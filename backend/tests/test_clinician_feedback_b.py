"""Clinician feedback 2026-11b (docs/wiki/plans/clinician-feedback-2026-11b.md).

Neuraxial technique detail, vascular access, O₂ suplementario, isquemia / neumoperitoneo
pressures, ventilation and positions over time, events on the "Tiempos del 1 al 6" row, fluids
summed from the time grid, the bleeding breakdown, and the struck-out "Tasa Fentanilo" row.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import fitz

from app.application.case_service import _derive
from app.application.dto import AnesthesiaCaseDTO
from app.domain import derivations
from app.infrastructure.render import crosswalk, extras
from app.infrastructure.render.renderer import FormRenderer

T0 = datetime(2026, 11, 20, 10, 45, tzinfo=timezone.utc)


def _case() -> AnesthesiaCaseDTO:
    every5 = lambda vals: [{"t": i * 5, "value": v} for i, v in enumerate(vals)]  # noqa: E731
    return _derive(AnesthesiaCaseDTO.model_validate({
        "isquemia": {"hr_inicio": "11:00", "hr_termino": "12:30", "sitio": "Muslo", "presion": 250},
        "neumoperitoneo": {"hr_inicio": "11:10", "presion": 12},
        "pre_assessment": {"labs": {"hb": 13.2, "ptl": 250, "tp": 12, "tpt": 30, "inr": 1.0}},
        "technique": {"modality": "Subaracnoidea", "values": {
            "aguja_Quincke": True, "aguja_calibre": "26", "nivel": "L3-L4", "nivel_bloqueo": "T10",
            "resultado_satisfactorio": True, "intentos": 2, "guiador": True, "cateter_cm": 10,
            "asepsia_Lumbar": True, "solucion_Isodine": True, "campo_Campo hendido": True,
            "dx_lidocaina": True, "dx_lidocaina_val": 40,
            "dx_bupivacaina": True, "dx_bupivacaina_val": 13, "dx_bupivacaina_via": "Subaracnoideo",
            "dx_fentanilo": True, "dx_fentanilo_val": 20, "dx_fentanilo_via": "Subaracnoideo"}},
        "trans_record": {
            "inicio": T0.isoformat(),
            "monitoring": {"PANI": True, "PAI": True, "Esofágica": True},
            "monitoring_otro": "Doppler", "notas": "Dexametasona 4 mg IV",
            "accesos": [{"tipo": "periferica", "calibre": "18G", "ubicacion": "Dorso mano"},
                        {"tipo": "central", "calibre": "7 Fr", "ubicacion": "Yugular"}],
            "o2_suplementario": {"dispositivo": "puntas_nasales", "flujo": 3},
            "events": [{"marker": 1, "t": 0}, {"marker": 2, "t": 5}, {"marker": 6, "t": 125}],
            "series": [
                {"lane": "fc", "points": every5([78, 77, 68])},
                {"lane": "ventilacion", "points": [{"t": 0, "value": "Espontánea"},
                                                   {"t": 10, "value": "Controlada"}]},
                {"lane": "posicion", "points": [{"t": 0, "value": "supina"}, {"t": 5, "value": "supina"},
                                                {"t": 30, "value": "litotomia"}]},
                {"lane": "fluido:Ringer lactato", "points": [{"t": 0, "value": 500}, {"t": 30, "value": 300},
                                                             {"t": 70, "value": 500}]},
                {"lane": "fluido:Gelatina succinilada", "points": [{"t": 65, "value": 250}]},
            ]},
        "fluid_balance": {"matrix": {"Diuresis": {"1hr": 100}, "Textiles": {"1hr": 50},
                                     "Aspirador": {"1hr": 100, "2hr": 30}}},
        "drugs": [
            {"farmaco": "", "dose_unit": "mg", "via": "IV"},  # an empty row (the " mg IV" bug)
            {"farmaco": "Fentanilo", "dose_value": 50, "dose_unit": "mcg", "via": "IV",
             "time": (T0 + timedelta(minutes=5)).isoformat()},
        ],
    }))


def _page_text(form_id: str, case: AnesthesiaCaseDTO, clip: fitz.Rect | None = None) -> str:
    pdf = FormRenderer().render(case, form_id)
    page = fitz.open(stream=pdf, filetype="pdf")[0]
    return page.get_text(clip=clip) if clip else page.get_text()


def test_fluid_balance_takes_intake_from_the_grid_and_sums_the_bleeding():
    fb = _case().fluid_balance
    assert fb.ingresos_grid == {"Ingreso Critaloide": {"1hr": 800.0, "2hr": 500.0},
                                "Ingreso Coloide": {"2hr": 250.0}}
    assert fb.sangrado == {"1hr": 150.0, "2hr": 30.0}
    assert fb.balance_parcial["1hr"] == 800 - 100 - 150
    assert fb.balance_parcial["2hr"] == 750 - 30
    # a typed intake wins over the grid
    out = derivations.fluid_balance({"Ingreso Critaloide": {"1hr": 1000}},
                                    grid={"Ingreso Critaloide": {"1hr": 800}})
    assert out["balance_parcial"]["1hr"] == 1000


def test_dose_needs_a_value_and_technique_doses_carry_their_route():
    case = _case()
    assert crosswalk._dose(case.drugs[0]) is None
    assert crosswalk.tech_drugs(case) == [
        ("Lidocaína", "40 mg Infiltración por planos"),
        ("Bupivacaína", "13 mg Subaracnoideo"),
        ("Fentanilo", "20 mcg Subaracnoideo"),
    ]


def test_nota2_neuraxial_block():
    case = _case()

    def field(fid: str, ftype: str = "text", label: str = "") -> object:
        return crosswalk.resolve(case, "nota_postanestesica", {"id": fid, "type": ftype, "label": label})

    assert field("intentos_143") == "2"
    assert field("sitio_144") == "L3-L4"
    assert field("intentos_126") is None          # epidural block stays empty
    assert field("min_nivel_de_difusion_183") == "T10 satisfactorio"
    assert field("aguja_hipodermica_guia_calibre_148", "checkbox_value") is True
    cateter = field("caudal_hasta_177", "checkbox_value")
    assert isinstance(cateter, crosswalk.TextOnly) and cateter == "10"   # no "Caudal" box
    assert field("bupivacaina_166", "checkbox_value") == "13 mg"
    assert field("fentanilo_171", "checkbox_value") == "20 mcg"
    assert field("lumbar_110", "checkbox", "Lumbar") is True
    assert field("isodine_114", "checkbox", "Isodine") is True
    assert field("campo_hendido_118", "checkbox", "Campo hendido") is True
    assert field("presion_223") == "12"
    assert "Lidocaína 40 mg Infiltración por planos" in field("farmacos_utilizados_230")
    obs = field("observaciones_incidentes_221")
    assert "Notas: Dexametasona 4 mg IV" in obs and "Otra monitorización: Doppler" in obs


def test_nota21_new_fields():
    case = _case()

    def field(fid: str, ftype: str = "open_field", label: str = "") -> object:
        return crosswalk.resolve(case, "registro_transanestesico", {"id": fid, "type": ftype, "label": label})

    assert field("horas_en_quirofano_39") == "2 h 05 min"
    assert field("tiempo_total_45") == "1.5"
    assert field("flujo_37") == "3"
    assert field("puntas_nasales_35", "checkbox") is True
    assert field("mascarilla_facial_36", "checkbox") is False
    assert field("pani_17", "checkbox", "PANI") is True
    assert field("pai_15", "checkbox", "PAi") is True
    assert field("esofagica_31", "checkbox", "Esofágica") is True
    assert field("otro_20", "checkbox", "Otro") is True
    assert field("ptl_58") == "250" and field("hb_56") == "13.2"
    assert field("posicion_51") is None   # drawn as symbols instead


def test_transanesthetic_record_prints_the_new_sections():
    case = _case()
    text = " ".join(_page_text("registro_transanestesico", case).split())  # wrapped cells
    for needle in ("18G", "Dorso mano", "7 Fr", "Yugular", "250", "12", "1300", "1550",
                   "Lidocaína", "40 mg Infiltración por planos", "13 mg Subaracnoideo", "10:45", "11:15"):
        assert needle in text, needle
    # the empty drug row does not print " mg IV"
    farmaco = _page_text("registro_transanestesico", case, fitz.Rect(27, 554, 208, 567))
    assert "mg IV" not in farmaco
    # events on the "Tiempos del 1 al 6" row, not inside the plot
    tiempos = _page_text("registro_transanestesico", case, fitz.Rect(109, 457.5, 602, 467))
    assert "1" in tiempos and "2" in tiempos and "6" in tiempos
    # "Tasa Fentanilo" row is struck out
    fluids = _page_text("registro_transanestesico", case, fitz.Rect(371, 716, 440, 729))
    assert "Tasa" not in fluids


def test_ventilation_line_and_position_symbols_are_drawn():
    case = _case()
    pdf = FormRenderer().render(case, "registro_transanestesico")
    page = fitz.open(stream=pdf, filetype="pdf")[0]
    vent = [d for d in page.get_drawings() if 426 < d["rect"].y0 and d["rect"].y1 < 450
            and d["rect"].x0 > 105 and d["rect"].width > 20]
    assert vent, "no ventilation line"
    pos = [d for d in page.get_drawings() if 527 <= d["rect"].y0 and d["rect"].y1 <= 541.5
           and d["rect"].x0 >= 462]
    assert len(pos) >= 2   # supina, then litotomía (the repeated supina is one change)
    assert extras.position_key("Litotomía") == "litotomia"
    assert extras.position_key("nope") is None


def test_web_and_backend_position_catalogues_match():
    from pathlib import Path
    ts = Path(__file__).resolve().parents[2] / "web" / "src" / "state" / "positions.ts"
    if not ts.is_file():  # the backend image has no web sources
        return
    src = ts.read_text(encoding="utf-8")
    for key in extras.POSITIONS:
        assert f"key: '{key}'" in src, key
