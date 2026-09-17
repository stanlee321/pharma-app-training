---
type: page
updated: 2026-07-09
tags: [app]
---

# Mock PK Engine (the math)

The math core of TivaTrainer. `MockPKEngine` (`PharmaApp/Engine/MockPKEngine.swift`) is a
real numerical PK/PD simulator: it integrates a 3-compartment plus effect-site model with a
hand-rolled RK4 solver and computes TCI (target-controlled infusion) bolus/infusion values with
a BET scheme. It conforms to `PKEngineProtocol` (`PharmaApp/Engine/PKEngineProtocol.swift`) and
is the engine actually running in the app. See [[engine]] for the provider/protocol wiring and
[[models]] for where model IDs and validation rules come from.

## What it is

- Class `MockPKEngine`, `final class ... : PKEngineProtocol, @unchecked Sendable`.
- Advertises four models via `availableModelIds = ["marsh", "schnider", "minto", "hannivoort"]`.
- Three protocol entry points:
  - `simulate(modelId:patient:targets:timeRangeSeconds:resolutionSeconds:)` — full time-series
    run, returns `SimulationOutput?` (`PharmaApp/Models/SimulationTypes.swift`).
  - `computeTCI(modelId:patient:currentState:targetConcentration:targetType:)` — single fast
    "what bolus/infusion hits this target?" query (protocol comment: must return in <16 ms for
    60 fps drag).
  - `validationRules(for:)` — delegates to `DrugDatabase.hardcoded` (`PharmaApp/Models/DrugModel.swift`),
    matching on `rustModelId`. See [[models]].

## Drift vs docs (read this first)

- **Header comment lies about the method.** The doc comment on `MockPKEngine` says it "generates
  realistic pharmacokinetic curves using analytical 3-compartment model solutions." It does **not**
  use analytical/closed-form solutions — `rk4Step` is a numerical Runge-Kutta-4 integrator over the
  ODE system. The `MARK: - ODE Solver (RK4, simplified)` comment is the accurate one.
- **"Mock" is a misnomer.** Despite the name and the "Use during development while the Rust engine is
  being built" comment, this is the production math path. `EngineProvider.useMock` is `true`
  (`PharmaApp/Engine/EngineProvider.swift`), and `RustPKEngine` is a pure stub — every method is
  `fatalError("RustPKEngine not yet implemented. Use MockPKEngine.")` (`PharmaApp/Engine/RustPKEngine.swift`).
  So the "mock" is the real engine and the "real" engine would crash if selected.
- **`PKEngineProtocol.computeTCI` comment mislabels state[3].** The protocol says `currentState` is
  "[x1, x2, x3, Ce] amounts in mg". `x1/x2/x3` are amounts (mg) but `Ce` (index 3) is a
  concentration (mg/ml), not an amount — `computeTCI` compares `currentState[3]` directly against a
  target Cp in mg/ml.

## THE TOP GOTCHA: unit conventions

Everything internal is **mg, mg/ml, and ml**. Rate constants are **per minute (1/min)**. Two
conversion boundaries bite hard:

1. **displayFactor — internal mg/ml is never what the UI shows.** `PKParams.displayFactor` scales
   internal mg/ml to display units. Marsh and Schnider use `1_000.0` (mg/ml → **mcg/ml**); Minto and
   Hannivoort use `1_000_000.0` (mg/ml → **ng/ml**). Every crossing is explicit:
   - Output: in `simulate`, `cp = (state[0] / p.v1) * p.displayFactor` and
     `ce = state[3] * p.displayFactor` before building each `CurvePoint`.
   - Input: target concentrations arrive in display units and are divided back down —
     `currentTargetCp = target.concentration / p.displayFactor` in `simulate`, and
     `targetCp = targetConcentration / p.displayFactor` in `computeTCI`.
   - Get displayFactor wrong for a model and concentrations are off by 1000x (mcg vs ng). The
     `ConcentrationUnit` enum (`PharmaApp/Models/SimulationTypes.swift`) mirrors these two units.

2. **Rate constants are per-minute but the loop counts seconds.** In `simulate`, `dtInternal = 0.1`
   is a 100 ms step and `t = Double(step) * dtInternal` is **seconds**. But every `k` in `deriv`
   (k10, k12, k21, k13, k31, ke0) is 1/min. The reconciliation is a single division at the call
   site: `rk4Step(..., dt: dtInternal / 60.0)` — the integrator is fed dt in **minutes**
   (`0.1 s / 60 = 0.001667 min`) while the output timeline stays in seconds. Miss the `/60` and the
   simulation runs 60x too fast. `CurvePoint.time` is documented as seconds; `SimulationOutput`'s
   rate constants are documented as 1/min.

