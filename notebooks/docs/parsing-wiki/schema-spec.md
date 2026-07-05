---
type: spec
updated: 2026-07-05
tags: [parsing, contract]
---

# Schema Spec — the output JSON contract

What `schema_extract.py` emits and the app consumes. One JSON per form. All bboxes are
`[x0, top, x1, bottom]` in **points, top-left origin** (matches the source PDF, so it
maps 1:1 back for a filled-PDF export and forward to the app canvas).

## Top level

```jsonc
{
  "form_id": "registro_transanestesico",
  "page":    { "width": 612, "height": 792 },
  "major_sections": ["Anestesia General", ...],   // rotated white sidebar labels
  "subsections":    [ { "title": "...", "bbox": [...] } ],  // black-bar white headers
  "fields":  [ ... ],   // see below
  "tables":  [ ... ],   // profile-driven; [] if none
  "charts":  [ ... ]    // profile-driven; [] if none
}
```

## `fields[]`

```jsonc
{
  "id":    "propofol_42",          // slug(label)+index, stable-ish
  "type":  "checkbox_value",       // see types below
  "label": "Propofol",
  "unit":  "mg",                   // or null
  "section": "Anestesia General",  // major zone by containment, or null
  "bbox":  [x0, top, x1, bottom],  // whole field extent
  "checkbox_bbox": [...] | null,   // the tick box, if any
  "blank_bbox":    [...] | null    // the writable value area, if any
}
```

**Field types** (from [[field-detection]]):

| type | meaning | app control |
|---|---|---|
| `checkbox` | tick box + label, no value | toggle |
| `checkbox_value` | tick box + label + fill-blank (+unit) | toggle + input |
| `number` | fill-blank with a recognised unit | numeric input |
| `text` | fill-blank, no unit | text input |
| `open_field` | `"Label:"` then empty ruled space | text input (free) |

## `tables[]`

From [[table-detection]]. Cell bounds are the intersection of `row_cuts` × `col_cuts`.

```jsonc
{
  "id": "control_fluidos",
  "title": "Control de fluidos",
  "bbox": [x0, top, x1, bottom],
  "rows":    [ { "label": "NCL",  "y0": .., "y1": .. }, ... ],
  "columns": [ { "label": "1 hr", "x0": .., "x1": .. }, ... ],
  "row_cuts": [ .. ],   // horizontal grid lines (y)
  "col_cuts": [ .. ]    // vertical grid lines (x)
}
```

## `charts[]`

From [[chart-detection]]. A time-series plotting grid — maps to the app's `ChartCanvas`.

```jsonc
{
  "id": "vitals_grid",
  "type": "timeseries_chart",
  "bbox": [x0, top, x1, bottom],
  "y_axis": { "ticks": [ { "value": 240, "y": .. }, ... ] },   // 20..240
  "x_axis": { "hour_lines": [ x, .. ], "minor_labels": [ {"label":"15","x":..} ] },
  "lanes":  [ { "label": "EKG", "y": .. }, ... ],   // plot rows down the left edge
  "bands":  [ { "label": "Anestésicos Inhalados", "y0":.., "y1":.. } ],
  "legend": { "text": "Δ Temperatura, X Tensión Arterial, ...", "bbox": [...] }
}
```

## Consuming it in the app

- `fields[]` → form controls (bind by `id`; group by `section`).
- `tables[]` → editable grids (rows × columns).
- `charts[]` → the interactive vitals chart (`ChartCanvas`); axis scale + lanes come
  straight from `y_axis`/`lanes`.
- The **same bboxes** feed a filled-PDF export: draw entered values into `blank_bbox` /
  cell rects over the [[fidelity-verification|1:1 clone]].

See the live examples: `../../forms/schema/nota2.schema.json`,
`../../forms/schema/nota21.schema.json`.
