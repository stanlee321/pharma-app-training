---
type: plan
updated: 2026-07-10
tags: [plan, screen, build-spec, rollup]
---
# Screen Build Specs — Cross-Screen Rollup

Aggregate view over the 13 per-screen build contracts in this folder. The point is a
single picture of **what is missing to build on the frontend**, tied to the **backend
endpoints** it calls. Per-screen detail lives in the linked pages (e.g.
[[encounter-list]], [[technique-general]]); the screen set is [[proposed-screens]], the
widget catalogue is [[ux-components]], the backend is [[rest-contract]], and the
export/PDF value map is [[field-crosswalk]].

Screen roster (build-sequence order — see §5): [[encounter-list]] · [[encounter-hub]] ·
[[patient-data]] · [[preanesthetic-assessment]] · [[technique-general]] ·
[[technique-neuraxial]] · [[technique-peripheral]] · [[transanesthetic-monitoring]] ·
[[drug-ledger]] · [[fluid-balance]] · [[recovery-aldrete]] · [[newborn-record]] ·
[[review-export]].

---

## 1. Component build-list

Every component named across the 13 cards, with status and the screens it serves. The
**build-new** widgets are ranked by reach — this is the "build these first" order.
Full specs for the shared widgets live in [[ux-components]].

### 1a. Build-new — ranked by reach (build these first)

| Rank | Component | # screens | Screens |
|---|---|---|---|
| 1 | **CheckboxGroupRow** (single/multi-select) | 10 (+1) | [[encounter-hub]], [[patient-data]], [[preanesthetic-assessment]], [[technique-general]], [[technique-neuraxial]], [[technique-peripheral]], [[transanesthetic-monitoring]], [[fluid-balance]], [[recovery-aldrete]], [[newborn-record]] (+[[review-export]] may reuse for the form selector) |
| 2 | **AcceleratingRepeatButton** (extract from `StepperRow`) | 6 | [[patient-data]], [[technique-general]], [[technique-neuraxial]], [[technique-peripheral]], [[drug-ledger]], [[fluid-balance]] |
| 3 | **Labeled text/notes row** — *naming divergence, unify to one widget* (FormTextRow / TextFieldRow / ShortTextFieldRow / short-text+number row / NotesField textarea) | 5 | [[encounter-hub]] (FormTextRow), [[patient-data]] (TextFieldRow), [[preanesthetic-assessment]] (ShortTextFieldRow), [[technique-neuraxial]] (short-text/number row), [[transanesthetic-monitoring]] (NotesField) |
| 4 | **DateTimePicker** | 4 | [[encounter-hub]], [[transanesthetic-monitoring]], [[drug-ledger]], [[newborn-record]] |
| 5 | **CheckboxValueRow** (toggle + number + unit) | 3 | [[technique-general]], [[technique-neuraxial]], [[technique-peripheral]] |
| 6 | **SignaturePad** | 2 | [[encounter-hub]], [[recovery-aldrete]] |

**Screen-specific build-new (reach 1)** — build with their owning screen:

| Component | Screen |
|---|---|
| EncounterRow summary card · Empty-state + New Encounter CTA · New Encounter button · Loading/error state | [[encounter-list]] |
| Section-row hub list · SectionRow (nav row + completion glyph) | [[encounter-hub]] |
| DerivedBiometricsCard (IMC · peso ideal · VSC · 25/15%) | [[patient-data]] |
| CompositeMethodBlock (imss_p2 metodo) | [[technique-general]] |
| NerveBlockTable (add-row per-nerve) | [[technique-peripheral]] |
| VitalsChartCanvas (multi-lane + event markers) | [[transanesthetic-monitoring]] |
| EditableDrugTable (add-row + TCI chip) | [[drug-ledger]] |
| HourlyFluidGrid (17×5 spreadsheet + running balance) | [[fluid-balance]] |
| ScoreGridWidget (6×6 0/1/2 + auto-sum) | [[recovery-aldrete]] |
| NewbornListView · NewbornRecordSheet | [[newborn-record]] |
| PDFPreviewView (PDFKit) · FormSelectorRow · CaseCompletenessSummary | [[review-export]] |

