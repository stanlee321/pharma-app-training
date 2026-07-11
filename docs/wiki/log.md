---
type: log
updated: 2026-07-10
tags: [log]
---

# Wiki Log

Append-only change log. One entry per operation, grep-able prefix:
`## [YYYY-MM-DD] <op> | <subject>`, `<op>` ∈ `ingest | query | lint | build`. Newest on
top. See [[SCHEMA]] for the workflow that produces entries.

## [2026-07-10] fix | text fields not editable — accessibilityElement(.combine) swallowed input

Device bug: text fields (Encounter Hub Dx/Sala/Servicio, and every `LabeledTextRow` across screens)
focused + showed the keyboard but wouldn't accept typed text. Root cause:
`.accessibilityElement(children: .combine)` wrapping an editable `TextField` flattens the row into a
single element and **swallows keyboard input**. Removed it from the 4 **editable** rows
(`LabeledTextRow`, `TechCheckboxValueRow`, `DrugLedgerRowEditor`, `NewbornEditor`); kept it on the
read-only `RE_SummaryRow`. Added a regression comment on `LabeledTextRow` + a ⚠️ caveat in
[[ux-components]] §0.3. App compiles + links.

## [2026-07-10] build | wire N10 export to the backend + section-completion coloring

App fixes from device testing. (1) **Review & Export (N10)** now calls the backend's real fill-pdf:
`CaseBackend.exportForm` / `RestBackend` POST `/cases/{id}/export/{form_id}` → `MockCaseStore.exportForm`
(save-then-export) → N10 gets the **filled 1:1 form** (202 KB, verified via a standalone round-trip),
with a form picker + the offline summary kept as a secondary option; the stale "not built yet" caption
removed. **`CaseStoreProvider.useREST` → `true`** so the app persists + exports through the live
service. (2) **Encounter Hub section-completion coloring** — rows are **blue when empty, green + ✓ when
they hold data** (`Models/CaseCompletion.swift` `hasData` per entity). (3) iOS **ATS** exception
(`NSAllowsLocalNetworking`) via an explicit `PharmaApp/Info.plist` so the app can reach
`http://127.0.0.1:8000`. App compiles + links; [[backend-api]].

## [2026-07-10] build | align tenancy to the API-gateway header contract

Aligned the backend to the Lookia `ms-api-gateway` header contract (external ref
`…/video-server_microservicios_apigateway/docs/GATEWAY_HEADERS.md`; captured as a [[backend-api]]
"Gateway integration" section + a `reference` memory). `api/deps.py` now parses the full gateway
identity into a `UserContext` (mirrors the gateway's recommended dependency): `X-User-Id`,
`X-User-Role`, `X-User-Scopes`, `X-User-Created-By`, `X-App-Type` (omitted-when-null guarded),
`X-Request-Id`, and S2S `X-Service-Name`/`X-Auth-Mode`. **Tenant key is now `ctx.owner_id`** — the
parent `created_by` for **guest** tokens, else `user_id` — closing the doc's #1 warning (guests
would otherwise filter to the wrong tenant). Local dev still falls back to `settings.mock_user_id`;
our `X-User-Id` choice already matched the gateway's primary tenancy key. **Audited:** pytest 2
passed + a live test — a guest (`created_by=parent`) sees & writes the parent's cases and an
unrelated user 404s → **gateway-aligned tenancy OK**. Role/scope/app-type gates + S2S policy are
parsed-for-later, not enforced yet.

## [2026-07-10] build | per-tenant scoping (X-User-Id) — mock gateway tenant

Added multi-tenant isolation ahead of the API gateway (which will inject **X-User-Id**). Backend: a
`user_id String(36)` column on `cases` (+ Alembic `0002`, backfilling existing rows to the mock
tenant), a `get_user_id` dependency reading the `X-User-Id` header (fallback to a fixed
`settings.mock_user_id`), and tenant isolation threaded through `CaseService` — the ownership check in
`_model` auto-scopes every read/write (404 across tenants), `list()` filters by `user_id`,
create/upsert stamp it. `owner` stays a human display name. App: `signIn` persists a stable
per-device UUID (`@AppStorage mock_user_id_v1`, set as `Author.id`); `RestBackend` sends it as
`X-User-Id` on every request.

