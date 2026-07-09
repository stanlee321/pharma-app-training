---
type: plan
updated: 2026-07-09
tags: [plan, inventory, schema, entities, reference]
---

# Field Inventory — What Data the Forms Capture (Inputs) and Compute (Outputs)

**This is THE reference doc for what data exists.** It consolidates the per-field
analysis of the four parsed schemas into (1) input control-type counts, (2) per-entity
input tables, (3) the derived/computed outputs the app must *calculate* not collect, and
(4) the `fill-pdf` export mapping that draws values back into the source PDF.

It is a **grouping + quantification** layer only. The exhaustive per-field source is the
emitted schema JSON — every claim below cites it. The consuming plans are
[[forms-to-app]] (the master plan), [[proposed-screens]] (the app surfaces), and
[[rest-contract]] (the backend DTOs). Domain grounding is the nine-entity model at
[entities/model.md](../../../notebooks/docs/parsing-wiki/entities/model.md).

**Schemas** (the exhaustive source, one JSON per form):
[`nota2.schema.json`](../../../notebooks/forms/schema/nota2.schema.json) ·
[`nota21.schema.json`](../../../notebooks/forms/schema/nota21.schema.json) ·
[`imss_p1.schema.json`](../../../notebooks/forms/schema/imss_p1.schema.json) ·
[`imss_p2.schema.json`](../../../notebooks/forms/schema/imss_p2.schema.json).
Schema contract: [schema-spec.md](../../../notebooks/docs/parsing-wiki/schema-spec.md).

| File | `form_id` | Fields (typed) | Structured objects |
|---|---|---:|---|
| [`nota2`](../../../notebooks/forms/schema/nota2.schema.json) | `nota_postanestesica` | 254 | 0 tables, 0 charts (all flat) |
| [`nota21`](../../../notebooks/forms/schema/nota21.schema.json) | `registro_transanestesico` | 70 | +1 chart, +2 tables (`farmaco`, `control_fluidos`) |
| [`imss_p1`](../../../notebooks/forms/schema/imss_p1.schema.json) | `imss_valoracion_preanestesica` | 86 | Aldrete 6×6 `score` grid (36 cells) |
| [`imss_p2`](../../../notebooks/forms/schema/imss_p2.schema.json) | `imss_registro_anestesia` | 58 | +1 chart, 7 `composite` method blocks |

Per-file field totals sum to **468** (254 + 70 + 86 + 58); the authoritative
control-type totals below sum to **471** because the 2 charts + 2 tables are counted as
their own single fields. Treat **≈471 input fields** as the working figure.

---

## 1. Input control-type totals (authoritative)

Exact raw schema `type` counts, summed across all four files (n = **471**), mapped to the
UI control that should render each. Counts are grounded in the emitted schemas cited above.

| UI control | Count | Raw schema `type`(s) | Where |
|---|---:|---|---|
| **Checkbox** — select-group / boolean | **181** | `checkbox` | nota2 (152), nota21 (29) |
| **Short-text** — single-line write-in | **176** | `text` (145) + `open_field` (31) | all four |
| **Checkbox + value** — toggle + number/text | **44** | `checkbox_value` | nota2 |
| **Score-grid cell** | **36** | `score` | imss_p1 (Aldrete) |
| **Number + unit** | **19** | `number` | nota2 (9), nota21 (10) |
| **Composite / method block** | **7** | `composite` | imss_p2 |
| **Long-text / notes** | **4** | `textarea` | imss_p1 (2), imss_p2 (2) |
| **Time-series chart** | **2** | `timeseries_chart` | nota21, imss_p2 |
| **Table / grid** | **2** | table objects | nota21 (`farmaco`, `control_fluidos`) |
| **Total** | **471** | | |

**Re-slices of the raw counts (these do not add to the total):**

- The **181 checkboxes** are not 181 independent booleans — they cluster into **~45–55
  option groups**: some mutually exclusive **single-select** (Urgencia/Electiva,
  URPA/UCI/Habitación, Cormack I–IV), some **multi-select** (monitoring ECG/SpO₂/EtCO₂/BIS),
  plus true standalone **boolean toggles** (Preoxigenación, Empaquetamiento).
