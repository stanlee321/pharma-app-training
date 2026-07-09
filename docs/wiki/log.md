---
type: log
updated: 2026-07-09
tags: [log]
---

# Wiki Log

Append-only change log. One entry per operation, grep-able prefix:
`## [YYYY-MM-DD] <op> | <subject>`, `<op>` ∈ `ingest | query | lint | build`. Newest on
top. See [[SCHEMA]] for the workflow that produces entries.

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
