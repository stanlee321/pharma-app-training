---
type: plan
updated: 2026-07-10
tags: [plan, screen, build-spec]
---

# N4a — Technique — General (build spec)

> Capture the **General anesthesia** modality of `AnestheticTechnique` (agents, airway, ventilation, maintenance) plus induction drug doses — the largest, most toggle-dense screen — as a case-scoped record, paged by subsection.

## Entities & data

- **`AnestheticTechnique` (general)** — 1 per case (singleton). **Collect.** This screen owns only the *General* modality branch of the ~185-field entity.
- **`DrugAdministration` (induction doses)** — many per case. **Collect.** The `checkbox_value` induction drugs (`Propofol ☐ __ mg`, `Fentanilo ☐ __ mcg`) surface an inline dose that also feeds the drug ledger.

**Field load** (subset of the ~185-field entity — the *General* zone only). Control-type mix from [[field-inventory]] §2, scoped to this screen's schema sections:

| Control | ~Count |
|---|---:|
| Checkbox (single/multi select) | ≈24 |
| Checkbox + value (induction drugs) | ≈12 |
| Number + unit (TET calibre, flows, vent params) | ≈4 |
| Short-text | ≈4 |
| Composite / method block (imss_p2 `metodo`) | ≈2 |
| **≈ total collect points** | **≈46** |

**Schema sources:** `notebooks/forms/schema/nota2.schema.json` major-section *Anestesia General* (44) + subsections **Ventilación / Ciclado / Parámetros ventilatorios / Mantenimiento anestésico**; `notebooks/forms/schema/imss_p2.schema.json` `metodo` composite blocks.

**Derived / read-only shown here:** the **TCI recommended bolus/infusion** chip beside each modelled induction drug (Propofol/Remifentanil) — computed **client-side** by `MockPKEngine` per [[decisions]] ADR-5, a decision aid only, **not** persisted authoritative data. No server-derived values on this screen.

## Components

| Component | Status | Renders here |
|---|---|---|
| Segmented host (from `SimulationView`) | reuse-existing (pattern) | pages the 4 subsections (Ventilación/Ciclado/Parámetros/Mantenimiento) |
| Card + section-header idiom (from `PatientInputView`) | reuse-existing | per-section card chrome |
| `CheckboxGroupRow` | build-new | modality single-select (AGIB/AGEV…), volatile agents multi-select, ventilation mode |
| `CheckboxValueRow` | build-new | induction drugs `Propofol ☐ __ mg`, `Fentanilo ☐ __ mcg` |
| `StepperRow` | reuse-existing | number+unit fields (TET calibre mmDI, flujo L/min, vent params) |
| `AcceleratingRepeatButton` | build-new (extract from `StepperRow`) | ± accel + haptics inside `CheckboxValueRow`/`StepperRow` |
| `CompositeMethodBlock` | build-new | imss_p2 `metodo` composite blocks |
| `DesignSystem` tokens | reuse-existing | colors/fonts/spacing/haptics |

Pulled from [[ux-components]] §8 + [[proposed-screens]] §5.

## Backend binding

Per [[decisions]] ADR-2, all access is through a `CaseStore` port (online-first REST), never `URLSession` directly.

- **Load** — `GET /api/v1/cases/{id}/anesthetic-technique` on appear; hydrates the modality + `values` blob.
- **Save** — `PUT /api/v1/cases/{id}/anesthetic-technique` (idempotent upsert of the whole sub-form), auto-fired debounced on edit.
- **Induction dose (optional ledger)** — `POST /api/v1/cases/{id}/drugs` when an induction `CheckboxValueRow` commits, so the dose also lands as a `DrugAdministration` row for N6/TCI.

**DTO:** `AnestheticTechnique` — tagged union on `modality (AGIB|AGEV|…)`; the ~44 General-zone fields ride as a `values: { field_id: bool | Quantity | string }` map ([[rest-contract]] §3). **Crosswalk mode: `values_blob`** — the schema `id` **is** the map key ([[field-crosswalk]]); the modality single-select is the one `attribute`-mode field. `DrugAdministration` items carry a **readOnly `recommended`** (client-computed, not sent).

Primary endpoint payload (`PUT …/anesthetic-technique`):

