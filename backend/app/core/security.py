"""Password hashing (argon2 via pwdlib) and Bearer JWT issue/verify (PyJWT, HS256).

Pure helpers with no DB access. Never log passwords, hashes or tokens.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

from .config import settings

JWT_ALGORITHM = "HS256"

# Marker hash for accounts that can never log in with a password (gateway JIT users).
UNUSABLE_PASSWORD = "!"

_hasher = PasswordHash((Argon2Hasher(),))
# Verified against when the username is unknown, so a miss costs the same as a wrong password.
_DUMMY_HASH = _hasher.hash("tiva-timing-equaliser")


class TokenError(Exception):
    """The bearer token is missing, malformed, tampered with or expired."""


class JWTSecretMissing(RuntimeError):
    """TIVA_JWT_SECRET is empty: local-mode tokens cannot be issued or verified."""


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    """Constant-ish time check; an unusable/unknown hash never matches (and never raises)."""
    if not password_hash or password_hash == UNUSABLE_PASSWORD:
        _hasher.verify(password, _DUMMY_HASH)
        return False
    try:
        return _hasher.verify(password, password_hash)
    except Exception:  # noqa: BLE001 - malformed hash -> no match
        return False


def burn_verify_time(password: str) -> None:
    """Spend one argon2 verify for an unknown username (login timing equaliser)."""
    _hasher.verify(password, _DUMMY_HASH)


def _secret() -> str:
    if not settings.jwt_secret:
        raise JWTSecretMissing("TIVA_JWT_SECRET is not set")
    return settings.jwt_secret


@dataclass(frozen=True)
class IssuedToken:
    access_token: str
    expires_at: datetime


def create_access_token(user_id: str, role: str, *, now: datetime | None = None) -> IssuedToken:
    """HS256 JWT with ``sub`` (user id), ``role``, ``iat``, ``exp`` (TTL = TIVA_JWT_TTL_MINUTES)."""
    issued = (now or datetime.now(timezone.utc)).replace(microsecond=0)
    expires = issued + timedelta(minutes=settings.jwt_ttl_minutes)
    claims = {"sub": user_id, "role": role, "iat": issued, "exp": expires}
    return IssuedToken(jwt.encode(claims, _secret(), algorithm=JWT_ALGORITHM), expires)


def decode_access_token(token: str) -> dict:
    """Verify signature + expiry and return the claims; raise TokenError otherwise."""
    try:
        secret = _secret()
    except JWTSecretMissing as exc:
        raise TokenError("token verification unavailable") from exc
    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=[JWT_ALGORITHM],
            options={"require": ["sub", "exp", "iat"]},
        )
    except jwt.PyJWTError as exc:
        raise TokenError("invalid token") from exc
    if not isinstance(claims.get("sub"), str) or not claims["sub"]:
        raise TokenError("invalid token")
    return claims
