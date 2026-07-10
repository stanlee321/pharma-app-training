---
type: plan
updated: 2026-07-10
tags: [plan, screen, build-spec]
---
# N4b — Technique — Regional Neuraxial (build spec)
> Capture the neuraxial (spinal/epidural) slice of `AnestheticTechnique` — needle, level, position, and local-anaesthetic + opioid doses — as one pushed sub-screen of the split N4 technique flow.

## Entities & data
- **Entity:** `AnestheticTechnique` (**neuraxial** branch), **collect**, **1-per-case singleton** — this screen edits one slice of the same aggregate N4a/N4c edit; it does not own a separate record.
- **Field load (≈59):** the nota2 `major_section` *Anestesia Regional Neuroaxial* (59 fields) — a subset of the ≈185-field `AnestheticTechnique` entity ([[field-inventory]] §2). Control mix (approx allocation of the 59):
  - Checkbox — select-group / boolean ≈ **32** (needle type Tuohy/Quincke/Whitacre, technique peridural/subaracnoidea/mixta, approach, baricity, catheter y/n).
  - Checkbox + value ≈ **15** — the regional-drug doses: `Lidocaína`/`Bupivacaína`/`Ropivacaína` ☐ __ mg, `Morfina`/`Fentanilo` neuraxial ☐ __ mcg (nota2 "regional doses", [[field-inventory]] §2 DrugAdministration ≈13 checkbox_value).
  - Short-text ≈ **8** — interspace/level free-write, catheter depth, notes.
  - Number + unit ≈ **4** — needle calibre [G], volume/dose numerics.
- **Schema section:** `Anestesia Regional Neuroaxial` (nota2, `notebooks/forms/schema/nota2.schema.json`).
- **Derived / read-only shown here:** none — no computed cells in this slice. (TCI recommendation is a client-side aid on the drug ledger N6, not surfaced here — [[decisions]] ADR-5.)

## Components
| Component | Reuse / build | What it renders here |
|---|---|---|
| `CheckboxValueRow` | **build-new** (shared, [[ux-components]] §2) | the regional-drug dose rows — toggle + inline number + unit (`Bupivacaína ☐ 15 mg`), and needle+dose |
| `CheckboxGroupRow` | **build-new** (shared, [[ux-components]] §1) | single-select needle type, technique (peridural/subaracnoidea/mixta), approach, position; multi-select adjuncts |
| `AcceleratingRepeatButton` | **build-new** (shared, [[ux-components]] §0.1, extracted from `StepperRow`) | the ± stepper inside each `CheckboxValueRow` dose |
| Short-text / number row | **build-new** (small, or reuse `PatientInputView` field idiom) | interspace, calibre, free-text neuraxial notes |
| Card + section-header chrome | **reuse-existing** (`PatientInputView` idiom) | groups the needle / technique / drug sections |
| `DesignSystem` tokens (`AppColors`/`Font`/`Spacing`/`Haptics`) | **reuse-existing** | selection tint, cell fonts, tap targets, haptics |

## Backend binding
Singleton `GET`/`PUT` on the `AnestheticTechnique` sub-resource ([[rest-contract]] §2.3). This screen mutates only the neuraxial keys of the shared aggregate; N4a/N4c mutate the others — all three funnel into **one** `PUT`.
- **Load** — `GET /api/v1/cases/{id}/anesthetic-technique` on appear; binds the `AnestheticTechnique` DTO into the view/VM.
- **Save** — `PUT /api/v1/cases/{id}/anesthetic-technique` (create-or-replace) on edit (auto-save per [[decisions]] ADR-2) and on Done. Merge-then-PUT so N4a/N4c edits aren't clobbered.
- **DTO** — `AnestheticTechnique`: tagged union on `modality`; the 59 neuraxial fields are carried in the `values: { field_id: bool | Quantity | string }` blob keyed by schema `id` ([[rest-contract]] §3).
- **Crosswalk mode** — **`values_blob`**: field id **is** the key into `anesthetic_technique.values[...]`, no per-id attribute ([[field-crosswalk]]). (Whether the LA/opioid doses instead route to `drug_administration` is an open question below; assignment treats them as `values_blob` on this entity.)

