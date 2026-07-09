---
type: report
updated: 2026-07-09
tags: [audit, app]
---

# Frontend Audit — 2026-07-09

## Executive summary

**Overall health: usable-with-gaps.** TivaTrainer's core training loop — drug selection → patient input → interactive TCI graph → 2D/3D compartmental animation — is genuinely implemented end-to-end and backed by a real RK4 3-compartment ODE solver, not faked data. The clean `@MainActor @Observable` architecture compiles under strict concurrency and keeps the heavy solver off the main thread. However, the app is not release-ready, and the single most important takeaway is a **safety-critical numerical bug**: `MockPKEngine` — which is the *only* functional engine (the Rust engine is a `fatalError` stub) — encodes Schnider V3 as 23.8 L instead of the published 238 L, a 10x error that distorts propofol slow-compartment kinetics for trainees who see this output as ground truth. Compounding the risk, there are **zero automated tests** despite a full validation-reference doc, which is exactly why that error went uncaught. Secondary problems cluster in incomplete Phase 8 work (no persistence, no accessibility, effect-site targeting never simulated), a real playback-Task leak, per-frame SceneKit churn, and a committed `.xcodeproj` that silently de-signs itself when regenerated per the documented workflow.

## Overall health

| Dimension | Health | One-line |
|---|---|---|
| Feature completeness & state | fair | Rich happy-path (Phases 1-7) done; Phase 8 (persistence, a11y, Rust engine) almost entirely outstanding. |
| PK/PD engine correctness | poor | Sound RK4/unit core, but a 10x Schnider V3 error, unsimulated effect-site, unscaled Hannivoort, and no tests — in the only shipping engine. |
| State, concurrency & lifecycle | fair | Clean Observable model, solver correctly off-main; but a playback leak, racing sim re-runs, and dead duplicate state. |
| SwiftUI views & UX | fair | Polished 2D charting; rough SceneKit per-frame cost, duplicated chart margins, dead design tokens, zero accessibility. |
| Build & project hygiene | fair | project.yml generates cleanly; committed xcodeproj drifts and wipes signing, MockData not bundled + dead, no tests/CI/lint. |

## Feature state

| Feature | State | Notes |
|---|---|---|
| Drug selection → patient input → simulation flow | DONE | `RootView` NavigationStack + `Route` drive the full path; coherent and working. |
| PK engine (RK4 3-compartment, covariate math, BET TCI) | DONE | `MockPKEngine` real solver; Marsh/Minto exact. See correctness bugs below. |
| Interactive concentration graph | DONE | `ChartCanvas` clamped coordinate math, dual Y-axes, tooltip, haptics-on-snap. |
| Draggable target node / TCI readouts / multi-target | DONE | Phase 5 delivered in `SimulationView` + `SimulationViewModel`. |
| Playback / scrubbing | PARTIAL | Leaks VM on dismiss; won't restart at cursor=1.0; not synced across tabs. |
| 2D compartment animation | PARTIAL | `CompartmentCanvas` particles frozen — no clock advances `cursorTimeSeconds` outside scrubbing. |
| 3D SceneKit compartmental view | DONE | `CompartmentSceneView` renders; heavy per-frame transaction/SCNText churn (perf). |
| Design system | PARTIAL | `DesignSystem` present but many Font/Color/Spacing tokens are dead; views hardcode. |
| Effect-site (Ce) targeting | MISSING | `simulate()` ignores `targetType`; every call site hardcodes `.plasma`; overshoot branch is dead code. |
| Rust engine | STUB | `RustPKEngine` methods `fatalError`; `EngineProvider.useMock = true`. |
| Saved Simulations / SwiftData persistence | MISSING | No SwiftData/@Model/@Query anywhere; button is an empty closure. |
| Edit Drug List | STUB | `DrugSelectionView` bottom-bar button has an empty action. |
| Accessibility / VoiceOver / Dynamic Type | MISSING | No accessibility modifiers anywhere; Canvas charts opaque to assistive tech. |
| Dark/light theme switching | MISSING | Only `.preferredColorScheme(.dark)` on sim; input screens don't force light (Phase 1). |
| Accelerating stepper (hold-to-accelerate) | PARTIAL | `StepperRow` accel wired only to dilution; weight/height/age are tap-only. |
| App icon | DONE | Committed 1024x1024 `AppIcon.png`. |
| Launch screen | MISSING | Auto-generated blank; no branded LaunchScreen. |
| Launch modal external links | STUB | `LaunchModalView` opens `https://example.com/info` and `/discount`. |
| MockData snapshots pipeline | STUB | `MockDataGenerator.loadSnapshot/generateAll` have zero callers; files also not bundled. |
| Unit tests | MISSING | No test target, no XCTest/Testing files. |

