---
type: entity
updated: 2026-07-05
tags: [parsing, entity, fluids]
entity: FluidBalance
---

# Entity — FluidBalance (Control de fluidos)

Intake/output accounting across the case. **1 per [[anesthesia-case]]**, tallied per
hour. From `nota21.control_fluidos` ([[table-detection]], 17 rows × 5 hour-columns) +
nota2 hemocomponentes.

## Structure

A matrix: **rows** (line items) × **columns** (`1 hr … 5 hr`), each cell a volume (ml).

### Row items (`control_fluidos.rows`)
- Losses/requirement: `NCL, DCL, 3er Espacio, Diuresis, Circuito respiratorio`,
  `Sangrado` (Textiles / Aspirador / Recuperador), `Total a reponer`.
- Intake: `Ingreso Cristaloide, Ingreso Coloide, Ingreso Hemocomponente`.
- Derived: `Balance parcial, Balance total, Tasa Fentanilo (µg/kg), Gasto urinario
  (ml/kg)`.

### Blood components (nota2)
`concentrado_globular, concentrado_plaquetario, plasma_fresco_congelado,
aferesis_plaquetaria` (ml).

### Somatometry-derived volumes (nota21)
`VSC, SP, 25%_VSC, 15%_VSC` — computed from [[patient]] weight.

## Relationships

Belongs to [[anesthesia-case]]; shares the fluid grid visually with
[[transanesthetic-record]]; `Tasa Fentanilo` references [[drug-administration]].

## App binding

Balances (`Balance parcial/total`, `Gasto urinario`) are **computed** — the app derives
them from the entered rows rather than hand-tallying, and can flag imbalance.

## Round-trip

Fills the `control_fluidos` table cells (row × hour intersections) via
[[table-detection|row_cuts × col_cuts]].
