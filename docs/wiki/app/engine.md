---
type: page
updated: 2026-07-09
tags: [app]
---

# PK Engine Abstraction

The PK/PD math engine sits behind a single protocol seam so the rest of the
app never talks to a concrete implementation. Two implementations exist today:
`MockPKEngine` (pure-Swift, ships and runs — see [[pk-engine-math]]) and
`RustPKEngine` (a crash-on-call stub). A one-line switch, `EngineProvider`,
picks between them.

## The protocol seam

`PKEngineProtocol` (`PharmaApp/Engine/PKEngineProtocol.swift`) is a `Sendable`
protocol with four members. Everything upstream — `SimulationViewModel`,
`CompartmentalViewModel`, `MockDataGenerator` — depends only on this surface,
not on any concrete engine.

- **`simulate(modelId:patient:targets:timeRangeSeconds:resolutionSeconds:) async -> SimulationOutput?`**
  Runs a full simulation over one or more `TargetEvent`s and returns time-series
  curves for graphing/animation. It is `async` (the heavy path) and returns an
  optional so a bad model id / failure surfaces as `nil` rather than a throw.
- **`computeTCI(modelId:patient:currentState:targetConcentration:targetType:) -> TCIResult?`**
  The fast path. Given the current compartment state it returns the bolus +
  infusion needed to reach a target concentration. Its doc comment pins a hard
  budget: **"Must return in < 16ms for 60fps drag interaction."** Note it is
  **synchronous** (no `async`) precisely so a drag gesture can call it inline per
  frame without awaiting. `currentState` is a positional `[Double]` =
  `[x1, x2, x3, Ce]` amounts in mg — an untyped array because it mirrors the raw
  FFI call shape (see below).
- **`validationRules(for modelId:) -> ValidationRules?`**
  Returns the patient-parameter bounds for a model (weight/height/age min-max,
  `requiresHeight`, `requiresGender`). Consumed by the input screens — see
  [[input-screens]].
- **`var availableModelIds: [String] { get }`**
  The list of model ids the engine supports (e.g. `marsh`, `schnider`, `minto`,
  `hannivoort`).

## Choosing the implementation: `EngineProvider`

`EngineProvider` (`PharmaApp/Engine/EngineProvider.swift`) is a bare enum with
one flag and one accessor:

- `static let useMock = true`
- `static var shared: any PKEngineProtocol` — returns `MockPKEngine()` when
  `useMock` is true, else `RustPKEngine()`.

Two non-obvious points:

1. **`shared` is a computed `var`, not a stored singleton.** Every read
   constructs a fresh engine instance. Both engines are stateless `final class`es
   so this is harmless today, but it is not a cached shared object despite the
   name.
2. **`useMock` is `true` in the shipped code**, so the whole app runs on
   `MockPKEngine`. This is the intended state until the Rust library lands.

## `RustPKEngine` is a `fatalError` stub

`RustPKEngine` (`PharmaApp/Engine/RustPKEngine.swift`) is
`final class RustPKEngine: PKEngineProtocol, @unchecked Sendable`. Its header
comment describes the eventual design — call the Rust `pk-engine` static library
via C-FFI (`libpk_engine.a` linked, `pk_engine.h` bridging header) — but **none
of it is implemented**. Every method body is a `fatalError`:

- `simulate(...)` → `fatalError("RustPKEngine not yet implemented. Use MockPKEngine.")`
- `computeTCI(...)` → same `fatalError`
- `validationRules(for:)` → same `fatalError`

The one member that is *not* a stub is the stored property
`let availableModelIds = ["marsh", "schnider", "minto", "hannivoort"]` — reading
it is safe. Only the three functional methods crash.

**Consequence:** flipping `EngineProvider.useMock` to `false` does **not** fail
at compile time or at construction — `RustPKEngine()` builds fine. It crashes
the process the first time any view model calls `simulate`, `computeTCI`, or
`validationRules`, which is immediately on any real screen. Do not flip the flag
until the Rust FFI is actually wired.

### Drift vs docs

- `EngineProvider.swift`'s comment says *"Flip `useMock` to `false` once the Rust
  library is integrated."* That library is not integrated; the code path it
  enables is a `fatalError` stub. The **code truth is `useMock = true` and Rust
  is non-functional.**
