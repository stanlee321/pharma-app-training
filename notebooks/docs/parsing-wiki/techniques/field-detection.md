---
type: technique
updated: 2026-07-05
tags: [parsing, fields, heuristics]
---

# Field detection — tokens → typed fields

Turns primitives into app-bindable fields (`checkbox / checkbox_value / number / text
/ open_field`). No per-form config — this is generic across layouts. Output shape:
[[schema-spec]].

## 1. Tokens (`build_lines`)

Cluster upright chars into visual lines by **baseline (`bottom`), ~3.5pt tol**
([[geometry]], [[lessons]] #10). Within a line, merge adjacent chars into tokens:

- **checkbox** — Wingdings font (`is_checkbox`).
- **blank** — a run of `_` (fill-in line).
- **text** — everything else; split when the gap exceeds ~3.5pt (text) / 2.5pt (blank).

## 2. State machine (`extract_fields`)

Scan each line's tokens left→right:

- **checkbox** → label = the text token to its right. If a **blank** follows the label
  → `checkbox_value` (+ `unit` via `unit_after` lookahead); else `checkbox`.
  Emits `checkbox_bbox` and, if present, `blank_bbox`.
- **blank** → label = nearest **non-empty** text token to the *left*; `unit` via
  lookahead. `number` if a unit is found, else `text`.
- **open field** → a `"Label:"` text token with a wide empty gap to its right (no
  blank glyph, just ruled space). Value area runs from the label to the next
  **vertical rule on that line's y-band** (not a page-wide x-cut — [[lessons]] #11).
  Catches header fields like `Registro:`, `Diagnóstico:`, `Preoperatorio:`.

`unit_after` skips whitespace/empty tokens and matches a known `UNITS` set (`mg, mcg,
ml, mmHg, lpm, /min, %, cmH₂O, …`).

## 3. Sections (`rotated_labels`)

Rotated text = zone labels. Group rotated chars by `line_id` (one rawdict line, already
in reading order — [[clip-aware-source]]), then merge parallel columns that overlap in
y and share an x. `want_white=True` → white sidebar labels = **major_sections**
(Anestesia General / Regional Neuroaxial / Bloqueo Periférico). `want_white=False` →
black band labels = chart bands ([[chart-detection]]).

Each field's `section` = the major band whose y-range contains it.

**Colour gotcha:** white text is grayscale and may be a 1-element tuple `(1.0,)`; the
`white()` check must handle len-1 tuples or header detection silently returns zero.
[[lessons]] #8

## Skip zones

Fields are not created inside a chart's lattice bbox (`skip_zones`) — the grid is a
plotting surface, not inputs.

## Results

- [[nota-postanestesica]]: 254 fields (152 checkbox, 44 checkbox_value, 9 number,
  44 text, 5 open).
- [[registro-transanestesico]]: 70 fields (29 checkbox, 10 number, 5 text, 26 open —
  the full patient header + diagnóstico block).

## Code

`../../forms/schema_extract.py` — `build_lines`, `extract_fields`, `unit_after`,
`rotated_labels`.
