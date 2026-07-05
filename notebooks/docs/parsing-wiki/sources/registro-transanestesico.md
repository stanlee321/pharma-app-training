---
type: source
updated: 2026-07-05
tags: [parsing, source, vector, tables, chart]
form_id: registro_transanestesico
state: done
---

# Source — Registro Transanestésico (2-1.pdf)

- **File:** `../../data/NOTA POST y TRANSANESTÉSICA 2-1.pdf`
- **Producer:** Microsoft Excel LTSC → PDF · 1 page · Letter (612×792)
- **Type:** vector, but structurally the hardest form so far
- **Role:** the *transanesthetic record* — the live half: patient-ID header, vitals
  graph over time, fluid-balance tables, Fármaco A–O, somatometry/labs. Companion to
  [[nota-postanestesica]].

## What makes it hard

Three shapes the checkbox-only extractor didn't cover:
1. a **time-series vitals grid** (~21,000 dotted rects) — [[chart-detection]],
2. structured **tables** (Fármaco A–O; Control de fluidos 17×5) — [[table-detection]],
3. a **clip-hidden phantom duplicate** of the fluid table that pdfplumber mis-handled
   — the trigger for the PyMuPDF rewrite ([[clip-aware-source]]).

## Results

- **Clone:** **99.0%** pixel-identical (mean **1.42/255**, 1.04% visibly diff).
  `../../forms/out/nota21_clone.pdf`. Verified: `nota21_overlay.png`, `fluid_zoom.png`.
- **Schema:** **70 fields** (29 checkbox, 10 number, 5 text, **26 open_field** = full
  header + diagnóstico/isquemia/neumoperitoneo block) + **2 tables** + **1 chart**.
  `../../forms/schema/nota21.schema.json`.
  - `tables`: `farmaco` (15 rows A–O × 2 cols), `control_fluidos` (17 rows × 5 hr-cols).
  - `charts`: `vitals_grid` — bbox `[116,92,594.6,445.7]`, 12 y-ticks (20–240),
    4 hour lines, 28 lanes, bands `[Anestésicos Inhalados, Fluidos IV]`, legend.

## Profile

`PROFILES["registro_transanestesico"]` declares `chart:True` + two table specs
(anchors: title, row labels A–O / NCL…Gasto urinario, hour columns). See
[[table-detection]].

## Techniques born here

[[clip-aware-source]] (PyMuPDF rewrite), [[ink-oracle]] (phantom-stroke filter),
[[table-detection]], [[chart-detection]]. Three bugs fixed — [[lessons]] #3
(degenerate rects), #2 (rawdict flags), #6 (centerline ink test).

## App mapping

`vitals_grid` → the app's `ChartCanvas`; the two tables → editable grids; header →
patient-info UI. The paper graph *becomes* the interactive chart.

## Run

```bash
PY=/Users/stanleysalvatierra/anaconda3/envs/forms_p11/bin/python
$PY forms/regen.py "data/NOTA POST y TRANSANESTÉSICA 2-1.pdf" forms/out/nota21_clone.pdf
$PY forms/schema_extract.py "data/NOTA POST y TRANSANESTÉSICA 2-1.pdf" registro_transanestesico forms/schema/nota21.schema.json
```
