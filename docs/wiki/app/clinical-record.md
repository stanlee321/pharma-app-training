---
type: page
updated: 2026-07-10
tags: [app, clinical, screens, case-store, built]
---

# Clinical Record — the case-scoped app spine (built)

The clinical-record layer added in **Phase A + B (2026-07-10)**: the app is now rooted at a
**mock login → Encounter List → Encounter Hub → clinical section screens**, editing an
**`AnesthesiaCase`** held in an in-memory **`CaseStore`**. This is the data-first vision
([[forms-to-app]]) made real in code — capture the anaesthesia record natively; the filled PDF
is a later projection. The original pharmacology app ([[screens]]) is now a **recyclable
toolset**, not the spine.

Source-grounded (all under `PharmaApp/`). The frontend **compiles + links** (commits `9945a93`,
`6ef5b11`); the only build gap is an `actool`/sim-runtime environment issue, not code
([[foundation-grounding-2026-07-10]]).

## The store (ADR-2 port)

`PharmaApp/Services/CaseStore.swift`:

- `protocol CaseStore` (`@MainActor`) — the persistence **port**: `cases`, `createCase(owner:)`,
  `index(of:)`, `delete(id:)`. Screens depend on this, never on `URLSession`, so a REST /
  offline impl drops in later without rewiring ([[rest-contract]], [[decisions]] ADR-2).
- `MockCaseStore` (`@MainActor @Observable`) — in-memory, seeded with one demo case. Lets the
  whole frontend build + run with **no backend**. Injected in `PharmaApp.swift` via
  `.environment(caseStore)` alongside `AppState`.

Screens edit a case with the pattern (reference: `PreanestheticView`):
`@Bindable var store = store` → `store.index(of: caseID)` → bind `$store.cases[idx].<child>.<field>`.

## The record (DTOs)

`PharmaApp/Models/ClinicalRecord.swift` — the aggregate + 9 entities, mirroring
[[rest-contract]] §3 (camelCase, `Codable`/`Sendable`, in-memory for now):

- **`AnesthesiaCase`** (root): `id`, `owner`, envelope (dx / sala / servicio / asa / raq /
  providers…), singleton children `patient` / `preAssessment` / `technique` / `transRecord` /
  `fluidBalance` / `recovery`, collections `drugs` / `newborns`.
- **`PatientRecord`** embeds `PatientProfile` (the PK covariates) + labs; computes `imc` /
  `pesoIdeal` / `vsc`. **`AnestheticTechnique`** carries `values: [String: FieldValue]` — the
  **values-blob** keyed by (currently hand-chosen) field ids. `RecoveryScore.aldrete` and
  `FluidBalance.matrix` are nested dictionaries. Supporting: `FieldValue` (bool/number/text),
  `Quantity`, `Provider`, `RecommendedDose`.
- **`Author`** (`Models/Author.swift`), **`TechniqueZone`** (`Models/TechniqueZone.swift` —
  general / neuraxial / peripheral, the `Route.technique` associated value).

## Navigation & auth

- **`Route`** (`App/Route.swift`) now has **14 cases**: legacy `.drugSelection` /
  `.patientInput` / `.simulation` / `.compartmental` (recyclable tools) + the spine
  `.encounterList`, `.encounterHub(UUID)`, `.patientData(UUID)`, `.preAssessment(UUID)`,
  `.technique(UUID, TechniqueZone)`, `.monitoring` / `.drugLedger` / `.fluidBalance` /
  `.recoveryScore` / `.newbornRecord` / `.reviewExport(UUID)`. Declared **up front** so
  per-screen work never edits `Route.swift` / `RootView`.
- **`AppState`** (`App/AppState.swift`) gained `navigationPath` (moved here from `RootView`),
  `author: Author?`, `isAuthenticated`, `signIn(name:role:)`, `signOut()`.
- **`RootView`** is a **mock-login gate**:
  `isAuthenticated ? NavigationStack(EncounterListView + .navigationDestination) : LoginView`.
  The launch-modal overlay is unchanged. Legacy detail: [[state-navigation]].

## The screens (Phase A + B)

Foundation / pilot (Phase A): [[login]] (mock auth), Encounter List (N1), Encounter Hub (N2),
and the [[preanesthetic-assessment|Preanesthetic (N3)]] pilot. Phase B:
[[patient-data|Patient]], [[technique-general|Technique ×3 zones]],
[[transanesthetic-monitoring|Monitoring]], [[drug-ledger|Drug Ledger]] (TCI chip via
`computeTCI`), [[fluid-balance|Fluid]] (hourly grid + live balance),
[[recovery-aldrete|Recovery]] (Aldrete grid + auto-sum), [[newborn-record|Newborn]],
[[review-export|Review & Export]] (MVP summary PDF via `UIGraphicsPDFRenderer`). Per-screen
build contracts: [[screens-index]].

## Shared components

`PharmaApp/Views/Components/`: `AcceleratingRepeatButton` (extracted from `StepperRow`, haptic
per tick, ≥44pt), `CheckboxGroupRow`, `LabeledTextRow`, `SectionHeader`, `CardStyle`.
Screen-specific widgets (Aldrete grid, hourly-fluid grid, editable drug table, technique
checkbox-value rows) are `private` to their screen files. New `DesignSystem` semantic tokens
(`selectionTint` / `invalidTint` / `fieldFill` / `controlStroke` / `surfaceDerived`,
`Font.cellValue`, `Spacing.tapTarget` / `cell`) — see [[design-system-build]].

## What's mock / pending

- **No backend yet** — `MockCaseStore` is in-memory; the FastAPI/Postgres impl behind the port
  is [[rest-contract]].
- **Field ids are hand-chosen** in the values-blob / dict-keyed screens — the canonical
  schema-id binding is the [[field-crosswalk]] + a schema field-catalogue bridge.
- **Derived values are client-side display-only** (IMC, fluid balance, Aldrete totals); the
  authoritative `derive_service` is server-side.
- **Export renders the real filled form** — the backend now stamps case data into the notebook's
  1:1 clone via `fitz` at each schema bbox (`backend/app/infrastructure/render/`), with a first-cut
  crosswalk and a summary-PDF fallback ([[log]] 2026-07-10). Still partial (derived fluid rows +
  vitals chart not drawn yet).
- **Phase 0** — the Schnider V3 10× bug ([[pk-engine-math]], `MockPKEngine.swift:69`) must land
  before the Drug / Technique TCI chips show a correct maintenance number.

## See also

[[screens]] (full inventory incl. the legacy tools) · [[state-navigation]] · [[architecture]] ·
[[forms-to-app]] (the plan this realizes) · [[foundation-grounding-2026-07-10]] (the code-truth
pass) · [[screens-index]] (per-screen build specs).
