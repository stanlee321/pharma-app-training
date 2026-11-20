"""First-cut field crosswalk: schema field ``id`` -> a value pulled off the case.

Maps a *demonstrable subset* of each form's fields (not all ~471) onto the
``AnesthesiaCaseDTO``. The renderer (``renderer.py``) walks each schema's fields, asks
this module to ``resolve`` a value for the field, and only draws when the resolver
returns something non-empty — so unmapped fields simply stay blank.

Return-value convention (interpreted by the renderer per field ``type``):
  * text / number / open_field / imss text  -> a ``str`` (or ``None`` to skip)
  * checkbox                                 -> ``True`` to stamp an "X", else falsy
  * checkbox_value                           -> ``True`` (stamp box only), or a ``str``
                                                (stamp box + write the value), else falsy

Tables (``farmaco``, ``control_fluidos``) and the imss score grid are handled directly
by the renderer against the case collections — they are not simple id->value fields.
"""
from __future__ import annotations

import unicodedata
from typing import Any, Optional

from ...application.dto import AnesthesiaCaseDTO


# ---------------------------------------------------------------------------- helpers
def _norm(s: Any) -> str:
    """Accent-stripped, lowercased, alnum-only key for fuzzy matching."""
    if s is None:
        return ""
    txt = unicodedata.normalize("NFKD", str(s))
    txt = "".join(c for c in txt if not unicodedata.combining(c))
    # normalise common sub/superscript digits (SpO₂ -> spo2)
    txt = txt.translate(str.maketrans("₀₁₂₃₄₅₆₇₈₉", "0123456789"))
    return "".join(c for c in txt.lower() if c.isalnum())


def _s(v: Any) -> Optional[str]:
    """Stringify a scalar for drawing; ``None`` for empty (but keep numeric 0)."""
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, float):
        if v != v:  # NaN
            return None
        out = f"{v:.2f}".rstrip("0").rstrip(".")
        return out or "0"
    out = str(v).strip()
    return out or None


class TextOnly(str):
    """A ``checkbox_value`` value written into the blank WITHOUT stamping its box (e.g. the
    "Caudal, Hasta __ cm" blank, whose box means the catheter direction, not the distance)."""


def _sex(gender: str) -> Optional[str]:
    g = (gender or "").strip().lower()
    if g.startswith("f"):
        return "F"
    if g.startswith("m"):
        return "M"
    return None


def _fecha(dt: Any) -> Optional[str]:
    if dt is None:
        return None
    try:
        return dt.strftime("%Y-%m-%d")
    except Exception:  # noqa: BLE001 - best effort
        return _s(dt)


def _dose(drug: Any, mark_infusion: bool = True) -> Optional[str]:
    """``"150 mg IV"``; a continuous infusion reads ``"Infusión continua 0.1 mcg/kg/min IV"``
    unless ``mark_infusion`` is off (the caller shows it next to the drug name instead)."""
    if _s(drug.dose_value) is None:
        return None  # a unit + route alone (" mg IV") says nothing
    parts = [_s(drug.dose_value), _s(drug.dose_unit), _s(drug.via)]
    joined = " ".join(p for p in parts if p)
    if joined and mark_infusion and getattr(drug, "modo", "bolo") == "infusion":
        return f"Infusión continua {joined}"
    return joined or None


def _join(*parts: tuple[str, Any]) -> Optional[str]:
    """``"Label: text; Label: text"`` from the non-empty parts (label "" = text alone)."""
    out = []
    for label, text in parts:
        txt = (text or "").strip() if isinstance(text, str) else _s(text)
        if txt:
            out.append(f"{label}: {txt}" if label else txt)
    return "; ".join(out) or None


# examen_fisico system key -> printed name (web/src/state/physicalExam.ts is the catalogue)
EXAM_SYSTEMS: dict[str, str] = {
    "neurologico": "Neurológico",
    "cardiovascular": "Cardiovascular",
    "respiratorio": "Respiratorio",
    "gastrointestinal": "Abdomen / gastrointestinal",
    "renal": "Renal / genitourinario",
    "endocrinometabolico": "Endocrinometabólico",
    "osteomuscular": "Osteomuscular",
    "hematologico": "Hematológico",
    "tegumentos": "Piel y tegumentos",
}


