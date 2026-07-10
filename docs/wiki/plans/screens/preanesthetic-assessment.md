---
type: plan
updated: 2026-07-10
tags: [plan, screen, build-spec]
---

# N3 — Preanesthetic Assessment (build spec)

> Capture the pre-op work-up (history, airway/system exam, urine + blood-chemistry labs, premedication) as one dense flat grid into the case-scoped `PreanestheticAssessment` record.

## Entities & data

- **Entity captured:** `PreanestheticAssessment` — **1 per** `AnesthesiaCase` (collect). Singleton child, upserted whole.
- **Field load:** ≈35 fields (see [[field-inventory]] §2), all schema-typed `text` — a single dense flat grid, no tables/charts/scores.
  - by control (after UI reclassification): free short-text ≈16–18 · **number+unit ≈15** (lab/urine rows reclassified from `text`, per [[proposed-screens]] §4) · ≈2 multiline notes (`textarea`) · a few categorical picks surfaced as single-select chips.
- **Schema sections:** `imss_p1` `antecedentes` (history), `imss_p1` `exploracion` (exam), `imss_p1` `orina` (urinalysis), `imss_p1` `quimica` (blood chemistry); `nota2` premedicación.
- **Derived / read-only shown:** **none on this screen.** This assessment *informs* the `asa`/`raq` risk scoring, but those live on the `AnesthesiaCase` root (N2), not here. No server-computed cell is displayed by N3. (Patient biometrics IMC/VSC are derived but belong to `Patient` / screen 3′.)

## Components

| Component | reuse / new | renders here |
|---|---|---|
| Section-card + header idiom | **reuse-existing** | groups the 4 schema sections (History / Exam / Urine / Chemistry) into `PatientInputView`-style cards |
| `StepperRow` | **reuse-existing** | the ≈15 lab/urinalysis numeric rows as number+unit (`urea`, `creatinina`, `glucosa`, `ph`, `na`, `k`, `densidad`, `albumina` …) — number+unit despite `text` typing |
| `CheckboxGroupRow` (single-select) | **build-new** (shared, [[ux-components]] §1) | categorical history/exam picks surfaced as chip groups (`dentadura` propia/prótesis, `cuello`, `estado_psiquico`, `alergia` sí/no) |
| `ShortTextFieldRow` (thin labeled text / multiline-notes row) | **build-new** (minor) | free-text history/exam/premedicación write-ins (`antecedentes_anestesicos`, `otros`, `medicamentos_previos`, `aparato_respiratorio`, `aparato_cardiovascular`, `premedicacion`) |
| `DesignSystem` tokens | **reuse-existing** | `AppColors`/`Font`/`Spacing`/`Haptics` styling ([[ux-components]] §0.2) |

No grid/score/table widget is needed — this is the lightest of the new collect screens.

## Backend binding

All access via the `CaseStore` port (ADR-2), never `URLSession` directly. Singleton sub-resource ([[rest-contract]] §2.3):

- **On load:** `GET /api/v1/cases/{id}/preanesthetic-assessment` → hydrates the view.
- **On save (auto-save on edit / Done):** `PUT /api/v1/cases/{id}/preanesthetic-assessment` → create-or-replace the whole sub-form in one call.
- **DTO bound:** `PreanestheticAssessment` ([[rest-contract]] §3) — `history{...}`, `exam{...}`, `labs_orina{...}`, `labs_quimica{ analyte: Quantity }` (each lab a `{value,unit}`), `premedicacion`.
- **Crosswalk modes ([[field-crosswalk]]):** all `attribute` (scalar `preanesthetic_assessment.<path>`; lab analytes are `Quantity`-valued attributes). **No `derived`, no `values_blob`, no `table_cell`** on this screen.

Primary endpoint payload (`PUT` body):

```json
{
  "history": {
    "antecedentes_anestesicos": "AGV previa sin eventos",
    "alergia": "Ninguna",
    "dentadura": "Propia",
    "cuello": "Corto",
    "estado_psiquico": "Consciente, orientado",
    "medicamentos_previos": "Losartán 50 mg/día",
    "premedicacion": "Midazolam 2 mg IV"
  },
  "exam": {
    "aparato_respiratorio": "Murmullo vesicular presente, sin agregados",
    "aparato_cardiovascular": "Ruidos cardiacos rítmicos"
  },
  "labs_orina": {
    "densidad":  { "value": 1.020, "unit": "" },
    "albumina":  { "value": 0,     "unit": "mg/dL" },
    "glucosa":   { "value": 0,     "unit": "mg/dL" }
  },
  "labs_quimica": {
    "urea":       { "value": 32,   "unit": "mg/dL" },
    "creatinina": { "value": 0.9,  "unit": "mg/dL" },
    "glucosa":    { "value": 98,   "unit": "mg/dL" },
    "na":         { "value": 140,  "unit": "mmol/L" },
    "k":          { "value": 4.1,  "unit": "mmol/L" },
    "ph":         { "value": 7.38, "unit": "" }
  }
}
```

