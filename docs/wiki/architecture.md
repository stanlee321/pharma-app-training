---
type: architecture
updated: 2026-07-09
tags: [architecture, overview]
---

# Architecture

The whole system on one page. **TivaTrainer** is a SwiftUI/iOS pharmacokinetic
simulation app (`PharmaApp/**`) plus an anaesthesia-**forms parsing / PDF-regeneration**
pipeline (`notebooks/forms/**`), joined by a shared clinical domain model. Ground truth
is the source code; where `docs/reference/**` design specs disagree, the code wins.
Drill into any box via its subsystem page.

## The app: SwiftUI MVVM over a PK-engine seam

```
                         @main PharmaApp  (App/PharmaApp.swift)
                              │  .environment(appState)
                              ▼
        ┌──────────────────────────────────────────────┐
        │  AppState  @MainActor @Observable             │   [[state-navigation]]
        │  drugModels · selectedDrug · patient          │
        │  simulationOutput · targets · playback        │
        │  engine: any PKEngineProtocol                 │
        └──────────────────────────────────────────────┘
              │ RootView: NavigationStack + Route enum
              │  drugSelection → patientInput → simulation → compartmental
              ▼
   ┌───────────────────────── Views (MVVM) ──────────────────────────┐
   │ Input screens          Simulation screen      Compartmental      │
   │ [[input-screens]]      [[simulation-screen]]  [[compartmental-screen]]
   │ picker · steppers      ChartCanvas Cp/Ce +     2D Canvas  / 3D   │
   │ validation clamp       draggable TCI target    SceneKit cylinders│
   └─────────────────────────────┬───────────────────────────────────┘
                                 │ appState.engine.simulate / computeTCI
                                 ▼
        ┌──────────────  PKEngineProtocol (the seam)  ──────────────┐
        │  simulate · computeTCI(<16 ms) · validationRules · ids    │  [[engine]]
        │  EngineProvider.useMock == true                           │
        │    ├─ MockPKEngine   ← REAL RK4 ODE solver  [[pk-engine-math]]
        │    └─ RustPKEngine   ← fatalError STUB (not wired)        │
        └───────────────────────────┬──────────────────────────────┘
                                    ▼
        4 PK models + dosing (in MockPKEngine)      [[pk-engine-math]]
        Marsh · Schnider · Minto · Hannivoort  →  3-compartment + Ce
        BET / TCI: computeBET bolus+infusion, computeTCI effect-site overshoot
```

**Layering.** `PharmaApp/App/**` holds the entry point, the single `@Observable`
`AppState`, and `Route`/`RootView` navigation ([[state-navigation]]). Views are thin and
read `AppState` from the environment; two view-models (`SimulationViewModel`,
`CompartmentalViewModel`) project `simulationOutput` for their screens. All numeric work
sits behind **`PKEngineProtocol`** ([[engine]]) so the engine can be swapped without
touching call sites — the `SimulationTypes` structs mirror the planned Rust C-FFI
contract. Domain types (`DrugModel`/`DrugDatabase`, `PatientProfile`, `SimulationTypes`)
are in [[models]]; styling primitives and the XcodeGen build are in
[[design-system-build]].

**The one seam fact that changes everything:** `EngineProvider.useMock == true` and
`RustPKEngine` is a `fatalError` stub in every functional method. So **`MockPKEngine` IS
the production engine** — a hand-rolled classic RK4 solver over a 4-state ODE
`[x1,x2,x3,Ce]`, not fake data. Flipping `useMock` to `false` compiles but crashes on the
first `simulate`/`computeTCI` call. Watch the unit conventions (internal mg / mg·ml⁻¹,
`displayFactor` ×1000 vs ×1e6, rate constants per-**minute** while the loop counts
seconds) — see [[pk-engine-math]].

## The forms-parsing pipeline

```
  3 source PDFs (notebooks/data/)
    ├─ nota postanestésica ─────┐  vector-extraction path
    ├─ registro transanestésico ┤    pdfsrc → regen (1:1 clone) + schema_extract
    └─ IMSS Tula (scanned) ─────┘  vision-reconstruction path (imss_gen)
                                        rebuild clean vector PDF + schema
                     ▼
        schema JSON contract: fields / tables / charts, point bboxes
```

A separate Python pipeline (`notebooks/forms/**`) turns paper/vector anaesthesia forms
into a print-faithful PDF clone **and** a structured field schema (JSON). Two paths:
vector-extraction for the born-digital forms (`pdfsrc` → `regen` + `schema_extract`) and
vision-reconstruction for the scanned IMSS form (`imss_gen`). Full detail lives in the
federated **parsing sub-wiki**; the hub page is [[parsing]].

## The entities bridge

The two halves meet at a shared clinical vocabulary — the parsed record is the *same
kind of data* the app generates:

| Parsing entity | App counterpart | Where |
|---|---|---|
| `Patient` (weight/height/age/sex) | **`PatientProfile`** (drives LBM covariates) | [[models]] |
| `TransanestheticRecord` vitals grid | **`ChartCanvas`** time-series plot | [[simulation-screen]] |
| `DrugAdministration` | **`DrugModel`** + TCI readouts | [[pk-engine-math]] |

Where [[parsing]] *reconstructs* a vitals grid from an existing PDF, the
[[simulation-screen]] *generates* the same time-series from the engine. See [[parsing]]
for the full bridge and links into the sub-wiki.

## Start here

New to the repo? Read [[cold-resume]] for a 60-second orientation, then [[index]] for the
full page catalog.
