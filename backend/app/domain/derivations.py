"""Pure derivation math — the "computed, never collected" values (rest-contract §3, field-inventory §3).

No framework imports. The server stamps these; the client never sends them. Row/formula
correctness is validated against the real parsed schema in
docs/wiki/reports/contract-reconciliation-2026-07-10.md.
"""
from __future__ import annotations

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


def fluid_balance(
    matrix: dict[str, dict[str, float]],
    weight_kg: float = 0.0,
    fentanyl_mcg_total: float = 0.0,
    hours: tuple[str, ...] = ("1hr", "2hr", "3hr", "4hr", "5hr"),
) -> dict[str, object]:
    """The named derived rows of control_fluidos (Balance parcial/total, Total a reponer,
    Gasto urinario ml/kg, Tasa Fentanilo µg/kg).

    NOTE: the exact clinical Balance parcial/total formula is unconfirmed — this uses the
    standard (Σ intake − Σ losses) per hour with a cumulative total. **Confirm with the
    anesthesiologist.** The load-bearing fix here is the real row names + emitting the named
    rows (the previous version referenced rows that don't exist in the form).
    """

    def cell(row: str, h: str) -> float:
        return matrix.get(row, {}).get(h) or 0

    balance_parcial: dict[str, float] = {}
    balance_total: dict[str, float] = {}
    total_a_reponer: dict[str, float] = {}
    gasto_urinario: dict[str, Optional[float]] = {}
    running = 0.0
    for h in hours:
        intake = sum(cell(r, h) for r in _INTAKE_ROWS)
        losses = sum(cell(r, h) for r in _LOSS_ROWS)
        parcial = round(intake - losses, 1)
        balance_parcial[h] = parcial
        running += parcial
        balance_total[h] = round(running, 1)
        total_a_reponer[h] = round(losses, 1)
        diuresis = cell("Diuresis", h)
        gasto_urinario[h] = round(diuresis / weight_kg, 2) if weight_kg else None

    tasa_fentanilo = round(fentanyl_mcg_total / weight_kg, 2) if weight_kg else None
    return {
        "balance_parcial": balance_parcial,
        "balance_total": balance_total,
        "total_a_reponer": total_a_reponer,
        "gasto_urinario": gasto_urinario,
        "tasa_fentanilo": tasa_fentanilo,
    }
