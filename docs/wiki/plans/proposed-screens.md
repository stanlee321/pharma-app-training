---
type: plan
updated: 2026-07-09
tags: [plan, screens, ui-ux]
---

# Plan — New App Screens for Clinical Data Capture (filled-PDF export as a subproduct)

**Goal.** Extend the current **5-screen** pharmacology app (see [[screens]]) into a
clinical-record app where a clinician **enters the anaesthesia data natively** — the ~471
form fields become a **persisted, case-scoped record** (the system of record). A **filled
PDF is a subproduct**, rendered from that record on demand ([[forms-to-app]]); the app is a
data-entry system, not a form viewer, and does no OCR. **Status (2026-07-10):** these are now the **canonical, mandatory app screens** (plus a
[[login|mock login]] gate, ADR-3). The original 5-screen pharmacology app ([[screens]]) was a
first approach — its screens are **recyclable building blocks** (steppers, `ChartCanvas`, TCI
tools) that now serve these designs, not the app's spine. Per-screen build contracts:
[[screens-index]]. Every screen below is grounded in the [nine-entity
model](../../../notebooks/docs/parsing-wiki/entities/model.md), **not a form's layout**.

The app today owns the *pharmacology spine* only — `PatientProfile`, `ChartCanvas`,
`DrugModel`/TCI dosing (3 of the 9 entities). The other 6 entities have **zero** screens,
and there is no persistence, no schema bridge, and no PDF layer. This plan adds ~11 new
screens plus the shared components and prerequisite layers they depend on.

Field counts and control-type mix come straight from the schemas:
[`nota2`](../../../notebooks/forms/schema/nota2.schema.json) 254 fields (3 major zones,
4 subsections, no tables/charts),
[`nota21`](../../../notebooks/forms/schema/nota21.schema.json) 70 fields + 2 tables
(`farmaco`, `control_fluidos`) + 1 chart (`vitals_grid`),
[`imss_p1`](../../../notebooks/forms/schema/imss_p1.schema.json) 86 fields incl. the
36-cell Aldrete `score` grid,
[`imss_p2`](../../../notebooks/forms/schema/imss_p2.schema.json) 58 fields + 1
`vitals_grid` chart + 7 `composite` method blocks.

---

## 1. Design principles (grounded)

1. **Aggregate-root first.** `anesthesia-case` is the root everything hangs off
   ([model.md](../../../notebooks/docs/parsing-wiki/entities/model.md) L45). So the new
   navigation is rooted at an **Encounter**, not at a drug — the current
   `.drugSelection` root becomes a *tool inside* an encounter.
2. **Selection controls dominate — build the components once.** 181 `checkbox` + 44
   `checkbox_value` = **225 of 471 fields (48%)** are toggle-based. A great
   checkbox-group / inline-value component (mirroring the existing `StepperRow` pattern)
   pays off on every screen.
3. **Progressive disclosure for the heavyweight.** `AnestheticTechnique` is ~185 fields
   and deeply hierarchical
   ([anesthetic-technique.md](../../../notebooks/docs/parsing-wiki/entities/anesthetic-technique.md)):
   General / Regional Neuraxial / Peripheral Block. It **must be split** (see §4).
4. **Reuse the pharma spine as anchors.** Patient capture reuses [[input-screens]]
   steppers; monitoring reuses [[simulation-screen]]'s `ChartCanvas`; drug dosing reuses
   `DrugModel` + `MockPKEngine` TCI/BET.
5. **Every value already knows its bbox.** All bind-back is designed already
   ([schema-spec.md](../../../notebooks/docs/parsing-wiki/schema-spec.md) L9-11, L88-92)
   — the Review screen just needs the not-yet-built `fill-pdf` layer.
6. **Collect once, export to many.** The four forms overlap heavily — `Patient` appears in
   all four, `AnestheticTechnique` in both `nota2` and `imss_p2`. So each **entity is
   captured once** into the shared record, never per-form. The form is an *output
   projection*: **N10** renders whichever form(s) the clinic needs (the IMSS set and/or the
   nota set) from the same data, with **no re-entry**. This is why the screens below are
   organized by **entity**, not by form.

---

## 2. Navigation sketch (ASCII)

