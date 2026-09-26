"""Request-scoped dependencies: the caller identity (both auth modes) and the services.

``get_current_user`` is the ONE identity dependency, switched by ``TIVA_AUTH_MODE``:

* ``local`` (default) — ``Authorization: Bearer <JWT>`` issued by ``POST /auth/login``;
  missing/invalid/expired token or inactive user -> 401.
* ``gateway`` (legacy) — the service runs behind the Lookia ``ms-api-gateway``, which
  authenticates once and injects ``X-*`` identity headers (GATEWAY_HEADERS.md, mirrored in
  docs/wiki/backend-api.md "Gateway integration"). We TRUST those headers. For guest tokens the
  effective tenant is the parent (``X-User-Created-By``, ``UserContext.owner_id``); with no
  header we fall back to the mock tenant. The tenant id is provisioned as a ``users`` row
  just-in-time (``cases.user_id`` is a FK to ``users.id``); an existing row is accepted only
  if it is gateway-provisioned (never a local account).

Pending password change (local mode): a user with ``must_change_password`` may only call the
two routes that depend on ``get_current_user_allow_pending`` (``GET /auth/me`` and
``POST /auth/change-password``); every route behind ``get_current_user`` (cases, documents,
export, ``/admin``) answers 403 ``{"detail": "password change required"}``.
"""
from dataclasses import dataclass, field

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from ..application.admin_service import AdminService
from ..application.auth_service import AuthService
from ..application.case_service import CaseService
from ..application.document_service import DocumentService
from ..application.patient_service import PatientService
from ..application.identity import CurrentUser
from ..core.config import settings
from ..core.db import get_db
from ..infrastructure.repository import (
    SqlCaseRepository,
    SqlDocumentRepository,
    SqlPatientRepository,
    SqlUserRepository,
)
from ..infrastructure.storage import DatabaseBlobStorage, DocumentStores, LocalFileStorage

__all__ = [
    "CurrentUser", "UserContext", "get_admin_service", "get_auth_service", "get_case_service",
    "get_current_user", "get_current_user_allow_pending", "get_document_service",
    "get_document_stores", "get_local_storage", "get_patient_service", "get_user_context",
    "require_admin",
]

ADMIN_ONLY_DETAIL = "admin only"
PASSWORD_CHANGE_REQUIRED_DETAIL = "password change required"

# auto_error=False: we raise our own 401 (and gateway mode needs no header at all). Declaring
# the scheme also publishes it in openapi.json for the generated web client.
_bearer = HTTPBearer(auto_error=False, description="JWT from POST /api/v1/auth/login")


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


def get_auth_service(db: Session = Depends(get_db)) -> AuthService:
    return AuthService(SqlUserRepository(db))


def get_current_user_allow_pending(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    auth: AuthService = Depends(get_auth_service),
) -> CurrentUser:
    """The caller, even while a password change is pending. ONLY for ``GET /auth/me`` and
    ``POST /auth/change-password``; every other route uses ``get_current_user``."""
    if settings.auth_mode == "gateway":
        ctx = get_user_context(request)
        # Tenant key = the effective owner (parent for guests); no header -> mock tenant.
        return auth.resolve_gateway(ctx.owner_id or settings.mock_user_id)
    return auth.resolve_bearer(credentials.credentials if credentials else None)


def get_current_user(
    user: CurrentUser = Depends(get_current_user_allow_pending),
) -> CurrentUser:
    """The caller; 403 while ``must_change_password`` is set (local mode)."""
    if settings.auth_mode == "local" and user.must_change_password:
        raise HTTPException(status_code=403, detail=PASSWORD_CHANGE_REQUIRED_DETAIL)
    return user


def get_local_storage() -> LocalFileStorage:
    """The on-disk store (absolute ``TIVA_DOCUMENTS_DIR``). Tests override this."""
    return LocalFileStorage(settings.documents_dir)


def get_document_stores(
    db: Session = Depends(get_db),
    local: LocalFileStorage = Depends(get_local_storage),
) -> DocumentStores:
    """Both adapters for this request. The database one shares the request's Session (FastAPI
    caches ``get_db`` per request), so blobs commit with their document rows. New documents go
    to ``TIVA_DOCUMENT_STORAGE`` (read per request)."""
    return DocumentStores(settings.document_storage, local=local, db=DatabaseBlobStorage(db))


def get_case_service(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
    stores: DocumentStores = Depends(get_document_stores),
) -> CaseService:
    return CaseService(SqlCaseRepository(db), user, SqlDocumentRepository(db), stores)


def get_document_service(
    db: Session = Depends(get_db),
    cases: CaseService = Depends(get_case_service),
    stores: DocumentStores = Depends(get_document_stores),
) -> DocumentService:
    return DocumentService(cases, SqlDocumentRepository(db), stores)


def get_patient_service(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
) -> PatientService:
    return PatientService(SqlPatientRepository(db), SqlCaseRepository(db), user)


def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Admin-only guard for every ``/admin`` route: 401 unauthenticated, 403 non-admin.
    The role is the one re-read from the DB by ``get_current_user``."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail=ADMIN_ONLY_DETAIL)
    return user


def get_admin_service(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_admin),
    cases: CaseService = Depends(get_case_service),
) -> AdminService:
    return AdminService(user, SqlUserRepository(db), cases, SqlDocumentRepository(db))
