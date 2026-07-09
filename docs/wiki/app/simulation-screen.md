---
type: page
updated: 2026-07-09
tags: [app]
---

# Simulation Screen

The interactive PK/PD graph: a scrubbable Cp/Ce concentration chart with a draggable
TCI target node, live bolus/infusion readouts, and playback. It is the app-side analogue
of the parsed anaesthetic chart — where [[parsing]] reconstructs a `TransanestheticRecord`
vitals grid from an *existing* PDF, this screen *generates* the same kind of time-series
from a live PK model and lets the user edit it by touch.

Files: `PharmaApp/ViewModels/SimulationViewModel.swift`, `PharmaApp/Views/Simulation/SimulationView.swift`,
`PharmaApp/Views/Simulation/ChartCanvas.swift`, `PharmaApp/Views/Simulation/DataTooltip.swift`.

---

## Composition

`SimulationView` is a `@State`-owned-VM screen. It reads `AppState` from the environment
(`@Environment(AppState.self)`) and lazily constructs its `SimulationViewModel` in `onAppear`
(the VM is `@State private var vm: SimulationViewModel?`, `nil` until first appearance, so
the body renders a black `ProgressView` placeholder until then). The whole screen is forced
dark (`.preferredColorScheme(.dark)`) with a hidden nav bar and a custom back button that
pops `navigationPath` — see [[state-navigation]].

A segmented control (`SimTab`) switches between **Graph** (this page) and **Compartments**
(`CompartmentalView`, documented in [[compartmental-screen]]). Only the Graph tab uses the
scrubbing/target machinery below.

On `.task`, if `appState.simulationOutput == nil` the view seeds a **default plasma target**
(`0.5 ng/ml` for `.ngPerMl` drugs, else `3.0`) and calls `appState.runSimulation` so the
chart is never empty, then calls `vm.autoScaleAxes()`.

---

## SimulationViewModel

`@MainActor @Observable final class` (`SimulationViewModel.swift`). It holds no simulation
data of its own — `drug`, `patient`, `output`, and `targets` are all computed pass-throughs
to `AppState`. Its own state is purely *interaction* state: chart axis maxima, the cursor,
the in-progress drag target, and playback.

### Cursor & scrubbing

The cursor is stored as a **fraction** `cursorTimeFraction ∈ [0,1]`, converted to seconds by
`cursorTimeSeconds = cursorTimeFraction * timeRangeMinutes * 60`. Two derived lookups drive
all readouts:

- `valuesAtCursor` finds the `CurvePoint` whose `time` is nearest `cursorTimeSeconds` via a
  linear `indices.min(by:)` scan — O(n) on every access, and it is read from many view
  bodies (status dashboard, tooltip, `currentState`).
- `activeTargetAtCursor` returns the last `TargetEvent` with `time <= cursorTimeSeconds`
  (targets sorted ascending) — i.e. the target "in effect" at the cursor.

Scrubbing is wired in `SimulationView.chartGesture`: when **not** dragging a target, a
`DragGesture(minimumDistance: 5)` maps `location.x` to `cursorTimeFraction` (clamped 0–1).
Tapping the chart (`onTapGesture`) both moves the cursor **and** begins a target edit at the
tapped concentration (see below).

### Target node drag → live `computeTCI`

The defining behaviour of this screen: while the user drags the target node, the VM recomputes
the TCI dosing **synchronously on every drag delta**. `onTargetDragChanged(concentration:)`
sets `isDraggingTarget = true`, clamps the concentration to `>= 0`, and calls
`appState.engine.computeTCI(...)` (returns `TCIResult?` — a *synchronous* call, unlike the
`async` `simulate`), storing it in `pendingTCIResult`. That result feeds the live "Bolus /
Target / Infusion" readout row (`SimulationView.tciReadouts`, only shown while dragging).

`currentState` — the compartment state handed to `computeTCI` — is built from `valuesAtCursor`
as `[amountV1, amountV2, amountV3, effectConcentration]` (falls back to `[0,0,0,0]`). Note the
first three are amounts (mg) but the fourth is the effect-site *concentration*, matching the
engine's expected state vector; see [[engine]] / [[pk-engine-math]].

Every drag/tap-created target is hardcoded `targetType: .plasma`. `TargetType.effectSite`
exists in [[models]] but the Simulation UI never produces it.

Entry points that start a drag:
- **Tap on chart** (`onTapGesture`): sets cursor fraction from x, converts y to a concentration
  (`yFrac * maxConcentration`), calls `onTargetDragChanged`.
