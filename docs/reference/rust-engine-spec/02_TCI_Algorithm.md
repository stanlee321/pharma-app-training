# TCI Algorithm Specification

## 1. What is TCI?

Target Controlled Infusion (TCI) is a control algorithm that calculates the **bolus dose** and **infusion rate** needed to reach and maintain a target drug concentration. It's the core math behind the "draggable target node" in the UI.

There are two targeting modes:
- **Plasma targeting (Cp):** Achieve target concentration in blood
- **Effect-site targeting (Ce):** Achieve target concentration at the site of drug action (brain)

## 2. TCI Inputs and Outputs

### Input

```rust
pub struct TCIInput {
    pub model: &dyn TivaModel,         // The PK model with patient-specific parameters
    pub current_state: [f64; 4],       // Current amounts [x1, x2, x3, x4(Ce)]
    pub target_concentration: f64,     // Desired concentration (mcg/ml or ng/ml)
    pub target_type: TargetType,       // Plasma or EffectSite
    pub dilution: f64,                 // Drug dilution (mg/ml) for volume calculations
    pub patient_weight: f64,           // For mcg/kg conversions
}

pub enum TargetType {
    Plasma,
    EffectSite,
}
```

### Output

```rust
pub struct TCIOutput {
    // Bolus dose
    pub bolus_mg: f64,                 // Bolus in mg
    pub bolus_ml: f64,                 // Bolus in ml (= bolus_mg / dilution)
    pub bolus_mcg_per_kg: f64,         // Bolus in mcg/kg (= bolus_mg * 1000 / weight)

    // Infusion rate to maintain target after bolus
    pub infusion_rate_mg_min: f64,     // mg/min (internal)
    pub infusion_rate_mg_hr: f64,      // mg/hr (= mg_min * 60)
    pub infusion_rate_ml_hr: f64,      // ml/hr (= mg_hr / dilution)
    pub infusion_rate_mcg_kg_hr: f64,  // mcg/kg/hr (= mg_hr * 1000 / weight)
}
```

## 3. Plasma-Targeting TCI Algorithm

When targeting plasma concentration (Cp_target):

### Step 1: Calculate Bolus

```
# Amount needed in V1 to achieve target plasma concentration
target_amount_v1 = Cp_target * V1

# Bolus = difference between target and current amount
bolus = target_amount_v1 - current_state[0]

# Cannot give negative bolus (can't remove drug)
bolus = max(bolus, 0.0)
```

### Step 2: Calculate Maintenance Infusion Rate

At steady state, the infusion must replace drug being eliminated and redistributed:

```
# Rate of drug leaving V1 at target concentration:
#   Elimination: k10 * target_amount_v1
#   To V2:      k12 * target_amount_v1
#   To V3:      k13 * target_amount_v1
#   From V2:   -k21 * current_state[1]
#   From V3:   -k31 * current_state[2]

R_maintenance = k10 * target_amount_v1
              + k12 * target_amount_v1 - k21 * current_state[1]
              + k13 * target_amount_v1 - k31 * current_state[2]

# Cannot have negative infusion
R_maintenance = max(R_maintenance, 0.0)
```

This is the **BET (Bolus-Elimination-Transfer)** scheme used in classic TCI pumps.

## 4. Effect-Site Targeting TCI Algorithm

Effect-site targeting is more complex because we need to overshoot the plasma concentration to drive the effect site to target faster.

### Approach: Modified Shafer-Gregg Algorithm

```
# Step 1: Calculate the plasma concentration needed to drive Ce to target
# At equilibrium: Ce = Cp, so we need to overshoot Cp temporarily.
#
# The effect-site is governed by:
#   dCe/dt = ke0 * (Cp - Ce)
#
# To make Ce reach Cp_target, we need Cp to overshoot such that
# the integral effect drives Ce to the target.

# Simple approach: compute Cp_overshoot that will equilibrate to Ce_target
# For an instantaneous bolus:
#   Cp_peak = bolus / V1 + current_Cp
#   Ce will rise toward Cp_peak, reaching Ce_target when Cp falls to Ce_target
#
# The exact Cp peak needed depends on the model's distribution kinetics.
# Use binary search or analytical solution.
```

### Iterative Method (Recommended for Implementation)