3. **Infusion rate is mg/min inside the ODE, but mg/hr / ml/hr / mcg·kg⁻¹·hr⁻¹ at the boundary.**
   `deriv` adds `infusionRate` straight into `dx1` (so it must be mg/min to match the per-minute
   k's). `computeBET` produces mg/min internally (`maintenanceRate`), then reports per-hour fields
   by `*60`. `simulate` converts back: `infusionRate = tci.infusionRateMgHr / 60.0`.
   `CurvePoint.infusionRate` is stored as mg/min.

4. **Volumes are ml, and each model reaches ml differently.** Marsh multiplies per-kg ml constants
   by weight directly (`v1 = 228.0 * w`). Schnider/Minto/Hannivoort work in litres / (L/min) then
   multiply by `1000.0` to reach ml / (ml/min). Both land in the same internal units by different
   arithmetic — do not "simplify" the `*1000` away.

## The state vector and the ODE

`deriv(state:p:infusionRate:)` defines the 4-state system, documented in-code as
`State: [x1(mg), x2(mg), x3(mg), Ce(mg/ml)]`:

- `x1` — central compartment amount (mg)
- `x2` — rapid peripheral (mg)
- `x3` — slow peripheral (mg)
- `Ce` — effect-site concentration (mg/ml)

Plasma concentration is derived, not stored: `cp = x1 / p.v1`. The derivatives:

```
dx1 = -(k10 + k12 + k13)*x1 + k21*x2 + k31*x3 + infusionRate
dx2 =  k12*x1 - k21*x2
dx3 =  k13*x1 - k31*x3
dce =  ke0*(cp - ce)
```

Standard mammillary 3-compartment kinetics (central eliminates via `k10` and exchanges with two
peripheral compartments) plus a first-order effect-site link driven by the plasma–effect gradient
`ke0*(cp - ce)`. Note `cp` is used only in `dce`; the amount equations are self-contained in
amounts.

The micro-rate constants are computed properties on `PKParams`: `k10 = cl1/v1`, `k12 = cl2/v1`,
`k21 = cl2/v2`, `k13 = cl3/v1`, `k31 = cl3/v3`. So models supply volumes (`v1/v2/v3`, ml) and
clearances (`cl1/cl2/cl3`, ml/min) plus `ke0` (1/min) and `displayFactor`, and the k's fall out.

### RK4 solver

`rk4Step(state:p:infusionRate:dt:)` is a textbook classic RK4: four `deriv` evaluations `k1..k4`
(at the start, two midpoints, and the endpoint) combined as
`state + (dt/6)*(k1 + 2*k2 + 2*k3 + k4)`. It loops over the 4 indices explicitly. `infusionRate`
is held constant across the four stages within a step (piecewise-constant infusion). This is a real
numerical integrator, not a lookup or analytical curve.

## The four models (PKParams equations)

All four are private functions returning a `PKParams`; `params(modelId:patient:)` dispatches on the
string id and returns `nil` for anything unknown (which makes `simulate`/`computeTCI` return `nil`).
Patient inputs come from `PatientProfile` (`PharmaApp/Models/PatientProfile.swift`): `weight` (kg),
`height` (cm), `age` (years), `gender`, `dilution` (mg/ml). `leanBodyMass` is a computed James-formula
property on `PatientProfile` used by Schnider and Minto. See [[input-screens]].

### Marsh (`marshParams`) — propofol, weight-only

- `v1 = 228*w`, `v2 = 463*w`, `v3 = 2893*w` (ml/kg × kg).
- Rate constants are the fixed Marsh set: `k10 = 0.119`, `k12 = 0.112`, `k13 = 0.042` (1/min), `ke0 = 0.26`.
- Clearances are back-derived so the k's come out right: `cl1 = k10*v1`, `cl2 = k12*v1`, `cl3 = k13*v1`.
- `displayFactor = 1000` (mcg/ml).
- The two `let _ = 0.055 // k21` and `let _ = 0.0033 // k31` lines are **dead code** documenting the
  expected derived values: `k21 = cl2/v2 = 0.112*228/463 ≈ 0.055`, `k31 = cl3/v3 = 0.042*228/2893 ≈ 0.0033`.
  They compute nothing.
- Only model with no age/height/gender dependence.

### Schnider (`schniderParams`) — propofol, LBM/age-adjusted clearance

- Volumes (ml): `v1 = 4270`, `v2 = (18.9 - 0.391*(age-53)) * 1000` (age-adjusted), `v3 = 238000` (238 L).
  Fixed 2026-09-16: V3 was 23800 (10× too small) and V2 omitted the age term.
- `cl1 = (1.89 + (weight-77)*0.0456 + (lbm-59)*(-0.0681) + (height-177)*0.0264) * 1000` (L/min → ml/min).
- `cl2 = (1.29 - 0.024*(age-53)) * 1000`; `cl3 = 836` (ml/min).
- `ke0 = 0.456`; `displayFactor = 1000` (mcg/ml).
- Uses `patient.leanBodyMass` (James formula).

### Minto (`mintoParams`) — remifentanil, age & LBM covariates

- `ageDiff = age - 40`, `lbmDiff = lbm - 55`.
- `v1 = (5.1 - 0.0201*ageDiff + 0.072*lbmDiff) * 1000`; `v2 = (9.82 - 0.0811*ageDiff + 0.108*lbmDiff) * 1000`; `v3 = 5420` (ml).
- `cl1 = (2.6 - 0.0162*ageDiff + 0.0191*lbmDiff) * 1000`; `cl2 = (2.05 - 0.0301*ageDiff) * 1000`; `cl3 = (0.076 - 0.00113*ageDiff) * 1000` (ml/min).
- `ke0 = 0.595 - 0.007*ageDiff` (age-dependent, unlike the others).
- `displayFactor = 1_000_000` (ng/ml) — opioid, so nanogram scale.

### Hannivoort (`hannivoortParams`) — dexmedetomidine, allometric weight scaling

- `wRatio = weight/70`, `wRatio075 = pow(wRatio, 0.75)` (allometric ¾-power for clearances).
- `v1 = 1.78*wRatio*1000`; `v2 = 30.3*wRatio*1000`; `v3 = 52.0*1000` (ml).
- `cl1 = 0.686*wRatio075*1000`; `cl2 = 2.98*wRatio075*1000`; `cl3 = 602` (ml/min).
- `ke0 = 1.09`; `displayFactor = 1_000_000` (ng/ml).

## BET / TCI (`computeBET`)

`computeBET(p:state:targetCp:patient:)` implements the classic **BET (Bolus–Elimination–Transfer)**
target-controlled dosing scheme and returns a `TCIResult`:

- **Bolus** to fill the central compartment to target:
  `targetAmount = targetCp * v1` (mg), `bolusMg = max(targetAmount - state[0], 0)`. Clamped at 0 so
  you never "un-dose" when already above target.
- **Maintenance rate** (mg/min), replacing elimination + net redistribution, clamped ≥ 0:
  ```
  maintenanceRate = max( k10*targetAmount
                       + k12*targetAmount - k21*x2
                       + k13*targetAmount - k31*x3, 0 )
  ```
  i.e. cover what leaves via `k10` plus what the peripheral compartments are net-absorbing at target.
- Reported in six unit flavours on `TCIResult`: `bolusMg`, `bolusMl` (÷ `dilution`, guarded against
  `dilution <= 0`), `bolusMcgPerKg` (`bolusMg*1000/weight`), `infusionRateMgHr` (`maintenanceRate*60`),
  `infusionRateMlHr` (`*60/dilution`), `infusionRateMcgKgHr` (`*60*1000/weight`). `dilution` (mg/ml)
  comes from `PatientProfile`.

### How `simulate` drives BET over time

Inside the integration loop, when a `TargetEvent` becomes due (`sortedTargets[i].time <= t`):
`computeBET` runs, the bolus is applied by `state[0] += tci.bolusMg`, and the maintenance infusion is
set (`infusionRate = tci.infusionRateMgHr / 60.0`, mg/min). Then **every step** while
`currentTargetCp > 0`, the maintenance rate is recomputed against the live `x2`/`x3` and re-applied
(`infusionRate = maintMgMin`, mg/min) — a continuously-updated infusion that tracks redistribution,
not a fixed rate. State is clamped non-negative each step (`state[i] = max(state[i], 0)`).

Loop structure: `dtInternal = 0.1` s fixed step, `totalSteps = timeRangeSeconds / dtInternal`,
output decimated to `outputInterval = max(1, resolutionSeconds / dtInternal)` — a `CurvePoint` is
emitted only every `outputInterval` steps.

### Effect-site targeting in `computeTCI`

For `targetType == .effectSite`, `computeTCI` applies a crude heuristic: if both current `Ce` and
current `Cp` are below target, it overshoots the plasma target by 30% (`effectiveTargetCp = targetCp * 1.3`)
"for faster Ce rise", otherwise no overshoot. The in-code comment flags this as "simplified for mock" —
it is not a proper effect-site TCI algorithm (no BET-Plus / time-to-peak-effect calculation). Plasma
targeting uses the target directly.

## Outputs and consumers

- `SimulationOutput` carries `points: [CurvePoint]` plus the raw `v1/v2/v3` volumes (ml) and
  `k10/k12/k21/k13/k31/ke0` (1/min). Per the field comments, volumes drive compartment **animation
  sizing** and rate constants drive **particle animation speed** — consumed by [[compartmental-screen]].
- `CurvePoint` (time in s, plasma/effect in display units, amounts in mg, infusion in mg/min) feeds
  the concentration-vs-time graphs in [[simulation-screen]].
- `computeTCI` powers fast drag interactions (the <16 ms budget in the protocol comment).

## Cross-links

[[engine]] · [[models]] · [[simulation-screen]] · [[compartmental-screen]] · [[input-screens]] · [[architecture]]
