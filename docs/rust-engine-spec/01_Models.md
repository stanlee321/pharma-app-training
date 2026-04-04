# PK/PD Model Specifications

## 1. Common Structure: 3-Compartment Mammillary Model + Effect Site

All TIVA models share the same ODE structure. They differ only in how **parameters are calculated from patient covariates**.

### 1.1 Compartments

| Compartment | Symbol | Represents |
|-------------|--------|------------|
| Central (V1) | x1 | Blood plasma |
| Rapid peripheral (V2) | x2 | Well-perfused tissues (muscle) |
| Slow peripheral (V3) | x3 | Poorly-perfused tissues (fat) |
| Effect site (Ce) | x4 | Biophase / site of drug action (brain) |

### 1.2 State Vector

```
y = [x1, x2, x3, x4]

where:
  x1 = drug amount in V1 (mg)
  x2 = drug amount in V2 (mg)
  x3 = drug amount in V3 (mg)
  x4 = effect-site concentration (mcg/ml) — NOT amount, this is concentration
```

Note: The effect-site is modeled as having negligible volume, so we track concentration directly.

### 1.3 ODE System

```
dx1/dt = -(k10 + k12 + k13) * x1 + k21 * x2 + k31 * x3 + R(t)
dx2/dt = k12 * x1 - k21 * x2
dx3/dt = k13 * x1 - k31 * x3
dx4/dt = ke0 * (x1/V1 - x4)
```

Where:
- `k10 = Cl1 / V1` — elimination rate constant (1/min)
- `k12 = Cl2 / V1` — central → rapid peripheral (1/min)
- `k21 = Cl2 / V2` — rapid peripheral → central (1/min)
- `k13 = Cl3 / V1` — central → slow peripheral (1/min)
- `k31 = Cl3 / V3` — slow peripheral → central (1/min)
- `ke0` — effect-site equilibration rate constant (1/min)
- `R(t)` — infusion rate at time t (mg/min), 0 when no infusion active
- `Cl1` = metabolic clearance (ml/min)
- `Cl2` = rapid peripheral clearance (ml/min)
- `Cl3` = slow peripheral clearance (ml/min)

### 1.4 Derived Outputs

```
Cp(t) = x1(t) / V1        # plasma concentration (mcg/ml)
Ce(t) = x4(t)              # effect-site concentration (mcg/ml)
InfusionRate(t) = R(t)     # current infusion rate (mg/min)
```

### 1.5 Units Convention

| Quantity | Unit |
|----------|------|
| Time | **minutes** |
| Drug amounts (x1, x2, x3) | **mg** |
| Volumes (V1, V2, V3) | **ml** (not liters!) |
| Clearances (Cl1, Cl2, Cl3) | **ml/min** |
| Rate constants (k10, k12, etc.) | **1/min** |
| Concentrations (Cp, Ce) | **model-dependent** (see below) |
| Infusion rate | **mg/min** (internal), displayed as **ml/hr** on UI |
| Bolus dose | **mg** |

### 1.6 Concentration Units Per Drug

**Important:** Different drugs use different concentration units in clinical practice. The engine must track which unit each model uses and include it in outputs.

| Drug | Concentration Unit | Typical Range |
|------|-------------------|---------------|
| Propofol | **mcg/ml** (= mg/L) | 1–8 mcg/ml |
| Remifentanil | **ng/ml** (= mcg/L) | 1–15 ng/ml |
| Dexmedetomidine | **ng/ml** (= mcg/L) | 0.2–2.0 ng/ml |

The Rust engine always computes concentrations as `amount_mg / volume_ml` = mg/ml internally. The FFI output should include a `concentration_unit` field so the Swift UI knows how to display it (some drugs show mcg/ml, others ng/ml).

Internal conversion: `1 mcg/ml = 1000 ng/ml = 1 mg/L`

---

## 2. Model: Propofol — Marsh (1991)

### Reference
Marsh B, White M, Morton N, Kenny GN. *Pharmacokinetic model driven infusion of propofol in children.* Br J Anaesth 1991; 67: 41-8.

### Covariates Used
- **Weight** (kg) — only covariate

### Parameter Calculation

```
V1  = 228 * weight / 1000        → ml (paper uses ml/kg, multiply by weight)
V2  = 463 * weight / 1000        → ml
V3  = 2893 * weight / 1000       → ml

k10 = 0.119                      → 1/min (fixed)
k12 = 0.112                      → 1/min (fixed)
k21 = 0.055                      → 1/min (fixed)
k13 = 0.042                      → 1/min (fixed)
k31 = 0.0033                     → 1/min (fixed)
ke0 = 0.26                       → 1/min (fixed, added by later work)

Cl1 = k10 * V1                   → ml/min (derived)
Cl2 = k12 * V1                   → ml/min (derived)
Cl3 = k13 * V1                   → ml/min (derived)
```

