---
type: page
updated: 2026-07-09
tags: [app]
---

# Input Screens

The input flow is the first two screens of the navigation stack plus a one-time launch overlay. Order of appearance: `LaunchModalView` (overlay) → `DrugSelectionView` (Route root) → `PatientInputView` → `SimulationView`. All three input surfaces read and mutate the single shared `AppState` (`PharmaApp/App/AppState.swift`), so their edits are live: there is no local form buffer that gets "submitted". See [[state-navigation]] for the `Route` enum and stack wiring, [[models]] for the data types, and [[engine]] for the simulate call.

---

## DrugSelectionView

`PharmaApp/Views/DrugSelection/DrugSelectionView.swift` — `struct DrugSelectionView`.

Screen 2 (the stack root, pushed by `RootView` in `PharmaApp/App/RootView.swift`). It picks which `DrugModel` (drug + PK/PD model pair) the whole session runs on.

### Layout (top → bottom)
- **`drugHeader`** — accent pill, drug name (`drug.drug`), model name (`drug.model`), and a concentration-unit badge (`drug.concentrationUnit.rawValue`). Accent color comes from the private `drugAccentColor(_:)` switch: propofol→blue, remifentanil→orange, dexmedetomidine→teal, else gray. Animated on `appState.selectedDrugIndex`.
- **`metadataSection`** — a vertical `ScrollView` of structured cards (see below).
- **`pickerSection`** — the wheel picker.
- **`bottomBar`** — two `Label` buttons, "Edit Drug List" and "Saved Simulations". Both have empty action closures (`Button { }`) — they are non-functional placeholders.

### Wheel picker
`pickerSection` binds a `Picker(selection: $state.selectedDrugIndex)` with `.pickerStyle(.wheel)` over `appState.drugModels.enumerated()`, tagging each row by integer offset and labeling with `model.pickerLabel` (`DrugModel.pickerLabel` renders `"Propofol [Marsh]"`). `.onChange(of: appState.selectedDrugIndex)` fires `Haptics.tap()` and `appState.onDrugSelected()` on every scroll tick, so the header/metadata update live as the wheel turns.

### Metadata cards
Built by two overloaded private `metadataCard(...)` helpers (one takes a plain `value: String`, one takes a `@ViewBuilder` for rich content). Cards rendered, in order:
- **Description** (`drug.description`).
- **Publication** — this is the only conditional card with special handling. `metadataSection` does `drug.publication.url.flatMap { URL(string: $0) }`; if that yields a valid URL it renders `drug.publication.title` plus a tappable SwiftUI `Link`, otherwise it falls back to a plain-text card showing just the title. Gotcha: in the bundled/hardcoded data only `propofol_marsh` has a non-nil `url` (`https://eurosiva.eu`); Schnider, Minto, and Hannivoort have `url: nil` and thus render the text fallback. See `DrugDatabase.hardcoded` in `PharmaApp/Models/DrugModel.swift`.
- **Comment** (`drug.comments ?? "None"`; colored gray when "None", else orange).
- **Manual dosing** — only if `drug.manualDosingRules != nil`.
- **Target effects** — only if `!drug.targetEffects.isEmpty`; renders each string as a green capsule chip.

### SELECT button → AppState
The trailing toolbar item labeled **"SELECT 1"** does: `Haptics.confirm()`, `appState.onDrugSelected()`, then `navigationPath.append(Route.patientInput)`. That is the only write this screen makes to selection state beyond the picker binding — and note `onDrugSelected()` already ran on the picker's `onChange`, so the SELECT call is redundant but harmless.

`AppState.onDrugSelected()` (`PharmaApp/App/AppState.swift`) is the important side effect: it resets `patient.dilution = drug.defaultDilutionMgMl` and **clamps** `patient.weight/height/age` into the newly selected model's `validationRules` ranges via the `Comparable.clamped(to:)` extension. So switching models can silently pull patient values in-bounds before the patient screen is even shown.

