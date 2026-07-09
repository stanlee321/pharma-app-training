---
type: index
updated: 2026-07-09
tags: [index, catalog]
---

# Project Wiki — Index

Master catalog of every page. Read this first when answering a query, then drill in and
answer with `path:symbol` citations. Orientation: [[cold-resume]]. Conventions &
workflows: [[SCHEMA]]. Whole-system view: [[architecture]].

## Core

| Page | What it covers |
|---|---|
| [[architecture]] | The whole system on one page: SwiftUI MVVM → `PKEngineProtocol` seam → 4 PK models + BET/TCI → screens, the forms pipeline, and the entities bridge. |
| [[cold-resume]] | 60-second orientation: what the project is, where things live, how to build, the 3 biggest gotchas. |
| [[SCHEMA]] | Wiki config: ground-truth-is-code rule, layers, frontmatter/wikilink conventions, ingest/query/lint workflows, log format. |
| [[log]] | Append-only change log for the wiki (`ingest \| query \| lint \| build`). |

## App — `PharmaApp/**` (Swift)

| Page | What it covers |
|---|---|
| [[state-navigation]] | `@main` app, the one `@Observable` `AppState`, its drug/patient/sim/playback state and actions, `RootView` `NavigationStack` + `Route`, and the launch-modal gate. |
| [[engine]] | The `PKEngineProtocol` seam: four members, `EngineProvider.useMock==true` picking Mock vs Rust, `RustPKEngine` as a `fatalError` stub, and the snake_case JSON round-trip. |
| [[pk-engine-math]] | `MockPKEngine` — the real math: 4-state ODE, hand-rolled RK4, the four model parameter equations, BET/TCI dosing, and the unit conventions (the top gotcha). |
| [[models]] | Domain models: `DrugModel`/`DrugDatabase` (`id` vs `rustModelId`), `PatientProfile` (James-formula LBM), `SimulationTypes` (Rust-FFI-shaped structs). |
| [[simulation-screen]] | Interactive Cp/Ce chart: `ChartCanvas`, draggable TCI target node, live bolus/infusion readouts, playback; app-side analogue of the parsed vitals grid. |
| [[compartmental-screen]] | `CompartmentalViewModel` fill fractions + Sizes/Labels toggles; `use3D` swaps a 2D SwiftUI Canvas for a SceneKit glass-cylinder 3D scene. |
| [[input-screens]] | Launch modal, drug-selection picker, and patient-input steppers with per-model validation clamping; hold-to-accelerate `StepperRow`. |
| [[design-system-build]] | `DesignSystem.swift` styling namespaces (colors/fonts/haptics/spacing) and the XcodeGen build (`project.yml`, re-run `xcodegen` on file changes). |

## Parsing — `notebooks/forms/**` (Python)

| Page | What it covers |
|---|---|
| [[parsing]] | Federation hub: high-level pipeline, the entities bridge to the app, and links into the sub-wiki. Does not restate the sub-wiki. |
| [parsing sub-wiki](../../notebooks/docs/parsing-wiki/index.md) | The federated first-class sub-wiki (own SCHEMA/index): strategy, pipeline, schema-spec, sources, entities. Co-located with the code it documents. |
