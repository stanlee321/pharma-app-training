---
type: plan
updated: 2026-07-10
tags: [plan, screen, build-spec]
---

# N5 — Transanesthetic Monitoring (build spec)
> Capture the intra-op vitals time-series (multi-lane chart + event markers) and the monitoring/basal toggles for one case's `TransanestheticRecord`, reusing the pharma spine's `ChartCanvas`.

## Entities & data
- **Entity:** `TransanestheticRecord` — **collect**, **1 per case** (singleton child of `AnesthesiaCase`).
- **Field load** (from [[field-inventory]] §2, ≈46 fields + 2 charts):
  - Multi-select monitoring checkboxes — **≈29** (`ECG`/`SpO₂`/`EtCO₂`/`BIS`/`TNM`, temp-probe site `Esofágica`/`Rectal`/`Nasofaríngea`)
  - Short-text vitals, basal + termination — **≈12** (`FC`/`TA`/`SpO₂`/`PVC`)
  - Time-series chart — **2** (nota21 + imss_p2 `vitals_grid`; lanes TEMP, T.A., PULSO/FC, R., SpO₂, EtCO₂, BIS + 1–6 event markers)
  - Long-text / notes — **2** (`Complicaciones transanestésicas`)
  - Number + unit — **1** (`Flujo` [L/min])
- **Schema sections:** nota21 `vitals_grid` + `monitoreo`; imss_p2 `vitals_grid`; nota2 signos basales.
- **Derived/read-only:** none owned by this entity ([[field-inventory]] §3 lists no `TransanestheticRecord` computed values). The chart *may* overlay PK `Cp`/`Ce` reference curves from the engine as a planning aid — see Open questions.

## Components
| Component | Reuse / build | Renders here |
|---|---|---|
| `ChartCanvas` | reuse-existing | Base plot renderer for the vitals lanes ([[proposed-screens]] §3 N5 reuse). |
| `SimulationView` segmented host | reuse-existing | `[Vitals] [Monitoring] [Basal/Term]` tab switch (same segmented-control idiom). |
| `SimulationViewModel` pattern | reuse-existing | Mirror its `@MainActor @Observable` shape for `MonitoringViewModel`. |
| `StepperRow` | reuse-existing | Basal & termination numeric vitals (`FC`/`TA`/`SpO₂`/`PVC`), `Flujo` [L/min]. |
| `DesignSystem` tokens | reuse-existing | Per-lane colours, `Haptics`, `Spacing`, `Font`. |
| `VitalsChartCanvas` | build-new | Multi-lane vitals plot + 1–6 event markers + tap/drag point entry (extends `ChartCanvas`). |
| `CheckboxGroupRow` | build-new (shared, [[ux-components]] §1) | The ≈29 monitoring multi-select toggles. |
| `NotesField` (textarea) | build-new (shared) | The 2 `Complicaciones` long-text fields. |
| `DateTimePicker` | build-new (shared, [[ux-components]] §7) | Event-marker + snapshot timestamps. |

## Backend binding
- **Load** — `GET /api/v1/cases/{id}/transanesthetic-record` on `.onAppear` (singleton fetch via `CaseStore`, [[rest-contract]] §2.3).
- **Save** — `PUT /api/v1/cases/{id}/transanesthetic-record` (idempotent upsert of the whole sub-form), fired debounced on every edit: monitoring toggle, snapshot commit, and **chart point add / drag-release**. There is no per-point endpoint — a point mutates `series[lane].points` in memory and the singleton `PUT` persists it.
- **DTO:** `TransanestheticRecord` ([[rest-contract]] §3).
- **Crosswalk modes** ([[field-crosswalk]]): **`series_point`** for the `vitals_grid` lanes → `series` (primary); **`attribute`** for the monitoring toggles (`monitoring.*`), basal/termination snapshots, `flujo`, and `complicaciones`.

```json
PUT /api/v1/cases/6f2a.../transanesthetic-record
{
  "series": [
    { "lane": "fc",   "points": [ {"t": 0, "value": 78}, {"t": 15, "value": 72} ] },
    { "lane": "ta",   "points": [ {"t": 0, "value": 120}, {"t": 15, "value": 110} ] },
    { "lane": "spo2", "points": [ {"t": 0, "value": 99} ] }
  ],
  "events": [ {"marker": 1, "t": 0}, {"marker": 2, "t": 12} ],
  "snapshots": {
    "basal": {"fc": 78, "ta": "120/80", "spo2": 99, "pvc": 6},
    "post":  {"fc": 72, "ta": "110/70", "spo2": 99, "pvc": 5}
  },
  "monitoring": {"ecg": true, "spo2": true, "etco2": true, "bis": false, "tnm": false, "temp_site": "esofagica"},
  "flujo": 2.0,
  "complicaciones": ""
}
```

