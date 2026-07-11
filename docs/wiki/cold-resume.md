---
type: resume
updated: 2026-07-09
tags: [resume, orientation]
---

# Cold Resume — 60-Second Orientation

Read this to page the whole project back in fast. Full catalog: [[index]]. Whole-system
view: [[architecture]]. Wiki rules: [[SCHEMA]].

## What this is

Two things in one repo:

1. **TivaTrainer** — a SwiftUI/iOS 17 pharmacokinetic simulation app for
   anaesthesiologists. Pick a drug model (Marsh / Schnider / Minto / Hannivoort), enter
   patient biometrics, set target concentrations, and it computes bolus + infusion and
   plots Cp/Ce curves, plus a 2D/3D compartmental animation. The math is a real
   4th-order Runge-Kutta ODE solver, not fake data.
2. **Forms parsing** — a Python pipeline that turns scanned/vector clinical anaesthesia
   forms into a print-faithful 1:1 PDF clone **and** a structured field-schema JSON. It
   shares a clinical domain model with the app (the parsed record is the same kind of
   data the app generates).

## Where we are (2026-07-10)

Planning for the **forms → app** build is complete and the architecture decisions are
locked — [[forms-to-app|master plan]] + [[decisions]] (ADRs). Goal (data-first): a clinician
enters the anaesthesia record **natively** in the app → persisted in a FastAPI/Postgres
backend ([[rest-contract]]) → a filled PDF is a **subproduct** we render (no OCR). ~11 new
[[proposed-screens]] with the [[ux-ui]] / [[ux-components]] design; full field map in
[[field-inventory]]. Each screen now has a **per-screen build contract** in `plans/screens/`
([[screens-index]]) with the entity/endpoint/component/gap binding, plus a cross-screen
[[screen-build-rollup]] (component build-list, `CaseStore` surface, dependency-ordered build
order). These are now the **canonical, mandatory** screens (+ a [[login|mock login]] gate,
ADR-3); the original 5 screens are recyclable building blocks. **2 near-ready ([[login]], N3),
12 blocked on the `CaseStore` persistence port (ADR-2)**.

- **Frontend is built end-to-end (Phase A + B):** all 14 screens compile + link against the
  in-memory `MockCaseStore` — Login → Encounter List → Hub → every clinical section, editing a case.
  Build gate: `xcodebuild` **BUILD SUCCEEDED** (asset catalog set aside to bypass the `actool`/
  sim-runtime env gap — SDK 26.6 vs installed 26.2; install the matching sim runtime for a runnable
  `.app`). Commits `9945a93` (foundation), `6ef5b11` (screens).
- **Backend is live (2026-07-10):** FastAPI on **Postgres** (Docker), full Case CRUD + sub-resources +
  server derivations, and a **real fill-pdf export** that stamps case data into the notebook's 1:1
  clone (verified end-to-end via `backend/scripts/e2e.py`; filled `registro_transanestesico` in
  `notebooks/forms/out/e2e_*.pdf`). API reference + run guide: [[backend-api]]. Commits `7fd34ce` /
  `768a4ef` / `a956c58`.
