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
- **App↔backend wired (2026-07-10):** `MockCaseStore` sits over a `CaseBackend` port with
  `RestBackend` (flip `CaseStoreProvider.useREST`); verified via a live create→save→load→delete
  round-trip ([[backend-api]]). **Next:** offline cache + auth, fill-pdf polish (derived fluid rows +
  vitals chart), Phase 0 (Schnider V3), full [[field-crosswalk]] + canonical keys.
- **Phase 0 (still pending):** fix the safety-critical Schnider V3 10× bug (`MockPKEngine.swift:69`,
  `v3 = 23800 → 238000`) + a PK regression suite ([[frontend-audit-2026-07-09]]) — required before
  the TCI recommendation chips (Drug Ledger / Technique) surface a correct number.
- **Awaiting Stanley's OK:** [[decisions]] ADR-1 (native screens) and ADR-2 (online-first
  persistence). The one integration artifact still to build is the [[field-crosswalk]]
  (gates the fill-pdf export, not Phase 0).

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
