---
type: log
updated: 2026-07-09
tags: [log]
---

# Wiki Log

Append-only change log. One entry per operation, grep-able prefix:
`## [YYYY-MM-DD] <op> | <subject>`, `<op>` ∈ `ingest | query | lint | build`. Newest on
top. See [[SCHEMA]] for the workflow that produces entries.

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