Note: Marsh is weight-scaled volumes with fixed rate constants. Simple but less physiologically accurate than Schnider.

### Validation Rules
- Weight: 30–150 kg
- Age: 1–99 years (not used in calculation but collected)
- Height: not used in calculation
- Gender: not used in calculation

### Target: Typically **plasma** targeting (Cp). Effect-site targeting is possible with ke0 but not in the original paper.

---

## 3. Model: Propofol — Schnider (1998/1999)

### Reference
Schnider TW, Minto CF, et al. *The influence of method of administration and covariates on the pharmacokinetics of propofol in adult volunteers.* Anesthesiology 1998; 88: 1170-82.
Schnider TW, Minto CF, et al. *The influence of age on propofol pharmacodynamics.* Anesthesiology 1999; 90: 1502-16.

### Covariates Used
- **Weight** (kg)
- **Height** (cm)
- **Age** (years)
- **Gender** (male/female) — used for LBM calculation

### Parameter Calculation

```
# Lean Body Mass (James formula)
if gender == male:
    LBM = 1.1 * weight - 128 * (weight / height)^2
if gender == female:
    LBM = 1.07 * weight - 148 * (weight / height)^2

# Volumes (fixed, not weight-scaled!)
V1  = 4270 ml
V2  = 18900 ml
V3  = 23800 ml

# Clearances
Cl1 = 1.89 + ((weight - 77) * 0.0456) + ((LBM - 59) * (-0.0681)) + ((height - 177) * 0.0264)
Cl2 = 1.29 - 0.024 * (age - 53)
Cl3 = 0.836

# All clearances in L/min → convert to ml/min:
Cl1 = Cl1 * 1000    → ml/min
Cl2 = Cl2 * 1000    → ml/min
Cl3 = Cl3 * 1000    → ml/min

# Rate constants (derived)
k10 = Cl1 / V1
k12 = Cl2 / V1
k21 = Cl2 / V2
k13 = Cl3 / V1
k31 = Cl3 / V3
ke0 = 0.456         → 1/min
```

### Validation Rules
- Weight: 44–123 kg
- Height: 155–196 cm
- Age: 18–88 years
- Gender: required

### Target: **Effect-site** targeting (Ce) is standard with Schnider. Plasma targeting also supported.

---

## 4. Model: Remifentanil — Minto (1997)

### Reference
Minto CF, Schnider TW, et al. *Pharmacokinetics and pharmacodynamics of remifentanil. II. Model application.* Anesthesiology 1997; 86: 24-33.

### Covariates Used
- **Weight** (kg)
- **Height** (cm)
- **Age** (years)
- **Gender** (male/female) — for LBM

### Parameter Calculation

```
# Lean Body Mass (James formula, same as Schnider)
if gender == male:
    LBM = 1.1 * weight - 128 * (weight / height)^2
if gender == female:
    LBM = 1.07 * weight - 148 * (weight / height)^2

# Volumes
V1 = 5.1 - 0.0201 * (age - 40) + 0.072 * (LBM - 55)           → L
V2 = 9.82 - 0.0811 * (age - 40) + 0.108 * (LBM - 55)           → L
V3 = 5.42                                                        → L

# Clearances
Cl1 = 2.6 - 0.0162 * (age - 40) + 0.0191 * (LBM - 55)          → L/min
Cl2 = 2.05 - 0.0301 * (age - 40)                                 → L/min
Cl3 = 0.076 - 0.00113 * (age - 40)                               → L/min

# Convert to ml:
V1  = V1 * 1000     → ml
V2  = V2 * 1000     → ml
V3  = V3 * 1000     → ml
Cl1 = Cl1 * 1000    → ml/min
Cl2 = Cl2 * 1000    → ml/min
Cl3 = Cl3 * 1000    → ml/min

# Rate constants
k10 = Cl1 / V1
k12 = Cl2 / V1
k21 = Cl2 / V2
k13 = Cl3 / V1
k31 = Cl3 / V3
ke0 = 0.595 - 0.007 * (age - 40)    → 1/min
```

### Validation Rules
- Weight: 30–150 kg
- Height: 150–200 cm
- Age: 18–90 years
- Gender: required

### Notes
- Remifentanil is an opioid (not a hypnotic like propofol)
- Concentrations typically in **ng/ml** (1000x smaller than propofol mcg/ml)
- Ultra-short acting: context-sensitive half-time ~3-4 minutes

---

## 5. Model: Dexmedetomidine — Hannivoort (2015)

