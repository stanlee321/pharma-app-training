---
type: plan
updated: 2026-07-10
tags: [plan, screen, build-spec]
---

# N6 — Drug Ledger (build spec)
> Growable, case-scoped ledger of every drug given during the case, with a live TCI-recommended dose shown beside the given dose for modelled agents.

## Entities & data
- **Entity captured:** `DrugAdministration` — **many per case** (role: **collect**). One row per drug given.
- **Field load** (from [[field-inventory]] §2, "DrugAdministration ≈40 fields + 2 tables"):

  | Control | Count |
  |---|---:|
  | Table / grid | 2 |
  | Short-text (drug + dose/route rows) | ≈26 |
  | Checkbox + value (regional drug doses) | ≈13 |
  | Long-text (free agents) | 1 |

- **Schema sections:** `nota21` `farmaco` table (rows A–O × *Fármaco* / *Dosis y Vía*); `imss_p2` medicamentos (`Medicamento A–M` + `Dosis/Vía A–M` = 26 paired text fields). The ≈13 `checkbox_value` regional-drug doses (`nota2` Lidocaína/Bupivacaína/Ropivacaína/Morfina) legitimately straddle this entity and `AnestheticTechnique` — see Open questions.
- **Derived / read-only shown here:** **TCI recommended bolus + infusion** per modelled row (Propofol/Remifentanil/Dexmedetomidine) from `DrugModel` + `MockPKEngine.computeTCI`/`computeBET`. Per **ADR-5** this is a **client-side decision aid, computed on the fly and NOT persisted** — only the *given* dose is stored ([[field-inventory]] §3, TCI row).

## Components

| Component | reuse / build | Renders here |
|---|---|---|
| `EditableDrugTable` | **build-new** ([[ux-components]] §5) | The whole ledger: rows `[drug ▾] [dose+unit] [route ▾] [time] [⊖]`, "+ Add drug" footer, TCI recommendation chip under modelled rows, swipe-to-delete |
| `DrugModel` / `DrugDatabase` | **reuse-existing** | `Menu` picker options for the drug column; `rustModelId` maps a picked drug → engine model |
| `MockPKEngine.computeTCI` / `computeBET` | **reuse-existing** | Computes the recommended bolus/infusion chip from `PatientProfile` covariates |
| `DateTimePicker` | **build-new** ([[ux-components]] §7) | Per-row `time` chip (defaults to now, `Now` shortcut) |
| `AcceleratingRepeatButton` | **build-new** (extract, §0.1) | ± on the dose value cluster (shared prerequisite) |
| `DesignSystem` tokens | **reuse-existing** | `AppColors`/`Font`/`Spacing`/`Haptics` chrome, `invalidTint` left-edge bar on incomplete rows |

## Backend binding
Collection CRUD sub-resource ([[rest-contract]] §2.3, DrugAdministration = many-per-case). All calls go through `CaseStore` (ADR-2), never `URLSession` directly.

- **On load:** `GET /api/v1/cases/{id}/drugs` → `[DrugAdministration]` populates the table.
- **On "+ Add drug" commit:** `POST /api/v1/cases/{id}/drugs` → returns the row with its server `id`.
- **On row edit (dose/route/time/drug):** `PATCH /api/v1/cases/{id}/drugs/{drug_id}`.
- **On delete (swipe / ⊖):** `DELETE /api/v1/cases/{id}/drugs/{drug_id}`.
- **DTO bound:** `DrugAdministration` ([[rest-contract]] §3) — `id, label(A..O|A..M), farmaco, dosis: Quantity{value,unit}, via, time`; the `recommended:{bolus,infusion}` field is **client-computed and NOT sent** (ADR-5).

**Crosswalk modes** ([[field-crosswalk]]): `table_cell` for the `nota21` `farmaco` grid (`entity.matrix[row_id][col_id]`), plain `attribute` for the `imss_p2` paired-text medicamentos, and the `recommended` dose is `derived` but client-side (never persisted). The `nota2` regional `checkbox_value` doses would ride `values_blob`/`checkbox_value` if owned here (open question).

Primary endpoint payload example:

```json
POST /api/v1/cases/6f2a3d.../drugs
Content-Type: application/json

{
  "label": "A",
  "farmaco": "Propofol",
  "dosis": { "value": 120, "unit": "mg" },
  "via": "IV",
  "time": "2026-07-10T09:14:00Z"
}
```
Response (200) echoes the stored row with a server `id`; `recommended` is absent (computed on device).