def _exam(case: AnesthesiaCaseDTO, key: str) -> Optional[str]:
    """One system of the physical exam as print text ("Normal" / "Alterado: findings")."""
    ex = (case.pre_assessment.examen_fisico or {}).get(key)
    if ex is None:
        return None
    estado = {"normal": "Normal", "alterado": "Alterado"}.get(ex.estado, "")
    return _join((estado, ex.hallazgos)) if estado and ex.hallazgos.strip() else (
        estado or _s(ex.hallazgos))


def _exam_rest(case: AnesthesiaCaseDTO, skip: tuple[str, ...]) -> Optional[str]:
    """The systems that have no slot of their own on the form."""
    return _join(*[(EXAM_SYSTEMS[k], _exam(case, k)) for k in EXAM_SYSTEMS if k not in skip])


def _observaciones(case: AnesthesiaCaseDTO) -> Optional[str]:
    """Observaciones plus the intercurrencias (events not caused by the medical act)."""
    tr = case.trans_record
    tipos = ", ".join(k for k, v in (tr.intercurrencias_tipos or {}).items() if v)
    inter = _join(("", tipos), ("", tr.intercurrencias))
    return _join(("", case.observaciones), ("Intercurrencias", inter), ("Notas", tr.notas),
                 ("Otra monitorización", tr.monitoring_otro))


# nota21 fluid name field -> control_fluidos intake row (domain.derivations.fluid_kind)
_FLUID_FIELDS = {
    "cristaloides_66": "Ingreso Critaloide",
    "coloides_67": "Ingreso Coloide",
    "hemocomponentes_68": "Ingreso hemocomponente",
}


def _grid_fluids(case: AnesthesiaCaseDTO) -> list[tuple[str, float]]:
    """``(name, total ml)`` of each time-grid IV fluid that holds values."""
    from .timegrid import FLUID_PREFIX
    out = []
    for s in case.trans_record.series:
        if not s.lane.startswith(FLUID_PREFIX) or not s.points:
            continue
        ml = sum(p.value for p in s.points
                 if isinstance(p.value, (int, float)) and not isinstance(p.value, bool))
        out.append((s.lane[len(FLUID_PREFIX):].strip(), float(ml)))
    return out


def _fluid_names(case: AnesthesiaCaseDTO, field_id: str) -> Optional[str]:
    from ...domain.derivations import fluid_kind
    row = _FLUID_FIELDS[field_id]
    names = []
    for name, _ml in _grid_fluids(case):
        if fluid_kind(name) == row and name not in names:
            names.append(name)
    return ", ".join(names) or None


def fluid_totals(case: AnesthesiaCaseDTO) -> dict[str, float]:
    """ml per intake row ("Ingreso Critaloide"…) and "total" over the whole time grid."""
    from ...domain.derivations import fluid_kind
    out: dict[str, float] = {}
    for name, ml in _grid_fluids(case):
        row = fluid_kind(name) or "otros"
        out[row] = out.get(row, 0.0) + ml
        out["total"] = out.get("total", 0.0) + ml
    return out


def _hhmm(v: Optional[str]) -> Optional[int]:
    """Minutes since midnight of "HH:MM" (or an ISO datetime), else None."""
    if not v:
        return None
    txt = str(v).strip()
    if "T" in txt:
        txt = txt.split("T", 1)[1]
    try:
        h, m = txt.split(":")[:2]
        return int(h) * 60 + int(m[:2])
    except (ValueError, IndexError):
        return None


def _duration(minutes: Optional[float]) -> Optional[str]:
    """``"2 h 35 min"``; None for a missing or negative span."""
    if minutes is None or minutes < 0:
        return None
    h, m = divmod(int(round(minutes)), 60)
    return f"{h} h {m:02d} min" if h else f"{m} min"


