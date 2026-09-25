"""The authenticated caller, as seen by the application layer (auth-mode agnostic)."""
from __future__ import annotations

from dataclasses import dataclass

ROLE_ANESTHESIOLOGIST = "anesthesiologist"
ROLE_ADMIN = "admin"


@dataclass(frozen=True)
class CurrentUser:
    """Resolved by ``api.deps.get_current_user`` from a Bearer JWT (local mode) or the gateway
    ``X-User-Id`` headers (gateway mode). Always backed by a ``users`` row."""

    id: str
    role: str
    username: str
    full_name: str = ""
    clave: str = ""
    # Local mode: while set, only GET /auth/me and POST /auth/change-password are allowed
    # (``api.deps.get_current_user`` answers 403 "password change required" elsewhere).
    must_change_password: bool = False

    @property
    def is_admin(self) -> bool:
        return self.role == ROLE_ADMIN
