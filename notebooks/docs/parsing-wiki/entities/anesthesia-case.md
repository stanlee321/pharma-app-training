---
type: entity
updated: 2026-07-05
tags: [parsing, entity, aggregate-root]
entity: AnesthesiaCase
---

# Entity — AnesthesiaCase (Caso anestésico)

The **aggregate root**: one peri-operative anesthesia episode. Every other entity hangs
off it. A single case can emit all three forms.

## Attributes

| attribute | type | source fields |
|---|---|---|
| `fecha` | date | nota21 `Fecha`, forms header |
| `tipo_admision` | enum urgencia/electiva | nota21 `Urgencia`/`Electiva` |
| `tipo` | enum I/II | nota21 `Tipo I`/`II` |
| `diagnostico_preop`, `diagnostico_postop` | text | IMSS p2 `PREOPERATORIO`/`OPERATORIO` |
| `operacion_propuesta`, `operacion_realizada` | text | IMSS p2 `PROPUESTA`/`REALIZADA` |
| `procedimiento` | text | nota21 procedimiento quirúrgico |
| `asa` | enum I–V | nota21 `ASA`, IMSS |
| `raq` (riesgo anestésico-quirúrgico) | enum | IMSS p1 `r.a.q. 1..5`, IMSS p2 clasif |
| `posicion` | enum | nota21 posición, IMSS p2 clasif |
| `duracion_anestesia` | duration | IMSS p2 `Duración de la anestesia` |
| `isquemia`, `neumoperitoneo` | sub-records | nota21 |
| `complicaciones_trans`, `complicaciones_post` | text | IMSS p1 `complicaciones` |
| `observaciones` | text | IMSS p2 `Observaciones` |
| `equipo_quirurgico` | text | nota21 |
| **providers** | see below | firmas |

### Providers (personnel — folded in)
`anestesiologo` (nombre, cédula, universidad, `clave`), `cirujano` — IMSS p2 `firmas`,
nota21 anestesiólogo line.

### Classification footer (IMSS p2 `clasificacion`)
`riesgo_anestesico_quirurgico, medicacion_preanestesica, anestesicos, terapia,
complicaciones, posicion, edad, sexo` — a coded summary strip; several are derived from
other entities.

## Relationships

Owns: [[patient]], [[preanesthetic-assessment]], [[anesthetic-technique]],
[[transanesthetic-record]], [[drug-administration]] (many), [[fluid-balance]],
[[recovery-score]], [[newborn-record]] (obstetric only).

## Round-trip

The case envelope fills the diagnóstico/operación/firmas blocks of IMSS p2 and the
header of nota21. Its child entities fill the rest.
