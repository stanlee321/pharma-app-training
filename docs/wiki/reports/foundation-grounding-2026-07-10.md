---
type: report
updated: 2026-07-10
tags: [report, grounding, build, foundation]
---
# Foundation Grounding — Code-Truth for the Phase A Build (2026-07-10)

> **Verdict.** The plan-derived screen specs mostly hold as *intent*, but they systematically overstate what already exists to reuse: every N1+ screen route except `.patientInput` is net-new, and the whole encounter/case/author domain the specs hang screens on **does not exist anywhere in the codebase** (grep: 0 hits for `CaseStore|author|encounter|Encounter|.login`). That is the **single blocker**: `.encounterList` / `.encounterHub(UUID)` cannot resolve without a `CaseStore` and an `AnesthesiaCase` model built from scratch. Everything else is **14 corrections** (wrong symbol names, private-vs-protocol methods, missing tokens, "reuse an existing List/Chart" claims that don't match the real widgets) and a handful of nits — all mechanical to fix once the foundation adds the right seams. **Phase A is safe to design now**, provided the foundation lands the shopping list in §3 (DesignSystem tokens, `AcceleratingRepeatButton`, `MockCaseStore` + 9 DTOs, the full `Route` enum up front, ~6 shared components, Login + Author) so that per-screen agents never touch `Route.swift` / `RootView.swift` and never re-invent tokens. Two live quantitative engine bugs (Schnider V3 10× too small, V2 age-term omitted) mean the TCI chip's Schnider maintenance-infusion number is wrong today — flagged, not Phase-A-blocking, but must be tracked.

---

## 1. Reuse-verbatim surface — what already exists (do NOT rebuild)

Real signatures with `file:symbol`. This is the load-bearing reuse surface; the foundation and per-screen agents build **on** it, not **beside** it.

### Nav / state (`PharmaApp/App/`)
- **`Route`** — `PharmaApp/App/Route.swift:4-9`. `enum Route: Hashable { case drugSelection; case patientInput; case simulation; case compartmental }`. Exactly 4 payload-free cases → `Hashable` is auto-synthesized. `.patientInput` **already exists** — do not re-add.
- **`AppState`** — `PharmaApp/App/AppState.swift:4-5`. `@MainActor @Observable final class AppState`. Instantiated once (`PharmaApp.swift:5`) and injected via `.environment(appState)` (`PharmaApp.swift:10`). New screens read `@Environment(AppState.self) private var appState`.
- **AppState stored surface** — `AppState.swift:9-41`: `drugModels`, `selectedDrugIndex`, `selectedDrug` (computed), `patient: PatientProfile`, `simulationOutput: SimulationOutput?`, `targets: [TargetEvent]`, `isSimulating`, `currentTime`/`isPlaying`/`playbackSpeed` (playback), `let engine: any PKEngineProtocol = EngineProvider.shared` (**cached** handle). Actions: `onDrugSelected()`, `runInitialSimulation() async`, `runSimulation(with:) async`. **No `navigationPath`, no case/author/encounter concept.**
- **`navigationPath` owner** — `RootView.swift:8`. `@State private var navigationPath = NavigationPath()`, owned by `RootView`, threaded as `@Binding` into `DrugSelectionView`/`PatientInputView`/`SimulationView`. Push: `navigationPath.append(Route.patientInput)`; back: `navigationPath.removeLast()`.
- **The single nav edit point** — `RootView.swift:11-25`. `NavigationStack(path:)` whose **root is a hardcoded view literal `DrugSelectionView(navigationPath: $navigationPath)`** (line 12), plus a `.navigationDestination(for: Route.self)` switch. Every new pushed screen adds a `case` here.
- **One-time overlay gate** — `RootView.swift:6,26-37`. `@AppStorage("hasSeenAnnouncement_v1")` + `@State showLaunchModal` + `.overlay { if … LaunchModalView(isPresented:onDismiss:) }` + `.onAppear` gate. This is the *mechanism* the login spec clones (not the marketing content).

### Design system (`PharmaApp/Utilities/DesignSystem.swift`, 61 lines)
- **Curve colors** — `plasma` (`:7`, #00D4FF cyan), `effect` (`:8`, #4ADE80 green), `infusion` (`:9`, #FB923C orange), `target` (`:10`, #3B82F6 blue). Symbol names are `plasma`/`effect`/`infusion`/`target` — **not** `plasmaColor`/`cyan`.
- **Surfaces/fluids** — `targetDashed`(11), `v1Fluid` #EF4444(14, only existing danger-red), `v2Fluid`/`v3Fluid`, `effectFill`(17, dup of `effect`), `clearance`(18), `darkBg`/`darkCard`(20-21), `gridLine`/`gridLineMajor`/`axisText`(23-25).
- **`Font`** ext (31-36) — `drugTitle`, `modelName`, `sectionHeader`(33, `= .headline`), `numericValue`(34, `.system(.body, .monospaced).bold()`), `axisLabel`, `tinyLabel`. `sectionHeader`/`numericValue` **are declared** (not missing).
- **`Haptics`** (42-50) — `tap()` (light), `targetSnap()` (medium), `confirm()` (success). All three spec-referenced fns present **verbatim**.
- **`Spacing`** (56-59) — `screen=16`, `section=20`, `item=12`, `tight=4`.

### Reusable idioms (Views + Utilities)
- **Hold-to-accelerate engine** — `PharmaApp/Utilities/StepperRow.swift`. `startAccelerating(delta:)` (77-95): 3 verbatim tiers `5×150ms → 10×80ms → while !cancelled 50ms(delta×5)`, each tick `MainActor.run`. `stopAccelerating()` (97-100) cancels the `Task`. `stepButton` (44-69) is 48×48 (meets 44pt), wired via `LongPressGesture(0.3).onEnded` + `.onLongPressGesture(minimumDuration:.infinity, pressing:)`. `adjust(by:)` (71-75) clamps + `.snappy(0.15)`; **no haptic on accel ticks**. Depends on global `clamped(to:)` defined in `AppState.swift:89`. Wired to **dilution only** (`PatientInputView.swift:135`).
- **Card scaffold** — `PatientInputView.swift` (repeated 101,144,213,356): `.padding(14).background(Color(.systemBackground), in: RoundedRectangle(cornerRadius: 14))`.
- **Section header** — literal uppercase `Text("DILUTION").font(.caption2.bold()).tracking(0.5)` + 24×24 icon-in-`opacity(0.12)`-rect (`PatientInputView.swift:112-122`). `DrugSelectionView.metadataCard` (166-193) uses `.uppercased()` + 28×28 icon — the real reusable row template (there is **no List**).
- **Selection chip precedent** — `genderButton` (`PatientInputView.swift:310-323`), selected fill hardcoded `Color.blue`(318), ~33pt tall. `genderRow` (282-308) is a **non-Binding** read+write-closure control.
- **Segmented host** — `SimulationView.swift`: `enum SimTab`(9-12) + `@State activeTab`(7) + hand-rolled `HStack`-of-Buttons `segmentedControl`(107-129). Dark-themed (`AppColors.darkCard` pill, `.preferredColorScheme(.dark)` at line 23).
- **Chart** — `ChartCanvas` (`ChartCanvas.swift:4-13`), dual-Y Canvas hardcoded to `CurvePoint` (`plasmaConcentration`/`effectConcentration`/`infusionRate` at 179/187/147). Liftable helpers: `xForTime`(53-56, internal), `yForConcentration`(58-61, internal), `niceSteps`(318-333), `formatAxisValue`(335-340). `concentrationUnit`(8) is declared but **unused**.

### Models / engine (`PharmaApp/Models/`, `PharmaApp/Engine/`)
- **`PatientProfile`** — `PatientProfile.swift:3-14`. `struct PatientProfile: Codable, Sendable { var weight; var height; var age; var gender: Gender; var dilution }`. Field is **`gender`** (enum `.male`/`.female`), **not `sex`**; also carries `dilution` the specs never mention. `leanBodyMass` (18-26) is a **computed** extension (not encoded). `.defaultMale`/`.defaultFemale` (29-35).
- **`DrugModel`** — `DrugModel.swift:4-28`. `id` (e.g. `"propofol_marsh"`) is the Identifiable UI key; **`rustModelId`** (`"marsh"`/`"schnider"`/`"minto"`/`"hannivoort"`) is what the engine takes. `DrugDatabase.load()` (31-123) uses `.convertFromSnakeCase` on a fresh `JSONDecoder` (:39) with `hardcoded` fallback.
- **`SimulationTypes`** — `SimulationTypes.swift`. `CurvePoint`(6), `SimulationOutput`(17), `TCIResult`(35-42, the dose-chip payload), `TargetEvent`(45), `TargetType`(51), `ValidationRules`(57), `ConcentrationUnit`(69) — all `Codable, Sendable`, **camelCase, NO CodingKeys**. snake_case is a **coder-boundary** concern, not a type property (proof: `MockDataGenerator.swift:80,97-98`).
- **`PKEngineProtocol`** — `PKEngineProtocol.swift:5-33`. Four members: `simulate(...) async`, **`computeTCI(...)` (SYNC, safe on the 60fps/main path)**, `validationRules(for:)`, `var availableModelIds`. `computeTCI` takes `targetConcentration` in **display units** (divides by `displayFactor` internally) and `currentState:[x1,x2,x3,Ce]` in **mg** (pass `[0,0,0,0]` for a fresh recommendation).
- **Chip entry point** — `MockPKEngine.computeTCI` (`MockPKEngine.swift:278-307`), the public protocol method. Call via `appState.engine.computeTCI(modelId: drug.rustModelId, patient: appState.patient, currentState:[0,0,0,0], targetConcentration:, targetType:)`.

---

## 2. Spec corrections — claim vs reality

**Blockers first.** Severity legend: **B** = blocker (build/design cannot proceed as specced), **C** = correction (will not compile / wrong reuse target), **N** = nit.

| # | Sev | Spec claim | Reality (code-truth) | Fix | Page to patch |
|---|-----|------------|----------------------|-----|---------------|
| 1 | **B** | Specs hang new screens on an existing encounter/case/author domain (encounter list, hub, per-case ledger). | `grep CaseStore\|author\|encounter\|Encounter` across `PharmaApp/**` = **0 hits**. `AppState` models a **single** in-flight simulation, not a keyed collection. `.encounterHub(UUID)` has nothing to look the UUID up in. | Build the domain from scratch: `AnesthesiaCase`/`Encounter` model (owns the `UUID`), an `@Observable @MainActor MockCaseStore`, and persistence. Net-new foundation, not reuse. | [[encounter-hub]], [[screens-index]] |
| 2 | C | N1 re-roots the spine as `.drugSelection → .login → .encounterList` (`.drugSelection` is the launch root Route). | There is **no root Route**. `NavigationStack` root is the hardcoded view literal `DrugSelectionView(navigationPath:)` (`RootView.swift:12`); the `.drugSelection` case is **dead** (never appended). | Re-rooting = **replace the root view literal at `RootView.swift:12`** with `LoginView(...)`/`EncounterListView(...)`, and add `.login`/`.encounterList` switch cases. Not "insert a route before `.drugSelection`". | [[screens-index]], [[proposed-screens]] |
| 3 | C | `AppState` is/can-be the owner of `navigationPath`; screens read the path from `AppState`. | `AppState` has **no `navigationPath`**; it's `@State` local to `RootView` (`:8`) passed by `@Binding`. | Either add `var navigationPath = NavigationPath()` to `AppState` and bind `NavigationStack(path: Bindable(appState).navigationPath)` (**preferred** for the deeper login→list→hub spine with programmatic resets), or keep the `@Binding` pattern and wire every new screen `navigationPath: $navigationPath`. **Decide once, up front.** | [[architecture]], [[screens-index]] |
| 4 | C | Add `.encounterHub(UUID)` / `.technique(TechniqueZone)` while keeping `Route: Hashable`. | Auto-`Hashable` holds only if every payload is `Hashable`. `UUID` is fine; **`TechniqueZone` does not exist** (0 hits). | Declare `enum TechniqueZone: String, Hashable, Sendable, CaseIterable { case general, neuraxial, peripheral }` **before** using it as a payload. No manual `==`/`hash(into:)` needed. | [[technique-general]], [[screens-index]] |
| 5 | C | Reuse `MockPKEngine.computeBET` for the TCI dose chip. | `computeBET` is **private** (`MockPKEngine.swift:161`), first param is the internal `PKParams` struct — not on the protocol, not callable from view/DTO code. | Call `appState.engine.computeTCI(...)` → read `TCIResult`. Drop all `computeBET` references; it's an impl detail behind `computeTCI` and won't exist on `RustPKEngine`. | [[drug-ledger]], [[technique-general]], [[ux-components]] |
| 6 | C | `PatientProfile` holds `weight/height/age/**sex**`. | Field is **`gender`** (`PatientProfile.swift:7`); there is no `sex`. Also carries stored `dilution`; LBM is computed, not stored. | Any `.sex` reference **won't compile** — use `.gender`. If the wire contract uses `sex`, map with explicit `CodingKeys { case gender = "sex" }` on the DTO, or standardize the server on `gender`. | [[patient-data]], [[rest-contract]], [[drug-ledger]] |
| 7 | C | Engine surface = simulate/computeTCI/computeBET/validationRules. | Fourth member is the computed `var availableModelIds`; `computeBET` is not on the protocol. | Wire the chip to `computeTCI` + `validationRules` only; treat `availableModelIds` as the fourth member. | [[rest-contract]], [[ux-components]] |
| 8 | C | `SimulationTypes`/the 9 DTOs provide snake_case round-trip as a **type** property. | No struct declares `CodingKeys`; snake_case works only because **callers** set `.convertFromSnakeCase`/`.convertToSnakeCase` (`MockDataGenerator.swift:80,97`; `DrugDatabase.swift:39`). | The `MockCaseStore`/REST client must own a `JSONDecoder`/`JSONEncoder` with the snake_case strategies. DTOs stay camelCase + no CodingKeys. | [[rest-contract]] |
| 9 | C | `AppColors` exposes `selectionTint`/`invalidTint`/`fieldFill`/`controlStroke`/`surfaceDerived`. | **None exist** (confirmed by grep — only the curve/surface set is present). | Add all five as foundation tokens (see §3a), derived from existing primitives. | [[ux-components]] |
| 10 | C | `Font.cellValue` exists. | **Missing.** `Font` ext has `sectionHeader`/`numericValue`(bold) but no `cellValue`. | Add `static let cellValue = Font.system(.body, design: .monospaced)` (non-bold sibling), or point cells at `numericValue`. | [[ux-components]] |
| 11 | C | `Spacing` exposes `tapTarget(44)` and `cell(8)`. | **Missing both** (only `screen/section/item/tight`). | Add `static let tapTarget: CGFloat = 44` and `static let cell: CGFloat = 8`. | [[ux-components]] |
| 12 | C | N1 reuses "the list idiom from `DrugSelectionView`"; CheckboxGroupRow's row grounds in it. | `DrugSelectionView` has **no List** — drug pick is a `.pickerStyle(.wheel)` Picker; rows are `metadataCard` **cards**. | Build N1's list new (`List`/`LazyVStack` of `AnesthesiaCase`), reusing `metadataCard`/the card scaffold as the row template. Only the empty `Saved Simulations` closure (`DrugSelectionView.swift:226-229`) is genuinely liftable. | [[proposed-screens]], [[ux-components]] |
| 13 | C | N5 Monitoring reuses `ChartCanvas` for a `VitalsChartCanvas`. | `ChartCanvas` is hardcoded to `CurvePoint`'s 3 PK series + concentration/infusion Y-axes; not generic over HR/SpO2/MAP. | Generalize `ChartCanvas` to `[ChartSeries]`, **or** write `VitalsChartCanvas` reusing only `xForTime`/`niceSteps`/`formatAxisValue`/grid+cursor. Don't point it at `ChartCanvas` as-is. | [[proposed-screens]], [[ux-components]] |
| 14 | C | N6 `EditableDrugTable` add-row reuses SimulationView's "+ Target" add-row. | "+ Target" (`SimulationView.swift:390-400`) is a single toolbar button entering a **drag-to-place-on-chart** mode — no inline table, no row insert. | Build the add-row new; only "a + button appends to a `@State` collection + `Haptics.tap()`" transfers. | [[proposed-screens]], [[ux-components]] |
| 15 | C | Schema/forms JSON bundling is covered by the existing `resources` config. | `resources` glob `*.json` matches **only top-level** `PharmaApp/Resources/` (not `Resources/Schema/*.json`); source schema lives **outside** the app tree at `notebooks/forms/schema/*.json`. | Copy files into `PharmaApp/Resources/` (top-level, matched) or `PharmaApp/Resources/Schema/` + add `includes: "Schema/*.json"`; then `xcodegen generate`. | [[rest-contract]] |
| — | N | `Font.numericValue`/`sectionHeader` are "dead". | Declarations confirmed present; **usage not checked**. Don't re-declare; grep call sites before acting on "unused". | | |
| — | N | `genderButton` hardcodes `.blue`. | Confirmed at `PatientInputView.swift:318`. Alias `selectionTint = target` and replace. | | [[ux-components]] |
| — | N | Accel loop fires `Haptics.tap()` "verbatim … on every step". | Haptic fires only on the tap (`StepperRow.swift:47`); accel ticks are **silent**. Per-step haptic is an intentional **addition**, not a carry-over. | | [[ux-components]] |
| — | N | N4a/N5 reuse the segmented-control host as-is. | Reusable as a pattern but dark-themed (`darkCard` pill, `.preferredColorScheme(.dark)`). Extract a generic `SegmentedControl<Tab>` and re-theme for light form screens. | | [[proposed-screens]] |
| — | N | New folders/files auto-included after `xcodegen generate`. | **TRUE** — `sources` is a directory scan of `PharmaApp` (excl. `Resources/MockData`). New `.swift`/folders need only `xcodegen generate`, no `project.yml` edit. | | |
| — | N | `xcodebuild` destination is `iPhone 15`. | May be unavailable on the Xcode 16.0 toolchain (iPhone 16 family default). Pick an installed sim via `xcrun simctl list devices available`. | | |

**Pages to patch (dedup):** [[screens-index]], [[proposed-screens]], [[ux-components]], [[rest-contract]], [[encounter-hub]], [[patient-data]], [[drug-ledger]], [[technique-general]], [[architecture]].

---

## 3. Phase A shopping list (concrete additions)

### (a) DesignSystem tokens to ADD — exact declarations
Append to the existing `enum AppColors` / `extension Font` / `enum Spacing` in `PharmaApp/Utilities/DesignSystem.swift` (same `static let` pattern):

```swift
// AppColors — derive from existing primitives, do not invent fresh literals
static let selectionTint  = target                       // #3B82F6, reuse target blue (:10) — replaces genderButton's .blue
static let invalidTint    = v1Fluid                      // #EF4444, the only existing danger-red (:14)
static let fieldFill      = Color.white.opacity(0.06)    // input background over darkBg
static let controlStroke  = Color.white.opacity(0.12)    // == existing gridLine value (:23)
static let surfaceDerived = Color.white.opacity(0.08)    // one step above darkCard

// Font
static let cellValue = Font.system(.body, design: .monospaced)   // non-bold sibling of numericValue

// Spacing
static let tapTarget: CGFloat = 44   // HIG minimum
static let cell: CGFloat = 8         // between tight(4) and item(12)
```
(Note: `effect` and `effectFill` hold identical RGB — consider collapsing to avoid drift, optional.)

### (b) `AcceleratingRepeatButton` — extraction surface (new file `PharmaApp/Utilities/AcceleratingRepeatButton.swift`)
Lift the accel engine **verbatim** from `StepperRow.swift:77-100`; generalize to a standalone button so weight/height/age steppers, `HourlyFluidGrid`, `EditableDrugTable`, `CheckboxValueRow` all share it:

```swift
struct AcceleratingRepeatButton: View {
    let systemName: String
    let onStep: () -> Void
    @State private var task: Task<Void, Never>?
    // tap → onStep() + Haptics.tap()
    // .simultaneousGesture(LongPressGesture(minimumDuration: 0.3).onEnded { start() })
    // .onLongPressGesture(minimumDuration: .infinity, pressing: { if !$0 { stop() } })
    // start() = verbatim tiers: 5×150ms → 10×80ms → while !cancelled 50ms (delta×5),
    //           calling onStep() + Haptics.tap() EACH tick (per-step haptic is the intended ADD)
}
```
Frame all ± buttons at `>= Spacing.tapTarget`; `PatientInput.compactStepperButton` (40pt, `:271`) is currently sub-44 and must be replaced. `clamped(to:)` resolves globally (defined in `AppState.swift:89`).

### (c) `MockCaseStore` + the 9 Codable DTOs + snake_case convention
- **Coder factory** (shared boundary, mirrors the two existing inline call sites):
```swift
enum CaseJSON {
    static let decoder: JSONDecoder = { let d = JSONDecoder(); d.keyDecodingStrategy = .convertFromSnakeCase; d.dateDecodingStrategy = .iso8601; return d }()
    static let encoder: JSONEncoder = { let e = JSONEncoder(); e.keyEncodingStrategy = .convertToSnakeCase; e.dateEncodingStrategy = .iso8601; return e }()
}
```
- **Store** — `@MainActor @Observable final class MockCaseStore { var encounters: [AnesthesiaCase] = []; func encounter(id: UUID) -> AnesthesiaCase? }`. Owned by `AppState` (`let caseStore = MockCaseStore()`) or injected via its own `.environment(...)` at `PharmaApp.swift:10`. **This is what `.encounterHub(UUID)` resolves against.**
- **9 DTOs** — new files in `PharmaApp/Models/`, each `Codable, Sendable` (+ `Identifiable` where keyed), **camelCase props, NO CodingKeys** (snake_case handled by `CaseJSON`), following the `SimulationTypes` template exactly. Root: `struct AnesthesiaCase: Codable, Sendable, Identifiable { let id: UUID; var patient: PatientProfile; … }` — **embed `PatientProfile` directly** (already `Codable+Sendable`), don't fork a parallel patient type. If the wire uses `sex`, add `CodingKeys { case gender = "sex"; case weight, height, age, dilution }` on the patient-facing DTO.

### (d) Full `Route` enum to declare UP FRONT (so per-screen agents never touch `Route.swift`/`RootView.swift`)
Extend `PharmaApp/App/Route.swift` and the `RootView.swift:14-23` switch **once** in the foundation pass:
```swift
enum Route: Hashable {
    case drugSelection, patientInput, simulation, compartmental   // existing — keep
    case login, encounterList
    case encounterHub(UUID)
    case preAssessment
    case technique(TechniqueZone)
    case monitoring, drugLedger, fluidBalance, recoveryScore, newbornRecord, reviewExport
}
```
Requires `TechniqueZone` (see §3f) declared first so auto-`Hashable` holds. `.patientInput` already exists — do NOT re-add. Wire each new pushed screen with `navigationPath: $navigationPath` in the switch (or via `AppState.navigationPath` if decision #3 goes that way).

### (e) ~6 shared components (build once, in foundation)
1. `AcceleratingRepeatButton` (§3b).
2. `SectionHeader` — fold the duplicated `Text(...).caption2.bold().tracking(0.5)` + 24×24 icon-in-`opacity(0.12)`-rect header.
3. `CardStyle` / card modifier — fold `radius 14 / padding 14 / systemBackground` (4 duplicate literals).
4. Generic `SegmentedControl<Tab: CaseIterable & Hashable>` — re-themed light-mode extraction of `SimulationView.segmentedControl`.
5. `ChartSeries` + series-agnostic chart input (or a parallel `VitalsChartCanvas` reusing `xForTime`/`niceSteps`/`formatAxisValue`).
6. `CheckboxGroupRow` / selection-chip — generalize `genderButton` (swap `.blue → selectionTint`, non-Binding read+write precedent).

### (f) Login + Author
- **`TechniqueZone`** — new `PharmaApp/Models/TechniqueZone.swift`: `enum TechniqueZone: String, Hashable, Sendable, CaseIterable { case general, neuraxial, peripheral }`.
- **Login gate** — make `LoginView` the `NavigationStack` **root** (`RootView.swift:12`), driven by an `@AppStorage("isLoggedIn_v1")` / `@Observable` auth flag, swapping to `EncounterListView` when authed. Reuse the `.overlay + @AppStorage + onDismiss` idiom **only if** login is a one-time skippable modal; a real gate is a root view, not an overlay.
- **Author** — an `Author`/user identity `struct Author: Codable, Sendable, Identifiable` referenced by `AnesthesiaCase`; net-new (0 hits today).

---

## 4. Build gate

Phase A ships iff this compiles — **there is no test target**, so `build` success **is** the gate (`project.yml` has no `schemes:`; XcodeGen auto-generates the `PharmaApp` scheme; no `DEVELOPMENT_TEAM` needed for a simulator build):

```bash
xcodegen generate && \
xcodebuild -project PharmaApp.xcodeproj -scheme PharmaApp \
  -destination 'platform=iOS Simulator,name=iPhone 16' build
# substitute an installed device from: xcrun simctl list devices available
```
Run `xcodegen generate` after ANY file/folder add (new `.swift` isn't in the target otherwise — directory scan of `PharmaApp/`, only `Resources/MockData` excluded; new `Services/`/`Models/` folders auto-included, no `project.yml` edit).

**Strict-concurrency constraints** (`SWIFT_STRICT_CONCURRENCY: complete`, `project.yml:30`; iOS 17.0 min):
- Every DTO crossing the engine seam or stored in `@MainActor AppState` must be `Sendable` (value-type structs — the `SimulationTypes` pattern).
- New UI-owned state (`MockCaseStore`, auth) must be `@MainActor @Observable` (like `AppState`) or hand back `Sendable` values.
- Use `@Observable` + `.environment(...)` (iOS-17 model), **not** `ObservableObject`/`@Published`.
- `TechniqueZone` must be `Hashable` (Route payload) and ideally `Sendable`.

---

## 5. Pilot readiness — Login + N3 Preanesthetic against `MockCaseStore` (no backend)

**Can they compile/run today with zero backend?** Yes, once the §3 foundation lands — both are pure client-side against an in-memory store. Nothing in either path requires the Rust engine or a network.

Concretely:
- **Login** — root-view swap at `RootView.swift:12` + `@AppStorage("isLoggedIn_v1")` flag. No store dependency; clones the proven `hasSeenAnnouncement` gating idiom. Compiles/runs standalone.
- **N3 Preanesthetic** — a form screen over `PatientProfile` (already `Codable+Sendable`, `.defaultMale` seed) writing into an `AnesthesiaCase` held by `MockCaseStore.encounters` (in-memory, no persistence needed for the pilot). Reuses the card scaffold + `AcceleratingRepeatButton` + section-header components. The TCI dose chip, if shown here, routes through `appState.engine.computeTCI(...)` → `MockPKEngine` (safe: `useMock == true`).

**Blockers to clear before pilot build (all in §3, none external):**
1. **`MockCaseStore` + `AnesthesiaCase` must exist** — without them N3 has nowhere to write and `.encounterHub(UUID)` can't resolve (spec-mismatch #1, the sole blocker). This is the gating dependency for the pilot.
2. **Full `Route` enum + `TechniqueZone`** declared up front (§3d/f) so N3's push nav compiles and per-screen agents don't touch `Route.swift`.
3. **DesignSystem tokens** (§3a) — N3 uses `selectionTint`/`fieldFill`/`controlStroke`/`cellValue`/`tapTarget`; absent today → won't compile if referenced.
4. **`nav path` ownership decision** (#3) — pick AppState-owned vs RootView-`@Binding` before wiring Login→EncounterList→N3, else programmatic reset (logout, select-encounter) is awkward.

**Non-blocking but track:** Schnider **V3 = 23800.0** (`MockPKEngine.swift:69`, should be 238000.0 — 10× too small → `k31` ~10× too large) and **V2 age-term omitted** (`:68`, fixed 18900.0, should be `(18.9 − 0.391·(age−53))·1000`). The Schnider maintenance-infusion the chip shows is quantitatively wrong; the bolus (`targetCp·V1`) is unaffected. `RustPKEngine` is a pure `fatalError` stub — do not flip `EngineProvider.useMock` (`:6`) to `false`.
