"""Patient (historia clínica) use-cases. Plan: docs/wiki/plans/patients-historias.md.

Visibility: patients are SHARED hospital-wide. Every authenticated user (anesthesiologist or
admin) lists, reads, creates and edits patients; ``created_by``/``updated_by`` record who did.
Deleting a patient is admin-only and refused (409) while it still has cases.

Uniqueness: ``registro`` (expediente) is stored trimmed and unique on ``lower(trim(registro))``.
Creating (or renaming a patient to) a registro that already exists raises
:class:`PatientExists`, answered as 409 ``{"detail": "patient exists", "patient_id": ...}`` so
the client can open the existing patient instead.

Snapshot refresh: a case keeps a copy of its patient's identity for the PDFs. Editing a patient
re-copies it into that patient's DRAFT cases (``case_service.apply_identity``) in the same
transaction as the patient update; finalized cases are never touched. Each draft is written with
a compare-and-set on its ``version``; a draft written concurrently is re-read and retried.
"""
from __future__ import annotations

import logging
import uuid

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from ..domain import derivations
from ..infrastructure.models import CaseModel, PatientModel
from ..infrastructure.repository import SqlCaseRepository, SqlPatientRepository
from . import dto
from .case_service import (
    PATIENT_NOT_FOUND,
    CaseService,
    _blob,
    _owner_name,
    _utc,
    apply_identity,
    canonical_id,
)
from .identity import CurrentUser

logger = logging.getLogger(__name__)

PATIENT_EXISTS_DETAIL = "patient exists"
PATIENT_HAS_CASES_DETAIL = "patient has cases; delete them first"
SNAPSHOT_RETRIES = 3


class PatientExists(Exception):
    """A patient with the same normalized registro already exists (-> 409 with its id)."""

    def __init__(self, patient_id: str):
        super().__init__(PATIENT_EXISTS_DETAIL)
        self.patient_id = patient_id

    def body(self) -> dict:
        return dto.PatientConflictDTO(patient_id=self.patient_id).model_dump()


def to_patient_dto(p: PatientModel, cases_count: int) -> dto.PatientDTO:
    return dto.PatientDTO(
        id=p.id, registro=p.registro, nombre=p.nombre or "", sexo=p.sexo or "",
        fecha_nacimiento=p.fecha_nacimiento, grupo_sanguineo=p.grupo_sanguineo or "",
        rh=p.rh or "", created_by=p.created_by, updated_by=p.updated_by,
        created_at=_utc(p.created_at), updated_at=_utc(p.updated_at),
        edad=derivations.age_years(p.fecha_nacimiento), cases_count=cases_count,
    )


class PatientService:
    def __init__(self, patients: SqlPatientRepository, cases: SqlCaseRepository,
                 user: CurrentUser):
        self.patients = patients
        self.cases = cases
        self.user = user

    # ------------------------------------------------------------------ helpers
    def _patient(self, patient_id: object) -> PatientModel:
        pid = canonical_id(patient_id)
        p = self.patients.get(pid) if pid else None
        if p is None:
            raise HTTPException(status_code=404, detail=PATIENT_NOT_FOUND)
        return p

    def _raise_if_taken(self, registro: str, *, other_than: str | None = None) -> None:
        existing = self.patients.get_by_registro(registro)
        if existing is not None and existing.id != other_than:
            raise PatientExists(existing.id)

    def _flush_or_conflict(self, registro: str | None, action) -> None:
        """Run ``action`` (a flush); a unique-index race on registro becomes PatientExists."""
        try:
            action()
        except IntegrityError:
            self.patients.rollback()
            existing = self.patients.get_by_registro(registro) if registro else None
            if existing is not None:
                raise PatientExists(existing.id) from None
            raise

    # ------------------------------------------------------------------ use-cases
    def list(self, *, q: str | None, limit: int, offset: int) -> dto.PatientPage:
        rows, total = self.patients.search(q=q, limit=limit, offset=offset)
        return dto.PatientPage(
            items=[to_patient_dto(p, n) for p, n in rows], total=total,
            limit=limit, offset=offset,
        )

    def create(self, req: dto.PatientCreate) -> dto.PatientDTO:
        self._raise_if_taken(req.registro)
        p = PatientModel(
            id=str(uuid.uuid4()), registro=req.registro, nombre=req.nombre, sexo=req.sexo,
            fecha_nacimiento=req.fecha_nacimiento, grupo_sanguineo=req.grupo_sanguineo,
            rh=req.rh, created_by=self.user.id, updated_by=self.user.id,
        )
        self._flush_or_conflict(req.registro, lambda: self.patients.add(p))
        self._flush_or_conflict(req.registro, self.patients.commit)
        return to_patient_dto(p, 0)

    def get(self, patient_id: str) -> dto.PatientDetailDTO:
        p = self._patient(patient_id)
        summaries = []
        for n, (m, owner) in enumerate(self.cases.for_patient(p.id), start=1):
            c = CaseService._load(m)
            summaries.append(dto.PatientCaseSummaryDTO(
                id=m.id, numero=n, created_at=c.created_at, fecha=c.fecha,
                diagnostico_preop=c.diagnostico_preop, status=c.status, user_id=m.user_id,
                author_name=_owner_name(owner),
                can_edit=(not self.user.is_admin and m.user_id == self.user.id
                          and m.status == "draft"),
            ))
        return dto.PatientDetailDTO(
            **to_patient_dto(p, len(summaries)).model_dump(), cases=summaries,
        )

    def update(self, patient_id: str, patch: dto.PatientUpdate) -> dto.PatientDTO:
        p = self._patient(patient_id)
        changes = patch.model_dump(exclude_unset=True)
        if "registro" in changes:
            self._raise_if_taken(changes["registro"], other_than=p.id)
        for key, value in changes.items():
            setattr(p, key, value)
        p.updated_by = self.user.id
        self._flush_or_conflict(p.registro, lambda: self.patients.touch(p))
        self._refresh_draft_snapshots(p)
        self._flush_or_conflict(p.registro, self.patients.commit)
        return to_patient_dto(p, self.patients.count_cases(p.id))

    def _refresh_draft_snapshots(self, p: PatientModel) -> None:
        """Re-copy the identity into every DRAFT case of ``p`` (not committed)."""
        for m in self.cases.drafts_for_patient(p.id):
            self._refresh_one(m, p)

    def _refresh_one(self, m: CaseModel, p: PatientModel) -> None:
        for _attempt in range(SNAPSHOT_RETRIES):
            if m.status != "draft":
                return  # finalized concurrently: never touched
            case = CaseService._load(m)
            before = case.patient.model_dump()
            apply_identity(case.patient, p)
            if case.patient.model_dump() == before:
                return
            if self.cases.replace_draft_data(m.id, data=_blob(case),
                                             expected_version=m.version):
                return
            self.cases.db.refresh(m)  # written concurrently: re-read and retry
        logger.warning("patient %s: could not refresh the snapshot of draft case %s", p.id, m.id)

    def delete(self, patient_id: str) -> None:
        """Admin only; 409 while the patient has cases (``cases.patient_id`` is RESTRICT)."""
        if not self.user.is_admin:
            raise HTTPException(status_code=403, detail="admin only")
        p = self._patient(patient_id)
        if self.patients.count_cases(p.id):
            raise HTTPException(status_code=409, detail=PATIENT_HAS_CASES_DETAIL)
        try:
            self.patients.delete(p)
            self.patients.commit()
        except IntegrityError:  # a case was created for it concurrently
            self.patients.rollback()
            raise HTTPException(status_code=409, detail=PATIENT_HAS_CASES_DETAIL) from None