> Consolidation flag: the rank-3 family is **five different names for one labeled-input
> row** (short-text + multiline modes). Build it once in [[ux-components]] and bind a
> `kind: .text/.number/.notes` variant, rather than shipping FormTextRow, TextFieldRow,
> ShortTextFieldRow and NotesField separately.

### 1b. Reuse-existing (no build cost)

| Component / idiom | # screens | Notes |
|---|---|---|
| DesignSystem tokens (AppColors/Font/Spacing/Haptics) | 13 | every screen |
| `StepperRow` (accelerating number+unit) | 9 | source of the extracted AcceleratingRepeatButton |
| `PatientInputView` card + section-header idiom | 7 | layout scaffold reused for form sections |
| `SimulationView` segmented host / +Target add-row idiom | 5 | subsection pager + collection add-row footer |
| RootView NavigationStack + `Route` enum + NavigationPath | 2+ | wiring touched by every screen; explicitly listed by [[encounter-list]], [[encounter-hub]] |
| `AppState` @Observable + `.environment` injection | 2+ | single source of truth, all screens |
| `SimulationViewModel` @MainActor @Observable shape | 2 | VM template ([[transanesthetic-monitoring]], [[recovery-aldrete]]) |
| `DrugSelectionView` list/section-row idiom | 2 | [[encounter-list]], [[review-export]] |
| `ChartCanvas` | 1 | [[transanesthetic-monitoring]] overlay base |
| `genderButton` segmented | 1 | [[patient-data]] |
| `DrugModel`/`DrugDatabase`, `MockPKEngine.computeTCI/BET`, `PatientProfile` covariates | 1 | [[drug-ledger]] TCI half (ready today) |
| SwiftUI `ShareLink`, `ProgressView` | 1 | [[review-export]] native export/spinner |

---

## 2. Endpoint coverage (frontend ↔ backend contract check)

Every screen's REST calls, checked against [[rest-contract]] §2. All paths are under
`/api/v1`.

| # | Screen | Endpoints called | In [[rest-contract]] §2? |
|---|---|---|---|
| N1 | [[encounter-list]] | `GET /cases` · `POST /cases` · `DELETE /cases/{id}` | ✅ |
| N2 | [[encounter-hub]] | `GET /cases/{id}` · `PATCH /cases/{id}` | ✅ |
| 3′ | [[patient-data]] | `GET /cases/{id}/patient` · `PUT /cases/{id}/patient` | ✅ |
| N3 | [[preanesthetic-assessment]] | `GET /cases/{id}/preanesthetic-assessment` · `PUT …` | ✅ |
| N4a | [[technique-general]] | `GET /cases/{id}/anesthetic-technique` · `PUT …` · `POST /cases/{id}/drugs` | ✅ |
| N4b | [[technique-neuraxial]] | `GET /cases/{id}/anesthetic-technique` · `PUT …` | ✅ |
| N4c | [[technique-peripheral]] | `GET /cases/{id}/anesthetic-technique` · `PUT …` | ✅ |
| N5 | [[transanesthetic-monitoring]] | `GET /cases/{id}/transanesthetic-record` · `PUT …` | ✅ |
| N6 | [[drug-ledger]] | `GET /cases/{id}/drugs` · `POST …` · `PATCH /…/{drug_id}` · `DELETE /…/{drug_id}` | ✅ |
| N7 | [[fluid-balance]] | `GET /cases/{id}/fluid-balance` · `PUT …` | ✅ |
| N8 | [[recovery-aldrete]] | `GET /cases/{id}/recovery-score` · `PUT …` | ✅ |
| N9 | [[newborn-record]] | `GET /cases/{id}/newborns` · `POST …` · `PATCH /…/{nb_id}` · `DELETE /…/{nb_id}` | ✅ |
| N10 | [[review-export]] | `GET /cases/{id}` · `POST /cases/{id}/export/{form_id}` | ✅ |

