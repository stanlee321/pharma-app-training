"""Clinician feedback 2026-11 (docs/wiki/plans/clinician-feedback-2026-11.md).

New case fields (antecedentes, examen físico, intercurrencias, infusions, the 5-minute time
grid) and how they reach the filled PDFs.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import fitz
import pytest

from app.application.dto import AnesthesiaCaseDTO
from app.infrastructure.render import crosswalk
from app.infrastructure.render.renderer import FormRenderer

T0 = datetime(2026, 11, 19, 8, 0, tzinfo=timezone.utc)


def _case() -> AnesthesiaCaseDTO:
    every5 = lambda vals: [{"t": i * 5, "value": v} for i, v in enumerate(vals)]  # noqa: E731
    return AnesthesiaCaseDTO.model_validate({
        "observaciones": "Sin eventos de vía aérea",
        "pre_assessment": {
            "antecedentes_patologicos": "Hipertensión arterial",
            "antecedentes_quirurgicos": "Colecistectomía 2019",
            "examen_fisico": {
                "cardiovascular": {"estado": "normal"},
                "osteomuscular": {"estado": "alterado", "hallazgos": "Escoliosis"},
            },
        },
        "technique": {"values": {"volatil_Sevoflurano": True}},
        "trans_record": {
            "inicio": T0.isoformat(),
            "intervalo_min": 5,
            "intercurrencias_tipos": {"Corte de energía eléctrica": True},
            "intercurrencias": "10 minutos sin luz",
            "events": [{"marker": 2, "t": 0}, {"marker": 3, "t": 15}],
            "series": [
                {"lane": "fc", "points": every5([80, 82, 78, 76])},
                {"lane": "ta_sys", "points": every5([120, 118, 110, 112])},
                {"lane": "ta_dia", "points": every5([70, 68, 65, 66])},
                {"lane": "spo2", "points": every5([95, 98, 99, 99])},
                {"lane": "o2", "points": every5([50, 50, 40, 40])},
                {"lane": "ekg", "points": [{"t": 0, "value": "Ritmo sinusal"}]},
                {"lane": "pocus", "points": [{"t": 10, "value": "Deslizamiento pleural presente"}]},
                {"lane": "entropia", "points": every5([45, 42])},
                {"lane": "inhalado:Sevoflurano", "points": [{"t": 0, "value": 2}, {"t": 20, "value": 2.5}]},
                {"lane": "fluido:Ringer lactato", "points": [{"t": 0, "value": 500}]},
                {"lane": "fluido:Albúmina 20 %", "points": [{"t": 10, "value": 100}]},
            ],
        },
        "drugs": [
            {"farmaco": "Propofol", "dose_value": 150, "dose_unit": "mg", "via": "IV",
             "time": T0.isoformat()},
            {"farmaco": "Noradrenalina", "dose_value": 0.1, "dose_unit": "mcg/kg/min", "via": "IV",
             "modo": "infusion", "time": (T0 + timedelta(minutes=20)).isoformat()},
        ],
    })


def test_new_fields_round_trip_and_default():
    blank = AnesthesiaCaseDTO()
    assert blank.pre_assessment.antecedentes_patologicos == ""
    assert blank.pre_assessment.examen_fisico == {}
    assert blank.trans_record.intervalo_min == 5
    assert blank.trans_record.inicio is None
    assert blank.drugs == []
    c = _case()
    again = AnesthesiaCaseDTO.model_validate_json(c.model_dump_json())
    ekg = next(s for s in again.trans_record.series if s.lane == "ekg")
    assert ekg.points[0].value == "Ritmo sinusal"           # text lanes keep text
    spo2 = next(s for s in again.trans_record.series if s.lane == "spo2")
    assert spo2.points[0].value == 95                         # numeric lanes stay numeric
    assert again.drugs[1].modo == "infusion"
    assert again.drugs[0].modo == "bolo"


def _field(form_schema: str, fid: str) -> dict:
    import json
    from app.core.config import settings
    with open(os.path.join(settings.schema_dir, form_schema), encoding="utf-8") as f:
        return next(x for x in json.load(f)["fields"] if x["id"] == fid)


def test_crosswalk_new_mappings():
    c = _case()
    otros = crosswalk.resolve(c, "imss_valoracion_preanestesica", _field("imss_p1.schema.json", "ant_otros"))
    assert "Patológicos: Hipertensión arterial" in otros
    assert "Quirúrgicos: Colecistectomía 2019" in otros
    assert "Osteomuscular: Alterado: Escoliosis" in otros
    cardio = crosswalk.resolve(c, "imss_valoracion_preanestesica",
                               _field("imss_p1.schema.json", "aparato_cardiovascular"))
    assert cardio == "Normal"
    obs = crosswalk.resolve(c, "nota_postanestesica", _field("nota2.schema.json", "observaciones_incidentes_221"))
    assert obs == ("Sin eventos de vía aérea; Intercurrencias: Corte de energía eléctrica; "
                   "10 minutos sin luz")
    assert crosswalk.resolve(c, "registro_transanestesico",
                             _field("nota21.schema.json", "cristaloides_66")) == "Ringer lactato"
    assert crosswalk.resolve(c, "registro_transanestesico",
                             _field("nota21.schema.json", "coloides_67")) == "Albúmina 20 %"
    assert crosswalk._dose(c.drugs[1]) == "Infusión continua 0.1 mcg/kg/min IV"


def test_sevoflurane_technique_checkbox_is_stamped():
    c = _case()
    sevo = _field("nota2.schema.json", "sevoflurano_36")
    assert crosswalk.resolve(c, "nota_postanestesica", sevo)
    other = _field("nota2.schema.json", "desflurano_37")
    assert not crosswalk.resolve(c, "nota_postanestesica", other)


def test_time_grid_is_drawn_on_the_transanesthetic_record():
    r = FormRenderer()
    if not (r._out_dir / "nota21_clone.pdf").is_file():
        pytest.skip("nota21 clone not generated")
    pdf = r.render(_case(), "registro_transanestesico")
    page = fitz.open(stream=pdf, filetype="pdf")[0]
    grid = page.get_text(clip=fitz.Rect(30, 80, 602, 232))
    for text in ("08:00", "09:00", "Sevoflurano (%)", "2.5", "Ringer lactato", "500",
                 "Ritmo sinusal", "Deslizamiento", "98", "E 45", "42"):
        assert text in grid, text
    # FC / TA / O2 values outside the axis or the grid never break the render
    if os.environ.get("TIVA_RENDER_PREVIEW"):
        page.get_pixmap(dpi=130, clip=fitz.Rect(0, 80, 612, 460)).save(os.environ["TIVA_RENDER_PREVIEW"])
