import { describe, expect, it } from 'vitest';
import { newCase } from '../api/factory';
import {
  fluidBalanceHasData,
  patientHasData,
  preAssessmentHasData,
  recoveryHasData,
  sectionCompletion,
  techniqueHasData,
  transRecordHasData,
} from './completion';

describe('hasData helpers (CaseCompletion.swift)', () => {
  it('a new case has no section data', () => {
    expect(Object.values(sectionCompletion(newCase('o')))).toEqual(Array(8).fill(false));
  });

  it('profile defaults and server derivations do not count', () => {
    const c = newCase('o');
    c.patient.profile.weight = 90;
    c.patient.imc = 31;
    c.fluid_balance.balance_total = { '1hr': 100 };
    c.recovery.totals = { ingreso: 8 };
    expect(patientHasData(c.patient)).toBe(false);
    expect(fluidBalanceHasData(c.fluid_balance)).toBe(false);
    expect(recoveryHasData(c.recovery)).toBe(false);
  });

  it('patient: any identity/lab field', () => {
    for (const mut of [
      (c: ReturnType<typeof newCase>) => (c.patient.nombre = 'N'),
      (c: ReturnType<typeof newCase>) => (c.patient.hb = 12),
      (c: ReturnType<typeof newCase>) => (c.patient.cama = '3'),
      (c: ReturnType<typeof newCase>) => (c.patient.hab = '201'),
    ]) {
      const c = newCase('o');
      mut(c);
      expect(patientHasData(c.patient)).toBe(true);
    }
  });

  it('preanesthetic: strings, booleans, scores, labs', () => {
    const a = newCase('o');
    a.pre_assessment.ayuno = true;
    expect(preAssessmentHasData(a.pre_assessment)).toBe(true);
    const b = newCase('o');
    b.pre_assessment.asa = 2;
    expect(preAssessmentHasData(b.pre_assessment)).toBe(true);
    const d = newCase('o');
    d.pre_assessment.labs = { glucosa: 90 };
    expect(preAssessmentHasData(d.pre_assessment)).toBe(true);
    const e = newCase('o');
    e.pre_assessment.tegumentos = 'normal';
    expect(preAssessmentHasData(e.pre_assessment)).toBe(true);
  });

  it('technique, monitoring, fluids, recovery, collections', () => {
    const c = newCase('o');
    c.technique.values = { x: true };
    expect(techniqueHasData(c.technique)).toBe(true);
    c.trans_record.basal.spo2 = 98;
    expect(transRecordHasData(c.trans_record)).toBe(true);
    const t = newCase('o');
    t.trans_record.basal.fr = 14; // Swift only checks fc/spo2/ta_sys
    expect(transRecordHasData(t.trans_record)).toBe(false);
    c.fluid_balance.blood_components = { paquete: true };
    expect(fluidBalanceHasData(c.fluid_balance)).toBe(true);
    c.recovery.alta_a_piso = 'sí';
    expect(recoveryHasData(c.recovery)).toBe(true);
    c.drugs.push({ id: 'd', label: 'A', farmaco: 'x', dose_value: null, dose_unit: 'mg', via: 'IV', time: null, rust_model_id: null });
    const s = sectionCompletion(c);
    expect(s.drugs).toBe(true);
    expect(s.newborn).toBe(false);
  });
});
