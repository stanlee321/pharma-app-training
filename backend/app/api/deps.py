"""Request-scoped dependencies, incl. the API-gateway caller identity.

The service runs behind the Lookia `ms-api-gateway`, which authenticates once and injects
`X-*` identity headers (see the cross-repo reference GATEWAY_HEADERS.md, mirrored in
docs/wiki/backend-api.md "Gateway integration"). We TRUST those headers — never re-validate
with Identity. For guest tokens the effective tenant is the parent (`X-User-Created-By`),
surfaced as `UserContext.owner_id`. With no gateway (local dev) we fall back to a mock tenant.
"""
from dataclasses import dataclass, field

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from ..application.case_service import CaseService
from ..core.config import settings
from ..core.db import get_db
from ..infrastructure.repository import SqlCaseRepository


@dataclass
class UserContext:
    """Caller identity parsed from the gateway headers (mirrors GATEWAY_HEADERS.md)."""

    user_id: str | None
    role: str | None
    scopes: list[str] = field(default_factory=list)
    created_by: str | None = None
    app_type: int | None = None
    request_id: str = ""
    # service-to-service (X-Service-Token path)
    service_name: str | None = None
    auth_mode: str | None = None

    @property
    def is_guest(self) -> bool:
        return self.role == "guest"

    @property
    def is_service_call(self) -> bool:
        return self.auth_mode == "service-token"

    @property
    def owner_id(self) -> str | None:
        """Effective resource owner: parent for guests, self otherwise."""
        return self.created_by if self.is_guest else self.user_id


def get_user_context(request: Request) -> UserContext:
    h = request.headers
    raw_scopes = h.get("X-User-Scopes", "")
    raw_app_type = h.get("X-App-Type")  # omitted when null — guard the int()
    return UserContext(
        user_id=h.get("X-User-Id"),
        role=h.get("X-User-Role"),
        scopes=[s for s in raw_scopes.split(",") if s],
        created_by=h.get("X-User-Created-By"),
        app_type=int(raw_app_type) if raw_app_type else None,
        request_id=h.get("X-Request-Id", ""),
        service_name=h.get("X-Service-Name"),
        auth_mode=h.get("X-Auth-Mode"),
    )


def get_case_service(
    db: Session = Depends(get_db),
    ctx: UserContext = Depends(get_user_context),
) -> CaseService:
    # Tenant key = the effective owner (parent for guests). Local dev without a gateway falls
    # back to the mock tenant so the service is usable standalone.
    tenant_id = ctx.owner_id or settings.mock_user_id
    return CaseService(SqlCaseRepository(db), tenant_id)
