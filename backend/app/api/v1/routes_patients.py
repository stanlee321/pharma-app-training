"""Patients (historias clínicas) — plan docs/wiki/plans/patients-historias.md.

GET    /patients?q=&limit=&offset=   -> PatientPage        (any user; q over nombre/registro)
POST   /patients                     -> PatientDTO         (any user; 409 + patient_id on a
                                                            duplicate registro)
GET    /patients/{patient_id}        -> PatientDetailDTO   (any user; + every case, numbered)
PATCH  /patients/{patient_id}        -> PatientDTO         (any user; refreshes the identity
                                                            snapshot of its DRAFT cases; 409 +
                                                            patient_id on a duplicate registro)
DELETE /patients/{patient_id}        -> 204                (admin; 409 while it has cases)
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query, Response

from ..deps import get_patient_service
from ...application import dto
from ...application.patient_service import PatientService

router = APIRouter(tags=["patients"], responses=dto.ERROR_RESPONSES)

# Declared per route so openapi types the 409 body (it carries the existing patient's id).
PATIENT_CONFLICT = {409: {"model": dto.PatientConflictDTO,
                          "description": "A patient with this registro already exists"}}
Limit = Query(50, ge=1, le=200, description="page size (1-200)")
Offset = Query(0, ge=0)
SearchQ = Query(None, max_length=200, description="substring of nombre or registro")


@router.get("/patients", response_model=dto.PatientPage)
def list_patients(
    q: Optional[str] = SearchQ,
    limit: int = Limit,
    offset: int = Offset,
    svc: PatientService = Depends(get_patient_service),
):
    return svc.list(q=q, limit=limit, offset=offset)


@router.post("/patients", response_model=dto.PatientDTO, responses=PATIENT_CONFLICT)
def create_patient(body: dto.PatientCreate, svc: PatientService = Depends(get_patient_service)):
    return svc.create(body)


@router.get("/patients/{patient_id}", response_model=dto.PatientDetailDTO)
def get_patient(patient_id: uuid.UUID, svc: PatientService = Depends(get_patient_service)):
    return svc.get(str(patient_id))


@router.patch("/patients/{patient_id}", response_model=dto.PatientDTO,
              responses=PATIENT_CONFLICT)
def update_patient(
    patient_id: uuid.UUID,
    body: dto.PatientUpdate,
    svc: PatientService = Depends(get_patient_service),
):
    return svc.update(str(patient_id), body)


@router.delete("/patients/{patient_id}", status_code=204, response_class=Response)
def delete_patient(
    patient_id: uuid.UUID, svc: PatientService = Depends(get_patient_service)
) -> Response:
    svc.delete(str(patient_id))
    return Response(status_code=204)