**Audited four ways:** (1) `alembic upgrade` applied `0002` to Postgres (column + index + backfill);
(2) a live **2-tenant isolation test** — A and B each see only their own cases, A→B GET/PUT/DELETE all
**404**, the no-header mock tenant sees only the backfilled rows → **ISOLATION OK**; (3) app compiles +
links; (4) a standalone round-trip proved `RestBackend` attaches `X-User-Id` from the persisted login
(a fresh tenant's list is exactly its own case). Mock now; the gateway just overwrites the header
later. pytest 2 passed. [[backend-api]], [[decisions]] ADR-3.

## [2026-07-10] build | app↔backend wiring (RestBackend) — verified round-trip

Wired the app to the backend behind the `CaseStore` port (delegated to a 3-agent workflow, then
audited). New `CaseBackend` port (`PharmaApp/Services/CaseBackend.swift`): `InMemoryBackend` (actor,
seeded) + `RestBackend` (URLSession → the API, ISO-8601, **no** key strategy — snake↔camel rides on
explicit `CodingKeys` so the `technique.values` / `fluid.matrix` / `aldrete` dict keys survive).
`MockCaseStore` keeps its name + sync surface (screens unchanged) but now holds a `backend` +
optimistic `createCase`/`delete` + async `refresh()`/`save(caseID:)`; `CaseStoreProvider.useREST`
(default **false** → in-memory, app still runs standalone) picks the backend; `EncounterList`
refreshes, `EncounterHub` saves on disappear + a Save button. Added `PUT /cases/{id}` full-aggregate
upsert to the backend (client owns the id → one idempotent save; commit `e24471a`).

**Audited two ways:** (1) app compiles + links (asset-aside `xcodebuild`, 0 Swift errors); (2) a
**standalone round-trip** — compiled the app's real `ClinicalRecord.swift` + `PatientProfile.swift` +
`CaseBackend.swift` and ran create→save→load→delete against the **live Postgres-backed server**:
server-derived `imc` round-trips, and the dict keys (`propofol_42`, `Ingreso Critaloide`) survive
untouched — **ROUND-TRIP OK**. Flip `useREST = true` and the app persists to the service. [[backend-api]].

## [2026-07-10] ingest | backend API reference into the wiki

Added [[backend-api]] — the **as-built** API reference + usage procedure (Docker Postgres → Alembic →
uvicorn → e2e), every endpoint, snake_case payload examples, the derived read-only fields, the
filled-PDF export, and the `CaseStore`-port connection path — grounded in the live OpenAPI spec.
Registered under a new **Backend** section in [[index]] and oriented [[cold-resume]] (backend live;
**app-wiring is the next step**). Milestone marker: the app can now connect to a real service.

## [2026-07-10] build | backend on Postgres + e2e + real fill-pdf export

Ran the backend live: **Postgres via Docker** (`backend/docker-compose.yml`, host port 5433) +
Alembic `upgrade head` + uvicorn against it. An **e2e script** (`backend/scripts/e2e.py`) drives the
full case lifecycle over HTTP (envelope → patient → preanesthetic → technique → monitoring → drugs →
fluids → recovery → export) and confirmed persistence + server derivations end-to-end (`imc 27.8`,
fluid `balance_parcial 1hr = 450` from the real misspelled rows, aldrete totals 10, 3 drugs persisted).

Built the **real fill-pdf renderer** (`backend/app/infrastructure/render/renderer.py` +
`crosswalk.py` — delegated, then audited): `POST …/export/{form_id}` now stamps the case data into
the notebook's **1:1 clone** via `fitz` at each schema field's bbox (text / checkbox / checkbox_value
+ the `farmaco` and `control_fluidos` tables), with the summary-PDF as fallback. **Visual audit
confirmed** `registro_transanestesico` fills 35 fields — header, Urgencia ✓, monitoring ✓,
dx/procedimiento, somatometry, the drug table (Propofol/Fentanilo/Rocuronio), the fluid grid — all in
the right boxes (206 KB filled vs 1.9 KB summary). This closes the paper→digital→PDF loop the app
exists for. A **first-cut [[field-crosswalk]]** now lives in `render/crosswalk.py`.

Follow-ups (documented): the fluid **derived** rows (Balance parcial/total, Gasto urinario, Tasa
Fentanilo) and the vitals **chart** aren't drawn yet; imss_p2 value bboxes overlap their printed
labels (scanned-reconstruction — needs nudging in `imss_gen.py`); the nota2 generic-drug double-stamp
needs section-aware routing.

## [2026-07-10] build | backend MVP + contract reconciliation

Stood up the FastAPI service behind the app's `CaseStore` port (ADR-2) in a dedicated conda env
(`tiva_backend`, py3.11): clean-architecture rings (domain / application / infrastructure / api),
Case aggregate CRUD + singleton/collection sub-resources, `derive_service`, `GET /forms` + schema
serving (the real notebooks JSON), a summary-PDF export, SQLite dev DB + Alembic baseline. Core
authored directly; routers / main / tests / Alembic built by a 5-agent workflow, then audited
(pytest 2 passed; every endpoint category verified). Lives in `backend/`; run guide in
`backend/README.md`. Commit `7fd34ce`.

Then a reconciliation pass ([[contract-reconciliation-2026-07-10]]) validated the DTOs/derivations
against the **actual parsed schemas** (not just the entity docs). Entity coverage 9/9; found + fixed
**2 blockers** — `fluid_balance()` referenced `control_fluidos` rows that don't exist (the real
intake row is the source-misspelled `"Ingreso Critaloide"`; `NCL` was wrongly counted as intake,
inverting the sign) → rewritten to the real rows + the named derived rows (Balance parcial/total,
Total a reponer, Gasto urinario, Tasa Fentanilo); and `TransanestheticRecordDTO` had dropped
`events`/`basal`/`termination` vs the frozen Swift → restored (+`SurgicalEventDTO`/`VitalSnapshotDTO`).
Also added the missing `AnesthesiaCase` envelope, `PreanestheticAssessment` exam, `NewbornRecord`,
Patient/Provider attrs, and hardened `aldrete_total` (5-criteria guard + 0–10 clamp). **Deferred**
(documented in the report): Swift-side field mirroring, the `checkbox_value` Quantity convention,
`imss_gen.py` schema-side ids for composites/newborn, and the exact clinical **Balance parcial/total
formula — flagged for anesthesiologist confirmation**.

## [2026-07-10] ingest | register the built clinical app into the source-grounded wiki

Registered the Phase A+B build into the **app** wiki so the source-grounded pages reflect the code,
not just the plans. New: [[clinical-record]] — the authoritative subsystem page for the case-scoped
spine (`CaseStore`/`MockCaseStore`, the 9 DTOs + `AnesthesiaCase`, the login gate + 14-case `Route`,
the built screens + shared components, and the mock/pending list). Updated the now-stale grounded
pages with banners + corrections pointing to it: [[screens]] (the 5 are now recyclable tools under a
clinical spine), [[state-navigation]] (`Route` 14 cases, `navigationPath` in `AppState`, login gate,
new AppState props), [[architecture]] (added the clinical-spine section). Added [[clinical-record]]
to [[index]]'s App section. Link-lint clean.

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
