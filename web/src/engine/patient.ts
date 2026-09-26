import type { PatientProfile } from '../api/types';
import type { EnginePatient } from './types';
import { isFemale } from '../lib/sex';

/**
 * Lean Body Mass (James formula) — used by Schnider and Minto. Exact port of Swift
 * `PatientProfile.leanBodyMass`:
 *   male   1.1  · W − 128 · (W/H)²
 *   female 1.07 · W − 148 · (W/H)²
 */
export function leanBodyMass(p: EnginePatient): number {
  const ratio = p.weight / p.height;
  switch (p.gender) {
    case 'male':
      return 1.1 * p.weight - 128.0 * ratio * ratio;
    case 'female':
      return 1.07 * p.weight - 148.0 * ratio * ratio;
  }
}

/**
 * Wire `PatientProfileDTO` (gender is a free string) → engine patient, via the shared `isFemale`
 * rule (anything other than "female" is male, the DTO default; Swift would fail to decode it).
 */
export function toEnginePatient(p: PatientProfile): EnginePatient {
  return {
    weight: p.weight,
    height: p.height,
    age: p.age,
    gender: isFemale(p.gender) ? 'female' : 'male',
    dilution: p.dilution,
  };
}

/** Swift `PatientProfile.defaultMale` — also the "Standard Adult Male" of 04_Validation_Reference. */
export const DEFAULT_MALE: EnginePatient = { weight: 70, height: 170, age: 40, gender: 'male', dilution: 10.0 };

/** Swift `PatientProfile.defaultFemale` — also the "Standard Adult Female" of 04_Validation_Reference. */
export const DEFAULT_FEMALE: EnginePatient = { weight: 60, height: 160, age: 50, gender: 'female', dilution: 10.0 };
