/**
 * Engine regression tests against docs/reference/rust-engine-spec/04_Validation_Reference.md
 * ("the reference"). Every expected number below is copied from that document (section noted),
 * or — where stated — derived arithmetically from the reference's own constants with a formula
 * quoted from 01_Models.md / 02_TCI_Algorithm.md. No value comes from running the Swift engine.
 *
 * TOLERANCE: parameters are compared with a RELATIVE tolerance of 0.5 % (`REL`). The reference
 * prints values rounded to 2–5 significant figures (e.g. Marsh k31 "0.0033" vs exact
 * 0.0042·228/2893 = 0.003310, a 0.3 % rounding gap; Schnider k31 "0.0035" vs 0.003513) and rounds
 * the James LBM to 55.31 kg (exact 55.298), which moves Schnider Cl1 by 0.05 %. Values the reference
 * gives as exact products (Marsh V1 = 228·70, fixed constants) are checked to 1e-9.
 *
 * GAPS — the reference has NO hand-calculated values for:
 *   - the Standard Adult Female and Elderly profiles (it lists the profiles, but no parameters);
 *   - Hannivoort at a weight other than 70 kg (so the allometric exponent is only exercised at 1);
 *   - any computeTCI infusion rate (§4 Test Case 1 gives only the bolus; Test Case 2's
 *     R = Cp·Cl1 is a steady-state rate, not the BET zero-state rate);
 *   - effect-site targeting (02_TCI §4 specifies a bisection search; the mock engine's 30 %
 *     overshoot is not in any spec, so it is only sanity-checked, not value-checked).
 */
import { describe, expect, it } from 'vitest';
import {
  computeTCI,
  displayToInternal,
  hannivoortParams,
  internalToDisplay,
  marshParams,
  mintoParams,
  pkParams,
  schniderParams,
  type PKParams,
} from './mockPKEngine';
import { DEFAULT_FEMALE, DEFAULT_MALE, leanBodyMass, toEnginePatient } from './patient';
import { ZERO_STATE } from './types';
import { DRUG_DATABASE, validationRules } from './drugDatabase';

const REL = 0.005; // 0.5 % — see header

function expectRel(actual: number, expected: number, rel = REL) {
  const err = Math.abs(actual - expected) / Math.abs(expected);
  expect(err, `${actual} vs reference ${expected} (rel err ${(err * 100).toFixed(3)} %)`).toBeLessThanOrEqual(rel);
}

type Ref = Partial<Record<keyof PKParams, number>>;
function expectParams(p: PKParams, ref: Ref) {
  for (const [k, v] of Object.entries(ref) as [keyof PKParams, number][]) expectRel(p[k], v);
}

/** Reference §2 "Standard Adult Male": 70 kg, 170 cm, 40 yr, male, 10 mg/ml. */
const STD_MALE = DEFAULT_MALE;

describe('patient helpers', () => {
  it('Standard Adult Male profile matches reference §2', () => {
    expect(STD_MALE).toEqual({ weight: 70, height: 170, age: 40, gender: 'male', dilution: 10 });
    expect(DEFAULT_FEMALE).toEqual({ weight: 60, height: 160, age: 50, gender: 'female', dilution: 10 });
  });

  it('James LBM, male = 55.31 kg (reference §3.2)', () => {
    expectRel(leanBodyMass(STD_MALE), 55.31);
  });

  it('James LBM, female uses 1.07·W − 148·(W/H)² (01_Models formula; reference has no value)', () => {
    // 1.07·60 − 148·(60/160)² = 64.2 − 20.8125 = 43.3875 (hand arithmetic from the spec formula).
    expect(leanBodyMass(DEFAULT_FEMALE)).toBeCloseTo(43.3875, 9);
  });

  it('maps the wire profile (gender string) onto the engine patient', () => {
    expect(toEnginePatient({ weight: 60, height: 160, age: 50, gender: 'female', dilution: 10 }).gender).toBe('female');
    expect(toEnginePatient({ weight: 60, height: 160, age: 50, gender: 'male', dilution: 10 }).gender).toBe('male');
    expect(toEnginePatient({ weight: 60, height: 160, age: 50, gender: '', dilution: 10 }).gender).toBe('male');
  });
});