```
# Binary search for the bolus that makes Ce peak at exactly the target

fn compute_effect_site_bolus(
    model: &dyn TivaModel,
    solver: &dyn OdeSolver,
    current_state: [f64; 4],
    ce_target: f64,
    dt_search: f64,          # simulation step for search (e.g., 1 second)
    t_horizon: f64,          # how far to search (e.g., 600 seconds)
) -> f64 {
    let mut low = 0.0;
    let mut high = ce_target * model.v1() * 5.0;  # generous upper bound

    for _ in 0..50 {  # 50 iterations of bisection = ~15 decimal digits
        let mid = (low + high) / 2.0;

        # Simulate: apply bolus of `mid` mg, no infusion, find peak Ce
        let mut state = current_state;
        state[0] += mid;  # apply bolus to V1

        let peak_ce = simulate_and_find_peak_ce(model, solver, state, t_horizon, dt_search);

        if peak_ce < ce_target {
            low = mid;
        } else {
            high = mid;
        }
    }

    return (low + high) / 2.0;
}
```

### Maintenance Infusion for Effect-Site Targeting

Once Ce has reached target, maintenance infusion is the same as plasma targeting but at `Cp = Ce_target` (since at steady state Cp = Ce):

```
R_maintenance = k10 * Ce_target * V1
              + k12 * Ce_target * V1 - k21 * current_state[1]
              + k13 * Ce_target * V1 - k31 * current_state[2]

R_maintenance = max(R_maintenance, 0.0)
```

## 5. Step-Down Behavior (Target Decrease)

When the user drags the target **down** (lower concentration):

```
if target_concentration < current_concentration:
    bolus = 0.0                    # No bolus (can't remove drug)
    infusion_rate = 0.0            # Stop infusion, let drug redistribute/eliminate

    # Optionally: compute time to reach new target with zero infusion
    # (useful for UI: "estimated time to target: X min")
```

## 6. Full Simulation with Multiple Targets

The "Done" button in the UI triggers a full time-course simulation. The user may set multiple targets at different times.

### Input

```rust
pub struct SimulationInput {
    pub model_id: ModelId,
    pub patient: PatientParams,
    pub targets: Vec<TargetEvent>,      // sorted by time
    pub time_range_seconds: f64,        // total simulation duration
    pub resolution_seconds: f64,        // output time step (typically 1.0)
}

pub struct TargetEvent {
    pub time: f64,                      // seconds from simulation start
    pub concentration: f64,             // target concentration
    pub target_type: TargetType,        // Plasma or EffectSite
}
```

### Algorithm

```
fn simulate(input: SimulationInput) -> SimulationOutput:
    model = create_model(input.model_id, input.patient)
    state = [0.0; 4]
    current_infusion_rate = 0.0
    output_points = []

    for t in 0..time_range_seconds step resolution_seconds:

        # Check if a new target starts at this time
        if target_event at time t:
            tci_result = compute_tci(model, state, target.concentration, target.target_type)

            # Apply bolus instantly
            state[0] += tci_result.bolus_mg

            # Set new maintenance infusion rate
            current_infusion_rate = tci_result.infusion_rate_mg_min

        # Integrate ODE for one time step with current infusion rate
        state = solver.step(model, state, current_infusion_rate, t, t + resolution)

        # Recalculate infusion rate (BET update)
        # The infusion rate should be recalculated each step to account
        # for redistribution changes:
        if current_target is not None:
            current_infusion_rate = recalculate_maintenance(
                model, state, current_target.concentration
            )
            current_infusion_rate = max(current_infusion_rate, 0.0)

        # Record output
        output_points.push(CurvePoint {
            time: t,
            plasma_concentration: model.cp(state),
            effect_concentration: model.ce(state),
            amount_v1: state[0],
            amount_v2: state[1],
            amount_v3: state[2],
            amount_effect: state[3],
            infusion_rate: current_infusion_rate,
        })

    return SimulationOutput {
        points: output_points,
        v1_volume: model.v1(),
        v2_volume: model.v2(),
        v3_volume: model.v3(),
        k10: model.k10(),
        k12: model.k12(),
        k21: model.k21(),
        k13: model.k13(),
        k31: model.k31(),
        ke0: model.ke0(),
    }
```

## 7. Performance Requirements

| Operation | Max Latency | Notes |
|-----------|------------|-------|
| `compute_tci()` — single point | **< 5ms** | Called during drag gesture (60fps) |
| `simulate()` — 60min at 1s resolution | **< 50ms** | Called on "Done" button |
| `simulate()` — 60min at 0.1s resolution | **< 200ms** | High-res for smooth animation |

These targets are easily achievable: `pk-core` solves 100k patients in 1.3s. A single patient with 3600 time points should be sub-millisecond.

## 8. Numerical Considerations

- Use **Dormand-Prince 4(5)** adaptive solver for accuracy
- Tolerances: `atol = 1e-8`, `rtol = 1e-6` (same as pk-core)
- The effect-site equation is stiff relative to other compartments when ke0 is large — monitor for solver step-size shrinking
- Infusion rate changes create discontinuities — restart integrator at each target change point
- All internal calculations in **f64** (not f32) for numerical stability
