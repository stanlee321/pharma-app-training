---
type: plan
updated: 2026-07-10
tags: [plan, screen, build-spec]
---

# N7 — Fluid Balance (build spec)

> Spreadsheet-style hourly intake/loss capture with live running balance — the `control_fluidos` grid plus blood-component toggles, one `FluidBalance` per case.

## Entities & data

- **`FluidBalance`** — captured, **1 per case** (singleton child under an `AnesthesiaCase`).
- **`Patient`** — read-only, 1 per case: `peso` (weight) feeds the per-kg derived rows (Gasto urinario ml/kg, Tasa Fentanilo µg/kg).
- **`DrugAdministration`** — read-only, many per case: fentanyl running rate feeds the derived **Tasa Fentanilo** row (cross-entity read; see open questions).

**Field load** (from [[field-inventory]] §2 FluidBalance):

| Control | Count | Notes |
|---|---:|---|
| Table / grid (`control_fluidos`) | 1 → **85 cells** | 17 rows × 5 hour-columns |
| Short-text summary lines | ≈3 | |
| Multi-select (blood products) | ≈4 | nota2 hemocomponentes |

≈**92 capture points**. Of the 85 grid cells, **4 rows × 5 = 20 are derived/read-only** (Balance parcial, Balance total, Gasto urinario, Tasa Fentanilo — [[field-inventory]] §3), leaving ~13 editable input rows × 5 columns. Schema sources: `notebooks/forms/schema/nota21.schema.json` `control_fluidos` table; `notebooks/forms/schema/nota2.schema.json` hemocomponentes.

**Derived / read-only shown here** (computed live client-side for display; server is authoritative on save): Balance parcial, Balance total (running left→right), Gasto urinario (ml/kg/h), Tasa Fentanilo (µg/kg), plus somatometry volumes `vsc`/`sp` per [[rest-contract]] §3. Never sent by the client.

## Components

| Component | Reuse / build | Renders here |
|---|---|---|
| `HourlyFluidGrid` | **build-new** | The 85-cell spreadsheet: frozen row-labels, 5 hour columns, horizontal scroll, decimal keypad per cell, `surfaceDerived` locked derived rows, imbalance `invalidTint` flag on Balance total (from [[ux-components]] §4) |
| `CheckboxGroupRow` | **build-new** (shared, §5) | The ≈4 blood-product multi-select chips (Concentrado globular/plaquetario, Plasma fresco, Aféresis) |
| `AcceleratingRepeatButton` | **build-new** (extract from `StepperRow`, §0.1) | Optional ± in the expanded single-cell editor |
| `DesignSystem` tokens | reuse-existing | `AppColors.surfaceDerived`, `Font.cellValue`, `Spacing.cell`, `Haptics.tap/targetSnap` |
| `StepperRow` right-cluster idiom | reuse-existing | monospaced value + `.numericText()` contentTransition on derived rows |
| `PatientInputView` card / section-header idiom | reuse-existing | Screen chrome + the blood-products section header |

## Backend binding

Singleton sub-resource ([[rest-contract]] §2.3), `keyDecodingStrategy = .convertFromSnakeCase`:

- **Load** — `GET /api/v1/cases/{id}/fluid-balance` on appear → decode into the `FluidBalance` DTO; server returns entered `matrix` + stamped read-only derived rows.
- **Save** — `PUT /api/v1/cases/{id}/fluid-balance` on cell commit (debounced auto-save, ADR-2) and on "Done"; body carries only entered rows + blood components. Server re-derives the 4 computed rows and returns them.

Crosswalk modes ([[field-crosswalk]]): entered cells are **`table_cell`** (`control_fluidos:<row>:<Nhr>` → `fluid_balance.matrix.<row>.<Nhr>`); the 4 computed rows are **`derived`** (read-only, `derive_service`); blood-product checkboxes are **`attribute`** (`blood_components{…}`).

Primary endpoint payload (adapted from [[rest-contract]] §3):

```json
PUT /api/v1/cases/6f2a.../fluid-balance
{
  "matrix": {
    "ncl":       { "1hr": 250, "2hr": 250, "3hr": null, "4hr": null, "5hr": null },
    "sangrado":  { "1hr": 80,  "2hr": 120, "3hr": null, "4hr": null, "5hr": null },
    "diuresis":  { "1hr": 90,  "2hr": 140, "3hr": null, "4hr": null, "5hr": null }
  },
  "blood_components": { "concentrado_globular": true, "plasma_fresco": false }
}
```