describe('model parameters vs 04_Validation_Reference §3 (Standard Male)', () => {
  it('§3.1 Marsh', () => {
    const p = marshParams(STD_MALE);
    // Exact products in the reference.
    expect(p.v1).toBeCloseTo(15960, 9);
    expect(p.v2).toBeCloseTo(32410, 9);
    expect(p.v3).toBeCloseTo(202510, 9);
    expect(p.k10).toBeCloseTo(0.119, 12);
    expect(p.k12).toBeCloseTo(0.112, 12);
    expect(p.k13).toBeCloseTo(0.042, 12);
    expect(p.ke0).toBe(0.26);
    expect(p.cl1).toBeCloseTo(1899.24, 6);
    expect(p.cl2).toBeCloseTo(1787.52, 6);
    expect(p.cl3).toBeCloseTo(670.32, 6);
    // Rounded in the reference (derived k21 = Cl2/V2, k31 = Cl3/V3).
    expectParams(p, { k21: 0.055, k31: 0.0033 });
  });

  it('§3.2 Schnider (post-2026-09-16 fix: V3 = 238 L, V2 age term)', () => {
    const p = schniderParams(STD_MALE);
    expect(p.v1).toBe(4270);
    expect(p.v3).toBe(238000);
    expect(p.ke0).toBe(0.456);
    expectParams(p, {
      v2: 23983.0,
      cl1: 1637.3,
      cl2: 1602.0,
      cl3: 836.0,
      k10: 0.3835,
      k12: 0.3752,
      k21: 0.0668,
      k13: 0.1958,
      k31: 0.0035,
    });
  });

  it('§3.3 Minto', () => {
    const p = mintoParams(STD_MALE);
    expectParams(p, {
      v1: 5122.3,
      v2: 9853.3,
      v3: 5420.0,
      cl1: 2605.9,
      cl2: 2050.0,
      cl3: 76.0,
      k10: 0.5088,
      k12: 0.4002,
      k21: 0.2081,
      k13: 0.01484,
      k31: 0.01402,
      ke0: 0.595,
    });
  });

  it('§3.4 Hannivoort', () => {
    const p = hannivoortParams(STD_MALE);
    expectParams(p, {
      v1: 1780,
      v2: 30300,
      v3: 52000,
      cl1: 686.0,
      cl2: 2980.0,
      cl3: 602.0,
      k10: 0.3854,
      k12: 1.6742,
      k21: 0.09835,
      k13: 0.3382,
      k31: 0.01158,
      ke0: 1.09,
    });
  });

  it('pkParams dispatches the four model ids and rejects unknown ones', () => {
    expect(pkParams('marsh', STD_MALE)?.v1).toBeCloseTo(15960, 9);
    expect(pkParams('schnider', STD_MALE)?.v1).toBe(4270);
    expect(pkParams('minto', STD_MALE)?.v3).toBe(5420);
    expect(pkParams('hannivoort', STD_MALE)?.ke0).toBe(1.09);
    expect(pkParams('eleveld', STD_MALE)).toBeNull();
    expect(computeTCI('eleveld', STD_MALE, ZERO_STATE, 3, 'plasma')).toBeNull();
  });
});

