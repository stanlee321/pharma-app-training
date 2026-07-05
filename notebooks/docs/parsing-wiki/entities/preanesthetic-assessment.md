---
type: entity
updated: 2026-07-05
tags: [parsing, entity]
entity: PreanestheticAssessment
---

# Entity — PreanestheticAssessment (Valoración preanestésica)

Pre-op work-up: history, airway/system exam, and lab panel. **1 per
[[anesthesia-case]].** Almost entirely from IMSS page 1 ([[imss-registro-anestesia]]).

## Attributes

### History (`imss_p1.antecedentes`)
`antecedentes_anestesicos, alergia, dentadura, cuello, estado_psiquico, otros,
medicamentos_previos, analgesica_obstetrica` — mostly free text.
Plus `premedicacion` (nota2).

### Exam (`imss_p1.exploracion`)
`aparato_respiratorio`, `aparato_cardiovascular` — free text; `tegumentos` (from
`imss_p1.datos`).

### Labs — Urine (`imss_p1.orina`)
`densidad, albumina, cilindros, hematuria, bilirrubina, glucosa, acetona`.

### Labs — Blood chemistry (`imss_p1.quimica`)
`urea, creatinina, glucosa, albumina, globulina, po2, pco2, sat_pct_hb, ph, k, cl, na`.

Each lab is a `{value, unit}` numeric. Baseline blood counts (Hb/Hto/Rh/grupo) live on
[[patient]].

## Relationships

Belongs to [[anesthesia-case]]; informs the `asa`/`raq` risk scoring there.

## Round-trip

Fills the top ~two-thirds of IMSS p1 (all rows above COMPLICACIONES). Each attribute →
its measured cell bbox in `imss_p1.schema.json`.

## Note

The lab panels are a natural fit for structured `{analyte: value}` capture in the app,
with reference-range validation — richer than the paper's blank cells.
