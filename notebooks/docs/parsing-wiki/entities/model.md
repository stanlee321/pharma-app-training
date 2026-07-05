---
type: entity-index
updated: 2026-07-05
tags: [parsing, entities, domain-model, synthesis]
---

# Entities — the domain model behind the forms

This is the **synthesis layer**: the canonical data model implied by every parsed
schema. Parsing gave us fields; entities are what those fields *mean*. The same
clinical objects recur across all four forms — so one model powers them all.

## Why entities unlock the app (the round-trip)

```
   paper form  ──parse──►  field schema  ──group──►  ENTITIES  (this layer)
       ▲                        │                        │
       │                        │  bbox per field        │  app collects instances
       │                        ▼                        ▼  via native UI
   filled PDF  ◄──draw values into bboxes over the 1:1 clone──┘
```

Every schema field carries a **bbox** ([[schema-spec]]) and maps to an **entity
attribute**. So the app can: (1) collect entity instances through digital UI, (2) bind
them onto any form's schema, (3) **regenerate the exact expected PDF** by drawing values
into the field bboxes over the [[fidelity-verification|1:1 clone]]. One entity model →
all three forms' PDFs. *The manual paper process becomes a digital process that emits
the identical PDF the clinic expects today.* That fill step is the next technique to
build (`fill-pdf`, planned).

## Entity catalog

| Entity | Cardinality | Appears in (forms) |
|---|---|---|
| [[patient]] | 1 per case | all four |
| [[anesthesia-case]] | root | all four |
| [[preanesthetic-assessment]] | 1 per case | IMSS p1, nota2 (premedicación) |
| [[anesthetic-technique]] | 1 per case | nota2 (rich), IMSS p2 (método) |
| [[transanesthetic-record]] | 1 per case | nota21 + IMSS p2 (vitals grid) |
| [[drug-administration]] | many per case | nota21 fármaco, IMSS p2 medicamentos, technique doses |
| [[fluid-balance]] | 1 per case | nota21 control_fluidos, nota2 hemocomponentes |
| [[recovery-score]] | 1 per case (× time points) | IMSS p1 Aldrete, nota2 (término) |
| [[newborn-record]] | 0..n (obstetric) | IMSS p2 casos obstétricos |

`anesthesia-case` is the aggregate root; everything else hangs off it.

## Field → entity map (grounded in the parsed schemas)

| Form / section | → Entity |
|---|---|
| `imss_p1.datos` (EDAD, SEXO, PESO, ESTATURA, Hb, Hto, Rh, grupo…) | [[patient]] |
| `nota21` header (Registro, Sala, Servicio, somatometría IMC/peso ideal) | [[patient]] + [[anesthesia-case]] |
| `imss_p1.antecedentes / exploracion / orina / quimica` | [[preanesthetic-assessment]] |
| `nota2` Anestesia General / Regional / Bloqueo; `imss_p2.metodo` | [[anesthetic-technique]] |
| `nota21.vitals_grid` + `imss_p2.vitals_grid`; `nota21` monitoreo; nota2 signos basales | [[transanesthetic-record]] |
| `nota21.farmaco`, `imss_p2.medicamentos`, technique drug doses | [[drug-administration]] |
| `nota21.control_fluidos`, nota2 hemocomponentes | [[fluid-balance]] |
| `imss_p1.aldrete` (36 cells), nota2 Aldrete/Ramsay/Bromage/ENA | [[recovery-score]] |
| `imss_p2.obstetricos` (RN sexo/peso/talla, Apgar) | [[newborn-record]] |
| `imss_p2.diagnostico / firmas / clasificacion`, ASA, RAQ | [[anesthesia-case]] |

## Bridge to the existing app model

Three entities connect directly to code the app already has (see the app's
`PatientProfile`, `ChartCanvas`, `DrugModel`):

- [[patient]] `weight/height/age/sex` **is** the pharma engine's `PatientProfile`
  (→ LBM → Marsh/Schnider/Minto/Hannivoort). The form's patient data can *drive the
  simulation*.
- [[transanesthetic-record]] time-series ↔ `ChartCanvas` (the paper vitals grid is the
  interactive chart).
- [[drug-administration]] ↔ the app's drug models / TCI dosing.

This is the join between the **parsing** work (this wiki) and the **pharma app** — the
forms supply the clinical envelope; the engine supplies the dosing math.
