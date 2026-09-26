/**
 * TS port of the parts of PharmaApp/Engine/MockPKEngine.swift the clinical screens use:
 * the four models' `*Params(patient:)` and `computeTCI` (BET plasma targeting, plus the mock's
 * simplified 30 % effect-site overshoot). Line-for-line faithful — do NOT "improve" the math here;
 * any change must be made in the Swift engine (and the spec) first. `simulate` / RK4 are not ported
 * (the Simulation / Compartmental screens are out of scope for the web port).
 *
 * Units (identical to Swift): amounts mg, concentrations mg/ml, volumes ml, clearances ml/min,
 * rate constants 1/min. Display ↔ internal via `displayFactor` (×1000 propofol → mcg/ml,
 * ×1e6 remifentanil / dexmedetomidine → ng/ml).
 */
import { leanBodyMass } from './patient';
import type { CompartmentState, EnginePatient, TargetType, TCIResult } from './types';

export const AVAILABLE_MODEL_IDS = ['marsh', 'schnider', 'minto', 'hannivoort'] as const;
export type ModelId = (typeof AVAILABLE_MODEL_IDS)[number];

/** Swift `MockPKEngine.PKParams` — computed PK parameters for a model + patient. */
export interface PKParams {
  v1: number; // ml
  v2: number; // ml
  v3: number; // ml
  cl1: number; // ml/min
  cl2: number; // ml/min
  cl3: number; // ml/min
  ke0: number; // 1/min
  displayFactor: number; // multiply mg/ml → display units
  k10: number; // cl1 / v1
  k12: number; // cl2 / v1
  k21: number; // cl2 / v2
  k13: number; // cl3 / v1
  k31: number; // cl3 / v3
}

/** Swift `PKParams(...)` memberwise init + its computed k's. */
function makeParams(p: Omit<PKParams, 'k10' | 'k12' | 'k21' | 'k13' | 'k31'>): PKParams {
  return {
    ...p,
    k10: p.cl1 / p.v1,
    k12: p.cl2 / p.v1,
    k21: p.cl2 / p.v2,
    k13: p.cl3 / p.v1,
    k31: p.cl3 / p.v3,
  };
}

/** Swift `params(modelId:patient:)` — nil (null) for an unknown model id. */
export function pkParams(modelId: string, patient: EnginePatient): PKParams | null {
  switch (modelId) {
    case 'marsh':
      return marshParams(patient);
    case 'schnider':
      return schniderParams(patient);
    case 'minto':
      return mintoParams(patient);
    case 'hannivoort':
      return hannivoortParams(patient);
    default:
      return null;
  }
}

export function marshParams(patient: EnginePatient): PKParams {
  const w = patient.weight;
  const v1 = 228.0 * w;
  const v2 = 463.0 * w;
  const v3 = 2893.0 * w;
  const k10 = 0.119;
  const k12 = 0.112;
  // k21 = 0.055 derived from cl2/v2
  const k13 = 0.042;
  // k31 = 0.0033 derived from cl3/v3
  return makeParams({
    v1,
    v2,
    v3,
    cl1: k10 * v1,
    cl2: k12 * v1,
    cl3: k13 * v1,
    ke0: 0.26,
    displayFactor: 1_000.0, // mg/ml → mcg/ml
  });
}

export function schniderParams(patient: EnginePatient): PKParams {
  const lbm = leanBodyMass(patient);
  const v1 = 4270.0;
  const v2 = (18.9 - 0.391 * (patient.age - 53)) * 1000.0;
  const v3 = 238000.0;
  const cl1 =
    (1.89 + (patient.weight - 77) * 0.0456 + (lbm - 59) * -0.0681 + (patient.height - 177) * 0.0264) * 1000.0;
  const cl2 = (1.29 - 0.024 * (patient.age - 53)) * 1000.0;
  const cl3 = 836.0;
  return makeParams({ v1, v2, v3, cl1, cl2, cl3, ke0: 0.456, displayFactor: 1_000.0 });
}