- **"+ Target" button** → `beginAddTarget()`: seeds `dragTargetConcentration` from the active
  target, else the last target, else the per-unit default (`0.5`/`3.0`), sets
  `isDraggingTarget`, and computes an initial `pendingTCIResult`.
- **Vertical drag** while `isDraggingTarget` (in `chartGesture`): converts y to concentration
  and fires a `Haptics.targetSnap()` when the value crosses a 0.1 rounding boundary.

### Nudge

`nudgeTarget(by:)` adds a delta (clamped `>= 0`) to `dragTargetConcentration` and re-runs
`onTargetDragChanged` (so the TCI readout updates too). The up/down chevron buttons pass
`nudgeAmount = maxConcentration * 0.02` (2% of the current concentration axis).

### Add / remove targets (commit path)

- `onTargetDragConfirmed()` ("Done"): builds a `TargetEvent` at `cursorTimeSeconds`,
  **replaces any existing target within a 5s tolerance** (`filter { abs($0.time - t) > 5 }`),
  appends, sorts, then `Task { await appState.runSimulation(with:); autoScaleAxes() }`. This is
  the async round-trip through the engine that redraws the curves.
- `onTargetDragCancelled()` ("Cancel"): drops `isDraggingTarget`, zeroes the drag concentration,
  clears `pendingTCIResult` — no simulation re-run.
- `removeTarget(at:)`: removes by index; if it was the **last** target it clears
  `appState.targets` and `simulationOutput` outright (empty chart), otherwise re-simulates.
- `removeTargetAtCursor()`: finds the target nearest the cursor, then locates it in the source
  array by matching **both** `time` and `concentration` (float equality — safe here only because
  the value came from that same array). Wired to the minus button, which is shown only when
  `targets.count > 1 && activeTargetAtCursor != nil`.

### Playback with speed cycling

`togglePlayback()` flips `isPlaying` and starts/stops a `Task<Void, Never>` (`playbackTask`).
`startPlayback()` cancels any prior task, then loops while `!Task.isCancelled && isPlaying`:
sleeps `16ms` (~60fps) and advances the cursor by
`advance = (playbackSpeed / (timeRangeMinutes*60)) * 0.016`, clamped to `1.0`; on reaching the
end it sets `isPlaying = false`. Because `playbackSpeed` is read **inside** the loop,
`cycleSpeed()` (which walks `[1,2,4,8]` mod-4) takes effect immediately without restarting the
task. Gotcha: the per-tick step uses a hardcoded `0.016s` regardless of real elapsed time, so
playback speed is nominal, not wall-clock-accurate.

### autoScaleAxes / ceilToNice

`autoScaleAxes()` sets the three axis maxima from the current output + targets:
- `maxConcentration = ceilToNice(max(maxCp, maxCe, dragTargetConcentration, maxTargetC) * 1.3)`
- `maxInfusionRate = ceilToNice(maxInfusionRate_of_points * 1.3)` (from raw `infusionRate`, mg/min)
- `timeRangeMinutes = max(ceil(lastPointTime / 60), 10)` — since `runSimulation` always requests
  `timeRangeSeconds: 3600` ([[state-navigation]] / `AppState.runSimulation`), this settles to ~60.

`ceilToNice(_:)` rounds a value up to the nearest 1/2/5/10 × power-of-ten (same "nice number"
logic as `ChartCanvas.niceSteps`, duplicated rather than shared).

---

## ChartCanvas — the custom Canvas chart

`ChartCanvas.swift` is a single SwiftUI `Canvas` that imperatively draws everything; there is
no SwiftUI `Charts` framework use. Inputs are plain value params (`points`, axis maxima,
`cursorFraction`, `targetConcentration`, `targetMarkers`, `compact`). This is the direct
counterpart to the parsed vitals grid in [[parsing]] — same dual-track "concentration over time
+ event markers" shape, drawn instead of parsed.

**Layers, in draw order** (`body`): grid → axes labels → (if points) infusion area → Cp/Ce
curves → inline end-labels → target line → target markers → cursor.

### Coordinate mapping & dual Y axes

- `xForTime(t)` maps seconds → x via `t / (timeRangeMinutes*60)`.
- `yForConcentration(c)` maps against `maxConcentration` (**left** axis).
- `yForInfusionRate(r)` maps against `maxInfusionRate` (**right** axis).

Two independent Y scales share the plot rect: concentration on the left (`AppColors.axisText`),
infusion rate on the right (`AppColors.infusion.opacity(0.8)`, non-compact only). X labels are
minutes.

### Curves and infusion area