**(a) Endpoints a screen needs that are NOT in the contract:** none. Every screen call
maps to an existing [[rest-contract]] §2 entry — the frontend↔backend surface is closed.

**(b) Contract endpoints that no screen calls:**

- `GET /forms` and `GET /forms/{form_id}/schema` — server-side schema provider
  (validation + PDF fill). No client screen consumes them today; [[review-export]] picks
  a form locally rather than listing via `GET /forms`. *Open question for N10: should the
  form selector be driven by `GET /forms` instead of a hard-coded 4?*
- `GET /cases/{id}/drugs/{drug_id}` — single-drug read. [[drug-ledger]] hydrates the
  whole ledger via the collection `GET /cases/{id}/drugs`, so the item-GET is unused.

*(Newborns expose no single-item GET in the contract — consistent with [[newborn-record]]
hydrating from the collection.)*

---

## 3. CaseStore protocol surface (ADR-2)

Union of every `CaseStore` method the 13 cards' `to_build` casestore items require,
grouped by shape. This is the one persistence port ([[rest-contract]] online-first REST)
behind which all screens sit.

> **Path divergence to reconcile:** cards propose four different homes —
> `Services/CaseStore.swift` (9 screens), `Persistence/CaseStore.swift` ([[patient-data]]),
> `Engine/CaseStore.swift` ([[transanesthetic-monitoring]], [[recovery-aldrete]]),
> `Data/CaseStore.swift` ([[review-export]]). **Canonical: `PharmaApp/Services/CaseStore.swift`**
> (dominant proposal).

```swift
protocol CaseStore: Sendable {

    // — Case lifecycle & aggregate root (N1, N2, N10) —
    func listCases(limit: Int, offset: Int) async throws -> CaseListResponse   // GET  /cases
    func createCase() async throws -> UUID                                     // POST /cases
    func deleteCase(id: UUID) async throws                                     // DELETE /cases/{id}
    func loadCase(id: UUID) async throws -> CaseAggregate                      // GET  /cases/{id}
    func patchCaseEnvelope(id: UUID, _ patch: CaseEnvelopePatch) async throws  // PATCH /cases/{id}

    // — Singleton children: 1-per-case GET/PUT upsert (3′, N3, N4a/b/c, N5, N7, N8) —
    func getPatient(caseID: UUID) async throws -> PatientDTO
    func putPatient(caseID: UUID, _ dto: PatientDTO) async throws -> PatientDTO           // re-stamps imc/peso_ideal/vsc
    func getPreAssessment(caseID: UUID) async throws -> PreanestheticAssessment
    func putPreAssessment(caseID: UUID, _ dto: PreanestheticAssessment) async throws
    func getTechnique(caseID: UUID) async throws -> AnestheticTechnique
    func saveTechnique(caseID: UUID, _ dto: AnestheticTechnique) async throws             // merge-then-PUT shared values blob
    func getTransanestheticRecord(caseID: UUID) async throws -> TransanestheticRecord
    func putTransanestheticRecord(caseID: UUID, _ dto: TransanestheticRecord) async throws
    func getFluidBalance(caseID: UUID) async throws -> FluidBalance                       // server re-derives balances
    func saveFluidBalance(caseID: UUID, _ dto: FluidBalance) async throws -> FluidBalance
    func getRecoveryScore(caseID: UUID) async throws -> RecoveryScore                     // server re-stamps total row
    func putRecoveryScore(caseID: UUID, _ dto: RecoveryScore) async throws -> RecoveryScore

    // — Collection: drugs (N6, dual-write from N4a) —
    func fetchDrugs(caseID: UUID) async throws -> [DrugAdministration]
    func addDrug(caseID: UUID, _ dto: DrugAdministration) async throws -> DrugAdministration
    func updateDrug(caseID: UUID, drugID: UUID, _ dto: DrugAdministration) async throws
    func deleteDrug(caseID: UUID, drugID: UUID) async throws

    // — Collection: newborns (N9, 0..n obstetric) —
    func fetchNewborns(caseID: UUID) async throws -> [NewbornRecord]
    func addNewborn(caseID: UUID, _ dto: NewbornRecord) async throws -> NewbornRecord
    func updateNewborn(caseID: UUID, nbID: UUID, _ dto: NewbornRecord) async throws
    func deleteNewborn(caseID: UUID, nbID: UUID) async throws

    // — Export (N10) —
    func exportForm(caseID: UUID, formID: String, options: ExportRequest?) async throws -> Data  // application/pdf
}
```

