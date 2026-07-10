"""Case export router — MVP summary PDF.

This is an **MVP summary PDF only**: it draws a handful of case-level lines onto a
single letter page so the export pipe is wired end-to-end. It does NOT yet fill the
real IMSS/nota forms — that later phase will wrap the ``notebooks/forms`` renderers,
keyed by the field-crosswalk (the schemas served from ``routes_forms``), to stamp
values into each form's bounding boxes. The ``form_id`` path segment is accepted now
so the URL contract is stable across that upgrade; here it only labels the output file.
"""
from __future__ import annotations

from io import BytesIO

from fastapi import APIRouter, Depends, Response
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from ..deps import get_case_service
from ...application.case_service import CaseService

router = APIRouter()


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
    """Render an MVP summary PDF for the case (404 if the case is missing)."""
    case = svc.get(case_id)  # raises HTTPException(404) when absent
    pdf_bytes = _render_summary_pdf(case, form_id)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{form_id}_{case_id}.pdf"'
        },
    )