## Reuses (existing app)
- `ChartCanvas` (`PharmaApp/Views/Simulation/ChartCanvas.swift`) — hand-drawn `Canvas` plot renderer.
- `SimulationView` segmented-control host + `SimulationViewModel` `@Observable` pattern ([[simulation-screen]]).
- `StepperRow` (accelerating number+unit steppers) for basal/termination vitals and `Flujo`.
- `DesignSystem` tokens (`AppColors`, `Font`, `Spacing`, `Haptics`) — lane/marker colours, tap feedback.
- `Route` + `RootView` `.navigationDestination(for: Route.self)` wiring ([[screens]] checklist).

## To build (the gap)
| Item | Kind | Proposed path |
|---|---|---|
| `Route.monitoring` case | route | `PharmaApp/App/Route.swift` |
| `.monitoring` destination branch | other | `PharmaApp/App/RootView.swift` |
| `MonitoringView` | view | `PharmaApp/Views/Monitoring/MonitoringView.swift` |
| `MonitoringViewModel` (series edit + toggle state) | viewmodel | `PharmaApp/Views/Monitoring/MonitoringViewModel.swift` |
| `VitalsChartCanvas` (multi-lane + markers + point entry) | component | `PharmaApp/Views/Monitoring/VitalsChartCanvas.swift` |
| `CheckboxGroupRow` (shared) | component | `PharmaApp/Views/Components/CheckboxGroupRow.swift` |
| `NotesField` (textarea, shared) | component | `PharmaApp/Views/Components/NotesField.swift` |
| `DateTimePicker` (shared) | component | `PharmaApp/Views/Components/DateTimePicker.swift` |
| `TransanestheticRecord` model (`Sendable`, `Codable`) | model | `PharmaApp/Models/TransanestheticRecord.swift` |
| `CaseStore.get/putTransanestheticRecord(caseID:)` | casestore | `PharmaApp/Engine/CaseStore.swift` |

## Dependencies
- **Persistence / `CaseStore`** (ADR-2) — no persistence exists today; the screen edits a case-scoped singleton and auto-saves through the `CaseStore` port.
- **Upstream Encounter/Case root** — N1 Encounter List + N2 Encounter Hub must create the `AnesthesiaCase` this record hangs off; N5 is pushed from the hub, not a stack root.
- **Backend** — `GET`/`PUT /cases/{id}/transanesthetic-record` + `TransanestheticRecord` DTO ([[rest-contract]] §2.3/§3).
- **Shared components** — `CheckboxGroupRow`, `NotesField`, `DateTimePicker` ([[ux-components]] §1/§7) must be built once.
- **Crosswalk** — `series_point` + `attribute` mappings for lanes/toggles ([[field-crosswalk]]); needed for export, not for capture.
- **Schema field catalogue** — the ≈29 monitoring toggle ids / canonical lane set (ADR-1 bespoke-screen-over-catalogue).
- Not blocking: `fill-pdf` / PDFKit export layer is only needed by N10.

## Readiness
**blocked: persistence/CaseStore (ADR-2) + upstream Encounter root.** `ChartCanvas`, `StepperRow`, and the toggle pattern are all known and reusable, but the screen cannot scope to a case or persist edits until the `CaseStore` port and an existing `AnesthesiaCase` (N1/N2) exist; the `TransanestheticRecord` model + backend endpoint are also net-new.

## Open questions
- Is **Drug Ledger (N6)** embedded here as a fourth segmented tab or a separately pushed `.drugLedger`? ([[proposed-screens]] §3 says "pushed **or** embedded in N5".)
- Vitals **point entry gesture** — tap-on-chart to add a reading at time `t`, or a time-column table that plots? "Interactive chart" is specified but the exact gesture is not.
- Do the PK engine's **`Cp`/`Ce` reference curves** overlay the observed vitals chart as a planning aid, or is the chart purely observed data?
- Do **nota21 and imss_p2 `vitals_grid`** reconcile into one canonical lane set, or does the clinic's chosen export form determine the lanes captured?
- **Event markers 1–6** — fixed surgical-event enum or free-text labels?