export function mintoParams(patient: EnginePatient): PKParams {
  const lbm = leanBodyMass(patient);
  const ageDiff = patient.age - 40.0;
  const lbmDiff = lbm - 55.0;
  const v1 = (5.1 - 0.0201 * ageDiff + 0.072 * lbmDiff) * 1000.0;
  const v2 = (9.82 - 0.0811 * ageDiff + 0.108 * lbmDiff) * 1000.0;
  const v3 = 5420.0;
  const cl1 = (2.6 - 0.0162 * ageDiff + 0.0191 * lbmDiff) * 1000.0;
  const cl2 = (2.05 - 0.0301 * ageDiff) * 1000.0;
  const cl3 = (0.076 - 0.00113 * ageDiff) * 1000.0;
  const ke0 = 0.595 - 0.007 * ageDiff;
  return makeParams({ v1, v2, v3, cl1, cl2, cl3, ke0, displayFactor: 1_000_000.0 }); // mg/ml → ng/ml
}

export function hannivoortParams(patient: EnginePatient): PKParams {
  const wRatio = patient.weight / 70.0;
  const wRatio075 = Math.pow(wRatio, 0.75);
  const v1 = 1.78 * wRatio * 1000.0;
  const v2 = 30.3 * wRatio * 1000.0;
  const v3 = 52.0 * 1000.0;
  const cl1 = 0.686 * wRatio075 * 1000.0;
  const cl2 = 2.98 * wRatio075 * 1000.0;
  const cl3 = 602.0;
  return makeParams({ v1, v2, v3, cl1, cl2, cl3, ke0: 1.09, displayFactor: 1_000_000.0 }); // mg/ml → ng/ml
}

/** Display units (mcg/ml or ng/ml) → internal mg/ml. */
export function displayToInternal(p: PKParams, display: number): number {
  return display / p.displayFactor;
}

/** Internal mg/ml → display units (mcg/ml or ng/ml). */
export function internalToDisplay(p: PKParams, internal: number): number {
  return internal * p.displayFactor;
}

/** Swift `computeBET` — bolus to fill V1 to target + maintenance replacing elimination/transfer. */
function computeBET(p: PKParams, state: CompartmentState, targetCp: number, patient: EnginePatient): TCIResult {
  const targetAmount = targetCp * p.v1; // mg in V1 for target Cp (mg/ml)
  const bolusMg = Math.max(targetAmount - state[0], 0.0);

  // Maintenance: replace elimination + redistribution
  const maintenanceRate = Math.max(
    p.k10 * targetAmount + p.k12 * targetAmount - p.k21 * state[1] + p.k13 * targetAmount - p.k31 * state[2],
    0.0,
  ); // mg/min

  const dilution = patient.dilution;
  const weight = patient.weight;

  return {
    bolusMg,
    bolusMl: dilution > 0 ? bolusMg / dilution : 0,
    bolusMcgPerKg: (bolusMg * 1000.0) / weight,
    infusionRateMgHr: maintenanceRate * 60.0,
    infusionRateMlHr: dilution > 0 ? (maintenanceRate * 60.0) / dilution : 0,
    infusionRateMcgKgHr: (maintenanceRate * 60.0 * 1000.0) / weight,
  };
}

/**
 * Swift `computeTCI` — `targetConcentration` is in display units; `currentState` is
 * `[x1, x2, x3, Ce]` (mg, mg, mg, mg/ml). Returns null for an unknown model id.
 */
export function computeTCI(
  modelId: string,
  patient: EnginePatient,
  currentState: CompartmentState,
  targetConcentration: number,
  targetType: TargetType,
): TCIResult | null {
  const p = pkParams(modelId, patient);
  if (!p) return null;

  // Convert display units → internal mg/ml
  const targetCp = targetConcentration / p.displayFactor;

  // For plasma targeting, use direct BET
  // For effect-site targeting, overshoot plasma (simplified for mock)
  let effectiveTargetCp: number;
  if (targetType === 'effectSite') {
    // Simplified overshoot: multiply by ratio to account for equilibration delay
    const currentCe = currentState[3];
    const currentCp = p.v1 > 0 ? currentState[0] / p.v1 : 0;
    if (currentCe < targetCp && currentCp < targetCp) {
      effectiveTargetCp = targetCp * 1.3; // 30% overshoot for faster Ce rise
    } else {
      effectiveTargetCp = targetCp;
    }
  } else {
    effectiveTargetCp = targetCp;
  }

  return computeBET(p, currentState, effectiveTargetCp, patient);
}