Shape summary: **5 root/lifecycle** + **6 singleton get/put pairs** + **2 collection CRUD
sets (drugs, newborns)** + **1 export**. The technique trio ([[technique-general]],
[[technique-neuraxial]], [[technique-peripheral]]) all share one singleton `getTechnique`/
`saveTechnique` — they must **merge-then-write** so branch/`values{}` edits don't clobber
each other.

---

## 4. Prerequisite layers (shared blockers)

Four cross-cutting layers gate the screens. Nothing frontend-only unblocks a screen until
its layer exists.

| Layer | Owner | Gates (screens) |
|---|---|---|
| **Persistence / CaseStore port** (ADR-2, online-first REST) | app + backend | **all 13** — no screen can scope to a case or persist without it |
| **Schema / field-catalogue bridge** (ADR-1: field list keyed by id) | app + `forms/schema/*.json` | [[technique-general]], [[technique-neuraxial]], [[technique-peripheral]] (technique field ids), [[transanesthetic-monitoring]] (~29 monitoring toggles), [[fluid-balance]] (`control_fluidos` row/col ids) |
| **Server fill-pdf value pass + [[field-crosswalk]] artifact** (ADR-6) | backend | [[review-export]] (export/PDF); [[field-crosswalk]] `values_blob`/`table_cell`/`score_cell` maps are export-time only for every data screen — they do **not** block data capture |
| **Derived-value hooks** (`derive_service`, proposed-screens §6.4) | app (live) + backend (authoritative) | [[patient-data]] (IMC/peso-ideal/VSC), [[fluid-balance]] (balances/gasto/tasa), [[recovery-aldrete]] (Aldrete total), [[review-export]] (summary read-only rows) |
| **Upstream Encounter root** (N1 list → N2 hub, AnesthesiaCase must exist) | screens N1/N2 | every entity screen (3′–N10) |
| **Phase-0 Schnider V3 fix** (ADR-5, precondition to surface TCI recs) | engine | [[technique-general]], [[drug-ledger]] (recommended dose chip), [[review-export]] summary |

Key insight: **CaseStore is the master blocker** — build it once and 12 of 13 screens
move from "blocked" to "buildable". The schema catalogue bridge and fill-pdf/crosswalk are
narrower, gating the technique/table screens and export respectively.

---

## 5. Dependency-ordered build sequence

Ordered so nothing is blocked when reached. Layer 0 is a hard prerequisite for everything.