def _isquemia_total(case: AnesthesiaCaseDTO) -> Optional[str]:
    a, b = _hhmm(case.isquemia.hr_inicio), _hhmm(case.isquemia.hr_termino)
    if a is None or b is None:
        return None
    span = b - a if b >= a else b + 24 * 60 - a
    return crosswalk_hours(span)


def crosswalk_hours(minutes: float) -> str:
    """Hours with two decimals at most ("1.5") — the form's unit is Hrs."""
    return _s(round(minutes / 60.0, 2)) or "0"


def _horas_quirofano(case: AnesthesiaCaseDTO) -> Optional[str]:
    """From event 1 (ingresa a quirófano) to 6 (sale), else the first to the last event."""
    ev = {e.marker: e.t for e in case.trans_record.events}
    if 1 in ev and 6 in ev:
        return _duration(ev[6] - ev[1])
    if len(ev) >= 2:
        return _duration(max(ev.values()) - min(ev.values()))
    return None


def _lab(case: AnesthesiaCaseDTO, *names: str) -> Optional[str]:
    labs = case.pre_assessment.labs or {}
    idx = {_norm(k): v for k, v in labs.items()}
    for n in names:
        if _norm(n) in idx:
            return _s(idx[_norm(n)])
    return None


def _drug_match(case: AnesthesiaCaseDTO, label: str) -> Any:
    """Find a case drug whose farmaco name matches (either direction) the field label."""
    key = _norm(label)
    if not key:
        return None
    for d in case.drugs:
        dn = _norm(d.farmaco)
        if dn and (dn in key or key in dn):
            return d
    return None


# technique.values multi-select key prefixes (web/src/state/techniqueFields.ts)
_MULTI_PREFIXES = ("volatil_", "aguja_", "asepsia_", "solucion_", "campo_")

# technique.values dose rows (``<key>`` bool + ``<key>_val`` number + optional ``<key>_via``):
# key -> (printed name, unit, default route). Web: state/techniqueFields.ts.
TECH_DOSES: dict[str, tuple[str, str, str]] = {
    "ind_propofol": ("Propofol", "mg", "IV"),
    "ind_fentanilo": ("Fentanilo", "mcg", "IV"),
    "ind_midazolam": ("Midazolam", "mg", "IV"),
    "ind_rocuronio": ("Rocuronio", "mg", "IV"),
    "dx_lidocaina": ("Lidocaína", "mg", "Infiltración por planos"),
    "dx_bupivacaina": ("Bupivacaína", "mg", ""),
    "dx_fentanilo": ("Fentanilo", "mcg", ""),
    "dx_morfina": ("Morfina", "mcg", ""),
}
_NEURAXIAL_DOSES = ("dx_lidocaina", "dx_bupivacaina", "dx_fentanilo", "dx_morfina")


def tech_dose(case: AnesthesiaCaseDTO, key: str, with_route: bool = True) -> Optional[str]:
    """``"13 mg subaracnoideo"`` for a ticked technique dose row, else None."""
    vals = case.technique.values or {}
    if not vals.get(key):
        return None
    _name, unit, default_via = TECH_DOSES[key]
    num = vals.get(f"{key}_val")
    amount = _s(num) if isinstance(num, (int, float)) and not isinstance(num, bool) else None
    via = vals.get(f"{key}_via") if isinstance(vals.get(f"{key}_via"), str) else ""
    via = ((via or "").strip() or default_via) if with_route else ""
    parts = [f"{amount} {unit}" if amount else None, via or None]
    return " ".join(p for p in parts if p) or ""


def tech_drugs(case: AnesthesiaCaseDTO, keys: tuple[str, ...] = _NEURAXIAL_DOSES) -> list[tuple[str, str]]:
    """``(name, "dose route")`` of the ticked technique dose rows (neuraxial by default)."""
    out = []
    for k in keys:
        d = tech_dose(case, k)
        if d is not None:
            out.append((TECH_DOSES[k][0], d))
    return out


