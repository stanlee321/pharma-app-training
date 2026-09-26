"""Stored documents + finalize (plan phase 3).

POST   /cases/{case_id}/documents   {form_id}  -> DocumentDTO     (owner or admin; else 403)
GET    /cases/{case_id}/documents              -> DocumentDTO[]   (any user; newest first)
GET    /documents/{document_id}/file           -> application/pdf (any user)
DELETE /documents/{document_id}                -> 204             (admin, or owner while draft)
POST   /cases/{case_id}/finalize               -> AnesthesiaCaseDTO (owner; draft -> finalized,
                                                  stores all four forms)
"""
import uuid

from fastapi import APIRouter, Depends, Response

from ..deps import get_document_service
from ...application import dto
from ...application.document_service import DocumentService
from .routes_export import PDF_RESPONSE, pdf_response

router = APIRouter(tags=["documents"], responses=dto.ERROR_RESPONSES)


@router.post("/cases/{case_id}/documents", response_model=dto.DocumentDTO)
def generate_document(
    case_id: uuid.UUID,
    body: dto.GenerateDocumentRequest,
    svc: DocumentService = Depends(get_document_service),
):
    """Render the form (summary-PDF fallback), store it and record it. 422 on unknown form_id."""
    return svc.generate(str(case_id), body.form_id)


@router.get("/cases/{case_id}/documents", response_model=list[dto.DocumentDTO])
def list_documents(case_id: uuid.UUID, svc: DocumentService = Depends(get_document_service)):
    return svc.list(str(case_id))


@router.post("/cases/{case_id}/finalize", response_model=dto.AnesthesiaCaseDTO)
def finalize_case(case_id: uuid.UUID, svc: DocumentService = Depends(get_document_service)):
    """Lock the case (draft -> finalized) and store all four forms as its snapshot.
    403 admin or not the owner, 404 missing, 409 already finalized."""
    return svc.finalize(str(case_id))


@router.get(
    "/documents/{document_id}/file",
    response_class=Response,
    responses=PDF_RESPONSE,
)
def download_document(
    document_id: uuid.UUID,
    svc: DocumentService = Depends(get_document_service),
) -> Response:
    doc, content = svc.open(str(document_id))
    return pdf_response(content, f"{doc.form_id}_{doc.case_id}.pdf")


@router.delete("/documents/{document_id}", status_code=204, response_class=Response)
def delete_document(
    document_id: uuid.UUID,
    svc: DocumentService = Depends(get_document_service),
) -> Response:
    svc.delete(str(document_id))
    return Response(status_code=204)
