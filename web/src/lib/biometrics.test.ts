import { describe, expect, it } from 'vitest';
import { imc, pesoIdeal, vsc } from './biometrics';

describe('derived biometrics (Swift PatientRecord parity)', () => {
  it('default male 70 kg / 170 cm', () => {
    const p = { weight: 70, height: 170, gender: 'male' };
    expect(imc(p).toFixed(1)).toBe('24.2');
    // 170/2.54 = 66.929 in → 6.929 in over 60 → 50 + 15.937
    expect(pesoIdeal(p).toFixed(1)).toBe('65.9');
    expect(vsc(p).toFixed(0)).toBe('4900');
  });

  it('female base 45.5 and no negative inches below 60 in', () => {
    expect(pesoIdeal({ height: 161, gender: 'female' }).toFixed(1)).toBe('53.3');
    expect(pesoIdeal({ height: 100, gender: 'female' })).toBe(45.5);
    expect(pesoIdeal({ height: 100, gender: 'male' })).toBe(50);
  });

  it('IMC is 0 for zero height (Swift guard)', () => {
    expect(imc({ weight: 70, height: 0 })).toBe(0);
  });
});
