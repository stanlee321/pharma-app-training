"""Fill-PDF renderer — draws a case's data into the real anaesthesia-form clones.

Opens the blank 1:1 clone PDF (produced by ``notebooks/forms``), walks the matching
schema's field bboxes, and stamps the case values (via ``crosswalk.resolve``) into place
with PyMuPDF (``fitz``). Entered data is drawn in a blue-ish ink so it reads as fill-in
over the black form. Returns the flattened PDF bytes.

Coordinate note: schema bboxes are ``[x0, top, x1, bottom]`` in fitz page coords
(origin top-left, y increasing downward, points) — the same space ``page.insert_text``
uses, so no axis flip is needed.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

import fitz  # PyMuPDF

from ...application.dto import AnesthesiaCaseDTO
from ...core.config import NOTEBOOKS_DIR, settings
from . import crosswalk, extras, timegrid

_INK = (0.0, 0.0, 0.75)  # blue-ish: distinguishes entered data from the black form
_FONT = "helv"

# form_id -> (clone pdf filename under out/, schema filename, 0-based page index)
FORM_MAP: dict[str, tuple[str, str, int]] = {
    "nota_postanestesica": ("nota2_clone.pdf", "nota2.schema.json", 0),
    "registro_transanestesico": ("nota21_clone.pdf", "nota21.schema.json", 0),
    "imss_valoracion_preanestesica": ("imss_recreated.pdf", "imss_p1.schema.json", 0),
    "imss_registro_anestesia": ("imss_recreated.pdf", "imss_p2.schema.json", 1),
}


def _plain_dashes(text: str) -> str:
    """The base-14 Helvetica has no en/em dash (they print as "·"): use a hyphen."""
    return text.replace("\u2013", "-").replace("\u2014", "-")


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


class FormRenderer:
    """Render a populated anaesthesia form PDF for a case + form_id."""

    def __init__(self) -> None:
        self._out_dir = NOTEBOOKS_DIR / "forms" / "out"
        self._schema_dir = Path(settings.schema_dir)
        # per-render counter, surfaced for self-verification / logging
        self.last_fill_count = 0

    # -------------------------------------------------------------- public API
    def supports(self, form_id: str) -> bool:
        return form_id in FORM_MAP

    def render(self, case: AnesthesiaCaseDTO, form_id: str) -> bytes:
        if form_id not in FORM_MAP:
            raise ValueError(f"unknown form_id: {form_id!r}")
        clone_name, schema_name, page_index = FORM_MAP[form_id]

        clone_path = self._out_dir / clone_name
        schema_path = self._schema_dir / schema_name
        if not clone_path.is_file():
            raise FileNotFoundError(f"clone PDF missing: {clone_path}")
        if not schema_path.is_file():
            raise FileNotFoundError(f"schema missing: {schema_path}")

        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        doc = fitz.open(str(clone_path))
        try:
            if page_index >= doc.page_count:
                raise ValueError(
                    f"{clone_name} has {doc.page_count} page(s); need index {page_index}"
                )
            page = doc[page_index]
            self.last_fill_count = self._fill_page(page, case, form_id, schema)
            return doc.tobytes()
        finally:
            doc.close()

    # ------------------------------------------------------------- internals
    def _fill_page(
        self, page: "fitz.Page", case: AnesthesiaCaseDTO, form_id: str, schema: dict
    ) -> int:
        count = 0
        for field in schema.get("fields", []):
            value = crosswalk.resolve(case, form_id, field)
            if value is None or value is False:
                continue
            count += self._draw_field(page, field, value)
        # structured extras
        count += self._draw_tables(page, case, schema)
        count += self._draw_charts(page, case, schema)
        if form_id == "registro_transanestesico":
            count += extras.draw_nota21(page, case, self._draw_text)
        return count

    def _draw_field(self, page: "fitz.Page", field: dict, value: Any) -> int:
        ftype = field.get("type")
        if ftype == "checkbox":
            box = field.get("checkbox_bbox") or field.get("bbox")
            return 1 if self._stamp_check(page, box) else 0
        if ftype == "checkbox_value":
            n = 0
            box = field.get("checkbox_bbox")
            if not isinstance(value, crosswalk.TextOnly):
                n += 1 if self._stamp_check(page, box) else 0
            if isinstance(value, str):
                target = field.get("blank_bbox") or field.get("bbox")
                n += 1 if self._draw_text(page, target, value) else 0
            return 1 if n else 0
        # text / number / open_field / imss text|textarea|score
        target = field.get("blank_bbox") or field.get("bbox")
        return 1 if self._draw_text(page, target, str(value)) else 0

    def _draw_text(self, page: "fitz.Page", bbox: Optional[list], text: str) -> bool:
        if not bbox or not text:
            return False
        text = _plain_dashes(text)
        x0, top, x1, bottom = bbox
        width = x1 - x0
        if width <= 1:
            return False
        fontsize = _clamp((bottom - top) * 0.9, 6.0, 9.0)
        need = fitz.get_text_length(text, fontname=_FONT, fontsize=fontsize)
        # long text in a box tall enough for several lines wraps (e.g. imss "OTROS")
        if need > width - 2.0 and self._draw_wrapped(page, bbox, text):
            return True
        # shrink long text (down to 5 pt) before truncating it with an ellipsis
        if need > width - 2.0:
            fontsize = max(5.0, fontsize * (width - 2.0) / need * 0.97)
        text = self._truncate(text, width - 2.0, fontsize)
        if not text:
            return False
        point = fitz.Point(x0 + 1.0, bottom - 2.0)
        if not self._on_page(page, point):
            return False
        page.insert_text(point, text, fontsize=fontsize, fontname=_FONT, color=_INK)
        return True

    def _draw_wrapped(self, page: "fitz.Page", bbox: list, text: str) -> bool:
        """Word-wrap ``text`` into the box at the largest size (7 → 4.5 pt) where it fits whole."""
        x0, top, x1, bottom = bbox
        width, height = x1 - x0 - 6.0, bottom - top - 1.0  # keep clear of the right border
        words = text.split()
        for fs in (7.0, 6.5, 6.0, 5.5, 5.0, 4.5):
            lead = fs * 1.15
            if height < 2 * lead:
                continue
            lines: list[str] = []
            for w in words:
                trial = f"{lines[-1]} {w}" if lines else w
                if lines and fitz.get_text_length(trial, fontname=_FONT, fontsize=fs) <= width:
                    lines[-1] = trial
                elif fitz.get_text_length(w, fontname=_FONT, fontsize=fs) <= width:
                    lines.append(w)
                else:
                    break  # a single word wider than the box: try a smaller size
            else:
                if len(lines) * lead <= height:
                    for i, line in enumerate(lines):
                        point = fitz.Point(x0 + 1.0, top + 0.5 + fs + i * lead)
                        page.insert_text(point, line, fontsize=fs, fontname=_FONT, color=_INK)
                    return True
        return False

    def _stamp_check(self, page: "fitz.Page", bbox: Optional[list]) -> bool:
        if not bbox:
            return False
        x0, top, x1, bottom = bbox
        w, h = x1 - x0, bottom - top
        if w <= 0 or h <= 0:
            return False
        fontsize = _clamp(min(w, h) * 1.1, 6.0, 10.0)
        tw = fitz.get_text_length("X", fontname=_FONT, fontsize=fontsize)
        cx, cy = (x0 + x1) / 2.0, (top + bottom) / 2.0
        point = fitz.Point(cx - tw / 2.0, cy + fontsize * 0.35)
        if not self._on_page(page, point):
            return False
        page.insert_text(point, "X", fontsize=fontsize, fontname=_FONT, color=_INK)
        return True

    def _draw_tables(self, page: "fitz.Page", case: AnesthesiaCaseDTO, schema: dict) -> int:
        count = 0
        for table in schema.get("tables", []):
            tid = table.get("id")
            if tid == "farmaco":
                count += self._draw_farmaco(page, case, table)
            elif tid == "control_fluidos":
                count += self._draw_fluidos(page, case, table)
        return count

    def _draw_charts(self, page: "fitz.Page", case: AnesthesiaCaseDTO, schema: dict) -> int:
        count = 0
        for chart in schema.get("charts", []):
            # nota21's intraoperative grid; the imss_p2 grid has another layout (not drawn yet)
            if chart.get("id") == "vitals_grid" and chart.get("x_axis", {}).get("hour_lines"):
                count += timegrid.draw(page, case, chart)
        return count

    def _draw_farmaco(self, page: "fitz.Page", case: AnesthesiaCaseDTO, table: dict) -> int:
        rows = table.get("rows", [])
        cols = table.get("columns", [])
        if len(cols) < 2 or not rows:
            return 0
        c_name, c_dose = cols[0], cols[1]
        count = 0
        # the neuraxial technique doses (lidocaína infiltración, bupivacaína…) follow the ledger
        tech_rows = rows[len(case.drugs):]
        for (name, dose), row in zip(crosswalk.tech_drugs(case), tech_rows):
            count += 1 if self._draw_text(page, [c_name["x0"], row["y0"], c_name["x1"], row["y1"]], name) else 0
            if dose:
                count += 1 if self._draw_text(page, [c_dose["x0"], row["y0"], c_dose["x1"], row["y1"]], dose) else 0
        for drug, row in zip(case.drugs, rows):
            name = (drug.farmaco or "").strip()
            if name and drug.modo == "infusion":
                name += " (infusión continua)"  # the dose cell is too narrow for it
            if name:
                cell = [c_name["x0"], row["y0"], c_name["x1"], row["y1"]]
                count += 1 if self._draw_text(page, cell, name) else 0
            dose = crosswalk._dose(drug, mark_infusion=False)
            if dose:
                cell = [c_dose["x0"], row["y0"], c_dose["x1"], row["y1"]]
                count += 1 if self._draw_text(page, cell, dose) else 0
        return count

    def _draw_fluidos(self, page: "fitz.Page", case: AnesthesiaCaseDTO, table: dict) -> int:
        """The typed matrix cells, then the derived rows (intake from the time grid where the
        matrix is empty, Sangrado = its breakdown, Total a reponer, balances, gasto urinario).
        The form's "Tasa Fentanilo" row is struck out (clinician feedback 2026-11b)."""
        rows = table.get("rows", [])
        cols = table.get("columns", [])
        if not rows or not cols:
            return 0
        fb = case.fluid_balance
        matrix = fb.matrix or {}
        row_by = {crosswalk._norm(r.get("label")): r for r in rows}
        col_by = {crosswalk._norm(c.get("label")): c for c in cols}
        count = 0
        tasa = row_by.get(crosswalk._norm("Tasa Fentanilo µg/kg"))
        if tasa is not None:  # white out the row the clinicians asked to remove
            # the row band is 718.5–728.55 on the clone; the label's descenders reach 728.3
            label_cell = fitz.Rect(372.0, tasa["y0"] + 0.6, cols[0]["x0"] - 0.4, tasa["y1"] + 0.7)
            # remove the words themselves (not only hide them); keep the table lines
            page.add_redact_annot(label_cell, fill=False)
            page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE,
                                  graphics=fitz.PDF_REDACT_LINE_ART_NONE)
            count += 1

        def put(row_label: str, hour: str, val: Any) -> int:
            row = row_by.get(crosswalk._norm(row_label))
            col = col_by.get(crosswalk._norm(hour))
            text = crosswalk._s(val)
            if row is None or col is None or text is None:
                return 0
            return 1 if self._draw_text(page, [col["x0"], row["y0"], col["x1"], row["y1"]], text) else 0

        typed: set[tuple[str, str]] = set()
        for row_label, hours in matrix.items():
            if not isinstance(hours, dict) or row_label == "Sangrado":
                continue
            for hour_label, val in hours.items():
                if crosswalk._s(val) is not None:
                    typed.add((row_label, hour_label))
                    count += put(row_label, hour_label, val)
        for row_label, hours in (fb.ingresos_grid or {}).items():
            for hour_label, val in hours.items():
                if (row_label, hour_label) not in typed:
                    count += put(row_label, hour_label, val)
        active = {h for _r, h in typed} | {h for v in (fb.ingresos_grid or {}).values() for h in v}
        for hour in sorted(active):
            count += put("Sangrado", hour, (fb.sangrado or {}).get(hour))
            count += put("Total a reponer", hour, (fb.total_a_reponer or {}).get(hour))
            count += put("Balance parcial", hour, (fb.balance_parcial or {}).get(hour))
            count += put("Balance total", hour, (fb.balance_total or {}).get(hour))
            count += put("Gasto urinario ml/kg", hour, (fb.gasto_urinario or {}).get(hour))
        return count

    # ------------------------------------------------------------- utilities
    @staticmethod
    def _on_page(page: "fitz.Page", point: fitz.Point) -> bool:
        r = page.rect
        return r.x0 <= point.x <= r.x1 and r.y0 <= point.y <= r.y1

    @staticmethod
    def _truncate(text: str, max_width: float, fontsize: float) -> str:
        if fitz.get_text_length(text, fontname=_FONT, fontsize=fontsize) <= max_width:
            return text
        # trim char-by-char, leaving room for an ellipsis
        out = text
        while out and fitz.get_text_length(out + "…", fontname=_FONT, fontsize=fontsize) > max_width:
            out = out[:-1]
        return (out + "…") if out else ""
