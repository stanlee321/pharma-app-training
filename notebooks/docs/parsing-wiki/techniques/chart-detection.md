---
type: technique
updated: 2026-07-05
tags: [parsing, charts, timeseries]
---

# Chart detection — the vitals grid as a `timeseries_chart`

The transanesthetic form's centrepiece is a hand-plotted **vitals graph over time**
(the anesthesiologist plots Δtemp, ✕ BP, • HR, ○ resp against a 20–240 scale). It's not
fields — it's a plotting surface. We emit it as a structured `timeseries_chart` that
**maps onto the app's existing `ChartCanvas`**.

Enabled per form by `PROFILES[form_id]["chart"] = True`.

## `extract_chart`

1. **Find the lattice.** The dotted grid is thousands of tiny filled rects
   (form 2-1 had ~21,000). Collect filled rects with `w,h ≤ 1.6pt`; require ≥ 2000 to
   confirm a chart. The bbox = their extent, trimmed of 0.5% outliers.
2. **Y-axis ticks.** Integer tokens that are multiples of 20 in 20…240, sitting just
   left of the grid → `{value, y}`. (12 ticks on 2-1.)
3. **X-axis.** `minor_labels` = "15"/"30"/"45" tokens above the grid; `hour_lines` =
   vertical segments spanning ≳ half the grid height (the hour boundaries).
4. **Lanes.** Short **alpha** labels hugging the grid's left edge — EKG, SpO₂, CO₂,
   BIS, the drug rows A–O, ventilación modes. Each `{label, y}` is a plot row. (28 on
   2-1.) Numeric-only labels are excluded (those are the axis ticks).
5. **Bands.** Rotated black labels at the far left ("Anestésicos Inhalados",
   "Fluidos IV") via `rotated_labels(want_white=False)` — see [[field-detection]].
6. **Legend.** The symbol-key line under the grid ("Δ Temperatura, X Tensión
   Arterial…").

The chart's bbox becomes a **skip zone** so [[field-detection]] doesn't scatter phantom
fields across the plotting grid.

## Mapping to the app

`y_axis.ticks` → the concentration/value axis scale; `x_axis` → the time axis;
`lanes` → the plotted series/rows; `bands` → grouping. The paper grid *becomes* the
interactive `ChartCanvas`. See [[schema-spec]].

## Result

- [[registro-transanestesico]]: `vitals_grid` — bbox `[116, 92, 594.6, 445.7]`,
  12 y-ticks, 4 hour lines, 28 lanes, bands `[Anestésicos Inhalados, Fluidos IV]`,
  legend captured.

## Code

`../../forms/schema_extract.py` — `extract_chart`.