## Top findings (ranked)

**1 · HIGH · Schnider V3 is 10x too small (23,800 ml vs published 238 L) — safety-critical**
`MockPKEngine.swift:69` `let v3 = 23800.0`. This makes `k31 = cl3/v3 = 836/23800 ≈ 0.0351/min` instead of the correct `≈ 0.00351/min`, so the propofol slow compartment is 10x undersized and returns drug ~10x too fast, distorting context-sensitive half-time. Both spec docs (`01_Models.md:151`, `04_Validation_Reference.md:54,69`) carry the same error, so nothing caught it. This engine is what ships (`EngineProvider.useMock = true`). **Fix:** set `v3 = 238000.0`, correct the spec docs, and add a Schnider-`k31` parameter regression test.

**2 · HIGH · Effect-site (Ce) targeting is advertised but never simulated**
`MockPKEngine.simulate()` (`MockPKEngine.swift:190-276`) never reads `target.targetType`, so `.plasma` and `.effectSite` produce identical curves. The only effect-site logic — a fixed 1.3x overshoot in `computeTCI` (`MockPKEngine.swift:293-304`) — is dead because every call site passes `.plasma` (`SimulationViewModel.swift:99,114,123`; `SimulationView.swift:34`), and the UI exposes no plasma/effect-site selector. This centers the app's own Ce premise on an unimplemented capability. **Fix:** implement effect-site TCI (bisection-on-Ce-peak per `02_TCI_Algorithm.md:87`) and thread a `TargetType` selector through the toolbar → `TargetEvent` → engine, or hide effect-site until built.

**3 · HIGH · Playback Task leaks the view model and spins forever if the screen is dismissed mid-playback**
`SimulationViewModel.startPlayback()` (`SimulationViewModel.swift:193-203`) starts a ~16ms loop whose `@MainActor` closure retains `self` via `playbackTask`; there is no `deinit` and `SimulationView` has no `.onDisappear`. Tapping Play then Back (`SimulationView.swift:70` `navigationPath.removeLast()`) drops SwiftUI's `@State` ref while the Task keeps `self` alive and `isPlaying == true`, so the 16ms timer fires on a detached VM for the process lifetime. **Fix:** `deinit { playbackTask?.cancel() }` (or `.onDisappear { vm.stopPlayback() }`) and capture `[weak self]`.

**4 · HIGH · SceneKit 3D view does heavy per-frame work at 30fps for no visual benefit**
`CompartmentalView.swift:123` wraps both canvases in `TimelineView(.animation(minimumInterval: 1/30))`, recreating `CompartmentSceneView` every frame → `Coordinator.update` runs a 0.25s implicit `SCNTransaction` per frame, and `updateSizeLabels` (`CompartmentSceneView.swift:498-527`) destroys+rebuilds 3 `SCNText` geometries every frame while Sizes mode is on — yet the `time` parameter is never read in the 3D path. Result: wasted CPU/GPU and overlapping quarter-second animations. **Fix:** wrap only the 2D `CompartmentCanvas` in TimelineView; build size labels once and toggle `isHidden`; drop the per-frame `SCNTransaction`.

**5 · HIGH · Committed `.xcodeproj` drifts from `project.yml`; regenerating wipes the signing team**
`PharmaApp.xcodeproj/project.pbxproj` is git-tracked with `DEVELOPMENT_TEAM = 923BHPTBX7`, but `project.yml` declares no team. The documented `xcodegen generate` workflow (README Build & Run / TestFlight) drops those lines, silently producing an unsigned project — and the real Apple Team ID is leaked into VCS. **Fix:** pick one source of truth — gitignore the `.xcodeproj` and supply `DEVELOPMENT_TEAM` via xcconfig/CI env, or stop regenerating. Don't both commit the project and tell users to regenerate it.