- **App↔backend wired + running e2e on a physical device (2026-07-10):** `MockCaseStore` over a
  `CaseBackend` port (`RestBackend`, `CaseStoreProvider.useREST=true`; base URL is a **runtime setting**
  — Login "Server" field / `UserDefaults backend_base_url`, default the Mac LAN IP). **Per-tenant
  isolation** via the `X-User-Id` gateway header (guest→parent `owner_id`; [[backend-api]] "Gateway
  integration"). The app **creates → fills (native input) → saves → exports the real filled form** from
  the device (backend on `0.0.0.0:8000`). Fixed two device bugs: N10 export now calls the backend
  fill-pdf (not the local summary); text fields were un-editable (`.accessibilityElement(.combine)` on
  editable rows — removed). Hub rows color **green+✓ when filled**. Commits `c553e0e`…`d0e9d87`.
- **Next milestone → deploy the backend to prod.** Prerequisites (per governance): fix the P1 Schnider
  safety bug first (below); put the real **API gateway in front** (the service trusts `X-User-Id` and
  currently runs `0.0.0.0` **unauthenticated** — never expose it publicly without the gateway); clear
  the **gated** items with Stanley (`git push` to the `stanlee321` personal remote — 17+ commits ahead;
  personal→KipustecAI org move; PHI confirmation on the IMSS material); then real DB creds/migrations +
  fill-pdf polish (derived fluid rows + vitals chart) + full [[field-crosswalk]].
- **Phase 0 (still pending):** fix the safety-critical Schnider V3 10× bug (`MockPKEngine.swift:69`,
  `v3 = 23800 → 238000`) + a PK regression suite ([[frontend-audit-2026-07-09]]) — required before
  the TCI recommendation chips (Drug Ledger / Technique) surface a correct number.
- **Governance (registry onboarding 2026-07-10):** this repo is in the lookia-ceo agentmemory registry
  (slug `pharma-app-training`). **Gated — propose, don't self-run:** `git push` to the personal remote,
  org-transfer, TestFlight/prod deploy, anything touching real patient data. **PHI rule:** no patient
  values in the bank or wiki (structure only); `notebooks/forms/imss/` + `notebooks/data/*.pdf` are
  PHI-suspect. ADR-1/ADR-2 are now realized (the built app runs on them); the remaining artifact is the
  [[field-crosswalk]] (gates the full fill-pdf, not Phase 0).

## Where things live

| What | Path |
|---|---|
| Swift app (entry, state, engine, views) | `PharmaApp/**` |
| PK engine (the math) | `PharmaApp/Engine/MockPKEngine.swift` |
| Forms-parsing code | `notebooks/forms/**` (`pdfsrc.py`, `regen.py`, `schema_extract.py`, `imss_gen.py`) |
| Source PDFs | `notebooks/data/*.pdf` |
| This wiki (grounded in source) | `docs/wiki/**` |
| Federated parsing sub-wiki | `notebooks/docs/parsing-wiki/**` |
| Raw human-authored specs (code wins on conflict) | `docs/reference/**` (functional / technical / rust-engine-spec / uiux / media) |

## How to build

**App:**
```bash
xcodegen generate        # regenerate PharmaApp.xcodeproj from project.yml
open PharmaApp.xcodeproj  # pick a team + device, Cmd+R (Xcode 16+, iOS 17 SDK)
```
`brew install xcodegen` first if needed. Mock data regenerates via
`swift generate_mock_data.swift` (writes 5 JSON snapshots to `PharmaApp/Resources/MockData/`).

**Parsing:** conda env **`forms_p11`** —
`/Users/stanleysalvatierra/anaconda3/envs/forms_p11/bin/python`. See the sub-wiki's
`cold-resume.md`.

## The 3 biggest gotchas

1. **`RustPKEngine` is a `fatalError` stub.** `EngineProvider.useMock == true`, so
   `MockPKEngine` is the real production engine. Setting `useMock = false` compiles but
   crashes on the first `simulate`/`computeTCI`/`validationRules` call. Reference docs
   that describe Rust as "integrated" are aspirational — the code wins. [[engine]]
2. **Engine unit conventions bite.** Internal units are mg / mg·ml⁻¹ / ml; `displayFactor`
   is ×1000 (mcg/ml for Marsh/Schnider) vs ×1e6 (ng/ml for Minto/Hannivoort); rate
   constants are per-**minute** while the sim loop counts seconds (reconciled by
   `dt = dtInternal/60`). Get these wrong and every number is off by orders of magnitude.
   [[pk-engine-math]]
3. **Re-run `xcodegen generate` after adding/renaming/moving any file.** Sources are
   directory-scanned from `project.yml`; a new file that isn't picked up simply isn't in
   the target. Never hand-edit `PharmaApp.xcodeproj` (it's generated). [[design-system-build]]
