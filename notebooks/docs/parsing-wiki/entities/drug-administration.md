---
type: entity
updated: 2026-07-05
tags: [parsing, entity, drugs]
entity: DrugAdministration
---

# Entity — DrugAdministration (Fármaco administrado)

A single drug given during the case. **Many per [[anesthesia-case]]** — a collection.
Comes from the drug tables plus dosed agents in the technique.

## Attributes

| attribute | type | source |
|---|---|---|
| `label` (A–O / A–M) | string | table row id |
| `farmaco` / `nombre` | string | nota21 `farmaco.Fármaco`, IMSS p2 `Medicamento X` |
| `dosis` | number + unit (mg/mcg) | `Dosis y Vía`, technique doses (Propofol mg, Fentanilo mcg…) |
| `via` | enum IV/IM/inhalación/… | `Dosis y Vía`, IMSS inducción route |
| `time` | timestamp | plotted mark on [[transanesthetic-record]] |

Two shapes feed this: the **explicit tables** ([[table-detection]]:
`nota21.farmaco` rows A–O, `imss_p2.medicamentos` rows A–M) and the **inline dosed
agents** in [[anesthetic-technique]] (Propofol\_\_\_ mg, Fentanilo\_\_\_ mcg — the
`checkbox_value` fields).

## Relationships

Belongs to [[anesthesia-case]]; emitted by [[anesthetic-technique]]; marks appear on
[[transanesthetic-record]].

## App binding (the bridge)

Links to the app's `DrugModel` / TCI engine: a `DrugAdministration` of Propofol with a
target concentration is exactly what `computeTCI` / `simulate` consume. The app can
compute the *recommended* dose (bolus + infusion) and record the *given* dose in the
same object — planning and documentation unified.

## Round-trip

Fills the A–O / A–M rows (name + dose/route cells) and the inline drug blanks of nota2.
The collection maps row-by-row into the table cell bboxes.