def _farmacos_utilizados(case: AnesthesiaCaseDTO) -> Optional[str]:
    items = [f"{n} {d}".strip() for n, d in tech_drugs(case)]
    for drug in case.drugs:
        name = (drug.farmaco or "").strip()
        if name:
            items.append(" ".join(x for x in (name, _dose(drug)) if x))
    return "; ".join(items) or None


def _neuraxial(case: AnesthesiaCaseDTO, fid: str) -> Any:
    """nota2 neuraxial block fields from technique.values (clinician feedback 2026-11b)."""
    vals = case.technique.values or {}
    mod = _norm(case.technique.modality)
    sub = mod in ("subaracnoidea", "mixta")
    epi = mod in ("epidural", "mixta")

    def text(k: str) -> Optional[str]:
        v = vals.get(k)
        return _s(v) if not isinstance(v, bool) else None

    nivel_bloqueo = text("nivel_bloqueo")
    if vals.get("resultado_satisfactorio"):
        nivel_bloqueo = f"{nivel_bloqueo} satisfactorio" if nivel_bloqueo else "Satisfactorio"
    table: dict[str, Any] = {
        "intentos_143": text("intentos") if sub else None,
        "sitio_144": text("nivel") if sub else None,
        "intentos_126": text("intentos") if epi else None,
        "sitio_127": text("nivel") if epi else None,
        "calibre_130": text("aguja_calibre") if epi else None,
        "aguja_hipodermica_guia_calibre_148": True if vals.get("guiador") else None,
        "min_nivel_de_difusion_183": nivel_bloqueo,
        "caudal_hasta_177": TextOnly(text("cateter_cm")) if text("cateter_cm") else None,
        "bupivacaina_166": tech_dose(case, "dx_bupivacaina", with_route=False),
        "fentanilo_171": tech_dose(case, "dx_fentanilo", with_route=False),
        "morfina_172": tech_dose(case, "dx_morfina", with_route=False),
        "propofol_25": tech_dose(case, "ind_propofol", with_route=False),
        "fentanilo_27": tech_dose(case, "ind_fentanilo", with_route=False),
        "rocuronio_31": tech_dose(case, "ind_rocuronio", with_route=False),
    }
    if fid == "whitacre_calibre_147" and sub and text("aguja_calibre"):
        g = text("aguja_calibre")
        return g if vals.get("aguja_Whitacre") else TextOnly(g)
    v = table.get(fid)
    return v or (True if v == "" else None)


def _technique_on(case: AnesthesiaCaseDTO, field: dict) -> bool:
    """True if this checkbox field is selected via technique.modality or technique.values."""
    fid = field.get("id", "")
    label = field.get("label") or ""
    tech = case.technique
    vals = tech.values or {}
    # exact field-id hit in the values blob
    if bool(vals.get(fid)):
        return True
    # a values key that normalises to this field's label; multi-select keys carry a prefix
    # ("volatil_Sevoflurano", "aguja_Tuohy") that is not part of the label
    nlabel = _norm(label)
    if nlabel:
        for k, v in vals.items():
            if not bool(v):
                continue
            nk = _norm(k)
            for prefix in _MULTI_PREFIXES:
                if k.startswith(prefix):
                    nk = _norm(k[len(prefix):])
            if nk == nlabel or (nk == "n2o" and nlabel.startswith("n2o")):
                return True
    # the chosen modality
    nmod = _norm(tech.modality)
    if nmod and nlabel and nmod == nlabel:
        return True
    if nmod and fid.startswith(nmod + "_"):
        return True
    return False


# --------------------------------------------------------------- aldrete (imss score)
# schema criterion slug (from the field id) -> normalised candidates present in the data
_ALDRETE_CRIT = {
    "actividadm": ("actividad", "actividadmuscular"),
    "respiracio": ("respiracion", "respiración"),
    "circulacio": ("circulacion", "circulación"),
    "estadodeco": ("conciencia", "estadodeconciencia", "estado"),
    "coloracion": ("coloracion", "coloración", "color"),
}
# column suffix -> normalised time-point candidates in the data. c0 ("AL SALIR") is only
# filled from an explicit "al salir"-style key — we do NOT alias it to the "0 min" value.
_ALDRETE_TP = {
    "c0": ("alsalir", "salir"),
    "c1": ("0", "0min", "almin"),
    "c2": ("20", "20min"),
    "c3": ("60", "60min"),
    "c4": ("90", "90min"),
    "c5": ("120", "120min"),
}