**Drift vs docs:** the navigation title is hardcoded `"Select Drug 1"` and the button `"SELECT 1"`, implying a multi-drug (drug-combination) selector, but only a single `selectedDrugIndex` exists in `AppState` — multi-drug selection is not implemented.

---

## PatientInputView

`PharmaApp/Views/PatientInput/PatientInputView.swift` — `struct PatientInputView`.

Screen 3. This is the screen that populates `PatientProfile` (`PharmaApp/Models/PatientProfile.swift`). It edits `appState.patient` **in place** through `@Bindable` bindings — there is no separate profile object constructed on exit.

`body` reads `let drug = appState.selectedDrug` and `let rules = drug.validationRules` once, then lays out four cards in a `ScrollView`: `drugCard`, `dilutionCard`, `patientDataCard`, `modelInfoFooter`.

### Dilution stepper
`dilutionCard(drug:)` shows the `drug.preparationRecipe` (if any) and a single **`StepperRow`** bound to `$state.patient.dilution`. Step and format are unit-dependent: `drug.concentrationUnit == .ngPerMl ? step 0.001 / "%.4f"` else `0.5 / "%.1f"`, range `0.001...100`. Gotcha: the unit label passed to `StepperRow` is hardcoded `"mg/ml"` regardless of `concentrationUnit`. This is the **only** row on the screen that uses `StepperRow` (and therefore the only one with hold-to-accelerate — see below).

### Biometric steppers (weight / height / age)
`patientDataCard(rules:)` renders three rows via the private `parameterRow(...)` helper (NOT `StepperRow`) for Weight, Height, Age, each bound to `$state.patient.weight/height/age`. Each row's `+`/`−` are `compactStepperButton`s whose action does:

```
value.wrappedValue = (value.wrappedValue ± step).clamped(to: range)
```

with `step = 1` and `range` taken from the per-model rules (`rules.minWeight...rules.maxWeight`, `rules.minHeight...rules.maxHeight`, `rules.minAge...rules.maxAge`). So per-model `validationRules` clamping is enforced on every tap, matching the clamp `onDrugSelected()` applied on entry.

**Gotcha / drift:** these biometric buttons are plain single-increment taps — they do **not** accelerate on hold. Hold-to-accelerate lives only in `StepperRow`, which here is wired to dilution alone. Any framing of the biometric steppers as "accelerating" describes the dilution row, not weight/height/age.

### Gender toggle
`genderRow` is a two-button segmented control (`genderButton("Male"/"Female")`) that writes `appState.patient.gender = .male/.female` directly, inside `withAnimation` + `Haptics.tap()`. `PatientProfile.Gender` is a `String` enum (`male`/`female`).

### Model requirements footer
`modelInfoFooter(drug:rules:)` shows three `requirementBadge`s (weight/height/age ranges from `rules`), and conditional footnotes when `!rules.requiresHeight` ("does not use height…") or `!rules.requiresGender` ("does not use gender…"). Gotcha: these flags are **advisory text only** — the height and gender inputs are always shown and editable even for models that ignore them (e.g. Marsh/Hannivoort have `requiresHeight:false, requiresGender:false`). Nothing is hidden or disabled.

### "Done" and the initial engine call
The trailing toolbar **"Done"** button does NOT build or submit a `PatientProfile` (it is already live-bound). It does: `Haptics.confirm()`, then resets `appState.simulationOutput = nil`, `appState.targets = []`, `appState.currentTime = 0`, and `navigationPath.append(Route.simulation)`.

The actual engine call is triggered **indirectly** by `SimulationView` (`PharmaApp/Views/Simulation/SimulationView.swift`): its `.task` sees `appState.simulationOutput == nil` (just cleared by Done), synthesizes a default `TargetEvent` (concentration 0.5 for `ngPerMl`, else 3.0, type `.plasma`), and calls `appState.runSimulation(with:)`, which invokes `engine.simulate(...)` on `EngineProvider.shared`. See [[simulation-screen]] and [[engine]].

