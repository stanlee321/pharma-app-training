# Validation Reference Values

## 1. Purpose

This document provides reference values for testing the pk-engine implementation. Each model should be validated against these known outputs before integration with the iOS app.

## 2. Test Patient Profiles

### Standard Adult Male
```
weight: 70 kg, height: 170 cm, age: 40 years, gender: male, dilution: 10 mg/ml
```

### Standard Adult Female
```
weight: 60 kg, height: 160 cm, age: 50 years, gender: female, dilution: 10 mg/ml
```

### Edge Case: Elderly
```
weight: 55 kg, height: 165 cm, age: 80 years, gender: male, dilution: 10 mg/ml
```

---

## 3. Model Parameter Validation

For each model + patient, verify the computed PK parameters match these values.

### 3.1 Marsh — Standard Male (70 kg)

```
V1  = 15960 ml    (228 * 70)
V2  = 32410 ml    (463 * 70)
V3  = 202510 ml   (2893 * 70)
k10 = 0.119 /min
k12 = 0.112 /min
k21 = 0.055 /min
k13 = 0.042 /min
k31 = 0.0033 /min
ke0 = 0.26 /min
Cl1 = 1899.24 ml/min
Cl2 = 1787.52 ml/min
Cl3 = 670.32 ml/min
```

### 3.2 Schnider — Standard Male (70 kg, 170 cm, 40 yr)

```
LBM = 1.1 * 70 - 128 * (70/170)^2 = 77 - 128 * 0.1695 = 77 - 21.69 = 55.31 kg

V1  = 4270 ml
V2  = 18900 ml
V3  = 23800 ml

Cl1 = (1.89 + (70-77)*0.0456 + (55.31-59)*(-0.0681) + (170-177)*0.0264) * 1000
    = (1.89 - 0.3192 + 0.2513 - 0.1848) * 1000
    = 1.6373 * 1000 = 1637.3 ml/min

Cl2 = (1.29 - 0.024 * (40-53)) * 1000
    = (1.29 + 0.312) * 1000 = 1602.0 ml/min

Cl3 = 0.836 * 1000 = 836.0 ml/min

k10 = 1637.3 / 4270 = 0.3835 /min
k12 = 1602.0 / 4270 = 0.3752 /min
k21 = 1602.0 / 18900 = 0.0848 /min
k13 = 836.0 / 4270 = 0.1958 /min
k31 = 836.0 / 23800 = 0.0351 /min
ke0 = 0.456 /min
```

### 3.3 Minto — Standard Male (70 kg, 170 cm, 40 yr)

```
LBM = 55.31 kg (same as Schnider)

V1  = (5.1 - 0.0201*(40-40) + 0.072*(55.31-55)) * 1000
    = (5.1 + 0 + 0.0223) * 1000 = 5122.3 ml

V2  = (9.82 - 0.0811*(40-40) + 0.108*(55.31-55)) * 1000
    = (9.82 + 0 + 0.0333) * 1000 = 9853.3 ml

V3  = 5420.0 ml

Cl1 = (2.6 - 0.0162*(40-40) + 0.0191*(55.31-55)) * 1000
    = (2.6 + 0 + 0.00593) * 1000 = 2605.9 ml/min

Cl2 = (2.05 - 0.0301*(40-40)) * 1000 = 2050.0 ml/min

Cl3 = (0.076 - 0.00113*(40-40)) * 1000 = 76.0 ml/min

k10 = 2605.9 / 5122.3 = 0.5088 /min
k12 = 2050.0 / 5122.3 = 0.4002 /min
k21 = 2050.0 / 9853.3 = 0.2081 /min
k13 = 76.0 / 5122.3 = 0.01484 /min
k31 = 76.0 / 5420.0 = 0.01402 /min
ke0 = 0.595 - 0.007*(40-40) = 0.595 /min
```

### 3.4 Hannivoort — Standard Male (70 kg)

