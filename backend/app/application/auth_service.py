"""Account use-cases: login, current user, change password, admin bootstrap, and resolving the
caller identity for both auth modes (Bearer JWT / trusted gateway headers)."""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from ..core import security
from ..infrastructure.models import UserModel
from ..infrastructure.repository import SqlUserRepository
from . import dto
from .identity import ROLE_ADMIN, ROLE_ANESTHESIOLOGIST, CurrentUser

_BEARER_CHALLENGE = {"WWW-Authenticate": "Bearer"}
GATEWAY_USERNAME_PREFIX = dto.GATEWAY_USERNAME_PREFIX
GATEWAY_USERNAME_DETAIL = f"usernames starting with {GATEWAY_USERNAME_PREFIX!r} are reserved"


def unauthorized(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(status_code=401, detail=detail, headers=_BEARER_CHALLENGE)


def _utc(value: datetime | None) -> datetime | None:
    """SQLite drops tzinfo on DateTime(timezone=True); every stored stamp is UTC."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def to_user_dto(u: UserModel) -> dto.UserDTO:
    return dto.UserDTO(
        id=u.id,
        username=u.username,
        full_name=u.full_name or "",
        clave=u.clave or "",
        role=u.role,
        is_active=bool(u.is_active),
        must_change_password=bool(u.must_change_password),
        created_at=_utc(u.created_at),
        updated_at=_utc(u.updated_at),
        last_login_at=_utc(u.last_login_at),
    )


def to_current_user(u: UserModel) -> CurrentUser:
    return CurrentUser(
        id=u.id, role=u.role, username=u.username, full_name=u.full_name or "",
        clave=u.clave or "", must_change_password=bool(u.must_change_password),
    )


def mark_password_changed(user: UserModel, password: str) -> None:
    """Set a new password hash and stamp ``password_changed_at`` (revokes older tokens)."""
    user.password_hash = security.hash_password(password)
    user.password_changed_at = datetime.now(timezone.utc)


def is_gateway_user(user: UserModel) -> bool:
    """A row the gateway may act as: JIT-provisioned (``gw-`` username) or password-less.
    Never a local account with a usable password (e.g. a local admin)."""
    return (
        (user.username or "").startswith(GATEWAY_USERNAME_PREFIX)
        or user.password_hash == security.UNUSABLE_PASSWORD
    )


def token_revoked(claims: dict, user: UserModel) -> bool:
    """True when the token predates the user's last password change. Both sides are compared
    at whole-second resolution (``iat`` is whole seconds), so a token issued in the same second
    right after the change stays valid."""
    changed = _utc(user.password_changed_at)
    if changed is None:
        return False
    try:
        iat = int(claims["iat"])
    except (KeyError, TypeError, ValueError):
        return True
    return iat < math.floor(changed.timestamp())


class AuthService:
    def __init__(self, users: SqlUserRepository):
        self.users = users

    # --- login / self-service ---
    def login(self, req: dto.LoginRequest) -> dto.LoginResponse:
        user = self.users.get_by_username(req.username)
        if user is None:
            security.burn_verify_time(req.password)
            raise unauthorized("Invalid username or password")
        if not security.verify_password(req.password, user.password_hash) or not user.is_active:
            raise unauthorized("Invalid username or password")
        issued = security.create_access_token(user.id, user.role)
        user = self.users.touch_login(user)
        return dto.LoginResponse(
            access_token=issued.access_token, expires_at=issued.expires_at,
            user=to_user_dto(user),
        )

    def me(self, current: CurrentUser) -> dto.UserDTO:
        user = self.users.get(current.id)
        if user is None:
            raise unauthorized()
        return to_user_dto(user)

    def change_password(self, current: CurrentUser, req: dto.ChangePasswordRequest) -> None:
        user = self.users.get(current.id)
        if user is None:
            raise unauthorized()
        if not security.verify_password(req.current_password, user.password_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        mark_password_changed(user, req.new_password)
        user.must_change_password = False
        self.users.save(user)

    # --- identity resolution (api.deps.get_current_user) ---
    def resolve_bearer(self, token: str | None) -> CurrentUser:
        if not token:
            raise unauthorized()
        try:
            claims = security.decode_access_token(token)
        except security.TokenError:
            raise unauthorized("Invalid or expired token") from None
        user = self.users.get(claims["sub"])
        if user is None or not user.is_active or token_revoked(claims, user):
            raise unauthorized("Invalid or expired token")
        # Role comes from the row, not the token: a demotion takes effect immediately.
        return to_current_user(user)

    def resolve_gateway(self, tenant_id: str) -> CurrentUser:
        """Legacy trusted-header mode: the gateway tenant id IS the user id. Unknown ids are
        provisioned just-in-time as anesthesiologists that can never log in locally.

        An existing row is only accepted when it is gateway-provisioned (``is_gateway_user``):
        a gateway header can never impersonate a local account (e.g. a local admin's id).
        Applies equally to the guest -> parent (``X-User-Created-By``) tenant."""
        tenant_id = (tenant_id or "").strip()
        if not tenant_id or len(tenant_id) > 36:
            raise unauthorized("Invalid gateway identity")
        user = self.users.get(tenant_id)
        if user is None:
            try:
                user = self.users.add_if_absent(UserModel(
                    id=tenant_id,
                    username=f"{GATEWAY_USERNAME_PREFIX}{tenant_id}",
                    role=ROLE_ANESTHESIOLOGIST,
                    password_hash=security.UNUSABLE_PASSWORD,
                    is_active=True,
                    must_change_password=False,
                ))
            except IntegrityError:  # e.g. the gw- username is taken by another row
                self.users.db.rollback()
                raise unauthorized("Invalid gateway identity") from None
        if not is_gateway_user(user):
            raise unauthorized("Invalid gateway identity")
        if not user.is_active:
            raise HTTPException(status_code=403, detail="User is inactive")
        return to_current_user(user)

    # --- admin bootstrap (CLI + optional env seed) ---
    def ensure_admin(
        self, username: str, password: str, *, full_name: str | None = None,
        clave: str | None = None,
    ) -> tuple[UserModel, bool]:
        """Idempotent: create the admin, or reset its password and force role admin + active.
        Returns (user, created)."""
        _check_username(username)
        _check_password(password)
        user = self.users.get_by_username(username)
        if user is None:
            user = self.users.add(UserModel(
                id=str(uuid.uuid4()), username=username, full_name=full_name or "",
                clave=clave or "", role=ROLE_ADMIN,
                password_hash=security.hash_password(password), is_active=True,
                must_change_password=False, password_changed_at=datetime.now(timezone.utc),
            ))
            return user, True
        mark_password_changed(user, password)
        user.role = ROLE_ADMIN
        user.is_active = True
        user.must_change_password = False
        if full_name is not None:
            user.full_name = full_name
        if clave is not None:
            user.clave = clave
        return self.users.save(user), False

    def bootstrap_admin(self, username: str, password: str) -> bool:
        """Dev seed: create the admin only if the username is free. Returns True if created."""
        if self.users.get_by_username(username) is not None:
            return False
        self.ensure_admin(username, password)
        return True


def _check_username(username: str) -> None:
    name = SqlUserRepository.normalize(username or "")
    if not name or len(name) > 64:
        raise ValueError("username must be 1-64 characters")
    if name.startswith(GATEWAY_USERNAME_PREFIX):
        raise ValueError(GATEWAY_USERNAME_DETAIL)


def _check_password(password: str) -> None:
    if not (dto.PASSWORD_MIN_LENGTH <= len(password or "") <= dto.PASSWORD_MAX_LENGTH):
        raise ValueError(
            f"password must be {dto.PASSWORD_MIN_LENGTH}-{dto.PASSWORD_MAX_LENGTH} characters"
        )
