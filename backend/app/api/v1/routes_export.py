"""Case export router (legacy streaming export) — real fill-PDF, with a summary-PDF fallback.

``POST /cases/{id}/export/{form_id}`` streams the rendered bytes and stores nothing; the stored,
auditable path is ``POST /cases/{id}/documents`` (routes_documents). Rendering (real form first,
the MVP summary PDF on any failure, including an unknown form_id) lives in
``infrastructure.render.render_case_pdf``, shared with document generation and finalize.
"""
import re
import uuid

from fastapi import APIRouter, Depends, Response

from ..deps import get_case_service
from ...application import dto
from ...application.case_service import CaseService
from ...infrastructure.render import render_case_pdf

router = APIRouter(responses=dto.ERROR_RESPONSES)

PDF_RESPONSE = {200: {"content": {"application/pdf": {}}, "description": "PDF bytes"}}
_UNSAFE_FILENAME = re.compile(r"[^A-Za-z0-9._-]")


def pdf_response(content: bytes, filename: str) -> Response:
    safe = _UNSAFE_FILENAME.sub("_", filename)
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe}"'},
    )


@router.post(
    "/cases/{case_id}/export/{form_id}",
    response_class=Response,
    responses=PDF_RESPONSE,
)
def export_case(
    case_id: uuid.UUID,
    form_id: str,
    svc: CaseService = Depends(get_case_service),
) -> Response:
    """Render the real filled form for the case, falling back to a summary PDF.

    404 if the case is missing (or not readable by the caller). Nothing is stored.
    """
    case = svc.get(str(case_id))  # raises HTTPException(404) when absent / not readable
    pdf = render_case_pdf(case, form_id)
    return pdf_response(pdf.content, f"{form_id}_{case.id}.pdf")
