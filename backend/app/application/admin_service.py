"""Admin use-cases (plan phase 4): user accounts, cross-tenant case management, the document
index and dashboard statistics. Every method assumes an admin caller; the constructor refuses
anyone else (the routes are also guarded by ``api.deps.require_admin``).

User-roster guards (all 409):

* an admin can never delete, deactivate or demote THEMSELF;
* the last ACTIVE admin can never be deleted, deactivated or demoted. The check runs after
  ``SqlUserRepository.lock_active_admins`` inside the same transaction, so two admins demoting
  each other concurrently cannot both succeed;
* a user who owns cases cannot be deleted (``cases.user_id`` is ON DELETE RESTRICT); deactivate
  the account instead.

Admins never edit case content: on cases they read, delete (with the stored files) and reopen.
"""
from __future__ import annotations

import uuid
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from ..core import security
from ..infrastructure.models import UserModel
from ..infrastructure.repository import CaseFilter, SqlDocumentRepository, SqlUserRepository
from . import dto
from .auth_service import mark_password_changed, to_user_dto
from .case_service import CaseService, _utc, to_summary
from .document_service import to_admin_document_dto
from .identity import ROLE_ADMIN, CurrentUser

USER_NOT_FOUND = "User not found"
SELF_GUARD_DETAIL = "admins cannot delete, deactivate or demote themselves"
LAST_ADMIN_DETAIL = "the last active admin cannot be deleted, deactivated or demoted"
USERNAME_TAKEN_DETAIL = "username already exists"
STATS_DAYS = 30


def _as_utc(value: datetime | None) -> datetime | None:
    value = _utc(value)
    return value.astimezone(timezone.utc) if value is not None else None


def day_start(day: date) -> datetime:
    """00:00 UTC of ``day``."""
    return datetime.combine(day, time.min, tzinfo=timezone.utc)