```
 RootView (NavigationStack)  — root changes: DrugSelection → EncounterList
   └─ overlay: Launch Modal (unchanged, first-run only)

 Encounter List ─────▶ Encounter Hub (AnesthesiaCase root) ──┬─────────────────────────┐
   (.encounterList)     (.encounterHub(id))                  │  section rows push into: │
   [repurposes the                                           │                          │
    empty "Saved                                             ▼                          ▼
    Simulations" button]        ┌──────────────────────────────────────────────────────────────┐
                                │ Patient Data*         (.patientInput)   REUSES StepperRow      │
                                │ Preanesthetic Assess. (.preAssessment)                         │
                                │ Anesthetic Technique  (.technique(zone)) ── SPLIT 3 sub-screens │
                                │      ├─ General        (.technique(.general))                   │
                                │      ├─ Regional Neurx (.technique(.neuraxial))                 │
                                │      └─ Peripheral Blk  (.technique(.peripheral))               │
                                │ Transanesthetic Mon.  (.monitoring)     REUSES ChartCanvas      │
                                │      └─ Drug Ledger    (.drugLedger)    REUSES DrugModel/TCI    │
                                │      └─ Fluid Balance  (.fluidBalance)  85-cell hourly grid     │
                                │ Recovery (Aldrete)    (.recoveryScore)  6×6 score grid          │
                                │ Newborn (obstetric)   sheet, 0..n       (.newbornRecord)        │
                                └──────────────────────────────────────────────────────────────┘
                                                          │
                                                          ▼
                                        Review & Export  (.reviewExport)
                                        PDF preview (PDFKit) + fill-pdf + Share
 * Patient screen already exists (screen 3); it becomes case-scoped, not global.
```

Legacy screens (`.simulation`, `.compartmental`) remain reachable as **PK tools** from
the monitoring/drug screens — they are not removed, just no longer the app's spine.

---

## 3. Proposed screens table

