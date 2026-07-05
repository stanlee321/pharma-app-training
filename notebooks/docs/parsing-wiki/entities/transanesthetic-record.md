---
type: entity
updated: 2026-07-05
tags: [parsing, entity, timeseries, chart]
entity: TransanestheticRecord
---

# Entity — TransanestheticRecord (Registro transanestésico)

The live intra-operative record: vital signs over time + monitoring setup. **1 per
[[anesthesia-case]].** Backs both vitals grids (`nota21.vitals_grid`,
`imss_p2.vitals_grid` — see [[chart-detection]]).

## Structure

### Time series (the plotted grid)
`series[]` of `(time, value)` for **TEMP, T.A., PULSO, R.** (IMSS legend) / and the
nota21 lanes (EKG, SpO₂, CO₂, PVC, BIS…). Axis 20–240; time in the 5 hour-blocks of
15/30/45 min. `agents[]` (inhaled agents, top AGENTES rows).

### Timeline events (markers 1–6)
`1 Llegada a quirófano, 2 Inicio anestesia, 3 Incisión, 4 Termina cirugía, 5 Termina
anestesia, 6 Pasa a recuperación` (+ Ø F.C.F. obstetric). Each = a timestamp anchoring
the x-axis.

### Snapshots (basal / post)
`FC, FR, TA, PAM, SpO₂, PVC` at **basal** and **post** (nota2 signos vitales rows;
IMSS p1 baseline TA/P/R/T). Store as labelled snapshots.

### Monitoring setup (`nota21` monitoreo)
Booleans: `ECG, FC, PAi, PVC, PANI, SpO₂, EtCO₂, FiO₂, BIS, Entropía, TNM,
protección_ocular, SNG, cateter_vesical`; temperature site; vascular access (vena
periférica/línea arterial/CVC with calibre+ubicación); O₂ suplementario; ventilación.

## Relationships

Belongs to [[anesthesia-case]]. Shares fluid rows with [[fluid-balance]]; drug marks
reference [[drug-administration]]. Airway/vent params overlap [[anesthetic-technique]].

## App binding (the bridge)

The time series **is** the app's `ChartCanvas` — axis scale, hour divisions and lanes
come straight from the `vitals_grid` chart component ([[schema-spec]]). The paper's
hand-plotted curve becomes the interactive chart; the app can also overlay the pharma
engine's predicted Cp/Ce.

## Round-trip

Plotting values back into the `vitals_grid` bbox regenerates the chart region of nota21
/ IMSS p2. Snapshots fill the signos-vitales rows.