```
V1  = 1.78 * (70/70) * 1000 = 1780 ml
V2  = 30.3 * (70/70) * 1000 = 30300 ml
V3  = 52.0 * 1000 = 52000 ml

Cl1 = 0.686 * (70/70)^0.75 * 1000 = 686.0 ml/min
Cl2 = 2.98 * (70/70)^0.75 * 1000 = 2980.0 ml/min
Cl3 = 0.602 * 1000 = 602.0 ml/min

k10 = 686.0 / 1780 = 0.3854 /min
k12 = 2980.0 / 1780 = 1.6742 /min
k21 = 2980.0 / 30300 = 0.09835 /min
k13 = 602.0 / 1780 = 0.3382 /min
k31 = 602.0 / 52000 = 0.01158 /min
ke0 = 1.09 /min
```

---

## 4. Simulation Validation

### Test Case 1: Marsh, Plasma Target 4 mcg/ml at t=0

**Setup:** Standard male, target Cp = 4 mcg/ml at t = 0

**Expected bolus:**
```
target_amount = 4.0 * 15960 = 63840 mcg = 63.84 mg
bolus_ml = 63.84 / 10 = 6.384 ml
bolus_mcg_kg = 63840 / 70 = 912 mcg/kg
```

**Expected at t=0+ (immediately after bolus):**
```
Cp ≈ 4.0 mcg/ml
Ce ≈ 0.0 mcg/ml (hasn't equilibrated yet)
```

**Expected at t=60s:**
```
Cp < 4.0 mcg/ml (drug redistributing to V2, V3)
Ce > 0.0 mcg/ml (rising toward Cp)
```

### Test Case 2: Steady-State Infusion

**Setup:** Marsh, standard male, constant infusion at rate R for 30 minutes

At steady state, Cp_ss = R / Cl1. So for Cp_ss = 4 mcg/ml:
```
R = 4.0 * 1899.24 = 7596.96 mcg/min = 7.597 mg/min = 455.8 mg/hr
```

After 30 minutes of this infusion rate, Cp should approach (but not reach) 4 mcg/ml. Verify that it's within 50% of target (full steady state takes hours for V3).

### Test Case 3: Effect-Site Equilibration

**Setup:** Any model, bolus only, no infusion

After a bolus, Ce should:
1. Start at 0
2. Rise as drug equilibrates
3. Peak at some time t_peak
4. Then decline as Cp falls below Ce
5. Eventually, Ce = Cp as both decline together

**Verify:** Ce peak time is approximately `1/ke0` minutes after bolus.
- Marsh: ~1/0.26 = 3.8 minutes
- Schnider: ~1/0.456 = 2.2 minutes
- Minto: ~1/0.595 = 1.7 minutes

### Test Case 4: TCI Step-Up / Step-Down

**Setup:** Two targets: Cp=4 at t=0, then Cp=2 at t=300s

**Expected behavior:**
- At t=0: bolus to reach Cp=4, maintenance infusion starts
- t=0 to 300: Cp maintained near 4, Ce rises toward 4
- At t=300: infusion stops (target decreased), no bolus
- t=300+: Cp falls from ~4 toward 2 via redistribution/elimination
- Ce falls from wherever it was toward 2

---

## 5. Cross-Validation with TivaTrainer / Open TCI

If possible, compare outputs against:
- **Open TCI** (open source): https://opentci.org
- **TivaTrainer** (the app being rebuilt — use as reference if available)
- **Rugloop**: Academic TCI software

Match criteria: within 5% for concentrations, within 10% for bolus/infusion calculations.

---

## 6. Numerical Stability Tests

### Test: Very High ke0

Dexmedetomidine (Hannivoort) has ke0 = 1.09/min, which is fast. Verify the adaptive solver handles this without excessive step-size reduction.

### Test: Long Simulation (4 hours)

Run 14400-second simulation. Verify:
- No NaN or Inf in output
- Concentrations remain non-negative
- State amounts remain non-negative (can't have negative drug in compartment)

### Test: Zero Target

Target Cp = 0 at t=0 should produce:
- bolus = 0, infusion = 0
- All concentrations remain 0

### Test: Very Small Target

Target Cp = 0.001 mcg/ml. Verify numerical precision is maintained.