**Drift vs docs:** `AppState.runInitialSimulation()` exists and looks like the intended "kick off the first sim" entry point, but nothing calls it — the real path goes through `runSimulation(with:)` from `SimulationView.task`. Also note the engine is the mock: `EngineProvider.useMock == true`, so `RustPKEngine` (a `fatalError` stub in `PharmaApp/Engine/RustPKEngine.swift`) is never constructed. See [[engine]] and [[pk-engine-math]].

### Back navigation
The leading toolbar button hides the default back button (`.navigationBarBackButtonHidden()`) and instead calls `navigationPath.removeLast()` under a "Select Drug" chevron label.

---

## StepperRow

`PharmaApp/Utilities/StepperRow.swift` — `struct StepperRow`.

A reusable labeled numeric row: `label`, `@Binding var value: Double`, `unit`, `step`, `range: ClosedRange<Double>`, `format`. Value is displayed monospaced with `.contentTransition(.numericText())` for animated digit rolls. Both `+`/`−` are built by the private `stepButton(systemName:delta:)`.

### Hold-to-accelerate
This is the non-obvious part. Each `stepButton`:
1. Plain tap → `adjust(by:)` (single step, `Haptics.tap()`).
2. A `.simultaneousGesture(LongPressGesture(minimumDuration: 0.3))` whose `onEnded` calls `startAccelerating(delta:)`.
3. A second `.onLongPressGesture(minimumDuration: .infinity, pressing:)` whose `pressing` closure calls `stopAccelerating()` on release (the `.infinity` duration means `perform` never fires; it exists only to observe press/release).

`adjust(by:)` applies `value = (value + delta).clamped(to: range)` inside `withAnimation(.snappy)`, so acceleration also respects the range clamp.

`startAccelerating(delta:)` runs a cancellable `Task` (`@State private var timerTask`) with a three-phase ramp, each tick hopping to `MainActor` to call `adjust`:
- 5 ticks @ 150 ms (1× step),
- 10 ticks @ 80 ms (1× step),
- then indefinitely @ 50 ms at **5× step** (`delta * 5`).

`stopAccelerating()` cancels and nils the task. Note there is **no** separate `AcceleratingRepeatButton` type — the accelerating behavior is entirely inside `StepperRow` via this `Task` ramp.

---

## LaunchModalView

`PharmaApp/Views/LaunchModal/LaunchModalView.swift` — `struct LaunchModalView`.

A one-time announcement overlay ("Important message" — TivatrainerX being replaced). It is a dimmed `ZStack` card, not a sheet; the dim background has an empty `.onTapGesture` that deliberately blocks tap-through so it cannot be dismissed by tapping outside.

### Presentation & AppStorage gating
Presented by `RootView` (`PharmaApp/App/RootView.swift`), not by the input screens themselves:
- `@AppStorage("hasSeenAnnouncement_v1") private var hasSeenAnnouncement`.
- `.onAppear { if !hasSeenAnnouncement { showLaunchModal = true } }`.
- `.overlay { if showLaunchModal { LaunchModalView(isPresented: $showLaunchModal) { hasSeenAnnouncement = true } } }`.

So it appears once per install (until the AppStorage flag flips) on top of `DrugSelectionView`. Gotcha: the persisted key is `"hasSeenAnnouncement_v1"` (versioned), not something like "hasSeenLaunchModal".

### Buttons
- **"More info"** and **"Claim your discount"** call the private `openURL(_:)` → `UIApplication.shared.open` with placeholder URLs `https://example.com/info` and `https://example.com/discount`. These are stubs.
- **"Continue with TivatrainerX"** (bordered-prominent) calls the `onDismiss` closure (which sets `hasSeenAnnouncement = true`) and animates `isPresented = false`. This is the only real dismissal path.

**Drift vs docs:** the "More info"/"Claim your discount" links point at `example.com` placeholders, not real endpoints.

---

## Related pages
[[architecture]] · [[state-navigation]] · [[models]] · [[engine]] · [[pk-engine-math]] · [[simulation-screen]] · [[compartmental-screen]] · [[design-system-build]] · [[parsing]]