- **~4 of the 176 short-text are signatures** (`Anestesiólogo`, `Cirujano`, `Clave`) and
  **~6 are date/time** (`Fecha`, `Turno`, isquemia/neumoperitoneo `Hr inicio/término`,
  `Duración de anestesia`) — render as signature capture and date/time pickers, not text.
- The 2 charts, 2 tables and 36-cell score-grid are **single fields that each expand into
  dozens of capture points** at data-entry time (the `control_fluidos` grid alone =
  17 rows × 5 hourly columns = **85 cells**).

**Design headline:** 181 checkbox + 44 checkbox_value = **225 of 471 fields (48%)** are
toggle-based. A great checkbox-group / inline-value component pays off on every screen —
see the shared-components table in [[proposed-screens]] §5.

---

## 2. Inputs grouped by entity

Per-entity counts are **approximate allocations** of the fields in §1 (a few fields —
positioning, complications — legitimately span entities; structured objects are noted as
units). The schema JSON remains the exhaustive per-field source. Each entity links to its
synthesis page in the parsing sub-wiki.

### Patient — ≈32 fields · [patient](../../../notebooks/docs/parsing-wiki/entities/patient.md)
Source: [`imss_p1`](../../../notebooks/forms/schema/imss_p1.schema.json) `datos`,
[`nota21`](../../../notebooks/forms/schema/nota21.schema.json) somatometría.

| Control | Count |
|---|---:|
| Short-text | ≈23 |
| Number + unit | ≈9 |

Examples: `EDAD`, `SEXO`, `PESO`, `GRUPO SANGUINEO`; `Peso` [Kg], `Talla` [mt], `IMC`
[kg/m²], `Peso ideal` [Kg]; `Hb`, `Hto`. The numeric weight/height/age **are** the pharma
engine's `PatientProfile` — capture once, parameterise everything downstream.

### AnesthesiaCase (root) — ≈49 fields · [anesthesia-case](../../../notebooks/docs/parsing-wiki/entities/anesthesia-case.md)
Source: [`nota21`](../../../notebooks/forms/schema/nota21.schema.json) header,
[`imss_p2`](../../../notebooks/forms/schema/imss_p2.schema.json) diagnostico/firmas/clasificacion,
[`nota2`](../../../notebooks/forms/schema/nota2.schema.json) destination.

| Control | Count |
|---|---:|
| Short-text (admin, Dx, R.A.Q./ASA legends) | ≈26 |
| Single-select checkbox | ≈11 |
| Date / time | ≈6 |
| Signature | ≈4 |
| Long-text / notes | ≈2 |

Examples: `Sala`/`Servicio`/`Turno`/`Fecha`; `Urgencia` vs `Electiva`; `Diagnóstico
Preoperatorio`/`Operatorio`; destination `URPA`/`UCI`/`Habitación`;
`Anestesiólogo`/`Cirujano`/`Clave` signatures. Signatures and date/time need dedicated
controls, not plain text inputs.

### PreanestheticAssessment — ≈35 fields · [preanesthetic-assessment](../../../notebooks/docs/parsing-wiki/entities/preanesthetic-assessment.md)
Source: [`imss_p1`](../../../notebooks/forms/schema/imss_p1.schema.json)
antecedentes/exploracion/orina/quimica, [`nota21`](../../../notebooks/forms/schema/nota21.schema.json) premedicación.

| Control | Count |
|---|---:|
| Short-text | ≈35 |

Examples: `ALERGIA`, `DENTADURA`, `CUELLO`, `ESTADO PSIQUICO`; lab panel
`UREA`/`CREATININA`/`GLUCOSA`/`pH`/`Na`/`K`; urinalysis `densidad`/`albumina`/`glucosa`;
`r.a.q. 1–5`; `Premedicación`. **Reclassify:** the lab/urinalysis rows are numeric despite
being typed `text` — surface as number+unit in the UI, no schema change.

### AnestheticTechnique — ≈185 fields (largest entity) · [anesthetic-technique](../../../notebooks/docs/parsing-wiki/entities/anesthetic-technique.md)
Source: [`nota2`](../../../notebooks/forms/schema/nota2.schema.json) (rich),
[`imss_p2`](../../../notebooks/forms/schema/imss_p2.schema.json) `metodo`.

