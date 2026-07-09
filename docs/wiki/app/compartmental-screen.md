---
type: page
updated: 2026-07-09
tags: [app]
---

# Compartmental Animation

An animated schematic of the PK model as a set of fluid-filled cylinders (V1 central,
V2 rapid peripheral, V3 slow peripheral) plus an effect site and an IV syringe, wired
with pipes that carry flowing particles. It renders the *same* simulation output as the
plasma/effect curve, but spatially: how much drug sits in each compartment and how fast
it moves between them at the scrubbed time. Two interchangeable renderers back it — a 2D
SwiftUI `Canvas` (pseudo-3D) and a real SceneKit 3D scene — toggled by `use3D`.

Source: `PharmaApp/ViewModels/CompartmentalViewModel.swift`,
`PharmaApp/Views/Compartmental/CompartmentalView.swift`,
`PharmaApp/Views/Compartmental/CompartmentCanvas.swift` (2D),
`PharmaApp/Views/Compartmental/CompartmentSceneView.swift` (3D).

## Where it lives

`CompartmentalView` renders two ways, controlled by its `embedded: Bool` (default `true`):

- **Embedded**: `SimulationView.simulationContent` mounts `CompartmentalView()` behind a
  Graph ↔ Compartments segmented control (`SimulationView.swift`). No close button.
- **Standalone**: `RootView` mounts `CompartmentalView(embedded: false)`, which shows an
  `xmark` button that calls `@Environment(\.dismiss)` (`CompartmentalView.toolbar`).

The view lazily builds its `CompartmentalViewModel` in `.onAppear` (`CompartmentalView.body`),
holding it in `@State private var vm`; until then it shows a black screen.

## Data source (all from the mock engine)

Everything is derived from `appState.simulationOutput` (`CompartmentalViewModel.output`),
which is produced upstream by the PK engine. See [[engine]] and [[pk-engine-math]]; the
per-point fields (`CurvePoint`) and run-level fields (`SimulationOutput`) are defined in
`PharmaApp/Models/SimulationTypes.swift` — see [[models]]. Units matter: `amountV1/V2/V3`
are **mg**, `v1Volume/v2/v3` are **ml**, rate constants `k10/k12/k21/k13/k31/ke0` are
**1/min**, `infusionRate` is **mg/min**, concentrations are display units.

**Drift vs docs:** `SimulationTypes` comments call itself the "Rust FFI contract," but the
data actually comes from the mock engine (`RustPKEngine` is a `fatalError` stub;
`EngineProvider.useMock` is `true`). This screen never touches Rust. See [[engine]].

## CompartmentalViewModel

`@MainActor @Observable final class CompartmentalViewModel`. Pulls nothing itself — it is
a computed projection over `output`. Safe fallbacks when `output == nil`: volumes default
to `1`, rate constants to `0` (`v1`…`ke0` properties).

### Timeline / cursor