| Order | Build | Why here (one line) |
|---|---|---|
| 0 | **CaseStore port + REST impl + AnesthesiaCase/DTO models** (ADR-2) | Master blocker for all 13 screens; nothing persists or scopes to a case without it. |
| 1 | **Login gate + N1 [[encounter-list]]** ([[login]] mock auth) | Re-roots the app spine (`.drugSelection → .login → .encounterList`); login sets the session author (ADR-3, no CaseStore dep), N1 creates/lists the cases every other screen hangs off. |
| 2 | **N2 [[encounter-hub]]** — build core shared widgets here (CheckboxGroupRow, labeled text row, DateTimePicker, SignaturePad, SectionRow) | Encounter root that pushes to all sub-screens; the highest-reach widgets are cheapest to amortize here first. |
| 3 | **3′ [[patient-data]]** — extract AcceleratingRepeatButton, DerivedBiometricsCard | Extends an existing screen; Patient covariates are needed downstream for MockPKEngine TCI. |
| 4 | **N3 [[preanesthetic-assessment]]** | Near-ready; only reuses StepperRow + CheckboxGroupRow (already built by step 2/3). |
| 5 | **N4a [[technique-general]]** — build CheckboxValueRow, CompositeMethodBlock + schema field-catalogue bridge | First technique screen; establishes the shared AnestheticTechnique model + merge-write and the field-catalogue bridge. |
| 6 | **N4b [[technique-neuraxial]]** | Reuses N4a's technique model, merge-write and CheckboxValueRow — additive branch only. |
| 7 | **N4c [[technique-peripheral]]** — build NerveBlockTable | Last technique branch; only new piece is the per-nerve add-row table. |
| 8 | **N5 [[transanesthetic-monitoring]]** — build VitalsChartCanvas, NotesField | Reuses ChartCanvas + segmented host; may host N6 as a tab, so precede the drug ledger. |
| 9 | **N6 [[drug-ledger]]** — build EditableDrugTable | Collection CRUD; TCI half already reuses MockPKEngine; must precede N7 (feeds fentanyl rate). |
| 10 | **N7 [[fluid-balance]]** — build HourlyFluidGrid + derive hooks | Reads Patient weight (3′) and Drug rate (N6); needs derived-value hooks online. |
| 11 | **N8 [[recovery-aldrete]]** — build ScoreGridWidget + Aldrete auto-sum | Independent singleton; reuses segmented/stepper idioms + derive hook. |
| 12 | **N9 [[newborn-record]]** | Collection CRUD gated on the obstetric flag; only needed for obstetric cases. |
| 13 | **N10 [[review-export]]** — build PDFPreviewView + fill-pdf value pass + [[field-crosswalk]] | Last: reads the full aggregate and needs every entity populated plus the server export pipeline. |

---

## 6. Readiness verdict

| Screen | Readiness | What unblocks it |
|---|---|---|
| [[preanesthetic-assessment]] (N3) | **near-ready** | CaseStore port only; components already covered by StepperRow + CheckboxGroupRow |
| [[encounter-list]] (N1) | blocked | persistence/CaseStore + `GET`/`POST /cases` |
| [[encounter-hub]] (N2) | blocked | persistence/CaseStore |
| [[patient-data]] (3′) | blocked | persistence/CaseStore + upstream N1/N2 |
| [[technique-general]] (N4a) | blocked | persistence/CaseStore + schema field-catalogue bridge |
| [[technique-neuraxial]] (N4b) | blocked | persistence/CaseStore + schema field-catalogue bridge |
| [[technique-peripheral]] (N4c) | blocked | persistence/CaseStore + shared AnestheticTechnique model & Checkbox components |
| [[transanesthetic-monitoring]] (N5) | blocked | persistence/CaseStore + upstream Encounter root |
| [[drug-ledger]] (N6) | blocked | persistence/CaseStore + existing Case (TCI recommendation half is ready) |
| [[fluid-balance]] (N7) | blocked | persistence/CaseStore + net-new grid components + derive hooks |
| [[recovery-aldrete]] (N8) | blocked | persistence/CaseStore + upstream Encounter root |
| [[newborn-record]] (N9) | blocked | persistence/CaseStore |
| [[review-export]] (N10) | blocked | server fill-pdf value pass + [[field-crosswalk]] (also CaseStore aggregate load) |

**Tally: 2 near-ready ([[login]] gate + [[preanesthetic-assessment]]), 12 blocked.** The dominant blocker is
the **persistence/CaseStore port (ADR-2)** — it appears in all 12 blocked screens. Second-order
blockers are narrow: the **schema field-catalogue bridge** (technique trio + monitoring +
fluid) and the **server fill-pdf value pass + [[field-crosswalk]]** ([[review-export]] only).
Ship CaseStore + N1/N2 first and the count flips to mostly buildable.