| Control | Count |
|---|---:|
| Checkbox — select-group / boolean | ≈120 |
| Checkbox + value | ≈40 |
| Short-text | ≈16 |
| Number + unit | ≈4 |
| Composite (method block) | 7 |

Examples: technique category `AGIB`/`AGEV`/`BEPD`/`Bloqueo de Plexo` (single-select);
volatile agents `Sevoflurano`/`Desflurano`/`Isoflurano`/`N₂O`; induction drugs as
**checkbox+value** `Propofol` ☐ __ mg, `Fentanilo` ☐ __ mcg; regional needles
`Tuohy`/`Quincke`/`Whitacre`; airway `TET Calibre` [mmDI]. Deeply hierarchical (General /
Regional Neuraxial / Peripheral Block) — the prime candidate for progressive disclosure;
the Regional Neuraxial (59) and Bloqueo Periférico (21) sub-sections are the heaviest.

### TransanestheticRecord — ≈46 fields + 2 charts · [transanesthetic-record](../../../notebooks/docs/parsing-wiki/entities/transanesthetic-record.md)
Source: [`nota21`](../../../notebooks/forms/schema/nota21.schema.json) `vitals_grid`/monitoreo,
[`imss_p2`](../../../notebooks/forms/schema/imss_p2.schema.json) `vitals_grid`,
[`nota2`](../../../notebooks/forms/schema/nota2.schema.json) signos basales.

| Control | Count |
|---|---:|
| Multi-select monitoring checkboxes | ≈29 |
| Short-text vitals (basal + termination) | ≈12 |
| Time-series chart | 2 |
| Long-text / notes (complications) | 2 |
| Number + unit | 1 |

Examples: the **vitals time-series chart** (plots TEMP, T.A., PULSO/FC, R., SpO₂, EtCO₂,
BIS with 1–6 surgical event markers); monitoring toggles `ECG`/`SpO₂`/`EtCO₂`/`BIS`/`TNM`,
temp-probe site `Esofágica`/`Rectal`/`Nasofaríngea`; `Flujo` [L/min]; nota2 basal &
termination `FC`/`TA`/`SpO₂`/`PVC`; `Complicaciones transanestésicas` (textarea). **The
interactive chart is the centrepiece** — maps to the app's `ChartCanvas`.

### DrugAdministration — ≈40 fields + 2 tables · [drug-administration](../../../notebooks/docs/parsing-wiki/entities/drug-administration.md)
Source: [`nota21`](../../../notebooks/forms/schema/nota21.schema.json) `farmaco` grid,
[`imss_p2`](../../../notebooks/forms/schema/imss_p2.schema.json) medicamentos,
[`nota2`](../../../notebooks/forms/schema/nota2.schema.json) regional doses.

| Control | Count |
|---|---:|
| Table / grid | 2 |
| Short-text (drug + dose/route rows) | ≈26 |
| Checkbox + value (regional drug doses) | ≈13 |
| Long-text (free agents) | 1 |

Examples: nota21 **`farmaco` grid** (rows A–O × *Fármaco* / *Dosis y Vía*); imss_p2
`Medicamento A–M` + `Dosis/Vía A–M` (26 paired text fields); nota2 regional drugs
`Lidocaína`/`Bupivacaína`/`Ropivacaína`/`Morfina`. An **editable repeatable table**
(add-row) is the right primitive; links to the app's `DrugModel` / TCI dosing.

### FluidBalance — ≈8 fields + 1 hourly grid · [fluid-balance](../../../notebooks/docs/parsing-wiki/entities/fluid-balance.md)
Source: [`nota21`](../../../notebooks/forms/schema/nota21.schema.json) `control_fluidos`,
[`nota2`](../../../notebooks/forms/schema/nota2.schema.json) hemocomponentes.

| Control | Count |
|---|---:|
| Table / grid (hourly balance) | 1 |
| Short-text summary lines | ≈3 |
| Multi-select (blood products) | ≈4 |

Examples: **`control_fluidos` grid** — 17 rows (`Sangrado`, `Diuresis`, `NCL`, `Ingreso
Cristaloide/Coloide/Hemocomponente`, `Balance parcial/total`, `Gasto urinario ml/kg`) ×
5 hourly columns = **85 numeric cells**; nota2 blood products `Concentrado
globular`/`plaquetario`/`Plasma fresco congelado`/`Aféresis`. Needs a spreadsheet-style
time-column widget with running-balance auto-calc (see §3).

