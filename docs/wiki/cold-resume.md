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