## By dimension

### Feature completeness & state
- **MEDIUM** — Rust engine is a `fatalError` stub; keep `useMock = true` so the path is never hit (`RustPKEngine.swift`).
- **MEDIUM** — Saved Simulations / SwiftData persistence entirely absent; two bottom-bar buttons are empty closures (`DrugSelectionView.swift:221,226`). Wire to a `@Model` or hide.
- **LOW** — Dark/light theme switching unimplemented; only `.preferredColorScheme(.dark)` on `SimulationView.swift:23`.
- **LOW** — Accelerating stepper wired only to dilution (`StepperRow`); weight/height/age use plain `compactStepperButton`. Reuse `StepperRow` or reword the TODO.
- **INFO** — Onboarding "Tap chart to set target" hint is unreachable: `.task` always auto-creates a default target so `points` is never empty. Gate one behavior behind a first-run flag.

### PK/PD engine correctness
- **MEDIUM** — Schnider V2 omits the age term (fixed `18900.0`, `MockPKEngine.swift:68`); correct is `(18.9 − 0.391·(age−53))·1000`.
- **MEDIUM** — Hannivoort V3/Cl3 not weight-scaled (`v3 = 52000`, `cl3 = 602` constants, `MockPKEngine.swift:107,110`); correct only at 70 kg. Apply allometric scaling.
- **LOW** — Effect-site 1.3x overshoot is a model-independent heuristic, undisclosed in-UI and currently unreachable. Replace with the spec's bisection method when Ce targeting ships.
- **INFO** — Hannivoort `ke0 = 1.09/min` is the fastest of all four models, contradicting dexmedetomidine's slow onset; confirm against a cited source.

### State, concurrency & lifecycle
- **MEDIUM** — Simulation re-runs fire as bare, uncancellable `Task`s (`SimulationViewModel.swift:131-134,159-162`) that overlap, race on `appState.simulationOutput`, and corrupt `isSimulating`. Store/cancel one `simulationTask` (debounce) or serialize via an actor.
- **MEDIUM** — Dead duplicate state: `AppState.isPlaying/playbackSpeed` never read/written; `currentTime`/`isSimulating` write-only; `runInitialSimulation()` has no callers. Delete or promote to single source of truth.
- **MEDIUM** — Graph and Compartments tabs keep independent cursors (`SimulationViewModel.cursorTimeFraction` vs `CompartmentalViewModel.cursorFraction`), so playback never animates the compartments tab. Hoist one cursor into `AppState`.
- **LOW** — `EngineProvider.shared` is a computed property allocating a new engine per access despite the singleton name. Make it a stored `static let`.
- **LOW** — `@unchecked Sendable` on the stateless engines is unnecessary and suppresses the compiler check; use plain `Sendable`.
- **LOW** — Natural playback completion leaves a stale non-nil `playbackTask`; pressing Play at the end is a no-op (cursor pinned at 1.0). Reset to 0 on completion.
- **INFO** — Per-render O(n) linear scans over up to 3600 points in `valuesAtCursor`/`currentPoint`; index directly since points are uniformly spaced.
- **INFO** — `AppState.selectedDrug` force-indexes `drugModels[0]`; traps if `DrugDatabase.load()` ever returns empty.