class AdminService:
    def __init__(
        self,
        user: CurrentUser,
        users: SqlUserRepository,
        cases: CaseService,
        documents: SqlDocumentRepository,
    ):
        if not user.is_admin:
            raise HTTPException(status_code=403, detail="admin only")
        self.user = user
        self.users = users
        self.cases = cases
        self.documents = documents

    # ------------------------------------------------------------------ users
    def _user(self, user_id: str) -> UserModel:
        m = self.users.get(user_id)
        if m is None:
            raise HTTPException(status_code=404, detail=USER_NOT_FOUND)
        return m

    def _guard_last_admin(self, target: UserModel) -> None:
        """409 if removing ``target``'s active-admin status would leave no active admin.
        Leaves the transaction open (holding the admin lock) for the caller's write."""
        self.users.lock_active_admins()
        self.users.db.refresh(target)  # re-read under the lock (a concurrent change committed)
        if target.role == ROLE_ADMIN and target.is_active and self.users.count_active_admins() <= 1:
            self.users.db.rollback()
            raise HTTPException(status_code=409, detail=LAST_ADMIN_DETAIL)

    def list_users(self, *, q: str | None = None, role: str | None = None,
                   is_active: bool | None = None) -> list[dto.UserDTO]:
        return [to_user_dto(u) for u in self.users.search(q=q, role=role, is_active=is_active)]

    def get_user(self, user_id: str) -> dto.UserDTO:
        return to_user_dto(self._user(user_id))

    def create_user(self, req: dto.AdminUserCreate) -> dto.UserDTO:
        if self.users.get_by_username(req.username) is not None:
            raise HTTPException(status_code=409, detail=USERNAME_TAKEN_DETAIL)
        try:
            m = self.users.add(UserModel(
                id=str(uuid.uuid4()), username=req.username, full_name=req.full_name.strip(),
                clave=req.clave.strip(), role=req.role,
                password_hash=security.hash_password(req.password), is_active=True,
                must_change_password=True,
            ))
        except IntegrityError:  # lost a race on uq_users_username
            self.users.db.rollback()
            raise HTTPException(status_code=409, detail=USERNAME_TAKEN_DETAIL) from None
        return to_user_dto(m)

    def update_user(self, user_id: str, patch: dto.AdminUserUpdate) -> dto.UserDTO:
        m = self._user(user_id)
        changes = patch.model_dump(exclude_unset=True)
        demotes = "role" in changes and changes["role"] != ROLE_ADMIN and m.role == ROLE_ADMIN
        deactivates = changes.get("is_active") is False and m.is_active
        if demotes or deactivates:
            if m.id == self.user.id:
                raise HTTPException(status_code=409, detail=SELF_GUARD_DETAIL)
            self._guard_last_admin(m)
        for key in ("full_name", "clave"):
            if key in changes:
                setattr(m, key, changes[key].strip())
        if "role" in changes:
            m.role = changes["role"]
        if "is_active" in changes:
            m.is_active = changes["is_active"]
        return to_user_dto(self.users.save(m))

    def reset_password(self, user_id: str, req: dto.ResetPasswordRequest) -> None:
        """Set a new temporary password; the user must change it at next login. Stamps
        ``password_changed_at``, which revokes every token issued before the reset."""
        m = self._user(user_id)
        mark_password_changed(m, req.password)
        m.must_change_password = True
        self.users.save(m)

    def delete_user(self, user_id: str) -> None:
        m = self._user(user_id)
        if m.id == self.user.id:
            raise HTTPException(status_code=409, detail=SELF_GUARD_DETAIL)
        if m.role == ROLE_ADMIN and m.is_active:
            self._guard_last_admin(m)
        owned = self.users.count_cases(m.id)
        if owned:
            self.users.db.rollback()
            raise HTTPException(
                status_code=409,
                detail=f"user owns {owned} case(s); deactivate the account instead",
            )
        try:
            self.users.delete(m)
        except IntegrityError:  # a case was created for this user concurrently (RESTRICT)
            self.users.db.rollback()
            raise HTTPException(
                status_code=409, detail="user owns cases; deactivate the account instead"
            ) from None

    # ------------------------------------------------------------------ cases
    def list_cases(self, *, status: str | None = None, user_id: str | None = None,
                   q: str | None = None, date_from: date | None = None,
                   date_to: date | None = None, limit: int = 50, offset: int = 0,
                   ) -> dto.AdminCasePage:
        """Newest first. ``date_from``/``date_to`` are inclusive UTC calendar days on
        ``created_at``."""
        if date_from and date_to and date_from > date_to:
            raise HTTPException(status_code=422, detail="date_from must be on or before date_to")
        f = CaseFilter(
            status=status, user_id=user_id, q=q,
            created_from=day_start(date_from) if date_from else None,
            created_to=day_start(date_to + timedelta(days=1)) if date_to else None,
        )
        rows, total = self.cases.repo.search(f, limit=limit, offset=offset)
        return dto.AdminCasePage(
            items=[to_summary(m, owner) for m, owner in rows], total=total,
            limit=limit, offset=offset,
        )

    def get_case(self, case_id: str) -> dto.AnesthesiaCaseDTO:
        return self.cases.get(case_id)

    def delete_case(self, case_id: str) -> None:
        self.cases.admin_delete(case_id)

    def reopen_case(self, case_id: str) -> dto.AnesthesiaCaseDTO:
        return self.cases.reopen(case_id)

    # ------------------------------------------------------------------ documents
    def list_documents(self, *, case_id: str | None = None, form_id: str | None = None,
                       limit: int = 50, offset: int = 0) -> dto.AdminDocumentPage:
        rows, total = self.documents.search(
            case_id=case_id, form_id=form_id, limit=limit, offset=offset
        )
        return dto.AdminDocumentPage(
            items=[to_admin_document_dto(d) for d in rows], total=total,
            limit=limit, offset=offset,
        )

    # ------------------------------------------------------------------ stats
    def stats(self, *, now: datetime | None = None) -> dto.AdminStatsDTO:
        """Dashboard numbers. ``cases_per_day`` covers the last 30 UTC calendar days (today
        included), oldest first, zero-filled. Days are bucketed in Python from the raw
        ``created_at`` values, so SQLite and Postgres give the same answer regardless of the
        database session time zone."""
        now = _as_utc(now) if now else datetime.now(timezone.utc)
        today = now.date()
        first = today - timedelta(days=STATS_DAYS - 1)
        per_day = Counter(
            _as_utc(ts).date() for ts in self.cases.repo.created_since(day_start(first))
        )
        by_status = self.cases.repo.count_by_status()
        per_user = []
        for a in self.users.activity():
            stamps = [s for s in (_as_utc(a.last_case_update), _as_utc(a.user.last_login_at)) if s]
            per_user.append(dto.UserActivityDTO(
                user_id=a.user.id, username=a.user.username, full_name=a.user.full_name or "",
                drafts=a.drafts, finalized=a.finalized,
                last_activity=max(stamps) if stamps else None,
            ))
        return dto.AdminStatsDTO(
            cases_total=sum(by_status.values()),
            cases_by_status=dto.CasesByStatusDTO(
                draft=by_status.get("draft", 0), finalized=by_status.get("finalized", 0)
            ),
            cases_per_day=[
                dto.DailyCountDTO(date=first + timedelta(days=i),
                                  count=per_day.get(first + timedelta(days=i), 0))
                for i in range(STATS_DAYS)
            ],
            per_user=per_user,
            documents_total=self.documents.count(),
        )