Primary endpoint payload (illustrative field ids — exact ids from the neuraxial section of `notebooks/forms/schema/nota2.schema.json`, resolved by the crosswalk):
```json
PUT /api/v1/cases/6f2a.../anesthetic-technique
Content-Type: application/json

{
  "modality": "BEPD",
  "values": {
    "tecnica_peridural": true,
    "aguja_tuohy": true,
    "aguja_calibre": { "value": 17, "unit": "G" },
    "nivel_puncion": "L3-L4",
    "posicion_sedente": true,
    "cateter_peridural": true,
    "bupivacaina": { "value": 15, "unit": "mg" },
    "fentanilo_neuraxial": { "value": 25, "unit": "mcg" },
    "morfina": { "value": 200, "unit": "mcg" }
  }
}
```

## Reuses (existing app)
- `DesignSystem.swift` tokens — `AppColors` (selection tint), `Font`, `Spacing.tapTarget`, `Haptics.tap()/confirm()`.
- `PatientInputView` card + section-header layout idiom (grouping, chrome).
- `StepperRow.swift` accelerate/haptics logic — the source pattern extracted into `AcceleratingRepeatButton`.
- `Route` enum + `RootView`'s single `.navigationDestination(for: Route.self)` + `NavigationPath` threading (the [[screens]] "adding a screen" wiring).

## To build (the gap)
| Item | Kind | Proposed path |
|---|---|---|
| `.technique(TechniqueZone)` case incl. `.neuraxial` (keep `Hashable`) | route | `PharmaApp/App/Route.swift` |
| `RootView` destination branch → `TechniqueNeuraxialView` | other | `PharmaApp/App/RootView.swift` |
| `TechniqueNeuraxialView` | view | `PharmaApp/Views/Technique/TechniqueNeuraxialView.swift` |
| `TechniqueViewModel` (shared across N4a/b/c; merge-then-PUT the `values` blob) | viewmodel | `PharmaApp/Views/Technique/TechniqueViewModel.swift` |
| `CheckboxValueRow` (shared) | component | `PharmaApp/Views/Components/CheckboxValueRow.swift` |
| `CheckboxGroupRow` (shared) | component | `PharmaApp/Views/Components/CheckboxGroupRow.swift` |
| `AcceleratingRepeatButton` (shared, extracted) | component | `PharmaApp/Views/Components/AcceleratingRepeatButton.swift` |
| `AnestheticTechnique` Codable model (`modality` + `values` blob) | model | `PharmaApp/Models/AnestheticTechnique.swift` |
| `CaseStore.fetchTechnique(caseId:)` / `saveTechnique(_:caseId:)` (ADR-2 port) | casestore | `PharmaApp/Services/CaseStore.swift` |

## Dependencies
- **Persistence / `CaseStore`** ([[decisions]] ADR-2) — none exists today ([[proposed-screens]] §6.1); required to load/save the singleton.
- **Schema field-catalogue bridge** ([[decisions]] ADR-1 nuance, [[proposed-screens]] §6.2) — the 59 neuraxial field ids (bundled or fetched once) so the screen iterates a catalogue rather than hand-coding 59 toggles.
- **Backend** `GET`/`PUT /cases/{id}/anesthetic-technique` ([[rest-contract]] §2.3).
- **Shared components** `CheckboxValueRow` / `CheckboxGroupRow` / `AcceleratingRepeatButton` — likely first built by **N4a**; N4b consumes them.
- **`field-crosswalk`** `values_blob` mapping ([[field-crosswalk]]) — needed for **export** (N10), not for this screen's capture.
- **Upstream screens:** an Encounter/Case must exist (N1 list → N2 hub), and the top-level modality single-select (N4a) gates whether the neuraxial branch is the active technique (progressive disclosure).

## Readiness
**blocked: persistence/CaseStore + schema field-catalogue bridge.** The view + wiring + the three shared widgets are well-specified and buildable, but there is no way to load/save the `AnestheticTechnique` singleton (no `CaseStore`) and no runtime source for the 59 neuraxial field ids yet.

## Open questions
- Do the LA/opioid doses (`Bupivacaína`/`Morfina`/`Fentanilo`) live in `anesthetic_technique.values` (values_blob, per assignment) or route to `DrugAdministration`? The crosswalk hints nota2 "regional doses" could be `drug_administration`.
- Does the DTO expose a typed `regional_neuraxial{...}` sub-object *and* the flat `values{}` blob ([[rest-contract]] §3 shows both), or is `values{}` the sole carrier? Affects the model shape.
- Is neuraxial independently reachable/editable, or hard-gated by the N4a top-level modality single-select?