def resolve_aldrete(case: AnesthesiaCaseDTO, field_id: str) -> Optional[str]:
    """Best-effort digit for an imss ``aldrete_<crit>_c<n>`` score cell.

    Returns ``None`` (skip) when the criterion/time-point can't be confidently mapped —
    we do NOT guess wildly here.
    """
    try:
        _, crit_slug, col = field_id.split("_")
    except ValueError:
        return None
    aldrete = case.recovery.aldrete or {}
    totals = case.recovery.totals or {}
    tp_cands = _ALDRETE_TP.get(col, ())
    if crit_slug == "total":
        norm_tot = {_norm(k): v for k, v in totals.items()}
        for tp in tp_cands:
            if tp in norm_tot and norm_tot[tp] is not None:
                return _s(norm_tot[tp])
        return None
    crit_cands = _ALDRETE_CRIT.get(crit_slug)
    if not crit_cands:
        return None
    # find the criterion dict
    norm_crit = {_norm(k): v for k, v in aldrete.items()}
    row = None
    for c in crit_cands:
        if c in norm_crit:
            row = norm_crit[c]
            break
    if not isinstance(row, dict):
        return None
    norm_row = {_norm(k): v for k, v in row.items()}
    for tp in tp_cands:
        if tp in norm_row and norm_row[tp] is not None:
            return _s(norm_row[tp])
    return None


def _has_lane(case: AnesthesiaCaseDTO, lane: str) -> bool:
    return any(s.lane == lane and s.points for s in case.trans_record.series)


# --------------------------------------------------------------------- per-form maps
def _nota21(case: AnesthesiaCaseDTO, field: dict) -> Any:
    fid = field["id"]
    ftype = field["type"]
    p = case.patient
    prof = p.profile

    static: dict[str, Any] = {
        "sala_0": case.sala,
        "servicio_1": case.servicio,
        "turno_2": case.turno,
        "registro_4": p.registro,
        "edad_5": _s(prof.age),
        "sexo_6": _sex(prof.gender),
        "hab_7": p.hab,
        "fecha_10": _fecha(case.fecha),
        # dx / cirugia block
        "preoperatorio_40": case.diagnostico_preop,
        "operatorio_44": case.diagnostico_postop,
        "propuesto_46": case.operacion_propuesta,
        "realizado_48": case.operacion_realizada,
        "premedicacion_50": case.pre_assessment.premedicacion,
        "posicion_51": None if _has_lane(case, "posicion") else case.posicion,
        "horas_en_quirofano_39": _horas_quirofano(case),
        "tiempo_total_45": _isquemia_total(case),
        "flujo_37": _s(case.trans_record.o2_suplementario.flujo),
        # isquemia / neumoperitoneo
        "isquemia_hr_inicio_41": case.isquemia.hr_inicio,
        "hr_termino_42": case.isquemia.hr_termino,
        "sitio_de_isquemia_47": case.isquemia.sitio,
        "neumoperitoneo_hr_inicio_49": case.neumoperitoneo.hr_inicio,
        # somatometry
        "peso_52": _s(prof.weight),
        "talla_53": _s(prof.height),
        "imc_54": _s(p.imc),
        "peso_ideal_55": _s(p.peso_ideal),
        "hb_56": _s(p.hb) or _lab(case, "hb"),
        "mg_dl_hto_57": _s(p.hto) or _lab(case, "hto"),
        "vsc_62": _s(p.vsc),
        "25_del_vsc_64": _s(p.vsc_25),
        "15_del_vsc_65": _s(p.vsc_15),
        # coagulation labs (best effort)
        "tp_59": _lab(case, "tp"),
        "tpt_60": _lab(case, "tpt"),
        "inr_61": _lab(case, "inr"),
        "ptl_58": _lab(case, "ptl", "plaquetas"),
        "equipo_quirurgico_69": case.equipo_quirurgico,
    }
    if fid in static:
        return static[fid]
    if fid in _FLUID_FIELDS:
        return _fluid_names(case, fid)

    if ftype == "checkbox":
        if fid == "urgencia_8":
            return _norm(case.tipo_admision) == "urgencia"
        if fid == "electiva_9":
            return _norm(case.tipo_admision) == "electiva"
        if fid == "i_11":
            return _norm(case.tipo) == "i"
        if fid == "ii_12":
            return _norm(case.tipo) == "ii"
        o2 = case.trans_record.o2_suplementario.dispositivo
        if fid == "puntas_nasales_35":
            return o2 == "puntas_nasales"
        if fid == "mascarilla_facial_36":
            return o2 == "mascarilla_facial"
        if fid == "otro_20" and case.trans_record.monitoring_otro.strip():
            return True
        # monitoring lanes: match field label against trans_record.monitoring keys
        mon = case.trans_record.monitoring or {}
        nlabel = _norm(field.get("label"))
        for k, v in mon.items():
            if _norm(k) == nlabel and bool(v):
                return True
        return None
    return None