| # | Screen | Entities collected | Proposed `Route` case | Presentation | Reuses existing pieces | Source schema / entity |
|---|---|---|---|---|---|---|
| N1 | **Encounter List** | — (lists `AnesthesiaCase`) | `.encounterList` (new **stack root**) | pushed / root | list idiom from `DrugSelectionView`; repurposes the empty **"Saved Simulations"** closure ([[screens]] row 2) | needs new persistence layer |
| N2 | **Encounter Hub** | `AnesthesiaCase` (root: Dx, ASA, RAQ, Sala/Servicio/Turno/Fecha, firmas) | `.encounterHub(UUID)` | pushed (encounter root) | `DesignSystem` tokens; section-row list idiom | [imss_p2](../../../notebooks/forms/schema/imss_p2.schema.json) diagnostico/firmas/clasificacion; [nota21](../../../notebooks/forms/schema/nota21.schema.json) header → [anesthesia-case](../../../notebooks/docs/parsing-wiki/entities/anesthesia-case.md) |
| 3′ | **Patient Data** (extend existing) | `Patient` (+ somatometría, Hb/Hto/Rh, grupo) | `.patientInput` (exists) | pushed | **`PatientInputView` + `StepperRow`** number+unit steppers ([[input-screens]]); `PatientProfile` | [imss_p1](../../../notebooks/forms/schema/imss_p1.schema.json) `datos`; nota21 somatometría → [patient](../../../notebooks/docs/parsing-wiki/entities/patient.md) |
| N3 | **Preanesthetic Assessment** | `PreanestheticAssessment` | `.preAssessment` | pushed | new `CheckboxGroupRow`; `StepperRow` for lab/urine numerics | imss_p1 `antecedentes/exploracion/orina/quimica`; nota2 premedicación → [preanesthetic-assessment](../../../notebooks/docs/parsing-wiki/entities/preanesthetic-assessment.md) |
| N4a | **Technique — General** | `AnestheticTechnique` (general) + `DrugAdministration` (induction doses) | `.technique(.general)` | pushed; **embedded segmented control** over subsections | segmented-control host pattern from `SimulationView`; new `CheckboxGroupRow` / `CheckboxValueRow` | nota2 zone *Anestesia General* (44) + subsections Ventilación/Ciclado/Parámetros/Mantenimiento; imss_p2 `metodo` composites |
| N4b | **Technique — Regional Neuraxial** | `AnestheticTechnique` (neuraxial) | `.technique(.neuraxial)` | pushed | `CheckboxValueRow` (needle + dose) | nota2 zone *Anestesia Regional Neuroaxial* (59) |
| N4c | **Technique — Peripheral Block** | `AnestheticTechnique` (peripheral) | `.technique(.peripheral)` | pushed | editable per-nerve row table | nota2 zone *Bloqueo Periférico* (21) |
| N5 | **Transanesthetic Monitoring** | `TransanestheticRecord` (vitals + monitoring toggles) | `.monitoring` | pushed | **`ChartCanvas` + `SimulationView`/`SimulationViewModel`** ([[simulation-screen]]); monitoring multi-select | nota21 + imss_p2 `vitals_grid` charts; nota21 monitoreo; nota2 signos basales → [transanesthetic-record](../../../notebooks/docs/parsing-wiki/entities/transanesthetic-record.md) |
| N6 | **Drug Ledger** | `DrugAdministration` (many/case) | `.drugLedger` | pushed **or** embedded in N5 | **`DrugModel`/`DrugDatabase`** + `MockPKEngine` `computeTCI`/`computeBET` for recommended dose; new `EditableDrugTable` | nota21 `farmaco` table, imss_p2 medicamentos → [drug-administration](../../../notebooks/docs/parsing-wiki/entities/drug-administration.md) |
| N7 | **Fluid Balance** | `FluidBalance` + blood components | `.fluidBalance` | pushed | new `HourlyFluidGrid` (spreadsheet, auto-balance) | nota21 `control_fluidos` (17 rows × 5 hr = 85 cells); nota2 hemocomponentes → [fluid-balance](../../../notebooks/docs/parsing-wiki/entities/fluid-balance.md) |
| N8 | **Recovery (Aldrete)** | `RecoveryScore` (× time points) | `.recoveryScore` | pushed | new `ScoreGridWidget` (0/1/2 segmented, auto-sum) | imss_p1 Aldrete 36 `score` cells; nota2 Aldrete/Ramsay/Bromage/ENA → [recovery-score](../../../notebooks/docs/parsing-wiki/entities/recovery-score.md) |
| N9 | **Newborn Record** | `NewbornRecord` (0..n, obstetric) | `.newbornRecord` | **sheet / overlay** (add-per-birth) | `StepperRow` (peso/talla) | imss_p2 `obstetricos` (RN sexo/peso/talla, Apgar) → [newborn-record](../../../notebooks/docs/parsing-wiki/entities/newborn-record.md) |
| N10 | **Review & Export** | reads all entities of the case | `.reviewExport` | pushed | **new PDFKit layer**; consumes schema bboxes | binds onto any of the 4 schemas; runs `fill-pdf` ([schema-spec](../../../notebooks/docs/parsing-wiki/schema-spec.md) L88-92) |

`Route` gains associated values (`.encounterHub(UUID)`, `.technique(TechniqueZone)`); the
enum stays `Hashable` as [[screens]]'s checklist requires.

---

## 4. Screens that MUST be split (large / hierarchical)

- **Anesthetic Technique (N4)** — the heavyweight: ~185 fields, ~40% of everything, and
  three disjoint modalities
  ([anesthetic-technique.md](../../../notebooks/docs/parsing-wiki/entities/anesthetic-technique.md)).
  Rendering it as one scroll is unusable. Split into **N4a/N4b/N4c** by the schema's own
  `major_sections` (`Anestesia General`, `Anestesia Regional Neuroaxial`, `Bloqueo
  Periférico`). Within **N4a**, use the existing `SimulationView` segmented-control host
  pattern to page the four `subsections` (Ventilación / Ciclado / Parámetros
  ventilatorios / Mantenimiento anestésico). Show only the chosen modality's fields
  (progressive disclosure), keyed off the top-level modality single-select.
- **Fluid Balance (N7)** — small field count but the hourly grid is **85 numeric cells**
  with derived Balance parcial/total, Gasto urinario, Tasa Fentanilo rows
  ([fluid-balance.md](../../../notebooks/docs/parsing-wiki/entities/fluid-balance.md)).
  Needs a dedicated spreadsheet component with running-balance auto-calc, not loose fields.
- **Recovery (N8)** — the Aldrete 6 criteria × 6 time-points is a purpose-built
  `ScoreGridWidget` with per-cell 0/1/2 pickers and an auto-summed TOTAL row
  ([recovery-score.md](../../../notebooks/docs/parsing-wiki/entities/recovery-score.md)),
  **not** 36 loose numbers.