## Reuses (existing app)
- **`DrugModel` / `DrugDatabase`** (`PharmaApp/Models/DrugModel.swift`) — drug picker list; `rustModelId` (`"marsh"`/`"schnider"`/`"minto"`/`"hannivoort"`) selects the engine model.
- **`MockPKEngine`** `computeTCI`/`computeBET` (`PharmaApp/Engine/MockPKEngine.swift`) — the recommended-dose engine (same path the Simulation screen already drives).
- **`PatientProfile`** via `AppState.patient` — covariates (weight/height/age/sex → LBM) feeding the TCI computation.
- **`SimulationView`** "+ Target" add-row idiom + `Menu` pickers, and the segmented-control host pattern if the screen is embedded as a tab inside N5.
- **`StepperRow`** right-cluster (monospaced value + `.numericText()`) for the dose field.
- **`DesignSystem`** tokens (`AppColors`, `Font`, `Spacing`, `Haptics`).

## To build (the gap)

| Item | Kind | Proposed path |
|---|---|---|
| `.drugLedger` case (keep `Hashable`) | route | `PharmaApp/App/Route.swift` |
| `DrugLedgerView` | view | `PharmaApp/Views/DrugLedger/DrugLedgerView.swift` |
| `DrugLedgerViewModel` (`@MainActor @Observable`; owns row CRUD + per-row TCI recompute) | viewmodel | `PharmaApp/Views/DrugLedger/DrugLedgerViewModel.swift` |
| `EditableDrugTable` | component | `PharmaApp/Views/Components/EditableDrugTable.swift` |
| `DateTimePicker` | component | `PharmaApp/Views/Components/DateTimePicker.swift` |
| `AcceleratingRepeatButton` (extract from `StepperRow`) | component | `PharmaApp/Views/Components/AcceleratingRepeatButton.swift` |
| `DrugAdministration` (`Codable`, `Sendable`) DTO | model | `PharmaApp/Models/DrugAdministration.swift` |
| `CaseStore.fetchDrugs / addDrug / updateDrug / deleteDrug` | casestore | `PharmaApp/Services/CaseStore.swift` |
| `RootView` navigation branch for `.drugLedger` | other | `PharmaApp/App/RootView.swift` |

## Dependencies
- **Persistence / `CaseStore`** (ADR-2, prereq layer §6.1) — the collection CRUD (`POST`/`PATCH`/`DELETE`) needs a persisted, case-scoped store; none exists today.
- **A Case must exist** — upstream N1 Encounter List → N2 Encounter Hub create the `AnesthesiaCase` this ledger hangs off.
- **Patient captured first** (screen 3′) — the TCI recommendation needs `PatientProfile` covariates.
- **Phase 0 / ADR-5** — the Schnider V3 fix must land before any recommended dose is surfaced.
- Engine (`DrugModel`, `MockPKEngine`) and drug picker already exist — no new PK math.
- Schema bridge / crosswalk / fill-pdf are needed only for export (N10), **not** for this collect screen.

## Readiness
**Blocked: persistence / `CaseStore` (ADR-2).** The TCI-recommendation half reuses `DrugModel` + `MockPKEngine` and is ready to wire, but a Drug Ledger is a many-per-case *collection* that cannot save without the `CaseStore` layer and an existing Case (N1/N2) — those are the true blockers; once they land, only the view + `EditableDrugTable`/`DateTimePicker` remain.

## Open questions
- **Presentation:** pushed `.drugLedger` vs embedded as a tab inside N5 Transanesthetic Monitoring — the plan leaves this open ([[proposed-screens]] §3, "pushed **or** embedded in N5").
- **Cross-entity ownership:** do the `nota2` regional `checkbox_value` drug doses (Lidocaína/Bupivacaína/…) belong to this ledger (`DrugAdministration`, per [[field-inventory]]) or to `AnestheticTechnique.values_blob` (per [[field-crosswalk]])? N4b/N4c vs N6.
- **Row-id projection:** one `DrugAdministration` collection must export to both `nota21` `farmaco` (rows A–O) and `imss_p2` (A–M) — how the ordered list maps to each form's fixed row labels.