describe('computeTCI from the zero state (plasma target)', () => {
  it('§4 Test Case 1: Marsh, Cp 4 mcg/ml → 63.84 mg = 6.384 ml = 912 mcg/kg', () => {
    const r = computeTCI('marsh', STD_MALE, ZERO_STATE, 4.0, 'plasma')!;
    expect(r.bolusMg).toBeCloseTo(63.84, 9);
    expect(r.bolusMl).toBeCloseTo(6.384, 9);
    expect(r.bolusMcgPerKg).toBeCloseTo(912, 9);
  });

  it('Marsh zero-state maintenance = (k10+k12+k13)·Cp·V1 (02_TCI §3, reference §3.1 constants)', () => {
    // NOT in the reference as a value: derived from its §3.1 constants and the 02_TCI §3 BET formula
    // with x2 = x3 = 0 → (0.119 + 0.112 + 0.042) · 63.84 mg = 17.42832 mg/min.
    const r = computeTCI('marsh', STD_MALE, ZERO_STATE, 4.0, 'plasma')!;
    expect(r.infusionRateMgHr).toBeCloseTo(17.42832 * 60, 6);
    expect(r.infusionRateMlHr).toBeCloseTo((17.42832 * 60) / 10, 6);
    expect(r.infusionRateMcgKgHr).toBeCloseTo((17.42832 * 60 * 1000) / 70, 4);
  });

  it('§6 Zero Target: bolus 0 and infusion 0', () => {
    for (const id of ['marsh', 'schnider', 'minto', 'hannivoort']) {
      const r = computeTCI(id, STD_MALE, ZERO_STATE, 0, 'plasma')!;
      expect(r).toEqual({
        bolusMg: 0,
        bolusMl: 0,
        bolusMcgPerKg: 0,
        infusionRateMgHr: 0,
        infusionRateMlHr: 0,
        infusionRateMcgKgHr: 0,
      });
    }
  });

  it('§6 Very Small Target 0.001 mcg/ml keeps precision (bolus = 0.001/1000 · V1)', () => {
    const r = computeTCI('marsh', STD_MALE, ZERO_STATE, 0.001, 'plasma')!;
    expect(r.bolusMg).toBeCloseTo(0.01596, 12);
    expect(r.bolusMg).toBeGreaterThan(0);
  });

  it('bolus is Cp·V1 for every model (reference §3 V1 values, display → mg/ml)', () => {
    // Schnider 3 mcg/ml · 4270 ml; Minto 4 ng/ml · 5122.3 ml; Hannivoort 1 ng/ml · 1780 ml.
    expectRel(computeTCI('schnider', STD_MALE, ZERO_STATE, 3, 'plasma')!.bolusMg, 0.003 * 4270);
    expectRel(computeTCI('minto', STD_MALE, ZERO_STATE, 4, 'plasma')!.bolusMg, 4e-6 * 5122.3);
    expectRel(computeTCI('hannivoort', STD_MALE, ZERO_STATE, 1, 'plasma')!.bolusMg, 1e-6 * 1780);
  });

  it('dilution 0 yields 0 ml (Swift guard), a non-zero state lowers the bolus and maintenance', () => {
    const noDil = computeTCI('marsh', { ...STD_MALE, dilution: 0 }, ZERO_STATE, 4, 'plasma')!;
    expect(noDil.bolusMl).toBe(0);
    expect(noDil.infusionRateMlHr).toBe(0);
    expect(noDil.bolusMg).toBeCloseTo(63.84, 9);
    // 10 mg already in V1 → bolus 53.84 mg; drug in V2/V3 returns, so maintenance drops by k21·x2 + k31·x3.
    const loaded = computeTCI('marsh', STD_MALE, [10, 20, 30, 0], 4, 'plasma')!;
    expect(loaded.bolusMg).toBeCloseTo(53.84, 9);
    const p = marshParams(STD_MALE);
    expect(loaded.infusionRateMgHr).toBeCloseTo((17.42832 - p.k21 * 20 - p.k31 * 30) * 60, 6);
    // Above target: no bolus.
    expect(computeTCI('marsh', STD_MALE, [100, 0, 0, 0], 4, 'plasma')!.bolusMg).toBe(0);
  });

  it('effect-site sanity (reference has no values): from zero, never below the plasma dose', () => {
    const cp = computeTCI('schnider', STD_MALE, ZERO_STATE, 3, 'plasma')!;
    const ce = computeTCI('schnider', STD_MALE, ZERO_STATE, 3, 'effectSite')!;
    expect(ce.bolusMg).toBeGreaterThan(cp.bolusMg);
    expect(ce.infusionRateMgHr).toBeGreaterThan(cp.infusionRateMgHr);
  });
});

describe('unit conversion display ↔ internal', () => {
  it('propofol ×1000 (mcg/ml), remifentanil / dexmedetomidine ×1e6 (ng/ml) — 01_Models §units', () => {
    const marsh = marshParams(STD_MALE);
    const minto = mintoParams(STD_MALE);
    const hann = hannivoortParams(STD_MALE);
    expect(marsh.displayFactor).toBe(1000);
    expect(schniderParams(STD_MALE).displayFactor).toBe(1000);
    expect(minto.displayFactor).toBe(1_000_000);
    expect(hann.displayFactor).toBe(1_000_000);
    expect(displayToInternal(marsh, 4)).toBeCloseTo(0.004, 15); // 4 mcg/ml = 0.004 mg/ml
    expect(displayToInternal(minto, 4)).toBeCloseTo(4e-6, 18); // 4 ng/ml = 4e-6 mg/ml
    expect(internalToDisplay(marsh, displayToInternal(marsh, 3.5))).toBeCloseTo(3.5, 12);
    expect(internalToDisplay(hann, displayToInternal(hann, 0.7))).toBeCloseTo(0.7, 12);
    // Reference §4 Test Case 1: 4 mcg/ml · 15960 ml = 63840 mcg = 63.84 mg.
    expect(displayToInternal(marsh, 4) * marsh.v1).toBeCloseTo(63.84, 9);
  });

  it('drug database units + dilutions come from drug_models.json', () => {
    expect(DRUG_DATABASE.map((m) => [m.rustModelId, m.concentrationUnit, m.defaultDilutionMgMl])).toEqual([
      ['marsh', 'mcg/ml', 10],
      ['schnider', 'mcg/ml', 10],
      ['minto', 'ng/ml', 0.02],
      ['hannivoort', 'ng/ml', 0.004],
    ]);
    expect(validationRules('schnider')).toMatchObject({ minAge: 18, requiresHeight: true });
    expect(validationRules('nope')).toBeNull();
  });
});
