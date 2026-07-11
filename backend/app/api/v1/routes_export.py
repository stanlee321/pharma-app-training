"""Case export router — real fill-PDF, with a summary-PDF fallback.

The primary path renders the **real anaesthesia form** (the notebook's 1:1 clone) with
the case's data stamped into each schema field's bounding box, via
``infrastructure.render.FormRenderer`` (keyed by the field-crosswalk). If the form_id is
unknown to the renderer, a clone/schema asset is missing, or anything else goes wrong, it
falls back to the **MVP summary PDF** below (a handful of case lines on a letter page) so
the export endpoint always returns a valid PDF. The ``form_id`` path segment selects the
form and labels the output file.
"""
from __future__ import annotations

import logging
from io import BytesIO

from fastapi import APIRouter, Depends, Response
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from ..deps import get_case_service
from ...application.case_service import CaseService
from ...infrastructure.render import FormRenderer

logger = logging.getLogger(__name__)
router = APIRouter()
_renderer = FormRenderer()


def _fmt(value: object) -> str:
    if value is None or value == "":
        return "—"
    if isinstance(value, float):
        return f"{value:.2f}".rstrip("0").rstrip(".")
    return str(value)


def _render_summary_pdf(case, form_id: str) -> bytes:
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    width, height = letter

    x = 72  # 1" left margin
    y = height - 72

    c.setFont("Helvetica-Bold", 18)
    c.drawString(x, y, "TivaTrainer — Case Summary")
    y -= 24

    c.setFont("Helvetica", 9)
    c.setFillGray(0.4)
    c.drawString(x, y, f"form: {form_id}    case: {case.id}")
    c.setFillGray(0.0)
    y -= 28

    patient = case.patient
    lines = [
        ("Paciente", patient.nombre),
        ("Edad", patient.profile.age),
        ("IMC", patient.imc),
        ("Diagnóstico preop.", case.diagnostico_preop),
        ("Técnica (modalidad)", case.technique.modality),
        ("Fármacos registrados", len(case.drugs)),
    ]

    totals = case.recovery.totals or {}
    if any(v is not None for v in totals.values()):
        rendered = ", ".join(f"{k}={_fmt(v)}" for k, v in totals.items() if v is not None)
        lines.append(("Aldrete (totales)", rendered))

    c.setFont("Helvetica", 12)
    for label, value in lines:
        c.setFont("Helvetica-Bold", 12)
        c.drawString(x, y, f"{label}:")
        c.setFont("Helvetica", 12)
        c.drawString(x + 170, y, _fmt(value))
        y -= 22

    c.showPage()
    c.save()
    return buf.getvalue()


@router.post("/cases/{case_id}/export/{form_id}")
def export_case(
    case_id: str,
    form_id: str,
    svc: CaseService = Depends(get_case_service),
) -> Response:
    """Render the real filled form for the case, falling back to a summary PDF.

    404 if the case is missing. Any renderer failure (unknown form_id, missing asset,
    draw error) degrades to the MVP summary PDF rather than erroring the request.
    """
    case = svc.get(case_id)  # raises HTTPException(404) when absent
    try:
        pdf_bytes = _renderer.render(case, form_id)
    except Exception:  # noqa: BLE001 - never fail the export; fall back to the summary
        logger.warning("fill-pdf render failed for form_id=%s; using summary", form_id,
                       exc_info=True)
        pdf_bytes = _render_summary_pdf(case, form_id)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{form_id}_{case_id}.pdf"'
        },
    )
