---
type: log
updated: 2026-07-10
tags: [log]
---

# Wiki Log

Append-only change log. One entry per operation, grep-able prefix:
`## [YYYY-MM-DD] <op> | <subject>`, `<op>` ∈ `ingest | query | lint | build`. Newest on
top. See [[SCHEMA]] for the workflow that produces entries.

## [2026-07-10] build | Phase B — all 8 clinical screens (frontend compiles e2e)

An 8-agent workflow filled the stub screens with real SwiftUI wired to `MockCaseStore`, then an audit
pass (remove stubs → `xcodegen` → `xcodebuild`) confirmed the **whole frontend compiles + links**
(BUILD SUCCEEDED, 0 errors, `Ld`; the asset catalog was set aside to bypass the sim-runtime/`actool`
env gap, then restored). Screens built: [[patient-data]], [[technique-general|Technique ×3 zones]],
[[transanesthetic-monitoring]], [[drug-ledger]], [[fluid-balance]], [[recovery-aldrete]],
[[newborn-record]], [[review-export]] — plus the Phase A [[login]] / N1 / N2 / N3.

All 14 screens are navigable Login → Encounter List → Hub → each section, editing the in-memory case.
Known follow-ups (all previously planned; none block the build): the schema field-catalogue bridge
(Technique/Recovery/Fluid use hand-chosen keys, not canonical schema ids — [[field-crosswalk]]);
server `derive_service` (balances / Aldrete totals are client-side display-only); the real fill-pdf
export (Review ships an MVP summary PDF via `UIGraphicsPDFRenderer`, not the form fill — needs the
crosswalk); and Phase 0 (Schnider V3 10×) before the Drug/Technique TCI chips show a correct
maintenance number. Commits `9945a93` (A), `6ef5b11` (B).

## [2026-07-10] build | Phase A foundation (compiles + links)

Authored the Phase A foundation directly (one tightly-coupled compile-critical unit — not fanned
out), grounded in [[foundation-grounding-2026-07-10]]. 17 files new/edited:
- **Models** — `Author`, `TechniqueZone`, `ClinicalRecord` (9 entity DTOs + `AnesthesiaCase` root,
  `FieldValue`/`Quantity`/`RecommendedDose`): camelCase, Codable/Sendable, embed `PatientProfile`.
- **Services** — `CaseStore` port + `MockCaseStore` (in-memory, seeded) → the app runs with **no
  backend** (ADR-2).
- **Nav** — full `Route` enum (all 14 cases, `TechniqueZone` associated) + `RootView` re-rooted
  (mock-login gate → `EncounterListView`; `navigationPath` moved into `AppState`); Phase-B stub views
  so every route compiles.
- **DesignSystem** — added the missing semantic tokens (`selectionTint`/`invalidTint`/`fieldFill`/
  `controlStroke`/`surfaceDerived`, `Font.cellValue`, `Spacing.tapTarget`/`cell`).
- **Components** — `AcceleratingRepeatButton` (extracted from `StepperRow`; now haptic on every accel
  tick, ≥44pt), `SectionHeader`, `CardStyle`, `LabeledTextRow`, `CheckboxGroupRow`.
- **Screens** — `LoginView`, `EncounterListView` (N1), `EncounterHubView` (N2), `PreanestheticView`
  (N3 pilot, real + wired to MockCaseStore); the other 8 are stubs for Phase B.

**Gate: `xcodebuild` → 0 Swift errors; Swift compiled + `Ld` linked** (every symbol resolved across
all files). The only failure is `actool`: this machine's newest simulator runtime is 26.2 but the
Xcode 26.6 SDK (23F81a) demands a 26.6 runtime — a pure environment gap (install the matching sim
runtime for a runnable `.app`), not a code issue. Phase 0 (Schnider V3 10× @ `MockPKEngine.swift:69`)
still pending before the TCI chips surface a correct number.

## [2026-07-10] build | foundation grounding (code-truth pass)

Ran a 6-agent **read-only** workflow to verify the plan-derived screen specs against the real
Swift source before Phase A. Report: [[foundation-grounding-2026-07-10]]. **1 blocker** (no
case/encounter/author/`CaseStore` domain exists — build from scratch) + **14 corrections**, the
load-bearing ones: re-rooting is replacing a hardcoded `DrugSelectionView` view literal at
`RootView.swift:12` (the `.drugSelection` case is dead), not inserting a Route; `navigationPath`
lives as `@State` in `RootView`, not `AppState`; `PatientProfile` has `gender` (enum), not `sex`;
the TCI chip calls the public `computeTCI` in **display units** — `computeBET` is private and
off-protocol (drop it); zero spec semantic tokens exist (all must-add); reuse mismatches
(`DrugSelectionView` has no `List`, `ChartCanvas` is hardcoded to 3 PK series, `+ Target` is a
drag-place not a table add-row); `forms/schema/*.json` sit outside the app tree and aren't bundled.
Build gate confirmed runnable (xcodegen + xcodebuild, iPhone 16 sim). Re-confirmed the two live
engine bugs (Schnider V3 10× @ `MockPKEngine.swift:69`, V2 age term @ :68) as Phase 0.

