---
type: pipeline
updated: 2026-07-05
tags: [parsing, architecture]
---

# Pipeline — the 3-module architecture

All code in `../../forms/`. One shared source-of-truth loader feeds two consumers.

```
                    ┌──────────────┐
   source PDF ─────►│  pdfsrc.py   │  clip-aware primitives (chars + drawings)
                    └──────┬───────┘
                           │  page = {width, height, chars[], drawings[]}
              ┌────────────┴────────────┐
              ▼                         ▼
       ┌────────────┐          ┌──────────────────┐
       │  regen.py  │          │ schema_extract.py│
       └─────┬──────┘          └────────┬─────────┘
             ▼                          ▼
   1:1 clone PDF + InkOracle    schema JSON (fields/tables/charts)
```

## `pdfsrc.py` — the shared page source (PyMuPDF)

Why PyMuPDF and not pdfplumber: it is the ground truth of what actually *renders* —
clip-aware text and scissor-aware graphics. pdfplumber both included clip-hidden
phantom content and mis-placed some Excel spans. See [[clip-aware-source]].

- `load(pdf)` → `{pages: [{width, height, chars, drawings}]}`
- **chars** (from `get_text("rawdict")`, *default flags*): `text, font, size, color,
  x0/top/x1/bottom, origin, dir, upright, line_id`. `line_id` = one rawdict visual
  line (used to reassemble rotated labels — see [[field-detection]]).
- **drawings** (from `get_drawings(extended=True)`): clip scissor stack by `level`;
  paths fully outside their scissor are dropped (epsilon-inflated test — see
  [[geometry]]). Each: `type (f|s|fs), items, rect, scissor, fill, color, width,
  even_odd`.
- `segments(drawings)` → `(h_segments, v_segments)`: flattens stroked lines, rect
  edges, **and thin filled rects** (Excel draws borders as skinny fills) into axis
  lines for [[table-detection]].

Coordinates everywhere: **top-left origin, y grows down** (points).

## `regen.py` — 1:1 regenerator + InkOracle

Reads `pdfsrc` primitives, re-emits them with ReportLab. Draws **graphics first, text
on top** (forms = background rules + foreground text).

- `FontMapper` — extracts *this* PDF's own embedded font subsets, registers each,
  and `pick(font, glyph)` chooses a registered subset that actually contains the
  glyph (`charToGlyph`), else system Arial. Wingdings2 → drawn square. See
  [[font-handling]].
- `InkOracle` — rasterizes the original at 150 dpi; `seg_coverage()` / `stroke_visible()`
  drop phantom line-like items the original shows no continuous ink along. See
  [[ink-oracle]].
- Char placement: `transform(dx, -dy, dy, dx, ox, H-oy)` from the char's `origin` and
  line `dir` — handles rotation uniformly. See [[geometry]].

Run: `python forms/regen.py <src.pdf> <out.pdf>`

## `schema_extract.py` — semantic extractor

Reads `pdfsrc` primitives → the schema in [[schema-spec]].

- `build_lines` → tokens (text / blank / checkbox), clustered by baseline.
- `extract_fields` → checkbox / checkbox_value / number / text / open_field
  state machine ([[field-detection]]).
- `rotated_labels` → sidebar `major_sections` (white) & chart `bands` (black).
- `extract_table` (anchored) + `extract_chart` (lattice) driven by a per-form
  `PROFILES` entry ([[table-detection]], [[chart-detection]]).
- Shares `InkOracle` from `regen.py` to filter phantom table lines.

Run: `python forms/schema_extract.py <src.pdf> <form_id> <out.json>`

## Adding a new form

Generic field detection needs no code. For tables/charts, add one `PROFILES[form_id]`
dict: table specs (title + row labels + column headers) and `chart: True`.