- **Preanesthetic (N3)** is a dense flat short-text grid; acceptable as one screen but
  the lab/urinalysis rows should be number+unit `StepperRow`s despite the schema typing
  them `text`.

---

## 5. Shared components to build once (reused across the screens above)

| Component | Serves | Mirrors |
|---|---|---|
| `CheckboxGroupRow` (single- & multi-select) | the 181 `checkbox` fields (~45–55 option groups) | new, sibling of `StepperRow` |
| `CheckboxValueRow` (toggle + inline number/text + unit) | the 44 `checkbox_value` fields (nota2 induction drugs) | `StepperRow` + toggle |
| `ScoreGridWidget` | Aldrete 36 `score` cells (N8) | new |
| `EditableDrugTable` (add-row) | `farmaco`/`medicamentos` grids (N6) | new |
| `HourlyFluidGrid` | `control_fluidos` 85 cells (N7) | new |
| `SignaturePad` + `DateTimePicker` | ~4 signature + ~6 date/time fields typed `text`/`open_field` | reclassified in UI, no schema change |

---

## 6. Prerequisite layers (not screens, but blockers — per the gap analysis)

These are absent today and gate the screens above; flagged so the plan is honest:

1. **Persistence / case store.** `AppState` holds a single in-memory live simulation; no
   `SwiftData`/`CoreData`/`FileManager` exists. Encounters (N1/N2) and the many-per-case
   entities (drugs, recovery time-points, newborns) need a case-scoped persisted model.
2. **Schema runtime bridge.** The schema JSONs are produced by an offline Python batch
   (`notebooks/forms/`). The app must load them at runtime to bind values by field `id`
   and drive N10.
3. **PDF / fill-pdf layer.** No PDFKit in the app; the reverse `fill-pdf` technique is
   *planned, not built* — it reuses the ReportLab draw calls in
   [`regen.py`](../../../notebooks/forms/regen.py) /
   [`imss_gen.py`](../../../notebooks/forms/imss_gen.py) keyed off `field.type` + bbox
   over the 1:1 clone. N10 depends on it.
4. **Derived-value engine hooks.** N7/N8 must *compute* (fluid balances, Aldrete totals),
   and N2/N3 patient biometrics (IMC, ideal weight, VSC) derive from weight/height — the
   app already has `PatientProfile` LBM; extend rather than collect these.

---

## 7. Wiring checklist per new screen (from [[screens]] §"Adding a screen")

For each `Nx` above: add the `Route` case (keep `Hashable`) → add a branch in
`RootView`'s `.navigationDestination(for: Route.self)` → create the view under
`PharmaApp/Views/<Area>/`, reading `@Environment(AppState.self)` (add a `@MainActor
@Observable` ViewModel only where screen-local logic warrants, e.g. N7 auto-balance, N8
auto-sum, N10 fill-pdf) → push from the parent hub via `navigationPath.append(...)` →
style with `DesignSystem` tokens ([[design-system-build]]) → update [[screens]], the new
per-screen pages, and [[architecture]]. See also [[state-navigation]] for the launch gate
and `AppState` shape, and [[models]] for where new entity models slot in.

---

## Sources

- App: `PharmaApp/App/Route.swift`, `RootView.swift`, `AppState.swift`;
  `PharmaApp/Views/PatientInput/PatientInputView.swift`,
  `PharmaApp/Views/Simulation/{SimulationView,ChartCanvas}.swift`,
  `PharmaApp/Utilities/StepperRow.swift`, `PharmaApp/Models/{PatientProfile,DrugModel}.swift`,
  `PharmaApp/Engine/MockPKEngine.swift`.
- Wiki: [[screens]], [[input-screens]], [[simulation-screen]], [[compartmental-screen]],
  [[state-navigation]], [[design-system-build]], [[models]], [[architecture]].
- Notebooks: [entities/model.md](../../../notebooks/docs/parsing-wiki/entities/model.md),
  [schema-spec.md](../../../notebooks/docs/parsing-wiki/schema-spec.md), the four schemas
  under [`notebooks/forms/schema/`](../../../notebooks/forms/schema/nota2.schema.json),
  the fill-pdf renderers [`regen.py`](../../../notebooks/forms/regen.py) /
  [`imss_gen.py`](../../../notebooks/forms/imss_gen.py).
</content>
</invoke>