### SwiftUI views & UX
- **MEDIUM** — Chart margins duplicated as raw literals in `ChartCanvas.swift:16-19` and `SimulationView.swift:240-243`; changing one silently desyncs the target node, tooltip, and tap-to-value math. Share one `ChartGeometry` source.
- **MEDIUM** — 2D compartment particle flow effectively frozen (no clock advances `cursorTimeSeconds` outside scrubbing) yet TimelineView still redraws 30fps of identical frames. Add an independent clock or drop idle TimelineView.
- **MEDIUM** — Large parts of `DesignSystem` are dead (all Font tokens, `v1Fluid/v2Fluid/v3Fluid/effectFill/clearance`, most Spacing) while `CompartmentCanvas`/`DataTooltip` hardcode colors — so tooltip legend dots don't match curve colors. Route through `AppColors` or delete tokens.
- **LOW** — Mini-chart `maxConc`/`maxRate` can be 0 on all-zero series → divide-by-zero NaN (coerced to a flatline, not a crash). Floor to a small positive value.
- **LOW** — Force unwraps in drawing paths (`ChartCanvas.swift:149,155`; `CompartmentSceneView.swift:441`); use guard-let.
- **INFO** — Tapping the chart locks the user into target-drag mode until Cancel/Done, disabling scrub with no affordance.
- **INFO** — Pervasive magic numbers for padding/radius/size despite the existing `Spacing` scale.

### Build & project hygiene
- **MEDIUM** — `MockData/*.json` snapshots are not actually bundled — the nested `includes` glob doesn't match, so `loadSnapshot`'s `Bundle.main` lookups would return nil.
- **MEDIUM** — The whole MockData pipeline is dead code compiled into the binary (`MockDataGenerator` has zero callers). Delete it or wire it into previews/tests.
- **MEDIUM** — Duplicate, already-diverging PK generators: root `generate_mock_data.swift` reimplements the models with different parameterization than `MockPKEngine` (clearances-vs-rate-constants), unguarded by any test. Establish one source of truth + a golden-file test.
- **LOW** — No lint/format config and no CI; `SWIFT_STRICT_CONCURRENCY: complete` is set with nothing surfacing its warnings.
- **LOW** — User-specific Xcode state committed (`xcuserdata/…xcuserstate`, `xcschememanagement.plist`); `.gitignore` has no Xcode section.

### Cross-cutting (deduplicated)
- **No automated tests** surfaces in three dimensions (Feature, PK/PD, Build): no test target in `project.yml`, no XCTest/`import Testing`, despite `04_Validation_Reference.md` providing exact expected values. This is the root enabler of the Schnider V3 error and is called out again under priorities.
- **No accessibility** surfaces in two dimensions (Feature, SwiftUI): zero accessibility modifiers anywhere; Canvas charts and icon-only controls are invisible to VoiceOver; fixed small fonts ignore Dynamic Type — notable for a medical/App Store context.

## Recommended priorities

1. **Fix Schnider V3 (`v3 = 238000`) and add a PK regression test suite.** Safety-critical and cheap; assert every model's `PKParams` for standard male/female/elderly against `04_Validation_Reference.md`, plus invariants (non-negative amounts, `Cp_ss = R/Cl1`, `Ce` peak near `1/ke0`). This both fixes the bug and installs the guard that would have caught it. While here, apply the Schnider-V2 age term and Hannivoort V3/Cl3 allometric scaling.
2. **Fix the playback Task leak** (`deinit`/`onDisappear` + `[weak self]`) and **serialize/cancel simulation re-runs.** Both are live defects on the main interactive screen — one leaks and spins forever, the other races shared output.
3. **Resolve the `.xcodeproj` vs `project.yml` signing drift.** Choose a single source of truth and parameterize `DEVELOPMENT_TEAM` via xcconfig/CI so a documented regenerate doesn't ship unsigned or leak the Team ID. Add a standard Xcode `.gitignore`.
4. **Decide effect-site targeting: implement or hide.** The app's Ce premise currently maps to `.plasma`-only simulation. Either add the target-type selector + bisection-on-Ce-peak algorithm, or remove the effect-site affordance so the UI doesn't imply a missing capability.
5. **Cut SceneKit per-frame cost and unfreeze 2D compartments.** Wrap only the 2D canvas in TimelineView, build SCNText once (toggle `isHidden`), drop the per-frame `SCNTransaction`, and hoist a single time cursor into `AppState` so playback drives both tabs.
6. **Add accessibility and clean up dead ends.** VoiceOver labels/values on steppers, target node, playback, and a chart summary representation; then either wire or hide the stub controls (Saved Simulations, Edit Drug List, info button, `example.com` links) and delete the dead MockData pipeline and vestigial `AppState` fields.