- **Cp** (plasma) — `AppColors.plasma` cyan, thick (2.5pt).
- **Ce** (effect) — `AppColors.effect` green, thinner (1.5pt).
- **Infusion** — drawn as a **filled area** to the baseline (`AppColors.infusion.opacity(0.1)`
  fill + solid 1.5pt top stroke), non-compact only. All curve/area points are clamped to the
  plot rect (`max(minY, min(maxY, y))`) so out-of-range values pin to the edges.

Inline `Cp`/`Ce` end-labels are drawn just past the right edge, with a 14pt vertical offset
applied to `Ce` if it would overlap `Cp`.

**Unit gotcha:** the infusion area plots `infusionRate * 60` (`drawInfusionArea`) and
`DataTooltip` shows `infusionRate * 60` labelled `ml/hr`, but `CurvePoint.infusionRate` is
documented as **mg/min** ([[models]]) and `autoScaleAxes` derives `maxInfusionRate` from the raw
mg/min values (no ×60). So the right-axis scale and the plotted area are in different units; the
×60 area is routinely much larger than `maxInfusionRate` and gets clamped toward the top of the
rect. Treat the infusion area as indicative, not quantitatively aligned to its axis labels.

### Target line & markers

- `drawTargetLine` renders the **active/dragging** target as a horizontal **dashed** line
  (`AppColors.targetDashed`, hand-rolled 6/4 dash) with a value label on the left axis, only
  when `targetConcentration > 0`.
- `drawTargetMarkers` renders **every** committed `TargetEvent`: a faint vertical dashed line at
  its time, a filled **triangle** on the X-axis, a very faint horizontal dashed line at its
  concentration, and (non-compact) a small value label under the triangle.
- `drawCursor` is a solid vertical line in `AppColors.target` at `cursorFraction`.

`niceSteps(max:count:)` generates axis tick values (1/2/5/10 × power-of-ten). `compact` shrinks
margins, tick counts, and line widths, and drops the right axis / infusion area / inline labels —
that mode is used by the mini-chart in [[compartmental-screen]].

### Target node overlay (drawn in the View, not the Canvas)

The draggable node itself is **not** part of `ChartCanvas`; it is a SwiftUI overlay in
`SimulationView.chartSection`, positioned over the canvas only while `isDraggingTarget`:

- a translucent **glow ring** (44pt, `AppColors.target.opacity(0.2)`),
- the **node** (18pt filled `AppColors.target` with a soft `shadow`),
- a monospaced value **capsule** pinned at `x + 40`.

Its position is computed from `cursorTimeFraction` and `dragTargetConcentration / maxConcentration`
using **hardcoded margins** (`chartLeft/Right = 45`, `chartTop = 16`, `chartBottom = 28`) that
must stay in sync with `ChartCanvas`'s non-compact margins — the two are separate constants, so
changing margins in one place silently misaligns the node.

---

## DataTooltip

`DataTooltip.swift` is the floating readout that follows the cursor when **not** dragging a target
(`SimulationView.chartSection` gates it on `!isDraggingTarget && valuesAtCursor != nil`). It shows
the cursor time plus color-dotted rows for **Cp**, **Ce**, and **Rate** (`infusionRate * 60`,
labelled `ml/hr`). To avoid running off-screen it is offset left (`cursorX - 80`) when the cursor
is past the halfway point, else right (`cursorX + 80`), pinned near the top of the plot.

Minor drift: `DataTooltip` hardcodes `.cyan` / `.green` / `.orange` rather than pulling
`AppColors.plasma` / `.effect` / `.infusion` from the design system ([[design-system-build]]);
they happen to be visually close but are not the same constants.

---

## Drift vs docs

- **Engine is the mock.** All curves and every live TCI readout on this screen come from
  `MockPKEngine`: `EngineProvider.useMock == true` (`Engine/EngineProvider.swift`) and every
  `RustPKEngine` method is a `fatalError("RustPKEngine not yet implemented...")` stub
  (`Engine/RustPKEngine.swift`). Any claim that this screen shows Rust-computed pharmacokinetics
  is false today. See [[engine]] and [[pk-engine-math]].
- **Infusion units** are inconsistent between the axis scale (mg/min) and the plotted/tooltip
  values (×60, labelled ml/hr) — documented under ChartCanvas above.
- **`niceSteps` / `ceilToNice`** are duplicated across `ChartCanvas` and `SimulationViewModel`,
  and chart margins are duplicated across `ChartCanvas` and `SimulationView`.

## See also

[[architecture]] · [[state-navigation]] · [[engine]] · [[pk-engine-math]] · [[models]] ·
[[compartmental-screen]] · [[input-screens]] · [[design-system-build]] · [[parsing]]