- `RustPKEngine.swift`'s header presents it as the "production" engine "that
  calls the Rust `pk-engine` static library." In reality it is a TODO skeleton —
  no FFI, no linked library, no bridging header. Treat any doc that calls it
  production as aspirational.

## Why the swap is call-site-transparent: `SimulationTypes`

The whole point of the seam is that swapping Mock → Rust requires **zero call-site
changes**. That works because the data types crossing the seam are defined once
in `PharmaApp/Models/SimulationTypes.swift`, whose header comment is explicit:
`// MARK: - Core Types (mirrors Rust FFI contract)`. These `Codable, Sendable`
structs/enums are laid out to match what the Rust C-FFI will return:

- `SimulationOutput` — `points: [CurvePoint]` plus compartment volumes
  (`v1Volume/v2Volume/v3Volume`) and rate constants (`k10, k12, k21, k13, k31,
  ke0`) for animation.
- `CurvePoint` — one time sample: `time`, `plasmaConcentration`,
  `effectConcentration`, `amountV1/V2/V3`, `infusionRate`.
- `TCIResult` — bolus and infusion expressed six ways (mg, ml, mcg/kg, mg/hr,
  ml/hr, mcg/kg/hr).
- `TargetEvent` + `TargetType` (`plasma` / `effectSite`), `ValidationRules`,
  `ConcentrationUnit`.

Because `computeTCI`'s `currentState` is the positional `[x1, x2, x3, Ce]` mg
array — matching `CurvePoint.amountV1/V2/V3` plus the effect-site amount — the
same argument marshals straight into a C array when Rust arrives. See [[models]]
for the full type catalog and [[pk-engine-math]] for how `MockPKEngine`
currently produces these values.

## `MockDataGenerator`: snapshot JSON

`MockDataGenerator` (`PharmaApp/Engine/MockDataGenerator.swift`) is a dev-only
enum that materializes `SimulationOutput`s to JSON on disk, for SwiftUI previews
and unit tests that must not run the live engine.

- **`generateAll(outputDir:) async`** instantiates `MockPKEngine()` **directly**
  (it bypasses `EngineProvider`) and runs five fixed scenarios, writing each to a
  named file:
  1. `marsh`, `.defaultMale`, target 4.0 plasma → `marsh_70kg_target4_plasma.json`
  2. `marsh`, step 4→6→2 plasma over 30 min → `marsh_70kg_multitarget.json`
  3. `hannivoort` (dex), 80kg, dilution 0.004, target 0.8 plasma →
     `hannivoort_80kg_target08ng.json`
  4. `schnider`, 60kg female, dilution 10.0, target 3.0 effect-site →
     `schnider_60kg_target3_effect.json`
  5. `minto` (remi), 70kg male, dilution 0.02, target 4.0 effect-site →
     `minto_70kg_target4ng_effect.json`

  All use `timeRangeSeconds: 1800` (30 min) at `resolutionSeconds: 1.0`.
- **`write(_:to:)`** encodes with `keyEncodingStrategy = .convertToSnakeCase` and
  `outputFormatting = [.prettyPrinted, .sortedKeys]` — so the on-disk JSON is
  snake_case, stable-ordered, and diff-friendly. Both `encode` and `write` are
  `try?`, so failures are silently skipped.
- **`loadSnapshot(named:) -> SimulationOutput?`** reads a snapshot back: it first
  tries `Bundle.main.url(forResource:withExtension:)` with the raw filename, then
  falls back to the `MockData` subdirectory (stripping `.json`). Decodes with
  `keyDecodingStrategy = .convertFromSnakeCase`. The snake_case ↔ camelCase
  strategies on both sides are what keep the round-trip lossless.

## Related

- [[pk-engine-math]] — the actual PK/PD math inside `MockPKEngine`.
- [[models]] — `SimulationTypes`, `PatientProfile`, and the FFI-mirroring types.
- [[architecture]] / [[state-navigation]] — where `EngineProvider.shared` is
  consumed by the view models.
- [[simulation-screen]], [[compartmental-screen]], [[input-screens]] — the
  screens driven by `simulate` / `computeTCI` / `validationRules`.