def _nota2(case: AnesthesiaCaseDTO, field: dict) -> Any:
    fid = field["id"]
    ftype = field["type"]
    basal = case.trans_record.basal
    term = case.trans_record.termination

    def ta(sn: Any) -> Optional[str]:
        sys, dia = _s(sn.ta_sys), _s(sn.ta_dia)
        if sys and dia:
            return f"{sys}/{dia}"
        return sys or dia

    static: dict[str, Any] = {
        # basal vitals row
        "fc_0": _s(basal.fc),
        "lpm_fr_1": _s(basal.fr),
        "min_ta_2": ta(basal),
        "mmhg_spo2_4": _s(basal.spo2),
        "pvc_5": _s(basal.pvc),
        # termination vitals row
        "fc_247": _s(term.fc),
        "lpm_fr_248": _s(term.fr),
        "min_ta_249": ta(term),
        "mmhg_spo2_251": _s(term.spo2),
        "pvc_252": _s(term.pvc),
        # recovery scores (single cells at the foot)
        "ramsay_241": _s((case.recovery.otras or {}).get("Ramsay")),
        "bromage_242": _s((case.recovery.otras or {}).get("Bromage")),
        "ena_243": _s((case.recovery.otras or {}).get("ENA")),
        "observaciones_incidentes_221": _observaciones(case),
        "anestesiologo_253": case.anestesiologo.nombre,
        "farmacos_utilizados_230": _farmacos_utilizados(case),
        "presion_223": _s(case.neumoperitoneo.presion),
        "mmhg_225": True if case.neumoperitoneo.presion is not None else None,
    }
    if fid in static:
        return static[fid]

    nx = _neuraxial(case, fid)
    if nx is not None:
        return nx

    if fid == "aldrete_240":
        totals = [v for v in (case.recovery.totals or {}).values() if v is not None]
        return _s(max(totals)) if totals else None

    if ftype == "checkbox":
        return _technique_on(case, field)

    if ftype == "checkbox_value":
        drug = _drug_match(case, field.get("label") or "")
        if drug is not None:
            return _dose(drug) or True
        if _technique_on(case, field):
            return True
        return None
    return None