### RecoveryScore — ≈48 fields · [recovery-score](../../../notebooks/docs/parsing-wiki/entities/recovery-score.md)
Source: [`imss_p1`](../../../notebooks/forms/schema/imss_p1.schema.json) Aldrete,
[`nota2`](../../../notebooks/forms/schema/nota2.schema.json) Aldrete/Ramsay/Bromage/ENA.

| Control | Count |
|---|---:|
| Score-grid cells | 36 |
| Short-text / number scales | ≈4 |
| Multi-select (emergence / reversal) | ≈8 |

Examples: imss_p1 **Aldrete score-grid** — 6 criteria (`Actividad muscular`,
`Respiración`, `Circulación`, `Estado de conciencia`, `Coloración`, `TOTAL`) × 6
time-points (`Al salir`, `0`, `20`, `60`, `90`, `120 min`); nota2
`Aldrete`/`Ramsay`/`Bromage`/`ENA`; reversal + emergence toggles. The Aldrete block is a
purpose-built **score-grid widget** — do not render as 36 loose numbers.

### NewbornRecord — ≈3 fields · [newborn-record](../../../notebooks/docs/parsing-wiki/entities/newborn-record.md)
Source: [`imss_p2`](../../../notebooks/forms/schema/imss_p2.schema.json) `obstetricos`.

| Control | Count |
|---|---:|
| Short-text | 3 |

Examples: `RN Sexo`, `RN Peso`, `RN Talla`. The model references Apgar; the schema exposes
only these three. Conditional sub-form shown only for obstetric cases, 0..n per case.

---

## 3. Derived / computed outputs — the app CALCULATES, not collects

These appear as fields/rows in the schemas but must be **engine-computed**, then written
back into their bboxes by `fill-pdf`. Never accept them from the client — the server (or
app) derives them. Grounded in the entity docs.

| Derived output | Formula / basis | Schema location | Doc |
|---|---|---|---|
| **Aldrete totals** | `total[t] = Σ 5 criteria`, range **0–10** | `aldrete_total_c0..c5` in [`imss_p1`](../../../notebooks/forms/schema/imss_p1.schema.json) | [recovery-score](../../../notebooks/docs/parsing-wiki/entities/recovery-score.md) |
| **Fluid balances** | `Balance parcial`, `Balance total`, `Gasto urinario (ml/kg)`, `Tasa Fentanilo (µg/kg)` computed per hour-column from entered intake/loss rows (NCL, DCL, Diuresis, Sangrado, Ingresos) | last 4 rows of `control_fluidos` in [`nota21`](../../../notebooks/forms/schema/nota21.schema.json) (marked *Derived*) | [fluid-balance](../../../notebooks/docs/parsing-wiki/entities/fluid-balance.md) |
| **Patient biometrics** | `IMC` (kg/m²), `Peso ideal` (kg), blood-volume set `VSC` (ml), `25% del VSC`, `15% del VSC` — all from `peso_52`/`talla_53` | `imc_54`, `peso_ideal_55`, `vsc_62`, `25_del_vsc_64`, `15_del_vsc_65` in [`nota21`](../../../notebooks/forms/schema/nota21.schema.json) | [patient](../../../notebooks/docs/parsing-wiki/entities/patient.md) |
| **TCI dosing** | recommended **bolus + infusion** per drug from the PK engine: `PatientProfile → LBM → Marsh/Schnider/Minto/Hannivoort → computeTCI/computeBET` | fills dose cells in `farmaco` / `medicamentos` / nota2 `checkbox_value` drug blanks | [drug-administration](../../../notebooks/docs/parsing-wiki/entities/drug-administration.md), [[pk-engine-math]] |

`weight/height/age/sex` **is** the app's `PatientProfile` ([[models]]), so capturing
Patient once parameterises IMC/ideal-weight/VSC and every TCI recommendation downstream.

---

## 4. The `fill-pdf` export mapping (planned, not built)

