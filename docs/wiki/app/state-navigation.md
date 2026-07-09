---
type: page
updated: 2026-07-09
tags: [app]
---

# App State & Navigation

How TivaTrainer boots, holds its single source of truth, and moves between screens. Four files in `PharmaApp/App/`: `PharmaApp.swift` (entry), `AppState.swift` (state), `RootView.swift` (navigation + launch gate), `Route.swift` (destinations). See [[architecture]] for the wider layering.

## Entry point

`PharmaApp` in `PharmaApp/App/PharmaApp.swift` is the `@main` `App`. It owns exactly one piece of state — `@State private var appState = AppState()` — and its single `WindowGroup` renders `RootView()` with `.environment(appState)`. That `.environment(_:)` call is the only injection point: every screen reads the same `AppState` instance out of the SwiftUI environment. There is no scene phase handling, no deep-link handling, and no secondary window.

## AppState — the single source of truth

`AppState` in `PharmaApp/App/AppState.swift` is a `@MainActor @Observable final class`. `@Observable` (the Observation macro, iOS 17) means views that touch a property re-render when that property changes; `@MainActor` pins all access to the main actor, which is why the async simulation actions (below) can mutate `simulationOutput`/`isSimulating` directly without hopping actors. It is the whole app's mutable state; screens inject it via `@Environment(AppState.self)` (e.g. `RootView`).

Stored state, grouped by the screen that drives it:

- **Drug database & selection** — `drugModels: [DrugModel]` is seeded eagerly from `DrugDatabase.load()` (see [[parsing]] / [[models]]). Selection is held as an index, `selectedDrugIndex: Int`, not as a `DrugModel`. The computed `selectedDrug` guards the index with `drugModels.indices.contains(...)` and falls back to `drugModels[0]` if out of range — so an invalid index is safe, but an *empty* `drugModels` would crash on the `drugModels[0]` fallback.
- **Patient profile** — `patient` (a `PatientProfile`, see [[models]]) initialized to `PatientProfile.defaultMale`.
- **Simulation state** — `simulationOutput: SimulationOutput?` (nil until a run completes), `targets: [TargetEvent]`, and `isSimulating: Bool` as the in-flight flag.
- **Playback** — `currentTime: Double` (seconds; the scrubber/time cursor), `isPlaying: Bool`, `playbackSpeed: Double = 1.0`. `AppState` only *holds* these; the play/pause loop lives in the simulation UI (see [[simulation-screen]]).
- **Engine handle** — `let engine: any PKEngineProtocol = EngineProvider.shared`. A single existential, resolved once at init. See [[engine]].

### Drift vs docs — the engine is a mock

`EngineProvider.shared` resolves to the mock: `EngineProvider.useMock` is `true`, and `RustPKEngine` is a `fatalError` stub. So every simulation in `AppState` actually runs through `MockPKEngine`, regardless of the `rustModelId` passed below. Any doc that implies a real Rust PK core is aspirational — the code path is mock-only. Details in [[engine]] and [[pk-engine-math]].

## Actions

Three methods, all on `AppState`:

- **`onDrugSelected()`** — call after changing `selectedDrugIndex`. It resets `patient.dilution` to the new drug's `defaultDilutionMgMl`, then **clamps** `patient.weight`, `.height`, and `.age` into the new drug's `validationRules` ranges (`minWeight...maxWeight`, etc.). Clamping keeps a patient configured for one drug valid when switching to a drug with a narrower range. It does **not** re-run the simulation. Clamping uses the file-local `Comparable.clamped(to:)` helper defined at the bottom of `AppState.swift` (`min(max(self, lower), upper)`).
- **`runInitialSimulation() async`** — sets `isSimulating = true`, `await`s `engine.simulate(...)`, stores the result in `simulationOutput`, resets `currentTime = 0`, then clears `isSimulating`. **Not called anywhere** — the actual first simulation runs through `runSimulation(with:)`, invoked from `SimulationView`'s `.task` (see [[simulation-screen]], [[input-screens]]). The `///` doc-comment ("after patient input is confirmed") states the intent, not the wiring.
- **`runSimulation(with newTargets:) async`** — assigns `targets = newTargets` first, then runs the same `engine.simulate(...)` call. Unlike the initial run it does **not** reset `currentTime`, preserving the scrubber position across a re-simulate.

Both simulate calls pass fixed run parameters: `timeRangeSeconds: 3600` (60 min) and `resolutionSeconds: 1.0` (one sample/second → ~3600 points). `modelId:` is `selectedDrug.rustModelId` (consumed by the mock but not used to branch math — see [[engine]]). Gotcha: neither action guards against concurrent/overlapping calls — nothing checks `isSimulating` before starting, so a rapid double-trigger can fire two overlapping `simulate` tasks and the last to finish wins.

## Navigation

`Route` in `PharmaApp/App/Route.swift` is a `Hashable enum` with four cases: `.drugSelection`, `.patientInput`, `.simulation`, `.compartmental`. `Hashable` is the requirement for pushing values onto a `NavigationPath`.

`RootView` in `PharmaApp/App/RootView.swift` owns the stack:

- `@State private var navigationPath = NavigationPath()` is the type-erased path, driving a `NavigationStack(path: $navigationPath)`.
- The stack root is `DrugSelectionView(navigationPath: $navigationPath)` — the binding is threaded down so child screens push routes themselves (see [[input-screens]]).
- A single `.navigationDestination(for: Route.self)` switches on the route: `.drugSelection` → `DrugSelectionView`, `.patientInput` → `PatientInputView`, `.simulation` → `SimulationView` (all handed the `$navigationPath` binding), and `.compartmental` → `CompartmentalView(embedded: false)`.

Note the asymmetry: `CompartmentalView` is passed `embedded: false` (full-screen pushed presentation) and does **not** receive `navigationPath`, whereas the other three do. `embedded` distinguishes the pushed full screen from an inline-embedded variant — see [[compartmental-screen]]. Also note `DrugSelectionView` appears twice (as the root *and* as the `.drugSelection` destination); the root instance is what you normally see, the destination case exists for completeness.

## Launch-modal gate

`RootView` gates a one-time announcement modal:

- `@AppStorage("hasSeenAnnouncement_v1") private var hasSeenAnnouncement = false` persists to `UserDefaults` under the versioned key `hasSeenAnnouncement_v1` (the `_v1` suffix lets a future announcement reset the gate by bumping to `_v2`).
- `@State private var showLaunchModal = false` is transient in-session visibility.
- `.onAppear` sets `showLaunchModal = true` only when `!hasSeenAnnouncement`.
- An `.overlay` renders `LaunchModalView(isPresented: $showLaunchModal)` while `showLaunchModal` is true; its completion closure sets `hasSeenAnnouncement = true`, so the modal never reappears on later launches.

Gotcha: the persisted flag is written in the modal's **completion closure**, not merely on dismiss — so `showLaunchModal` (in-session) and `hasSeenAnnouncement` (persisted) are set at the same moment by the same callback. Whatever `LaunchModalView` decides counts as "dismissed" is what marks the announcement seen (see [[input-screens]] for the modal itself).

## See also

- [[architecture]] — where this subsystem sits in the layering
- [[engine]] / [[pk-engine-math]] — what `engine.simulate(...)` actually runs
- [[models]] — `DrugModel`, `PatientProfile`, `SimulationOutput`, `TargetEvent`, `validationRules`
- [[simulation-screen]] / [[compartmental-screen]] / [[input-screens]] — the screens routed here
- [[parsing]] — `DrugDatabase.load()`
