"""Transanesthetic record (nota21) values that have no schema field of their own.

Clinician feedback 2026-11b: the printed form has these spaces but the field extractor did not
turn them into fields (blank lines inside a drawn box), so they are placed by measured geometry
(points, fitz page space, from ``nota21_clone.pdf``):

* **Acceso endovascular**: up to 3 peripheral veins, 1 arterial line, 1 central venous
  catheter — calibre + ubicación on the numbered lines.
* **Presión** of the isquemia (tourniquet) and of the neumoperitoneo.
* **ml** of the Cristaloides / Coloides / Hemocomponentes rows and **Total fluidos infundidos**,
  summed from the time-grid IV fluids.
* **Posición** over time: the standard graphic symbols of the operative positions (supina,
  prona, Trendelenburg, litotomía…) with the time of each change, one per cell of the
  "Posición" row; the catalogue mirrors web ``src/state/positions.ts``.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Callable, Optional

import fitz  # PyMuPDF

from ...application.dto import AnesthesiaCaseDTO
from . import crosswalk

_INK = (0.0, 0.0, 0.75)
_FONT = "helv"

DrawText = Callable[["fitz.Page", Optional[list], str], bool]

# --------------------------------------------------------------------------- geometry
# acceso endovascular: (y0, y1) of each numbered line; calibre / ubicación x ranges
_ACCESS_ROWS = {
    "periferica": [(312.0, 320.0), (320.0, 328.0), (328.0, 336.0)],
    "arterial": [(352.2, 360.2)],
    "central": [(376.6, 384.6)],
}
_CALIBRE_X = (17.0, 42.0)
_UBICACION_X = (44.0, 84.0)
_ISQUEMIA_PRESION = [473.6, 495.1, 492.0, 502.0]
_NEUMO_PRESION = [568.4, 517.7, 584.6, 524.7]
# ml cells (left of the printed "ml") of the fluid-name rows, and the total row
_FLUID_ML = {
    "Ingreso Critaloide": [340.0, 694.5, 363.0, 700.5],
    "Ingreso Coloide": [340.0, 706.9, 363.0, 712.9],
    "Ingreso hemocomponente": [340.0, 720.3, 363.0, 726.3],
}
_TOTAL_ML = [300.0, 730.3, 357.5, 738.9]
# "Posición:" row: cell borders and the band height
_POSITION_X = [462.7, 486.5, 509.5, 532.5, 555.4, 578.4, 601.3]
_POSITION_Y = (527.2, 541.2)

# ----------------------------------------------------------------- position symbols
# key -> (head (x, y), polylines, arrows); unit box x 0..1 (head at the left), y 0..1 downwards.
# Drawn after "SÍMBOLOS GRÁFICOS PARA POSICIONES OPERATORIAS" (clinician reference sheet).
_P = tuple[float, float]
POSITIONS: dict[str, tuple[str, _P, list[list[_P]], list[tuple[_P, _P]]]] = {
    "supina": ("Supina", (0.1, 0.3), [[(0.05, 0.62), (1.0, 0.62), (1.0, 0.4)]], []),
    "prona": ("Prona", (0.1, 0.72), [[(0.05, 0.38), (1.0, 0.38), (1.0, 0.58)]], []),
    "cabeza_alta": ("Cabeza alta", (0.1, 0.22), [[(0.08, 0.42), (1.0, 0.88), (1.0, 0.68)]], []),
    "cabeza_baja": ("Cabeza baja", (0.1, 0.72), [[(0.14, 0.62), (1.0, 0.22), (1.0, 0.02)]], []),
    "trendelenburg": ("Trendelenburg", (0.08, 0.72),
                      [[(0.12, 0.82), (0.5, 0.28), (1.0, 0.28), (1.0, 0.08)]], []),
    "litotomia": ("Litotomía", (0.08, 0.72),
                  [[(0.13, 0.86), (0.6, 0.86), (0.6, 0.3), (1.0, 0.3), (1.0, 0.1)]], []),
    "lateral_derecha": ("Lateral derecha", (0.1, 0.3), [[(0.05, 0.62), (1.0, 0.62), (1.0, 0.4)]],
                        [((0.25, 1.0), (0.7, 0.05))]),
    "lateral_izquierda": ("Lateral izquierda", (0.1, 0.3),
                          [[(0.05, 0.62), (1.0, 0.62), (1.0, 0.4)]], [((0.75, 1.0), (0.3, 0.05))]),
    "renal_derecha": ("Renal derecha", (0.1, 0.3),
                      [[(0.05, 0.55), (1.0, 0.55), (1.0, 0.35)], [(0.3, 0.95), (0.42, 0.62), (0.54, 0.95)]],
                      [((0.5, 0.95), (0.85, 0.2))]),
    "renal_izquierda": ("Renal izquierda", (0.1, 0.3),
                        [[(0.05, 0.55), (1.0, 0.55), (1.0, 0.35)], [(0.46, 0.95), (0.58, 0.62), (0.7, 0.95)]],
                        [((0.5, 0.95), (0.18, 0.2))]),
    "raquilateral_derecha": ("Raqui-lateral derecha", (0.12, 0.35),
                             [[(0.18, 0.62), (0.6, 0.9), (0.95, 0.55), (0.6, 0.35), (0.95, 0.12)]], []),
    "colecistectomia": ("Colecistectomía", (0.1, 0.62),
                        [[(0.16, 0.66), (0.5, 0.25), (1.0, 0.7), (1.0, 0.9)]], []),
    "raquilateral_izquierda": ("Raqui-lateral izquierda", (0.1, 0.78),
                               [[(0.15, 0.6), (0.5, 0.18), (0.95, 0.28), (0.6, 0.6), (0.95, 0.85)]], []),
    "litotomia_avanzada": ("Litotomía avanzada", (0.08, 0.75),
                           [[(0.13, 0.86), (0.6, 0.86), (0.4, 0.2), (1.0, 0.2), (1.0, 0.02)]], []),
    "semisentada": ("Semisentada", (0.12, 0.12), [[(0.14, 0.3), (0.38, 0.6), (0.68, 0.6), (0.95, 0.98)]], []),
    "sentada": ("Sentada", (0.4, 0.1),
                [[(0.32, 0.25), (0.32, 0.6), (0.68, 0.6), (0.68, 0.98), (0.95, 0.98)]], []),
    "kerr": ("Kerr", (0.1, 0.8), [[(0.15, 0.68), (0.52, 0.1), (0.95, 0.68), (0.95, 0.85)]], []),
}


def position_key(value: object) -> Optional[str]:
    """The catalogue key of a stored position (key, or its printed name in any case/accents)."""
    if not isinstance(value, str) or not value.strip():
        return None
    if value in POSITIONS:
        return value
    n = crosswalk._norm(value)
    for k, (name, *_rest) in POSITIONS.items():
        if crosswalk._norm(name) == n or crosswalk._norm(k) == n:
            return k
    return None


def draw_position(page: "fitz.Page", key: str, rect: fitz.Rect, width: float = 0.5) -> bool:
    """One position symbol scaled into ``rect``."""
    spec = POSITIONS.get(key)
    if spec is None:
        return False
    _name, head, lines, arrows = spec
    r = min(rect.width, rect.height) * 0.16

    def pt(p: _P) -> fitz.Point:
        return fitz.Point(rect.x0 + p[0] * rect.width, rect.y0 + p[1] * rect.height)

    shape = page.new_shape()
    shape.draw_circle(pt(head), r)
    for line in lines:
        shape.draw_polyline([pt(p) for p in line])
    for a, b in arrows:
        pa, pb = pt(a), pt(b)
        shape.draw_line(pa, pb)
        d = pb - pa
        length = max((d.x ** 2 + d.y ** 2) ** 0.5, 0.01)
        ux, uy = d.x / length, d.y / length
        size = r * 1.6
        for sx in (1, -1):  # two barbs at the tip
            shape.draw_line(pb, fitz.Point(pb.x - size * (ux + sx * uy * 0.6),
                                           pb.y - size * (uy - sx * ux * 0.6)))
    shape.finish(color=_INK, width=width, closePath=False)
    shape.commit()
    return True


def _positions(page: "fitz.Page", case: AnesthesiaCaseDTO) -> int:
    tr = case.trans_record
    lane = next((s for s in tr.series if s.lane == "posicion" and s.points), None)
    if lane is None:
        return 0
    changes: list[tuple[float, str]] = []
    for p in sorted(lane.points, key=lambda p: p.t):
        key = position_key(p.value)
        if key and (not changes or changes[-1][1] != key):
            changes.append((p.t, key))
    n = 0
    cells = list(zip(_POSITION_X, _POSITION_X[1:]))
    for (t, key), (x0, x1) in zip(changes, cells):
        y0, y1 = _POSITION_Y
        symbol = fitz.Rect(x0 + 3.0, y0 + 0.8, x1 - 3.0, y0 + 8.2)
        n += 1 if draw_position(page, key, symbol) else 0
        if tr.inicio is not None:
            label = (tr.inicio + timedelta(minutes=t)).strftime("%H:%M")
        else:
            label = f"+{crosswalk._s(float(t))} min"
        fs = 3.8
        w = fitz.get_text_length(label, fontname=_FONT, fontsize=fs)
        page.insert_text(fitz.Point((x0 + x1 - w) / 2.0, y1 - 1.0), label, fontsize=fs,
                         fontname=_FONT, color=_INK)
    return n


def draw_nota21(page: "fitz.Page", case: AnesthesiaCaseDTO, draw_text: DrawText) -> int:
    """Everything above; ``draw_text`` is the renderer's fit-or-shrink text writer."""
    n = 0
    tr = case.trans_record
    used = {k: 0 for k in _ACCESS_ROWS}
    for acc in tr.accesos:
        rows = _ACCESS_ROWS.get(acc.tipo)
        if rows is None or used[acc.tipo] >= len(rows):
            continue
        y0, y1 = rows[used[acc.tipo]]
        used[acc.tipo] += 1
        if acc.calibre.strip():
            n += 1 if draw_text(page, [_CALIBRE_X[0], y0, _CALIBRE_X[1], y1], acc.calibre.strip()) else 0
        if acc.ubicacion.strip():
            n += 1 if draw_text(page, [_UBICACION_X[0], y0, _UBICACION_X[1], y1], acc.ubicacion.strip()) else 0

    for bbox, val in ((_ISQUEMIA_PRESION, case.isquemia.presion), (_NEUMO_PRESION, case.neumoperitoneo.presion)):
        text = crosswalk._s(val)
        if text:
            n += 1 if draw_text(page, bbox, text) else 0

    totals = crosswalk.fluid_totals(case)
    for row, bbox in _FLUID_ML.items():
        text = crosswalk._s(totals.get(row))
        if text:
            n += 1 if draw_text(page, bbox, text) else 0
    if totals.get("total"):
        n += 1 if draw_text(page, _TOTAL_ML, crosswalk._s(totals["total"]) or "") else 0

    n += _positions(page, case)
    return n
