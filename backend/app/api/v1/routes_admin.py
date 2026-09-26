"""Admin API (plan phase 4). Every route requires an ``admin`` (401 without a valid identity,
403 for an anesthesiologist) via the router-level ``require_admin`` dependency.

Users
  GET    /admin/users?q=&role=&is_active=        -> UserDTO[]
  POST   /admin/users                            -> UserDTO (must_change_password = true)
  GET    /admin/users/{user_id}                  -> UserDTO
  PATCH  /admin/users/{user_id}                  -> UserDTO {full_name?, clave?, role?, is_active?}
  POST   /admin/users/{user_id}/reset-password   -> 204 (sets must_change_password)
  DELETE /admin/users/{user_id}                  -> 204; 409 if the user owns cases
  Guards (409): never delete/deactivate/demote yourself or the last active admin.
Cases
  GET    /admin/cases?status=&user_id=&patient_id=&q=&date_from=&date_to=&limit=&offset=
                                                 -> AdminCasePage (rows carry patient fields)
  GET    /admin/cases/{case_id}                  -> AnesthesiaCaseDTO
  DELETE /admin/cases/{case_id}                  -> 204 (any status; removes its document files)
  POST   /admin/cases/{case_id}/reopen           -> AnesthesiaCaseDTO (finalized -> draft)
Patients
  GET    /admin/patients?q=&limit=&offset=       -> PatientPage (with cases_count)
  DELETE /admin/patients/{patient_id}            -> 204; 409 while it has cases
Documents
  GET    /admin/documents?case_id=&form_id=&limit=&offset= -> AdminDocumentPage
Stats
  GET    /admin/stats                            -> AdminStatsDTO
"""
import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Path, Query, Response

from ..deps import get_admin_service, get_patient_service, require_admin
from ...application import dto
from ...application.admin_service import AdminService
from ...application.patient_service import PatientService

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)],
                   responses=dto.ERROR_RESPONSES)

# user ids are not always UUIDs (gateway JIT users keep the gateway's id, <= 36 chars)
UserIdPath = Path(min_length=1, max_length=36)
Limit = Query(50, ge=1, le=200, description="page size (1-200)")
Offset = Query(0, ge=0)


# --- users ---------------------------------------------------------------------------------
@router.get("/users", response_model=list[dto.UserDTO])
def admin_list_users(
    q: Optional[str] = Query(None, max_length=200,
                             description="substring of username, full_name or clave"),
    role: Optional[dto.UserRole] = None,
    is_active: Optional[bool] = None,
    svc: AdminService = Depends(get_admin_service),
):
    return svc.list_users(q=q, role=role, is_active=is_active)


@router.post("/users", response_model=dto.UserDTO)
def admin_create_user(body: dto.AdminUserCreate, svc: AdminService = Depends(get_admin_service)):
    """409 if the username (case-insensitive) is taken."""
    return svc.create_user(body)


@router.get("/users/{user_id}", response_model=dto.UserDTO)
def admin_get_user(user_id: str = UserIdPath, svc: AdminService = Depends(get_admin_service)):
    return svc.get_user(user_id)


@router.patch("/users/{user_id}", response_model=dto.UserDTO)
def admin_update_user(
    body: dto.AdminUserUpdate,
    user_id: str = UserIdPath,
    svc: AdminService = Depends(get_admin_service),
):
    return svc.update_user(user_id, body)


@router.post("/users/{user_id}/reset-password", status_code=204, response_class=Response)
def admin_reset_password(
    body: dto.ResetPasswordRequest,
    user_id: str = UserIdPath,
    svc: AdminService = Depends(get_admin_service),
) -> Response:
    svc.reset_password(user_id, body)
    return Response(status_code=204)


@router.delete("/users/{user_id}", status_code=204, response_class=Response)
def admin_delete_user(
    user_id: str = UserIdPath, svc: AdminService = Depends(get_admin_service)
) -> Response:
    svc.delete_user(user_id)
    return Response(status_code=204)


# --- cases ---------------------------------------------------------------------------------
@router.get("/cases", response_model=dto.AdminCasePage)
def admin_list_cases(
    status: Optional[dto.CaseStatus] = None,
    user_id: Optional[str] = Query(None, max_length=36),
    patient_id: Optional[uuid.UUID] = None,
    q: Optional[str] = Query(None, max_length=200, description=(
        "substring of patient name/registro (case snapshot or patient), diagnosis, procedure, "
        "owner, case id, owner username/full name")),
    date_from: Optional[date] = Query(None, description="created on/after (UTC day)"),
    date_to: Optional[date] = Query(None, description="created on/before (UTC day)"),
    limit: int = Limit,
    offset: int = Offset,
    svc: AdminService = Depends(get_admin_service),
):
    return svc.list_cases(status=status, user_id=user_id,
                          patient_id=str(patient_id) if patient_id else None,
                          q=q, date_from=date_from,
                          date_to=date_to, limit=limit, offset=offset)


@router.get("/cases/{case_id}", response_model=dto.AnesthesiaCaseDTO)
def admin_get_case(case_id: uuid.UUID, svc: AdminService = Depends(get_admin_service)):
    return svc.get_case(str(case_id))


@router.delete("/cases/{case_id}", status_code=204, response_class=Response)
def admin_delete_case(
    case_id: uuid.UUID, svc: AdminService = Depends(get_admin_service)
) -> Response:
    svc.delete_case(str(case_id))
    return Response(status_code=204)


@router.post("/cases/{case_id}/reopen", response_model=dto.AnesthesiaCaseDTO)
def admin_reopen_case(case_id: uuid.UUID, svc: AdminService = Depends(get_admin_service)):
    """finalized -> draft (stored documents are kept). 409 if the case is not finalized."""
    return svc.reopen_case(str(case_id))


# --- patients ------------------------------------------------------------------------------
@router.get("/patients", response_model=dto.PatientPage)
def admin_list_patients(
    q: Optional[str] = Query(None, max_length=200,
                             description="substring of nombre or registro"),
    limit: int = Limit,
    offset: int = Offset,
    svc: PatientService = Depends(get_patient_service),
):
    return svc.list(q=q, limit=limit, offset=offset)


@router.delete("/patients/{patient_id}", status_code=204, response_class=Response)
def admin_delete_patient(
    patient_id: uuid.UUID, svc: PatientService = Depends(get_patient_service)
) -> Response:
    """409 while the patient still has cases."""
    svc.delete(str(patient_id))
    return Response(status_code=204)


# --- documents -----------------------------------------------------------------------------
@router.get("/documents", response_model=dto.AdminDocumentPage)
def admin_list_documents(
    case_id: Optional[uuid.UUID] = None,
    form_id: Optional[dto.FormId] = None,
    limit: int = Limit,
    offset: int = Offset,
    svc: AdminService = Depends(get_admin_service),
):
    return svc.list_documents(case_id=str(case_id) if case_id else None, form_id=form_id,
                              limit=limit, offset=offset)


# --- stats ---------------------------------------------------------------------------------
@router.get("/stats", response_model=dto.AdminStatsDTO)
def admin_stats(svc: AdminService = Depends(get_admin_service)):
    return svc.stats()