### Reference
Hannivoort LN, et al. *Development of an Optimized Pharmacokinetic Model of Dexmedetomidine Using Target-Controlled Infusion in Healthy Volunteers.* Anesthesiology 2015; 123: 357-67.

### Covariates Used
- **Weight** (kg)

### Parameter Calculation

```
# Volumes
V1 = 1.78 * (weight / 70)                    → L
V2 = 30.3 * (weight / 70)                    → L
V3 = 52.0                                     → L

# Clearances
Cl1 = 0.686 * (weight / 70)^0.75             → L/min
Cl2 = 2.98 * (weight / 70)^0.75              → L/min
Cl3 = 0.602                                   → L/min

# Convert to ml:
V1  = V1 * 1000     → ml
V2  = V2 * 1000     → ml
V3  = V3 * 1000     → ml
Cl1 = Cl1 * 1000    → ml/min
Cl2 = Cl2 * 1000    → ml/min
Cl3 = Cl3 * 1000    → ml/min

# Rate constants
k10 = Cl1 / V1
k12 = Cl2 / V1
k21 = Cl2 / V2
k13 = Cl3 / V1
k31 = Cl3 / V3
ke0 = 1.09                                    → 1/min
```

### Validation Rules
- Weight: 45–120 kg
- Age: 18–80 years (not used in calculation)
- Height: not used
- Gender: not used

### Notes
- Dexmedetomidine concentrations in **ng/ml**
- Slower onset than propofol/remifentanil

---

## 6. Model Trait (Rust Interface)

```rust
pub trait TivaModel: Send + Sync {
    /// Number of state variables (always 4 for 3-cmt + effect)
    fn n_states(&self) -> usize { 4 }

    /// Compute derivatives: dx/dt = f(t, x, R)
    /// R = current infusion rate (mg/min)
    fn deriv(&self, t: f64, y: &[f64], infusion_rate: f64, dydt: &mut [f64]);

    /// Model parameters (for external inspection)
    fn v1(&self) -> f64;
    fn v2(&self) -> f64;
    fn v3(&self) -> f64;
    fn k10(&self) -> f64;
    fn k12(&self) -> f64;
    fn k21(&self) -> f64;
    fn k13(&self) -> f64;
    fn k31(&self) -> f64;
    fn ke0(&self) -> f64;

    /// Plasma concentration from state
    fn cp(&self, y: &[f64]) -> f64 { y[0] / self.v1() }

    /// Effect-site concentration from state
    fn ce(&self, y: &[f64]) -> f64 { y[3] }
}
```

## 7. Model Registry

```rust
pub enum ModelId {
    Marsh,
    Schnider,
    Minto,
    Hannivoort,
}

pub enum ConcentrationUnit {
    McgPerMl,  // Propofol
    NgPerMl,   // Remifentanil, Dexmedetomidine
}

pub fn create_model(
    id: ModelId,
    weight: f64,
    height: f64,
    age: f64,
    gender: Gender,
) -> Box<dyn TivaModel> {
    match id {
        ModelId::Marsh => Box::new(MarshModel::new(weight)),
        ModelId::Schnider => Box::new(SchniderModel::new(weight, height, age, gender)),
        ModelId::Minto => Box::new(MintoModel::new(weight, height, age, gender)),
        ModelId::Hannivoort => Box::new(HannivoortModel::new(weight)),
    }
}

/// Returns the clinical concentration unit for display purposes.
/// The engine computes in mg/ml internally; this tells the UI how to convert for display.
pub fn concentration_unit(id: ModelId) -> ConcentrationUnit {
    match id {
        ModelId::Marsh | ModelId::Schnider => ConcentrationUnit::McgPerMl,
        ModelId::Minto | ModelId::Hannivoort => ConcentrationUnit::NgPerMl,
    }
}

/// Conversion factor: multiply internal mg/ml by this to get display unit.
/// mcg/ml: factor = 1000 (mg/ml * 1000 = mcg/ml)
/// ng/ml:  factor = 1_000_000 (mg/ml * 1e6 = ng/ml)
pub fn concentration_display_factor(id: ModelId) -> f64 {
    match id {
        ModelId::Marsh | ModelId::Schnider => 1_000.0,
        ModelId::Minto | ModelId::Hannivoort => 1_000_000.0,
    }
}
```

### Extensibility Note

The reference app (TivaTrainerX) includes more drugs than these 4 core models:
- Dexmedetomidine [Eyeldi variant]
- Levobupivacaine [Hart...]
- Lidocaine [Russell]
- (potentially more)

The `TivaModel` trait and `ModelId` enum are designed to be extended. Adding a new model requires:
1. New struct implementing `TivaModel`
2. New variant in `ModelId`
3. New arm in `create_model()` and `concentration_unit()`
4. Corresponding entry in the Swift-side `drug_models.json`