Response is the same shape echoed back (no read-only additions for this entity). Export to a filled PDF is out of scope for N3 — it happens later at N10, drawing each attribute into its `imss_p1.schema.json` cell bbox via `fill-pdf` (see `notebooks/forms/schema/imss_p1.schema.json`, `notebooks/forms/imss_gen.py`).

## Reuses (existing app)

- **`StepperRow`** (`PharmaApp/Utilities/StepperRow.swift`) — number+unit steppers for every lab/urine row.
- **`PatientInputView`** card + section-header + segmented idiom (`PharmaApp/Views/PatientInput/PatientInputView.swift`) as the layout template.
- **`DesignSystem` tokens** (`PharmaApp/Utilities/DesignSystem.swift`) — `AppColors`, `Font`, `Spacing`, `Haptics`.
- **`RootView` NavigationStack + `Route` push** mechanism and `AppState` `.environment(...)` injection (`PharmaApp/App/RootView.swift`, `AppState.swift`).

## To build (the gap)

| item | kind | proposed path |
|---|---|---|
| `.preAssessment` case (keep `Hashable`) | route | `PharmaApp/App/Route.swift` |
| `navigationDestination` branch for `.preAssessment` | other | `PharmaApp/App/RootView.swift` |
| `PreAssessmentView` | view | `PharmaApp/Views/PreAssessment/PreAssessmentView.swift` |
| `PreAssessmentViewModel` (light — only if section grouping / validation warrants) | viewmodel | `PharmaApp/Views/PreAssessment/PreAssessmentViewModel.swift` |
| `CheckboxGroupRow` (shared single/multi-select) | component | `PharmaApp/Views/Components/CheckboxGroupRow.swift` |
| `ShortTextFieldRow` (labeled short-text + multiline notes) | component | `PharmaApp/Views/Components/ShortTextFieldRow.swift` |
| `PreanestheticAssessment` model (`Sendable`, `Codable`; `Quantity` value type) | model | `PharmaApp/Models/PreanestheticAssessment.swift` |
| `CaseStore.getPreAssessment(caseId)` / `putPreAssessment(caseId:_:)` | casestore | `PharmaApp/Services/CaseStore.swift` |

## Dependencies

- **Persistence / `CaseStore` port (ADR-2)** — shared prerequisite; the screen fetches/upserts via it, never `URLSession`. Not screen-specific.
- **Shared component `CheckboxGroupRow`** ([[ux-components]] §1) and the **`AcceleratingRepeatButton` extraction** (§0.1) that `StepperRow` reuse leans on.
- **Upstream screen:** an `AnesthesiaCase` must exist first (N1 Encounter List → N2 Encounter Hub); N3 is pushed from the hub with a resolved `caseId`.
- **Not blocked by:** the schema runtime bridge, PDF/`fill-pdf` layer, or the [[field-crosswalk]] — those are export-time (N10) concerns; capture on N3 needs none of them.

## Readiness

**near-ready** — the lightest new collect screen: a flat field grid that reuses `StepperRow` and adds one simple shared `CheckboxGroupRow` + a thin text row. Only the shared `CaseStore` port (ADR-2) and upstream Case creation gate it; there is no screen-specific blocker (no grid/score/PDF layer).

## Open questions

- Which history/exam fields become single-select `CheckboxGroupRow` chips vs free short-text? The schema types them all `text`; enumerations (e.g. `dentadura` propia/prótesis, `cuello` corto/normal/largo, `alergia` sí/no) are clinical conventions not encoded in `imss_p1.schema.json` — need the curated option lists.
- Per-analyte canonical `unit` and optional reference-range validation: the schema stores labs as unitless `text`, but the DTO uses `Quantity{value,unit}` and the entity note wants range-checked capture. Is range validation in the MVP scope, and where do the units live (client map vs served metadata)?
- `r.a.q. 1–5` and ASA render physically near this assessment on `imss_p1` but the entity model assigns them to `AnesthesiaCase` (N2). Confirm they are captured on N2 only and not duplicated here.
