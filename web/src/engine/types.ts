/**
 * Engine-crossing types — port of PharmaApp/Models/SimulationTypes.swift (the subset computeTCI
 * needs) and PharmaApp/Models/PatientProfile.swift. Field names are camelCase like Swift: these
 * never cross the wire (the TCI recommendation is a client-side decision aid, ADR-5).
 */

/** Swift `PatientProfile`. Units: kg, cm, years, mg/ml. */
export interface EnginePatient {
  weight: number;
  height: number;
  age: number;
  gender: 'male' | 'female';
  dilution: number;
}

/** Swift `TargetType`. */
export type TargetType = 'plasma' | 'effectSite';

/** Swift `TCIResult` — what bolus/infusion hits the target. */
export interface TCIResult {
  bolusMg: number;
  bolusMl: number;
  bolusMcgPerKg: number;
  infusionRateMgHr: number;
  infusionRateMlHr: number;
  infusionRateMcgKgHr: number;
}

/**
 * Engine state `[x1, x2, x3, Ce]`: x1–x3 in mg (amounts in V1/V2/V3), Ce in mg/ml (internal units).
 */
export type CompartmentState = readonly [number, number, number, number];

export const ZERO_STATE: CompartmentState = [0, 0, 0, 0];

/** Swift `ConcentrationUnit`. */
export type ConcentrationUnit = 'mcg/ml' | 'ng/ml';
