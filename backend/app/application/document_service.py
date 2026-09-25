"""Stored documents (plan phase 3): generate / list / download / delete PDFs, and finalize.

Authorization (reuses ``CaseService``'s readable/writable checks):

* generate + list + download — anyone who can READ the case: its owner (draft or finalized)
  or an admin. Anyone else -> 404.
* delete — an admin, or the owner while the case is still a draft (409 once finalized).
* finalize — the owner of a draft case only (403 admin, 404 others, 409 already finalized).

Consistency: a file is written BEFORE its row is committed. If the commit fails, the file just
written is removed, so a failed request leaves neither a row nor a file behind. Finalize writes
all four PDFs, then flips the status and inserts the four rows in ONE transaction (a
compare-and-set on ``status='draft'`` AND the ``version`` it rendered, so a write that commits
while the PDFs render makes finalize fail with 409 instead of locking data the PDFs do not show);
any failure removes every file it wrote.
Deleting a document commits the row removal first, then removes the file (an unremovable file
is logged and orphaned, never a dangling row).
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select

from ..infrastructure.models import CaseModel, DocumentModel
from ..infrastructure.render import render_case_pdf
from ..infrastructure.repository import SqlDocumentRepository
from ..infrastructure.storage import (
    DocumentStorage,
    StorageError,
    StoredFile,
    StoredFileMissing,
    sha256_hex,
)
from . import dto
from .case_service import FINALIZED_DETAIL, CaseService, _utc, canonical_id

logger = logging.getLogger(__name__)

DOCUMENT_NOT_FOUND = "Document not found"
FINALIZE_CONFLICT_DETAIL = "case changed during finalize; retry"
API_PREFIX = "/api/v1"


def download_url(document_id: str) -> str:
    return f"{API_PREFIX}/documents/{document_id}/file"


def to_document_dto(m: DocumentModel) -> dto.DocumentDTO:
    return dto.DocumentDTO(
        id=m.id, case_id=m.case_id, form_id=m.form_id, size_bytes=m.size_bytes,
        sha256=m.sha256, generated_by=m.generated_by, created_at=_utc(m.created_at),
        is_fallback=bool(m.is_fallback), download_url=download_url(m.id),
    )


def to_admin_document_dto(m: DocumentModel) -> dto.AdminDocumentDTO:
    return dto.AdminDocumentDTO(**to_document_dto(m).model_dump(), storage_path=m.storage_path)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def storage_key(case_id: str, form_id: str, at: datetime) -> str:
    """``<case_id>/<form_id>_<UTC yyyymmddTHHMMSSffffff>.pdf``"""
    return f"{case_id}/{form_id}_{at.astimezone(timezone.utc):%Y%m%dT%H%M%S%f}.pdf"


class DocumentService:
    def __init__(self, cases: CaseService, repo: SqlDocumentRepository, storage: DocumentStorage):
        self.cases = cases
        self.repo = repo
        self.storage = storage

    @property
    def user(self):
        return self.cases.user

    # ------------------------------------------------------------------ helpers
    def _check_form(self, form_id: str) -> None:
        if form_id not in dto.FORM_IDS:  # the routes' Literal already 422s; defence in depth
            raise HTTPException(status_code=422, detail=f"unknown form_id: {form_id!r}")

    def _store(self, case: dto.AnesthesiaCaseDTO, form_id: str) -> tuple[DocumentModel, StoredFile]:
        """Render + write one file and build (not add) its row."""
        pdf = render_case_pdf(case, form_id)
        case_id = str(case.id)
        at = _utc_now()
        try:
            stored = self.storage.save(pdf.content, storage_key(case_id, form_id, at))
        except StorageError:
            # Same-microsecond collision on the same form: retry once with a fresh stamp.
            at = _utc_now()
            stored = self.storage.save(pdf.content, storage_key(case_id, form_id, at))
        row = DocumentModel(
            id=str(uuid.uuid4()), case_id=case_id, form_id=form_id,
            storage_path=stored.path, size_bytes=stored.size_bytes, sha256=stored.sha256,
            is_fallback=pdf.is_fallback, generated_by=self.user.id, created_at=at,
        )
        return row, stored

    def _discard(self, files: list[StoredFile]) -> None:
        for f in files:
            try:
                self.storage.delete(f.path)
            except (OSError, StorageError):
                logger.error("could not remove orphaned document file after a failed write",
                             exc_info=True)

    def _document(self, document_id: str) -> DocumentModel:
        """The document row, if the caller can read its case (else 404, never 403)."""
        did = canonical_id(document_id)
        m = self.repo.get(did) if did else None
        if m is None:
            raise HTTPException(status_code=404, detail=DOCUMENT_NOT_FOUND)
        try:
            self.cases.readable(m.case_id)
        except HTTPException as exc:
            if exc.status_code == 404:
                raise HTTPException(status_code=404, detail=DOCUMENT_NOT_FOUND) from exc
            raise
        return m

    # ------------------------------------------------------------------ use-cases
    def generate(self, case_id: str, form_id: str) -> dto.DocumentDTO:
        self._check_form(form_id)
        case = self.cases.load(self.cases.readable(case_id))
        row, stored = self._store(case, form_id)
        try:
            self.repo.add(row)
            self.repo.commit()
        except Exception:
            self.repo.rollback()
            self._discard([stored])
            raise
        return to_document_dto(row)

    def list(self, case_id: str) -> list[dto.DocumentDTO]:
        m = self.cases.readable(case_id)
        return [to_document_dto(d) for d in self.repo.list_for_case(m.id)]

    def open(self, document_id: str) -> tuple[DocumentModel, bytes]:
        m = self._document(document_id)
        try:
            content = self.storage.open(m.storage_path)
        except StoredFileMissing as exc:
            logger.error("document %s: file missing on disk", m.id)
            raise HTTPException(status_code=404, detail="document file is missing") from exc
        except StorageError as exc:
            logger.error("document %s: stored path is outside the storage root", m.id)
            raise HTTPException(status_code=500, detail="document is unreadable") from exc
        if sha256_hex(content) != m.sha256:
            logger.error("document %s: sha256 mismatch on disk", m.id)
            raise HTTPException(status_code=500, detail="document integrity check failed")
        return m, content

    def delete(self, document_id: str) -> None:
        m = self._document(document_id)
        if not self.user.is_admin:
            case = self.cases.readable(m.case_id)  # the owner (readable already checked)
            if case.status == "finalized":
                raise HTTPException(status_code=409, detail=FINALIZED_DETAIL)
        path = m.storage_path
        self.repo.delete(m)
        self.repo.commit()
        try:
            self.storage.delete(path)
        except (OSError, StorageError):
            logger.warning("document %s: row deleted but the file could not be removed", m.id,
                           exc_info=True)

    def finalize(self, case_id: str) -> dto.AnesthesiaCaseDTO:
        """Owner only: render + store all four forms, then atomically lock the case and record
        the documents. Each form falls back to the summary PDF on its own; nothing half-applies."""
        m = self.cases.writable(case_id)  # 403 admin / 404 not own / 409 already finalized
        # The snapshot is rendered from THIS version of the row; the lock below only applies
        # if nothing wrote to the case meanwhile, so the stored PDFs always match the locked data.
        loaded_version = m.version
        case = self.cases.load(m)
        written: list[StoredFile] = []
        rows: list[DocumentModel] = []
        try:
            for form_id in dto.FORM_IDS:
                row, stored = self._store(case, form_id)
                written.append(stored)
                rows.append(row)
            if not self.cases.repo.set_status(
                m.id, expected="draft", status="finalized", finalized_at=_utc_now(),
                expected_version=loaded_version,
            ):
                raise HTTPException(status_code=409, detail=self._lost_finalize_detail(m.id))
            for row in rows:
                self.repo.add(row)
            self.repo.commit()
        except Exception:
            self.repo.rollback()
            self._discard(written)
            raise
        self.repo.db.refresh(m)
        return self.cases.load(m)

    def _lost_finalize_detail(self, case_id: str) -> str:
        """Why the finalize compare-and-set matched nothing (read in a fresh statement)."""
        status = self.repo.db.scalar(
            select(CaseModel.status).where(CaseModel.id == case_id)
        )
        if status == "draft":
            return FINALIZE_CONFLICT_DETAIL
        return FINALIZED_DETAIL