## [2026-07-10] build | screens promoted to canonical + mock login

Decision: the [[proposed-screens]] set is now the **canonical, mandatory** app spine (was a
proposal); the original 5-screen pharmacology app ([[screens]]) becomes **recyclable building
blocks** (steppers, `ChartCanvas`, `DrugModel`/TCI) that serve the new designs, not the spine.
Added a **mock login gate** ([[login]], ADR-3) as the launch root — no real auth (deferred), sets
a session author for `cases.owner`. Login is **near-ready** (no `CaseStore` dep), joining N3
([[preanesthetic-assessment]]) as the two pilot-ready screens. Updated [[screens-index]] (14
screens) + the [[proposed-screens]] status banner + [[screen-build-rollup]] tally.

## [2026-07-10] build | per-screen frontend build specs

Ran a 14-agent workflow (13 screen cards + a synthesis pass, **plan-derived**) to bind the
planning corpus **per screen** — the connective tissue that was missing (the plans each covered
one axis: screens / fields / endpoints / widgets, but nothing tied them together per screen). New
folder `plans/screens/`:

- 13 per-screen **build contracts** (indexed at [[screens-index]]) — each card ties a screen to
  its entities, field load, components (reuse vs build-new), the exact REST endpoints + a concrete
  JSON payload, the **gap list** (Route / View / VM / component / `CaseStore` items with proposed
  file paths), dependencies, and a readiness verdict. Heavyweights grounded: [[technique-general]]
  carries the `values_blob` binding + client-side TCI chip (ADR-5); [[review-export]] the
  fill-pdf / [[field-crosswalk]] gate.
- [[screen-build-rollup]] — the aggregate that answers "what's missing to build": component
  build-list ranked by reach (`CheckboxGroupRow` serves 10 screens), the endpoint-coverage check
  (**0 endpoints missing** from [[rest-contract]]; 3 contract endpoints have no caller), the
  `CaseStore` protocol surface (5 lifecycle + 6 singleton get/put + 2 collection CRUD + export),
  the prerequisite layers, and a dependency-ordered build sequence.

Verdict: **1 near-ready ([[preanesthetic-assessment]]), 12 blocked** — the dominant blocker is the
persistence/`CaseStore` port (ADR-2), which alone gates 12 of 13. Two consolidations the synthesis
caught: the "labeled text row" was proposed under 5 names → unify to one variant widget; `CaseStore`
was proposed in 4 folders → canonical `PharmaApp/Services/CaseStore.swift`. Grounding is
plan-derived (not re-verified vs Swift source) per the run's scope. Mechanical link-lint clean
(15 new pages, all wikilinks resolve).

## [2026-07-10] query | readiness review → build decisions locked

A "are we ready to build?" review of the plan surfaced gaps; closed them so development
starts contradiction-free:
- Added [[decisions]] (ADR-1..6): resolved the app-architecture fork (**native screens**,
  not a schema-driven renderer), online-first persistence behind a `CaseStore` port,
  `owner`-column auth (full auth later), synchronous export, and **client-side TCI** (the
  app's engine, not the backend).
- Added [[field-crosswalk]]: specified the field-id ↔ entity Rosetta stone the export +
  validation need (the one integration artifact still to build; gates fill-pdf, not Phase 0).
- Fixed the contradiction in [[rest-contract]] §0/§4 (was "app renders forms dynamically")
  and marked its open questions resolved; updated [[forms-to-app]] risks.
Verdict: **Phase 0 + the backend skeleton are ready now**; the crosswalk builds alongside
the export layer.

## [2026-07-09] ingest | UX/UI design

Synthesized the UX/UI design layer for the clinical-record app into a 2-page Plans set (both
under `docs/wiki/plans/`), grounded in the app's existing idioms (`StepperRow` accel + `Haptics`,
`PatientInputView` card/segmented, `SimulationView` segmented host + `ChartCanvas` coord math,
`DesignSystem` tokens) and framed **data-first** (native clinician entry; the filled PDF is a
subproduct rendered later, no OCR). Both pages fix the [[frontend-audit-2026-07-09]]'s three
cross-cutting gaps — zero accessibility, dead `DesignSystem` tokens, hardcoded literals:

- [[ux-ui]] — the **master UX/UI page**: Part 1 eight fast-safe entry principles (two-tempo
  capture, one-tap toggles for the 48%/225 toggle fields, clamp-on-entry defaults, error-prevention
  over messaging, progressive disclosure, undo-by-default, section-completion, collect-once);
  Part 2 the accessibility strategy (VoiceOver label/value/hint contract, `AXChartDescriptor` for
  the vitals chart, adjustable grids, Dynamic Type + dead-Font-token fix, 44 pt targets — two real
  defects found: `compactStepperButton` 40 pt, `genderButton` ~33 pt); Part 3 the design-system +
  theming direction (semantic token set, colour-never-sole-signal, per-screen light/dark); Part 4
  per-screen interaction flows + ASCII wireframes for the seven heavyweight screens (N2 Hub, N4
  Technique, N5 Monitoring, N6 Drug Ledger, N7 Fluid grid, N8 Aldrete, N10 Review/Export).