Response (200) additionally carries server-stamped read-only rows: `balance_parcial`, `balance_total`, `gasto_urinario`, `tasa_fentanilo`, `vsc`, `sp` (per hour column) — rejected if sent by the client.

## Reuses (existing app)

- `DesignSystem.swift` tokens — `AppColors`, `Font`, `Spacing`, `Haptics` (with the §0.2 additions `surfaceDerived`/`Font.cellValue`/`Spacing.cell`).
- `StepperRow.swift` — the accelerating hold-to-repeat + haptics logic (source of the extracted `AcceleratingRepeatButton`) and its monospaced value cluster.
- `PatientInputView.swift` — card + section-header layout idiom.
- `PatientProfile` (from `AppState.patient`) — `weight` covariate for per-kg derived rows.
- `RootView` `NavigationStack` + `Route` push pattern ([[screens]] §"Adding a screen").

## To build (the gap)

| Item | Kind | Proposed path |
|---|---|---|
| `.fluidBalance` case (keep `Hashable`) | route | `PharmaApp/App/Route.swift` |
| `FluidBalanceView` | view | `PharmaApp/Views/FluidBalance/FluidBalanceView.swift` |
| `FluidBalanceViewModel` (`@MainActor @Observable`, live auto-balance) | viewmodel | `PharmaApp/Views/FluidBalance/FluidBalanceViewModel.swift` |
| `HourlyFluidGrid` | component | `PharmaApp/Views/Components/HourlyFluidGrid.swift` |
| `CheckboxGroupRow` (shared) | component | `PharmaApp/Views/Components/CheckboxGroupRow.swift` |
| `AcceleratingRepeatButton` (extract) | component | `PharmaApp/Utilities/AcceleratingRepeatButton.swift` |
| Client-side fluid derivations (live display mirror) | derivation | `PharmaApp/Engine/FluidDerivations.swift` |
| `FluidBalance` `Codable`/`Sendable` DTO | model | `PharmaApp/Models/FluidBalance.swift` |
| `CaseStore.fetchFluidBalance(caseID)` / `saveFluidBalance(caseID, _)` | casestore | `PharmaApp/Services/CaseStore.swift` |

## Dependencies

- **Persistence / `CaseStore`** (ADR-2) — absent today; the GET/PUT round-trip and auto-save depend on it.
- **Schema field-catalogue bridge** — the `control_fluidos` row/column ids (which rows are editable vs derived) to key the grid ([[decisions]] ADR-1).
- **Derived-value hooks** — server-authoritative `derive_service` for the 4 computed rows; the client mirror is display-only.
- **[[field-crosswalk]]** (`table_cell` + `derived`) — needed for PDF export at N10, not to render this screen.
- **Upstream screens** — a `Case` must exist (**N1** Encounter List / **N2** Encounter Hub); **N3′ Patient Data** must supply `weight` for per-kg rows; **N6 Drug Ledger** supplies the fentanyl rate for Tasa Fentanilo.

## Readiness

**blocked: persistence/CaseStore layer** — the case store (ADR-2) is entirely absent, and the primary widget `HourlyFluidGrid` (plus shared `CheckboxGroupRow`/`AcceleratingRepeatButton`) is net-new. Once those land, only the view + VM auto-balance wiring remain.

## Open questions

- Exact `control_fluidos` **row roster**: [[field-inventory]] names ~9 rows (Sangrado, Diuresis, NCL, Ingreso Cristaloide/Coloide/Hemocomponente, Balance parcial/total, Gasto urinario) but the grid is 17 rows — the remaining input rows need enumeration from `notebooks/forms/schema/nota21.schema.json`.
- **Tasa Fentanilo** source: it reads a fentanyl running rate from `DrugAdministration` (N6). Is that ledger guaranteed populated / available at N7 render time, or does the row show `—` until N6 is filled?
- **Two schema sources into one entity**: the grid comes from nota21, blood components from nota2 — confirm both project into the single `FluidBalance` DTO / `PUT` payload with no per-form split.
- **Client vs server derivation divergence**: the grid shows a live client-computed balance, but the server re-derives on save (ADR: derived never accepted from client). Does the server response overwrite the client's displayed values, and how is a transient mismatch handled?
- **Imbalance threshold**: the per-kg value at which Balance total flips to `invalidTint` (▲) is unspecified — needs a clinical constant.