- `cursorFraction: Double` (0…1) is the only mutable time state; there is **no autoplay**
  here (unlike [[simulation-screen]]'s `SimulationViewModel`, which has a playback loop).
- `cursorTimeSeconds = cursorFraction * timeRangeMinutes * 60`.
- `timeRangeMinutes` defaults to `30`, but `init` overrides it to
  `max(ceil(lastPoint.time / 60), 10)` so the axis spans the whole run.
- `currentPoint` picks the `CurvePoint` whose `time` is nearest `cursorTimeSeconds`
  (`pts.indices.min(by: abs time diff)`) — a linear scan, recomputed on every access.

### Fill fractions (amounts → 0…1)

`fillV1/V2/V3` normalize the current compartment amount to a single global scale:

- `maxAmount` (private) = the max over **all** points of `max(amountV1, amountV2, amountV3)`,
  floored at `0.001`. This is a shared denominator, so the three cylinders are directly
  comparable — the fullest cylinder at the peak-loaded instant reads ~100%.
- `fillVn = min(amountVn / maxAmount, 1.0)`, or `0` if there is no `currentPoint`.

`fillEffect` is the odd one out: it normalizes `effectConcentration` against
**max plasma concentration** (`maxCp = max of plasmaConcentration`), not max effect
concentration — `min(effectConcentration / maxCp, 1.0)`. So the effect orb is scaled
relative to peak *plasma* Cp, deliberately (it will never look "full" if Ce peaks below
Cp). This is a real semantic gotcha, not a bug per se.

### Sizes mode scaling (V1/V2/V3)

`sizeScaleV1/V2/V3` drive the "Sizes" toggle. When `showSizes` is off they return `1.0`
(uniform cylinders). When on, `scaleVn = max(vn / max(v1,v2,v3), 0.3)` — each cylinder is
scaled proportional to its **volume**, with a `0.3` floor so a tiny compartment stays
visible. These are the same numbers fed to both renderers.

### Particle positions

`particles(rate:count:speed:)` returns fractional positions (0…1) along a pipe, phased by
`cursorTimeSeconds`, empty when `rate <= 0`. **Gotcha: this method is dead code** — no
caller exists. Both renderers compute their own particle motion independently
(`CompartmentCanvas.drawPipe` in 2D; `SCNParticleSystem` in 3D).

`formatTime` renders `hh:mm:ss` for the bottom time label.

## use3D toggle

`renderModeToggle` (`CompartmentalView`) is a 2-segment control setting `vm.use3D`
(`false` = 2D, default). `compartmentSection` branches on it inside a
`TimelineView(.animation(minimumInterval: 1.0/30.0))`: `use3D` → `CompartmentSceneView`,
else `CompartmentCanvas`. Both receive the same fills, size scales, `infusionRate` (from
`currentPoint?.infusionRate`), toggle flags, volumes, and `time = cursorTimeSeconds`.

**Gotcha — rate constants only reach 2D.** `CompartmentCanvas` is passed
`k12/k21/k13/k31/k10/ke0`; `CompartmentSceneView` is **not**. The 3D scene animates pipe
flow at a constant birth rate regardless of PK, whereas 2D particle speed/count/direction
are PK-driven.

**Gotcha — the 30fps `TimelineView` does little in 2D.** 2D particle phase is a pure
function of `cursorTimeSeconds`, which is fixed unless the user scrubs. So 2D particles
sit frozen while paused; the ticker only forces a redraw. In 3D, `SCNParticleSystem` runs
on SceneKit's own real-time clock, so pipes keep flowing even when the cursor is static.

## 2D renderer — CompartmentCanvas

A single SwiftUI `Canvas` (`CompartmentCanvas.body`). Layout is hard-coded around
`center = (0.5w, 0.45h)`: V1 centered, V2 top-right, V3 bottom-right, effect site left,
syringe far left; base cylinder 60×90 pt scaled by `scaleVn`.

- **Cylinders** (`drawCylinder`): a translucent rounded-rect "glass" body + a bottom-up
  fluid fill whose height = `rect.height * fill`, painted with a 3-stop linear gradient
  and a left-edge highlight for a pseudo-3D look. `showLabels` draws the "V1/V2/V3" tag;
  `showSizes` draws `"<volume> ml"` under it; `showData` overlays the fill percentage.
- **Effect site** (`drawEffectSite`): a diamond, green fill at `0.3 * fill` opacity.
- **Syringe** (`drawSyringe`): barrel/needle/plunger; turns red and the plunger drops when
  `infusionRate > 0`.
- **Pipes + particles** (`drawPipe`): V1↔V2 uses the **net** rate `k12 - k21`, V1↔V3 uses
  `k13 - k31`, V1→effect uses `ke0`, syringe→V1 uses `infusionRate * 100`. Particle
  `count = min(Int(absRate*8)+2, 8)` and `speed = absRate*0.3`; a **negative net rate
  reverses** particle direction (`if rate < 0 { frac = 1 - frac }`) — so the pipe visually
  shows which way the gradient currently pushes drug. `drawArrowPipe` handles the downward
  V1→clearance pipe (rate `k10`) with an arrowhead.

## 3D renderer — CompartmentSceneView

`UIViewRepresentable` over an `SCNView` (`makeUIView`): black background,
`multisampling4X`, `allowsCameraControl = true` with `interactionMode = .orbitTurntable`
(user can turntable-orbit the model), default lighting off. A `Coordinator` builds the
scene once (`buildScene`) and mutates it in `updateUIView` → `Coordinator.update`.

- **Camera/lights** (`buildScene`, `addLighting`): FOV 40, at `(0,1.5,6)` looking at
  `(0,-0.2,0)`; custom ambient + shadow-casting directional key + soft fill light; a dark
  `SCNFloor` (`addFloorGrid`, reflectivity 0.05).
- **Compartments** (`buildCompartment`): each is an `SCNCylinder` (r 0.3, h 1.0, 32
  segments) with a **glass PBR** material — `physicallyBased`, `metalness 0`,
  `roughness 0.08`, `transparency 0.15`, double-sided — plus a thin `SCNTorus` rim
  highlight. Inside sits a separate **inner fluid `SCNCylinder`** (r `0.3-0.02`, PBR
  roughness 0.4, color at 0.6 alpha) starting at height `0.001`.
- **Effect site** (`buildEffectSite`): a translucent green `SCNSphere` with an inner
  "glow" sphere whose diffuse/emission alpha is driven by `fillEffect` at update time.
- **Syringe** (`buildSyringe`): box barrel, plunger rod, metallic needle, and an inner
  fluid box that lights up red when infusing.
- **Pipes** (`buildPipe`): thin `SCNCylinder`s aligned with `look(at:)`, constant-shaded
  with emissive tint. Each pipe also gets an `SCNParticleSystem` emitter
  (`addPipeParticles`: birthRate 6, lifespan 2.5, size 0.035, velocity 0.3, additive
  blend, no gravity) pointed at its destination.
- **Labels** (`addLabel`): `SCNText` with an `SCNBillboardConstraint` (free X/Y) so text
  always faces the camera; centered via `pivot`.

### 3D update loop

`Coordinator.update` runs in an `SCNTransaction` (animationDuration 0.25) each frame:

- `updateFluid` resizes each inner fluid cylinder to `cylHeight * clampedFill` and
  repositions it so it grows from the glass floor.
- Effect glow alpha ∝ `fillEffect`; syringe fluid/plunger react to `infusionRate`.
- **Sizes mode**: sets `glassVn.scale = scaleVn`. **Gotcha: only the glass node is
  scaled** — the fluid nodes are children of the scene root, not the glass, so in Sizes
  mode the fluid does not shrink with its cylinder.
- Labels toggled via `isHidden`; size labels are torn down and rebuilt on toggle
  (`updateSizeLabels`).
- **Particle rate is mostly static**: only the emitter whose name contains `"syr"` has its
  `birthRate` modulated (12 while infusing, else 0). All other pipes keep birthRate 6 —
  reinforcing that 3D flow is not PK-rate-driven.

## Surrounding chrome (CompartmentalView)

- **Toolbar**: `Data` / `Sizes` / `Labels` pills toggle the `showData/showSizes/showLabels`
  flags; each fires `Haptics.tap()`. Active pills tint with `AppColors.target` (see
  [[design-system-build]]).
- **Status bar**: drug name, model name, and `plasmaConcentration` at the cursor in
  `AppColors.plasma`.
- **Mini chart**: reuses `ChartCanvas` in `compact: true` (shared with [[simulation-screen]]),
  with a `DragGesture` that maps x-position (minus 30 pt left/right insets) to
  `cursorFraction` — this is the only way to move time on this screen. `maxConc`/`maxRate`
  helpers scale the axes.
- **Bottom bar**: `formatTime(cursorTimeSeconds)` on the left, "Time(min)" on the right.

## Related

[[simulation-screen]] · [[engine]] · [[pk-engine-math]] · [[models]] ·
[[design-system-build]] · [[state-navigation]] · [[architecture]]