The round-trip is fully **designed**: every schema field/cell/chart carries a bbox in
`[x0, top, x1, bottom]` points, top-left origin, which
[schema-spec.md](../../../notebooks/docs/parsing-wiki/schema-spec.md) states "maps 1:1
back for a filled-PDF export … the **same bboxes** feed a filled-PDF export: draw entered
values into `blank_bbox` / cell rects over the 1:1 clone." `model.md` confirms it is the
**next technique to build (`fill-pdf`, planned)** — no code exists yet.

Mechanically, `fill-pdf` reuses the ReportLab draw calls already in the renderers, keyed
off `field.type` + bbox, layered over the 1:1 clone:

| Field type | Fill action | Target bbox |
|---|---|---|
| `text` / `open_field` | `drawString` the value | `blank_bbox` |
| `checkbox` | stamp X/✓ (reuse `Page.box` / `c.rect` glyph) | `checkbox_bbox` |
| `checkbox_value` | mark box **and** draw value (+`unit`) | `checkbox_bbox` + `blank_bbox` |
| `number` | draw numeric value, append `unit` | `blank_bbox` |
| table cell | draw value in `row_cuts × col_cuts` intersection | `tables[]` (`farmaco`, `control_fluidos`) |
| `timeseries_chart` | plot: value→y via `y_axis.ticks`, time→x via `x_axis.hour_lines`, per `lane` | inside chart `bbox` (`vitals_grid`) |
| `score` (Aldrete) | mark the connected box cell | `aldrete_*_c0..5`, `aldrete_total_c0..5` |

### Renderers that exist today (the blank-template producers)

The fill layer draws *over* whatever these already emit. Both record field bboxes but draw
**no entered values** — that is the missing step.

- [`forms/regen.py`](../../../notebooks/forms/regen.py) — `regenerate(src_pdf, out_pdf)`
  redraws a source PDF into a **1:1 vector clone** (background drawings first, chars on
  top). Loader: [`forms/pdfsrc.py`](../../../notebooks/forms/pdfsrc.py).
- [`forms/imss_gen.py`](../../../notebooks/forms/imss_gen.py) —
  `render_pdf(pages, out_pdf)` builds the IMSS form from vector primitives (no source PDF;
  `source: "scanned-reconstruction"`). `Page.field(...)` is the fillable-field registry;
  `emit_schema(pg, out_json)` serialises it.

### What regenerates today (blank clones exist in `forms/out/`)

| Form | `form_id`(s) | Method | Renderer |
|---|---|---|---|
| **nota2** | `nota_postanestesica` | vector clone (1:1) | `regen.py: regenerate()` |
| **nota21** | `registro_transanestesico` | vector clone; carries 2 tables + 1 chart | `regen.py: regenerate()` |
| **IMSS** (2 pp) | `imss_valoracion_preanestesica`, `imss_registro_anestesia` | from-scratch **reconstruction** | `imss_gen.py: render_pdf()` via `build_page1/2` |

All three already emit/consume bboxes, so all three are ready to receive the not-yet-built
`fill-pdf` value layer. The backend adapter that would wrap these renderers is specified in
[[rest-contract]] §2.4; the in-app export surface is N10 in [[proposed-screens]].

---

## Sources

- Schemas (exhaustive per-field source):
  [`nota2`](../../../notebooks/forms/schema/nota2.schema.json),
  [`nota21`](../../../notebooks/forms/schema/nota21.schema.json),
  [`imss_p1`](../../../notebooks/forms/schema/imss_p1.schema.json),
  [`imss_p2`](../../../notebooks/forms/schema/imss_p2.schema.json).
- Contract: [schema-spec.md](../../../notebooks/docs/parsing-wiki/schema-spec.md).
- Entities: [model.md](../../../notebooks/docs/parsing-wiki/entities/model.md) and the
  per-entity pages linked in §2–§3.
- Renderers: [`regen.py`](../../../notebooks/forms/regen.py),
  [`imss_gen.py`](../../../notebooks/forms/imss_gen.py),
  [`pdfsrc.py`](../../../notebooks/forms/pdfsrc.py).
- Consumers: [[forms-to-app]], [[proposed-screens]], [[rest-contract]]; app anchors
  [[models]], [[pk-engine-math]], [[simulation-screen]].
</content>
</invoke>
