"""Intraoperative time grid of the transanesthetic record (nota21 ``vitals_grid``).

Draws ``trans_record.series`` / ``events`` and the drug ledger onto the printed grid:

* **Anestésicos inhalados** (3 rows): agent name in the label cell, its % at each change.
* **Fluidos IV** (5 rows): fluid name (full, no abbreviations) and the volume (ml) per column.
* **Monitoreo** rows: EKG (text, e.g. "Ritmo sinusal"), SpO2, O2, CO2, the "PVC" row (prints the
  POCUS finding) and BIS (or Entropía / NINDEX when BIS is empty — the form has one
  depth-of-anaesthesia row).
* **Vitals plot** on the 20–240 axis with the form's legend glyphs: • FC, X TA (sys/dia joined),
  O FR, ∆ temperature; surgical events 1–6 as numbers along the top.
* **Drugs** A–O: the row letter at the time given; a continuous infusion is a line from its
  start to its end (or to the end of the grid while it is still running).

``t`` is minutes since ``trans_record.inicio``. Geometry (points, fitz page space) was measured
from ``nota21_clone.pdf``; the hour lines and y-axis ticks come from the schema chart.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Iterable, Optional

import fitz  # PyMuPDF

from ...application.dto import AnesthesiaCaseDTO, VitalSeriesDTO
from . import crosswalk

_INK = (0.0, 0.0, 0.75)
_FONT = "helv"
_FS = 4.6  # value font size: two/three digits fit in a 5-minute column (8.2 pt)

# Lane keys (shared with the web catalogue in web/src/state/timeGrid.ts).
INHALED_PREFIX = "inhalado:"
FLUID_PREFIX = "fluido:"
PLOT_LANES = ("fc", "ta_sys", "ta_dia", "fr", "temp")

# Measured row bands (y0, y1) of the clone.
_LABEL_X = (37.0, 107.0)
_INHALED_ROWS = [(90.6, 100.6), (100.6, 112.2), (112.2, 123.8)]
_FLUID_ROWS = [(125.6, 134.4), (134.4, 144.3), (144.3, 154.1), (154.1, 163.9), (163.9, 172.9)]
# printed monitoring row -> the lane keys that fill it, in priority order (prefix when not first)
_MONITOR_ROWS: list[tuple[tuple[float, float], tuple[tuple[str, str], ...]]] = [
    ((174.0, 183.4), (("ekg", ""),)),
    ((183.4, 193.3), (("spo2", ""),)),
    ((193.3, 203.1), (("o2", ""),)),
    ((203.1, 212.9), (("etco2", ""),)),
    ((212.9, 221.4), (("pocus", ""),)),          # printed label: PVC
    ((221.4, 230.1), (("bis", ""), ("entropia", "E "), ("nindex", "N "))),
]
_PLOT_Y = (232.0, 421.0)  # vitals plot, above the event-number row
_EVENT_Y = 424.0  # bottom of the plot (the top rows hold the drug letters)
_GRID_END_MIN = 300.0  # five one-hour blocks


class _Axis:
    """Minutes -> x and value -> y for the vitals grid of the schema chart."""

    def __init__(self, chart: dict) -> None:
        hours = sorted(chart["x_axis"]["hour_lines"])
        self.hour_w = (hours[-1] - hours[0]) / (len(hours) - 1)
        self.x0 = hours[0] - self.hour_w
        self.x_end = self.x0 + self.hour_w * 5
        ticks = sorted(chart["y_axis"]["ticks"], key=lambda t: t["value"])
        self.v_lo, self.y_lo = ticks[0]["value"], ticks[0]["y"]
        self.v_hi, self.y_hi = ticks[-1]["value"], ticks[-1]["y"]

    def x(self, minutes: float) -> float:
        return self.x0 + minutes / 60.0 * self.hour_w

    def y(self, value: float) -> Optional[float]:
        """The axis continues past its last labels (e.g. FR 12 below the 20 line) inside the plot."""
        frac = (value - self.v_lo) / (self.v_hi - self.v_lo)
        y = self.y_lo + frac * (self.y_hi - self.y_lo)
        return y if _PLOT_Y[0] <= y <= _PLOT_Y[1] else None


def _in_grid(t: float) -> bool:
    return 0.0 <= t < _GRID_END_MIN


def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v) if v == v else None
    return None


def _points(series: VitalSeriesDTO) -> list[tuple[float, Any]]:
    pts = [(p.t, p.value) for p in series.points if _in_grid(p.t)]
    return sorted(pts, key=lambda p: p[0])


def _text_width(text: str, fs: float) -> float:
    return fitz.get_text_length(text, fontname=_FONT, fontsize=fs)


def _fit(text: str, width: float, fs: float) -> str:
    if _text_width(text, fs) <= width:
        return text
    out = text
    while out and _text_width(out + "…", fs) > width:
        out = out[:-1]
    return (out + "…") if out else ""


def _put(page: "fitz.Page", x: float, y_bottom: float, text: str, fs: float = _FS) -> int:
    if not text:
        return 0
    page.insert_text(fitz.Point(x, y_bottom), text, fontsize=fs, fontname=_FONT, color=_INK)
    return 1


def _row_text(page, ax: _Axis, band, pts, prefix: str = "", step: float = 5.0) -> int:
    """Each value in its column; text values run until the next change (or the grid end).

    ``prefix`` tags the row's source when it is not the printed one (BIS row showing Entropía).
    """
    y0, y1 = band
    base = y1 - (y1 - y0 - _FS) / 2.0 - 0.8
    n = 0
    for i, (t, v) in enumerate(pts):
        nv = _num(v)
        lead = prefix if i == 0 else ""  # the source tag ("E ", "N ") once, at the first value
        if nv is not None:
            txt = lead + crosswalk._s(nv)
            cx = ax.x(t + step / 2.0)
            n += _put(page, cx - _text_width(txt, _FS) / 2.0, base, txt)
            continue
        txt = lead + str(v).strip()
        if not txt.strip():
            continue
        nxt = pts[i + 1][0] if i + 1 < len(pts) else _GRID_END_MIN
        width = max(ax.x(nxt) - ax.x(t) - 1.0, ax.hour_w / 12.0)
        n += _put(page, ax.x(t) + 0.5, base, _fit(txt, width, _FS))
    return n


def _label(page, band, text: str) -> int:
    """Row name in the label cell, shrunk (to 4.5 pt) before it is cut, so names stay whole."""
    y0, y1 = band
    width = _LABEL_X[1] - _LABEL_X[0] - 2.0
    fs = min(6.5, (y1 - y0) * 0.75)
    need = _text_width(text, fs)
    if need > width:
        fs = max(4.5, fs * width / need)
    return _put(page, _LABEL_X[0] + 1.0, y1 - (y1 - y0 - fs) / 2.0 - 1.0, _fit(text, width, fs), fs)


def _plot(page, ax: _Axis, lanes: dict[str, VitalSeriesDTO]) -> int:
    shape = page.new_shape()
    n = 0
    for key in ("fc", "fr", "temp"):
        s = lanes.get(key)
        if s is None:
            continue
        for t, v in _points(s):
            nv = _num(v)
            y = ax.y(nv) if nv is not None else None
            if y is None:
                continue
            x = ax.x(t)
            if key == "fc":  # • filled dot
                shape.draw_circle(fitz.Point(x, y), 1.3)
                shape.finish(color=_INK, fill=_INK, width=0.4)
            elif key == "fr":  # O open circle
                shape.draw_circle(fitz.Point(x, y), 1.6)
                shape.finish(color=_INK, width=0.5)
            else:  # ∆ temperature
                shape.draw_polyline([fitz.Point(x - 1.6, y + 1.3), fitz.Point(x, y - 1.5),
                                     fitz.Point(x + 1.6, y + 1.3), fitz.Point(x - 1.6, y + 1.3)])
                shape.finish(color=_INK, width=0.5)
            n += 1
    sys_pts = dict(_points(lanes["ta_sys"])) if "ta_sys" in lanes else {}
    dia_pts = dict(_points(lanes["ta_dia"])) if "ta_dia" in lanes else {}
    for t in sorted(set(sys_pts) | set(dia_pts)):
        x = ax.x(t)
        ys = [ax.y(v) for v in (_num(sys_pts.get(t)), _num(dia_pts.get(t))) if v is not None]
        ys = [y for y in ys if y is not None]
        for y in ys:  # X tensión arterial
            shape.draw_line(fitz.Point(x - 1.4, y - 1.4), fitz.Point(x + 1.4, y + 1.4))
            shape.draw_line(fitz.Point(x - 1.4, y + 1.4), fitz.Point(x + 1.4, y - 1.4))
        if len(ys) == 2:
            shape.draw_line(fitz.Point(x, min(ys) + 1.4), fitz.Point(x, max(ys) - 1.4))
        if ys:
            shape.finish(color=_INK, width=0.5)
            n += 1
    shape.commit()
    return n


def _minutes(inicio: Optional[datetime], at: Optional[datetime]) -> Optional[float]:
    if inicio is None or at is None:
        return None
    try:
        return (at - inicio).total_seconds() / 60.0
    except TypeError:  # naive vs aware
        return None


def _drugs(page, ax: _Axis, case: AnesthesiaCaseDTO, lane_y: dict[str, float]) -> int:
    inicio = case.trans_record.inicio
    n = 0
    for i, drug in enumerate(case.drugs):
        letter = chr(65 + i) if i < 26 else ""
        y = lane_y.get(letter)
        start = _minutes(inicio, drug.time)
        if y is None or start is None or not _in_grid(start):
            continue
        x = ax.x(start)
        n += _put(page, max(x - 1.2, ax.x0 + 1.0), y + 1.6, letter, 4.8)
        if drug.modo == "infusion":
            end = _minutes(inicio, drug.fin)
            end = _GRID_END_MIN if end is None else min(max(end, start), _GRID_END_MIN)
            shape = page.new_shape()
            shape.draw_line(fitz.Point(x + 2.5, y), fitz.Point(ax.x(end), y))
            shape.finish(color=_INK, width=0.6)
            if drug.fin is not None:  # closed bar at the stop time
                shape.draw_line(fitz.Point(ax.x(end), y - 1.5), fitz.Point(ax.x(end), y + 1.5))
                shape.finish(color=_INK, width=0.6)
            shape.commit()
    return n


def _named(lanes: Iterable[VitalSeriesDTO], prefix: str) -> list[tuple[str, VitalSeriesDTO]]:
    out = []
    for s in lanes:
        if s.lane.startswith(prefix) and s.points:
            out.append((s.lane[len(prefix):].strip(), s))
    return out


def draw(page: "fitz.Page", case: AnesthesiaCaseDTO, chart: dict) -> int:
    """Draw the whole time grid; returns the number of marks placed."""
    ax = _Axis(chart)
    tr = case.trans_record
    step = float(tr.intervalo_min or 5)
    lanes = {s.lane: s for s in tr.series if s.points}
    n = 0

    # hour labels from the grid start ("HH:MM" at the left of each hour block)
    if tr.inicio is not None:
        for h in range(5):
            label = (tr.inicio + timedelta(hours=h)).strftime("%H:%M")
            n += _put(page, ax.x(h * 60) + 1.0, 87.5, label, 4.4)

    for band, (name, s) in zip(_INHALED_ROWS, _named(tr.series, INHALED_PREFIX)):
        n += _label(page, band, f"{name} (%)")
        n += _row_text(page, ax, band, _points(s), step=step)
    for band, (name, s) in zip(_FLUID_ROWS, _named(tr.series, FLUID_PREFIX)):
        n += _label(page, band, name)  # band title says "Fluidos IV"; values are ml
        n += _row_text(page, ax, band, _points(s), step=step)

    for band, sources in _MONITOR_ROWS:
        for i, (key, prefix) in enumerate(sources):
            s = lanes.get(key)
            if s is None:
                continue
            n += _row_text(page, ax, band, _points(s), prefix if i else "", step=step)
            break

    n += _plot(page, ax, lanes)

    for ev in tr.events:
        if _in_grid(ev.t) and 1 <= ev.marker <= 6:
            n += _put(page, max(ax.x(ev.t) - 1.2, ax.x0 + 1.0), _EVENT_Y, str(ev.marker), 5.0)

    lane_y = {l["label"]: l["y"] for l in chart.get("lanes", []) if len(l["label"]) == 1}
    n += _drugs(page, ax, case, lane_y)
    return n
