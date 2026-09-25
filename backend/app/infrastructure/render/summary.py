"""MVP summary PDF: a handful of case lines on a letter page.

The fallback whenever the real fill-PDF form cannot be rendered (unknown form_id, a missing
clone/schema asset, a draw error), so export / document generation always yield a valid PDF.
"""
from __future__ import annotations

from io import BytesIO

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


def _fmt(value: object) -> str:
    if value is None or value == "":
        return "—"
    if isinstance(value, float):
        return f"{value:.2f}".rstrip("0").rstrip(".")
    return str(value)


def render_summary_pdf(case, form_id: str) -> bytes:
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
