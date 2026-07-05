---
type: entity
updated: 2026-07-05
tags: [parsing, entity, obstetric]
entity: NewbornRecord
---

# Entity — NewbornRecord (Recién nacido / Casos obstétricos)

Obstetric outcome, present only for obstetric cases. **0..n per [[anesthesia-case]]**
(usually 1; more for multiples). From `imss_p2.obstetricos`.

## Attributes

| attribute | type | source |
|---|---|---|
| `expulsion_placenta` | enum espontánea/manual | IMSS p2 `EXPULSION DE LA PLACENTA` |
| `sexo` | enum | `rn_sexo` |
| `peso` | number (g/kg) | `rn_peso` |
| `talla` | number (cm) | `rn_talla` |
| `apgar` | {1min, 5min, 10min} scores | Apgar sub-table |
| `estado_general_al_salir` | Apgar/text | `ESTADO GENERAL AL SALIR DEL QUIROFANO` |

## Relationships

Belongs to [[anesthesia-case]] (obstetric). The Ø F.C.F. lane on
[[transanesthetic-record]] is the fetal-heart trace for the same case.

## Round-trip

Fills the CASOS OBSTÉTRICOS block of IMSS p2 — the SEXO/PESO/TALLA rows and the
1/5/10-minute Apgar cells (`rn_*` field bboxes in `imss_p2.schema.json`).

## Note

Conditional entity: only instantiated when the case is obstetric. The app should show
this block only for that case type.
