---
type: index
updated: 2026-07-10
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
| [[clinical-record]] | The **case-scoped clinical spine** (BUILT, Phase A+B): `CaseStore`/`MockCaseStore`, the 9 entity DTOs + `AnesthesiaCase`, the login gate + 14-case `Route`, the built clinical screens + shared components. The data-first [[forms-to-app]] vision in code. |
| [[screens]] | The **original 5-screen map** (now recyclable tools): `Route` cases, view/VM per screen, push vs overlay vs embedded presentation, per-screen status, and a checklist for adding/evolving a screen. |
| [[state-navigation]] | `@main` app, the one `@Observable` `AppState`, its drug/patient/sim/playback state and actions, `RootView` `NavigationStack` + `Route`, and the launch-modal gate. |
| [[engine]] | The `PKEngineProtocol` seam: four members, `EngineProvider.useMock==true` picking Mock vs Rust, `RustPKEngine` as a `fatalError` stub, and the snake_case JSON round-trip. |
| [[pk-engine-math]] | `MockPKEngine` — the real math: 4-state ODE, hand-rolled RK4, the four model parameter equations, BET/TCI dosing, and the unit conventions (the top gotcha). |
| [[models]] | Domain models: `DrugModel`/`DrugDatabase` (`id` vs `rustModelId`), `PatientProfile` (James-formula LBM), `SimulationTypes` (Rust-FFI-shaped structs). |
| [[simulation-screen]] | Interactive Cp/Ce chart: `ChartCanvas`, draggable TCI target node, live bolus/infusion readouts, playback; app-side analogue of the parsed vitals grid. |
| [[compartmental-screen]] | `CompartmentalViewModel` fill fractions + Sizes/Labels toggles; `use3D` swaps a 2D SwiftUI Canvas for a SceneKit glass-cylinder 3D scene. |
| [[input-screens]] | Launch modal, drug-selection picker, and patient-input steppers with per-model validation clamping; hold-to-accelerate `StepperRow`. |
| [[design-system-build]] | `DesignSystem.swift` styling namespaces (colors/fonts/haptics/spacing) and the XcodeGen build (`project.yml`, re-run `xcodegen` on file changes). |

## Backend — `backend/**` (Python / FastAPI)

| Page | What it covers |
|---|---|
| [[backend-api]] | **As-built API reference + usage**: the run procedure (Docker Postgres → Alembic → uvicorn → e2e), every endpoint, snake_case payload examples, derived read-only fields, the filled-PDF export, and how the app connects via the `CaseStore` port. Design of record: [[rest-contract]]. |

## Parsing — `notebooks/forms/**` (Python)

| Page | What it covers |
|---|---|
| [[parsing]] | Federation hub: high-level pipeline, the entities bridge to the app, and links into the sub-wiki. Does not restate the sub-wiki. |
| [parsing sub-wiki](../../notebooks/docs/parsing-wiki/index.md) | The federated first-class sub-wiki (own SCHEMA/index): strategy, pipeline, schema-spec, sources, entities. Co-located with the code it documents. |

## Plans

Forward-looking proposals (not code) for the forms → app end-to-end build. Read
[[forms-to-app]] first — it sequences the other three.

| Page | What it covers |
|---|---|
| [[forms-to-app]] | **Master plan**: the data-first e2e vision (collect → persist → project; the filled PDF is a subproduct we render from the data, no OCR), the entities → screens → REST → FastAPI/Postgres chain, and a phased roadmap gated by the audit. |
| [[field-inventory]] | **Reference doc** for what data exists: ~471 inputs by control type + per-entity tables, the derived/computed outputs, and the `fill-pdf` export mapping — every group cites its schema source. |
| [[proposed-screens]] | ~11 app screens rooted at an Encounter (reusing the pharma spine + six net-new clinical screens), shared components, and prerequisite layers. |
| [[rest-contract]] | FastAPI + Postgres backend: clean-architecture rings, `Case` aggregate + nested sub-resources, per-entity DTOs, and a server-side `fill-pdf` export endpoint. |
| [[ux-ui]] | **Master UX/UI**: eight fast-safe entry principles, the accessibility strategy (closing the zero-a11y gap), the design-system + theming direction, and per-screen interaction flows + ASCII wireframes for the seven heavyweight screens. |
| [[ux-components]] | The **shared data-entry component library**: interaction specs (states, gestures, bindings, a11y) for the seven widgets, and how each composes from `DesignSystem` tokens. |
| [[decisions]] | **Build decisions (ADRs)** closing the readiness gaps: native screens (not a dynamic renderer), online-first persistence, auth, sync export, client-side TCI, and the crosswalk mandate. |
| [[field-crosswalk]] | The **field-id ↔ entity crosswalk** spec — the Rosetta stone binding the ~471 schema ids to entity attributes/bboxes that the export + validation need. Specified, not yet built. |

### Screen build specs — `plans/screens/`

Per-screen **frontend build contracts** (plan-derived): for each of the 13 [[proposed-screens]],
what to reuse vs build, the entities/DTOs it captures, the REST endpoints it calls, and its
readiness. Start at [[screens-index]]; the cross-screen component build-list, endpoint-coverage
check, `CaseStore` protocol surface, prerequisite layers, and dependency-ordered build order are
in [[screen-build-rollup]]. Headline: **1 near-ready ([[preanesthetic-assessment]]), 12 blocked on
the persistence/`CaseStore` port (ADR-2)** — build that + [[encounter-list]]/[[encounter-hub]]
first and the rest become buildable.

## Reports

Point-in-time analyses filed back into the wiki (per [[SCHEMA]] — good answers compound).

| Page | What it covers |
|---|---|
| [[frontend-audit-2026-07-09]] | State audit (2026-07-09): overall "usable-with-gaps"; the Schnider V3 10× safety bug; feature matrix; ranked findings; recommended priorities. |
| [[foundation-grounding-2026-07-10]] | Code-truth pass (2026-07-10): verifies the plan-derived screen specs vs the real Swift — **1 blocker** (no case/`CaseStore`/author domain exists) + **14 corrections** (re-root is a view-literal swap not a Route insert; `navigationPath` in `RootView` not `AppState`; `PatientProfile.gender` not `sex`; `computeBET` is private/off-protocol; semantic tokens all missing; reuse mismatches). Carries the **Phase A shopping list** + the `xcodebuild` gate. |
| [[contract-reconciliation-2026-07-10]] | Backend DTOs/derivations ↔ **parsing outputs** (2026-07-10): entity coverage 9/9; **2 blockers fixed** (`fluid_balance` referenced non-existent `control_fluidos` rows — the real intake row is the source-misspelled `"Ingreso Critaloide"`; `TransanestheticRecord` had dropped `events`/`basal`/`termination`) + ~30 attr gaps closed. Deferred: `checkbox_value` value convention, `imss_gen.py` schema ids, Swift mirroring, and the clinical Balance formula (anesthesiologist). |
