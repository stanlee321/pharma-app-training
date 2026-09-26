import { describe, expect, it } from 'vitest';
import { toEnginePatient } from '../engine/patient';
import { pesoIdeal } from './biometrics';
import { isFemale } from './sex';

describe('isFemale (single sex rule for engine, biometrics, chips, Review)', () => {
  it('only "female" is female; empty/unknown fall back to the male DTO default', () => {
    expect(isFemale('female')).toBe(true);
    expect(isFemale(' Female ')).toBe(true);
    expect(isFemale('male')).toBe(false);
    expect(isFemale('')).toBe(false);
    expect(isFemale('x')).toBe(false);
    expect(isFemale(null)).toBe(false);
  });

  it('engine and biometrics agree for an unknown value', () => {
    const p = { weight: 60, height: 160, age: 50, gender: '', dilution: 10 };
    expect(toEnginePatient(p).gender).toBe('male');
    expect(pesoIdeal(p)).toBe(pesoIdeal({ ...p, gender: 'male' }));
  });
});
