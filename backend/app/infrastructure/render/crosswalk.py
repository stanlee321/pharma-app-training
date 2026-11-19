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
    return _join(("", case.observaciones), ("Intercurrencias", inter))


# Fluids IV catalogue category (web/src/state/timeGrid.ts FLUIDS) for the nota21 name fields.
_FLUID_KIND = {
    "cristaloides_66": ("ringer", "fisiologica", "glucosada", "mixta", "hartmann", "plasmalyte",
                        "salina", "bicarbonato", "manitol"),
    "coloides_67": ("gelatina", "almidon", "albumina", "dextrano", "coloide"),
    "hemocomponentes_68": ("globular", "plasma fresco", "plaquet", "crioprecip", "sangre"),
}


def _fluid_names(case: AnesthesiaCaseDTO, field_id: str) -> Optional[str]:
    from .timegrid import FLUID_PREFIX
    keys = _FLUID_KIND[field_id]
    names = []
    for s in case.trans_record.series:
        if not s.lane.startswith(FLUID_PREFIX) or not s.points:
            continue
        name = s.lane[len(FLUID_PREFIX):].strip()
        low = unicodedata.normalize("NFKD", name.lower())
        low = "".join(c for c in low if not unicodedata.combining(c)).replace("-", "")
        if any(k in low for k in keys) and name not in names:
            names.append(name)
    return ", ".join(names) or None


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
_MULTI_PREFIXES = ("volatil_", "aguja_")


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
        "posicion_51": case.posicion,
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
        "hb_56": _s(p.hb),
        "mg_dl_hto_57": _s(p.hto),
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
    if fid in _FLUID_KIND:
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
    }
    if fid in static:
        return static[fid]

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
        "pre_hb": _s(p.hb),
        "pre_hto": _s(p.hto),
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