def _imss_p1(case: AnesthesiaCaseDTO, field: dict) -> Any:
    fid = field["id"]
    p = case.patient
    prof = p.profile
    pa = case.pre_assessment
    basal = case.trans_record.basal

    static: dict[str, Any] = {
        "pre_edad": _s(prof.age),
        "pre_sexo": _sex(prof.gender),
        "pre_estatura": _s(prof.height),
        "pre_peso": _s(prof.weight),
        "pre_ta": (f"{_s(basal.ta_sys)}/{_s(basal.ta_dia)}"
                   if basal.ta_sys and basal.ta_dia else _s(basal.ta_sys)),
        "pre_p": _s(basal.fc),
        "pre_r": _s(basal.fr),
        "pre_tegumentos": pa.tegumentos or _exam(case, "tegumentos"),
        "pre_hb": _s(p.hb) or _lab(case, "hb"),
        "pre_hto": _s(p.hto) or _lab(case, "hto"),
        "pre_rh": p.rh,
        "pre_grupo_sanguineo": p.grupo_sanguineo,
        "pre_t_prot": _lab(case, "tp", "tprot"),
        "ant_antecedentes": pa.antecedentes_anestesicos,
        "ant_alergia": pa.alergia,
        "ant_dentadura": pa.dentadura,
        "ant_cuello": pa.cuello,
        "ant_estado": pa.estado_psiquico,
        # the form has no slot for patológicos / quirúrgicos nor for the other exam systems
        "ant_otros": _join(
            ("Patológicos", pa.antecedentes_patologicos),
            ("Quirúrgicos", pa.antecedentes_quirurgicos),
            ("", pa.otros),
            ("Examen físico", _exam_rest(case, ("respiratorio", "cardiovascular", "tegumentos"))),
        ),
        "aparato_respiratorio": pa.aparato_respiratorio or _exam(case, "respiratorio"),
        "aparato_cardiovascular": pa.aparato_cardiovascular or _exam(case, "cardiovascular"),
        "medicamentos_previos": pa.medicamentos_previos,
        "analgesica_obstetrica": pa.analgesica_obstetrica,
        "complic_transanestesica": case.trans_record.complicaciones,
        "complic_postanestesicas": case.complicaciones_post,
    }
    if fid in static:
        return static[fid]

    # lab grids (orina_*, quim_*) -> pre_assessment.labs by normalised label
    if fid.startswith("orina_") or fid.startswith("quim_"):
        return _lab(case, fid.split("_", 1)[1], field.get("label"))

    if field["type"] == "score" and fid.startswith("aldrete_"):
        return resolve_aldrete(case, fid)
    return None


# imss_p2 medicamentos rows: med_<A..M>_(nombre|dosis) -> drugs[index]
_MED_LETTERS = "ABCDEFGHIJKLM"


def _imss_p2(case: AnesthesiaCaseDTO, field: dict) -> Any:
    fid = field["id"]

    static: dict[str, Any] = {
        "cama": case.patient.cama,
        "diag_preop": case.diagnostico_preop,
        "diag_oper": case.diagnostico_postop,
        "oper_prop": case.operacion_propuesta,
        "oper_real": case.operacion_realizada,
        "duracion_anestesia": case.duracion_anestesia,
        "observaciones": _observaciones(case),
        "anestesiologo": case.anestesiologo.nombre,
        "clave": case.anestesiologo.clave,
        "cirujano": case.cirujano.nombre,
    }
    if fid in static:
        return static[fid]

    if fid.startswith("med_") and (fid.endswith("_nombre") or fid.endswith("_dosis")):
        _, letter, which = fid.split("_")
        idx = _MED_LETTERS.find(letter)
        if 0 <= idx < len(case.drugs):
            drug = case.drugs[idx]
            return drug.farmaco if which == "nombre" else _dose(drug)
        return None

    if case.newborns:
        nb = case.newborns[0]
        nb_map = {
            "rn_sexo": nb.sexo,
            "rn_peso": _s(nb.peso_gramos),
            "rn_talla": _s(nb.talla_cm),
        }
        if fid in nb_map:
            return nb_map[fid]
    return None


_RESOLVERS = {
    "registro_transanestesico": _nota21,
    "nota_postanestesica": _nota2,
    "imss_valoracion_preanestesica": _imss_p1,
    "imss_registro_anestesia": _imss_p2,
}


def resolve(case: AnesthesiaCaseDTO, form_id: str, field: dict) -> Any:
    """Resolve a value for one schema field, or ``None`` when unmapped/empty."""
    fn = _RESOLVERS.get(form_id)
    if fn is None:
        return None
    try:
        return fn(case, field)
    except Exception:  # noqa: BLE001 - a bad field never breaks the whole render
        return None