- [[ux-components]] — the **shared component library**: interaction specs (layout, states, gestures,
  bindings, a11y) for the seven widgets (`CheckboxGroupRow`, `CheckboxValueRow`, `ScoreGridWidget`,
  `HourlyFluidGrid`, `EditableDrugTable`, `SignaturePad`, `DateTimePicker`), plus §0 shared
  conventions (extract `AcceleratingRepeatButton` from `StepperRow`, the token composition, the
  a11y baseline, the data-first binding model) and how each composes from `DesignSystem` tokens.

Added both to the **Plans** section of [[index]]; this entry records the ingest.

## [2026-07-09] ingest | forms→app plan

Synthesized the forms → app end-to-end plan into a 4-page Plans set (all under
`docs/wiki/plans/`, grounded in the four schemas, the nine-entity model, the notebook
renderers, and the actual app source):

- [[forms-to-app]] — the **master plan**: the e2e vision (collect → render → export filled
  PDF), the entities → screens → REST → FastAPI/Postgres chain, and a **phased roadmap**
  (Phase 0 audit fixes → 1 schema endpoint → 2 persistence/Case CRUD → 3 app bridge + re-root
  nav → 4 six clinical screens → 5 `fill-pdf` export). Respects [[frontend-audit-2026-07-09]].
- [[field-inventory]] — the **reference doc** for what data exists: authoritative
  control-type totals (~471 inputs, 48% toggle-based), per-entity input tables, the
  derived/computed outputs (Aldrete totals, fluid balances, IMC/VSC, TCI dose), and the
  `fill-pdf` export mapping — every group cites its `notebooks/forms/schema/*.json` source.
- [[proposed-screens]] — ~11 screens rooted at an Encounter (previously filed).
- [[rest-contract]] — FastAPI + Postgres backend contract (previously filed).

Added a **Plans** section to [[index]] linking all four; this entry records the ingest.

## [2026-07-09] ingest | screen map + audit report filed

- Added [[screens]] — a consolidated 5-screen map (Launch Modal overlay, Drug Selection,
  Patient Input, Simulation, Compartmental) with `Route` cases, view/VM, the three
  presentation kinds (push / overlay / embedded tab), per-screen status, and an
  add-a-screen checklist. Grounded: only 2 VMs exist; `DrugSelectionView` uses `AppState`
  directly (no `DrugSelectionViewModel` despite the planning docs); `SimulationView`
  embeds `CompartmentalView()` as a `[Graph][Compartments]` tab.
- Catalogued the [[frontend-audit-2026-07-09|audit report]] under a new Reports section
  in [[index]]. Back-linked [[screens]] from [[state-navigation]].

## [2026-07-09] lint | first pass — 4 fixes

Lint after the build caught 4 real issues (all fixed):
- **grounding** — [[parsing]] falsely claimed the app cross-link pages "not yet written";
  they all exist. Corrected.
- **drift** — [[state-navigation]] said `runInitialSimulation()` is "called once patient
  input is confirmed"; grep shows it has **no call sites** — the real path is
  `runSimulation(with:)` from `SimulationView.task`. Corrected (matches [[input-screens]]).
- **grounding** — [[design-system-build]] cited `docs/rust-engine-spec/…` (pre-reorg path);
  fixed to `docs/reference/rust-engine-spec/…`.
- **drift (sub-wiki)** — the parsing sub-wiki's `cold-resume.md` / `strategy.md` still
  called the IMSS form "deferred"; it shipped. Updated to "done".

Mechanical link-lint clean on both wikis (14 + 30 pages, no dangling links, no orphans).

## [2026-07-09] build | project wiki instantiated

Built the project-level wiki grounded in source code via a multi-agent workflow: parallel
agents read the actual `PharmaApp/**` Swift and `notebooks/forms/**` Python sources (not
the aspirational `docs/reference/**` specs), and a synthesis step wove the results into a
navigable tree with Obsidian wikilinks and a federated bridge to the existing parsing
sub-wiki. Ground-truth rule applied throughout: **`RustPKEngine` is a `fatalError` stub
and `EngineProvider.useMock == true`, so `MockPKEngine` is the real engine** — drift from
the reference docs noted on every affected page.

Pages created:

- Core: `SCHEMA.md`, [[index]], [[architecture]], [[cold-resume]], [[log]]
- App (`docs/wiki/app/`): [[state-navigation]], [[engine]], [[pk-engine-math]], [[models]],
  [[simulation-screen]], [[compartmental-screen]], [[input-screens]], [[design-system-build]]
- Parsing: [[parsing]] (federation hub → the sub-wiki at
  `notebooks/docs/parsing-wiki/**` + the app entities bridge)
