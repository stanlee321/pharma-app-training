"""Pure derivation math — the "computed, never collected" values (rest-contract §3, field-inventory §3).

No framework imports. The server stamps these; the client never sends them. Row/formula
correctness is validated against the real parsed schema in
docs/wiki/reports/contract-reconciliation-2026-07-10.md.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional


def imc(weight_kg: float, height_cm: float) -> float:
    m = height_cm / 100.0
    return round(weight_kg / (m * m), 1) if m > 0 else 0.0


def peso_ideal(height_cm: float, is_male: bool) -> float:
    """Devine ideal body weight (kg)."""
    inches_over_60 = max(0.0, height_cm / 2.54 - 60)
    base = 50.0 if is_male else 45.5
    return round(base + 2.3 * inches_over_60, 1)


def vsc(weight_kg: float) -> float:
    """Estimated blood volume (~70 ml/kg)."""
    return round(weight_kg * 70, 1)


def aldrete_total(aldrete: dict[str, dict[str, int]]) -> dict[str, int | None]:
    """total[time_point] = Σ criteria (clamped 0..10), None if the column is partial.

    Ignores a stray ``total`` criterion key so a caller can't double-count.
    """
    criteria = {k: v for k, v in aldrete.items() if k.strip().lower() != "total"}
    time_points: set[str] = set()
    for crit in criteria.values():
        time_points.update(crit.keys())
    totals: dict[str, int | None] = {}
    for tp in time_points:
        vals = [crit.get(tp) for crit in criteria.values()]
        if vals and all(v is not None for v in vals):
            totals[tp] = max(0, min(10, sum(v for v in vals)))
        else:
            totals[tp] = None
    return totals


# Canonical control_fluidos rows (verified against the nota21 schema). NB the source form
# misspells "Cristaloide" as "Critaloide" — kept verbatim so the row key matches.
_INTAKE_ROWS = ("Ingreso Critaloide", "Ingreso Coloide", "Ingreso hemocomponente")
_LOSS_ROWS = ("NCL", "DCL", "3er Espacio", "Diuresis", "Circuito respiratorio", "Sangrado")
# Bleeding broken down by source (clinician feedback 2026-11b); "Sangrado" is their sum.
BLEEDING_ROWS = ("Textiles", "Aspirador", "Recuperador")
FLUID_HOURS = ("1hr", "2hr", "3hr", "4hr", "5hr")

# IV fluid name (time-grid lane ``fluido:<name>``) -> intake row, by accent-free keyword.
_FLUID_KIND: dict[str, tuple[str, ...]] = {
    "Ingreso Critaloide": ("ringer", "fisiologica", "glucosada", "mixta", "hartmann", "plasmalyte",
                           "salina", "bicarbonato", "manitol"),
    "Ingreso Coloide": ("gelatina", "almidon", "albumina", "dextrano", "coloide"),
    "Ingreso hemocomponente": ("globular", "plasma fresco", "plaquet", "crioprecip", "sangre"),
}


def _plain(s: str) -> str:
    import unicodedata
    t = unicodedata.normalize("NFKD", s.lower())
    return "".join(c for c in t if not unicodedata.combining(c)).replace("-", "")


def fluid_kind(name: str) -> Optional[str]:
    """The control_fluidos intake row of an IV fluid name, or None when unknown."""
    low = _plain(name)
    for row, keys in _FLUID_KIND.items():
        if any(k in low for k in keys):
            return row
    return None


def grid_intake(fluids: list[tuple[str, float, float]]) -> dict[str, dict[str, float]]:
    """Intake rows per hour from the time-grid fluids: ``(name, t_minutes, ml)`` triples.

    Hour ``1hr`` holds minutes 0–59 of the grid, and so on up to ``5hr``.
    """
    out: dict[str, dict[str, float]] = {}
    for name, t, ml in fluids:
        row = fluid_kind(name)
        idx = int(t // 60)
        if row is None or not 0 <= idx < len(FLUID_HOURS) or ml is None:
            continue
        h = FLUID_HOURS[idx]
        out.setdefault(row, {})[h] = round(out.get(row, {}).get(h, 0.0) + ml, 1)
    return out


def fluid_balance(
    matrix: dict[str, dict[str, float]],
    weight_kg: float = 0.0,
    fentanyl_mcg_total: float = 0.0,
    hours: tuple[str, ...] = FLUID_HOURS,
    grid: Optional[dict[str, dict[str, float]]] = None,
) -> dict[str, object]:
    """The named derived rows of control_fluidos (Balance parcial/total, Total a reponer,
    Gasto urinario ml/kg, Sangrado, the intake taken from the time grid, Tasa Fentanilo µg/kg).

    An intake cell typed in the matrix wins; an empty one takes the sum of the IV fluids of
    that hour in the time grid (``grid``, see ``grid_intake``). Sangrado is the sum of
    Textiles + Aspirador + Recuperador when any is filled, else the Sangrado cell itself.

    NOTE: the exact clinical Balance parcial/total formula is unconfirmed — this uses the
    standard (Σ intake − Σ losses) per hour with a cumulative total.
    """
    grid = grid or {}

    def cell(row: str, h: str) -> Optional[float]:
        v = matrix.get(row, {}).get(h)
        return v if isinstance(v, (int, float)) else None

    def intake_cell(row: str, h: str) -> float:
        v = cell(row, h)
        return v if v is not None else grid.get(row, {}).get(h, 0.0)

    balance_parcial: dict[str, float] = {}
    balance_total: dict[str, float] = {}
    total_a_reponer: dict[str, float] = {}
    gasto_urinario: dict[str, Optional[float]] = {}
    sangrado: dict[str, float] = {}
    running = 0.0
    for h in hours:
        parts = [cell(r, h) for r in BLEEDING_ROWS]
        if any(p is not None for p in parts):
            sangrado[h] = round(sum(p or 0 for p in parts), 1)
        elif cell("Sangrado", h) is not None:
            sangrado[h] = round(cell("Sangrado", h) or 0, 1)
        intake = sum(intake_cell(r, h) for r in _INTAKE_ROWS)
        losses = sum(cell(r, h) or 0 for r in _LOSS_ROWS if r != "Sangrado") + sangrado.get(h, 0)
        parcial = round(intake - losses, 1)
        balance_parcial[h] = parcial
        running += parcial
        balance_total[h] = round(running, 1)
        total_a_reponer[h] = round(losses, 1)
        diuresis = cell("Diuresis", h) or 0
        gasto_urinario[h] = round(diuresis / weight_kg, 2) if weight_kg else None

    tasa_fentanilo = round(fentanyl_mcg_total / weight_kg, 2) if weight_kg else None
    return {
        "balance_parcial": balance_parcial,
        "balance_total": balance_total,
        "total_a_reponer": total_a_reponer,
        "gasto_urinario": gasto_urinario,
        "sangrado": sangrado,
        "ingresos_grid": {r: dict(v) for r, v in grid.items()},
        "tasa_fentanilo": tasa_fentanilo,
    }


def age_years(birth: date | None, today: date | None = None) -> int | None:
    """Whole years from ``birth`` to ``today`` (UTC today by default); None without a birth
    date or when it lies in the future."""
    if birth is None:
        return None
    today = today or datetime.now(timezone.utc).date()
    years = today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))
    return years if years >= 0 else None
