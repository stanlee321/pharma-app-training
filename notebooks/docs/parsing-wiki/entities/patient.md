---
type: entity
updated: 2026-07-05
tags: [parsing, entity]
entity: Patient
---

# Entity — Patient (Paciente)

Identity + biometrics of the person undergoing anesthesia. **1 per
[[anesthesia-case]].** Recurs in every form — the most shared entity.

## Attributes

| attribute | type | source fields |
|---|---|---|
| `registro` (id) | string | nota21 `Registro`, IMSS header |
| `nombre` | string | nota21 `Datos del Hospital` / paciente |
| `edad` | number (yr) | IMSS p1 `EDAD`, nota21 `Edad`, IMSS p2 clasif `EDAD` |
| `sexo` | enum M/F | IMSS p1 `SEXO`, nota21 `Sexo` |
| `peso` | number (kg) | IMSS p1 `PESO`, nota21 somatometría `Peso` |
| `talla` / estatura | number (cm) | IMSS p1 `ESTATURA`, nota21 `Talla` |
| `imc`, `peso_ideal` | number | nota21 somatometría |
| `hb, hto, rh, grupo_sanguineo` | labs | IMSS p1 `datos` |
| `sala, servicio, cama, hab` | strings | nota21 header, IMSS p2 `Cama` |

Vital-sign columns TA/P/R/T in `imss_p1.datos` are **baseline** readings — model them on
[[transanesthetic-record]] (basal snapshot), not here.

## Relationships

Belongs to [[anesthesia-case]]. Referenced by [[preanesthetic-assessment]],
[[recovery-score]], [[drug-administration]] (per-kg dosing).

## App binding (the bridge)

`weight / height / age / sex` **is** the app's `PatientProfile` — the exact covariates
the pharma engine needs for LBM and the Marsh/Schnider/Minto/Hannivoort models. Capture
Patient once and the simulation is parameterised for free. See [[entities/model|the
bridge]].

## Round-trip

These attributes fill the identity cells of all four forms — the header rows of
nota21 / IMSS, and `imss_p1.datos`. Same Patient → every form's top block.
