"""Pure derivation math — the "computed, never collected" values (rest-contract §3, field-inventory §3).

No framework imports. The server stamps these; the client never sends them.
"""
from __future__ import annotations


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
    """total[time_point] = Σ criteria, or None if the column is partial (0..10)."""
    time_points: set[str] = set()
    for crit in aldrete.values():
        time_points.update(crit.keys())
    totals: dict[str, int | None] = {}
    for tp in time_points:
        vals = [crit.get(tp) for crit in aldrete.values()]
        totals[tp] = sum(v for v in vals) if vals and all(v is not None for v in vals) else None
    return totals


def fluid_balance(
    matrix: dict[str, dict[str, float]],
    hours: tuple[str, ...] = ("1hr", "2hr", "3hr", "4hr", "5hr"),
) -> dict[str, float]:
    """Balance[hour] = (intake rows) − (loss rows) per hour column."""
    intake_rows = ("NCL", "Cristaloide", "Coloide")
    loss_rows = ("Sangrado", "Diuresis")
    balance: dict[str, float] = {}
    for h in hours:
        intake = sum((matrix.get(r, {}).get(h) or 0) for r in intake_rows)
        loss = sum((matrix.get(r, {}).get(h) or 0) for r in loss_rows)
        balance[h] = round(intake - loss, 1)
    return balance
