import type { PatientProfile } from '../api/types';
import { isFemale } from './sex';

/*
 * Derived biometrics shown read-only on Patient Data — exact ports of the Swift
 * `PatientRecord.imc / pesoIdeal / vsc` computed properties (Models/ClinicalRecord.swift).
 * Client-computed for live feedback; never sent as authoritative (the server re-stamps its own).
 */

/** Body-mass index (kg/m²); 0 when height is 0 (Swift guard). */
export function imc(p: Pick<PatientProfile, 'weight' | 'height'>): number {
  const m = p.height / 100;
  return m > 0 ? p.weight / (m * m) : 0;
}

/** Devine ideal body weight (kg): 50 (male) / 45.5 (female) + 2.3 kg per inch over 60 in. */
export function pesoIdeal(p: Pick<PatientProfile, 'height' | 'gender'>): number {
  const inchesOver60 = Math.max(0, p.height / 2.54 - 60);
  const base = isFemale(p.gender) ? 45.5 : 50.0;
  return base + 2.3 * inchesOver60;
}

/** Estimated blood volume (~70 ml/kg). */
export function vsc(p: Pick<PatientProfile, 'weight'>): number {
  return p.weight * 70;
}