```json
{
  "modality": "AGEV",
  "general": {
    "induccion":   { "propofol_42": true, "fentanilo_43": true },
    "via_aerea":   { "tet_calibre_60": 7.5 },
    "ventilacion": { "ventilacion_controlada": true },
    "mantenimiento": {}
  },
  "values": {
    "modalidad_agev": true,
    "sevoflurano_51": false,
    "propofol_42": true,   "propofol_42_val": 120,
    "fentanilo_43": true,  "fentanilo_43_val": 250,
    "tet_calibre_60": 7.5
  }
}
```

## Reuses (existing app)

- **`SimulationView` segmented-control host** — the `[Graph][Compartments]` pattern, repurposed to page the 4 subsections (see [[screens]] screen 4).
- **`StepperRow`** — number+unit steppers with hold-to-accelerate for TET calibre / flows / vent params.
- **`PatientInputView`** card + uppercase section-header idiom for each subsection card.
- **`DrugModel`/`DrugDatabase` + `MockPKEngine.computeTCI`/`computeBET`** — the induction-dose TCI recommendation chip (ADR-5, client-side).
- **`DesignSystem` tokens** (`AppColors`/`Font`/`Spacing`/`Haptics`).
- **`Route` enum + `RootView` `.navigationDestination`** wiring; `AppState` via `@Environment`.

## To build (the gap)

| Item | Kind | Proposed path |
|---|---|---|
| `Route.technique(TechniqueZone)` case + `TechniqueZone` enum (Hashable) | route | `PharmaApp/App/Route.swift` |
| `RootView` destination branch → `TechniqueGeneralView` | other | `PharmaApp/App/RootView.swift` |
| `TechniqueGeneralView` | view | `PharmaApp/Views/Technique/TechniqueGeneralView.swift` |
| `TechniqueGeneralViewModel` (subsection paging, progressive disclosure keyed off modality single-select, TCI recs) | viewmodel | `PharmaApp/Views/Technique/TechniqueGeneralViewModel.swift` |
| `CheckboxGroupRow` | component | `PharmaApp/Views/Components/CheckboxGroupRow.swift` |
| `CheckboxValueRow` | component | `PharmaApp/Views/Components/CheckboxValueRow.swift` |
| `AcceleratingRepeatButton` (extracted from `StepperRow`) | component | `PharmaApp/Views/Components/AcceleratingRepeatButton.swift` |
| `CompositeMethodBlock` (imss_p2 `metodo`) | component | `PharmaApp/Views/Components/CompositeMethodBlock.swift` |
| `AnestheticTechnique` model (modality enum + `values` blob) | model | `PharmaApp/Models/AnestheticTechnique.swift` |
| `DrugAdministration` model (induction item) | model | `PharmaApp/Models/DrugAdministration.swift` |
| `CaseStore.fetchTechnique` / `saveTechnique` (PUT) / `addDrug` (POST) | casestore | `PharmaApp/Services/CaseStore.swift` |
| General-zone field-catalogue loader (iterate schema field list by `id`) | other | `PharmaApp/Services/SchemaCatalog.swift` |

## Dependencies

- **Persistence / `CaseStore` (ADR-2)** — the online-first REST store must exist; the screen binds a case-scoped `AnestheticTechnique`, so there is nothing to save into without it.
- **Schema field-catalogue bridge (ADR-1 nuance)** — the General-zone field list keyed by `id`, bundled or fetched once, so the dense checkbox sets aren't hand-coded.
- **Upstream screens** — an `AnesthesiaCase` must exist first (N1 Encounter List → N2 Encounter Hub); this pushes from the hub. `Patient` (N3′) should be captured so `MockPKEngine` has covariates for the TCI chip.
- **[[field-crosswalk]]** (`values_blob` map) — server-side, gates **export** (N10 fill-pdf), not data entry here.
- **Phase 0 Schnider V3 fix (ADR-5)** — must land before the TCI recommendation chip is surfaced.

## Readiness

**Blocked: persistence/CaseStore + schema field-catalogue bridge.** The view, the two net-new checkbox components, and the segmented host are all buildable from known idioms, but the screen has **no case to bind to** (no `CaseStore`, no Encounter yet) and **no field list to iterate** until the catalogue bridge lands.

## Open questions

- Do induction `checkbox_value` doses live **only** in the technique `values_blob`, or are they **also** materialized as `DrugAdministration` rows (dual-write)? The crosswalk points them at `values_blob`, but the screen assignment names `DrugAdministration` as collected — pick one source of truth to avoid divergence.
- Which of imss_p2's 7 `metodo` composites belong to **General** vs the neuraxial/peripheral splits (N4b/N4c)? The composite→subsection mapping isn't itemized in the plans.
