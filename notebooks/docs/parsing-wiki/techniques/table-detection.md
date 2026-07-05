---
type: technique
updated: 2026-07-05
tags: [parsing, tables]
---

# Table detection — anchored rows/cols + line-derived cells

For grid tables (drug list, fluid balance). **Anchored**, not fully automatic: we
declare the semantic anchors per form; the geometry (cell bounds) is derived from the
line grid. This is robust because clinical tables have known, fixed row/column labels.

## Per-form profile

In `schema_extract.py`'s `PROFILES[form_id]["tables"]`, one spec per table:

```python
dict(id="control_fluidos", title="Control de fluidos", title_x=(340, 480),
     rows=["NCL","DCL","3er Espacio", ... "Gasto urinario ml/kg"], rows_x=(340, 500),
     cols=["1 hr","2 hr","3 hr","4 hr","5 hr"], cols_x=(430, 615), x_right=606)
```

`*_x` are coarse x-windows that disambiguate a label from identical text elsewhere.

## `extract_table`

1. **Anchor** — find the title token, then each declared row-label and column-header
   token (via `_find_token`, which allows containment for long anchors since a cell's
   text can absorb a neighbour, e.g. `"mlTasa Fentanilo µg/kg"`).
2. **Grid lines** — from `segments()` ([[clip-aware-source]]), take horizontal cuts
   spanning most of the table width and vertical cuts within its x-range. Dedupe
   near-duplicates (`_cuts`, ~1.5pt tol). These segments are **ink-filtered** by the
   [[ink-oracle]] first, so phantom borders don't fabricate cells.
3. **Cell bounds** — each row's `[y0,y1]` = the pair of horizontal cuts bracketing its
   label centroid; each column's `[x0,x1]` = the bracketing vertical cuts. Snap the
   table bbox to the outermost cuts.

Output: `rows[]`, `columns[]`, `row_cuts[]`, `col_cuts[]` — a cell is the intersection
of a row band and a column band. See [[schema-spec]].

## Why anchored beats pure line-clustering

Pure grid-clustering can't name rows/columns, and merged/blank cells make row counts
ambiguous. Declaring the known labels gives every cell a stable semantic key the app
binds to — and lets `_find_token` recover even when adjacent cell text bleeds together.

## Results

- [[registro-transanestesico]]: `farmaco` (15 rows A–O × 2 cols) and `control_fluidos`
  (17 rows × 5 hour-columns), cell bounds from 23/17 detected line cuts.

## Code

`../../forms/schema_extract.py` — `extract_table`, `_find_token`, `_cuts`, `PROFILES`.
