import { describe, expect, it } from 'vitest';
import { newCase } from '../api/factory';
import { newDrug } from './drugLedger';
import { bleeding, cumulativeBalance, gridFluidTotal, gridIntake, hourBalance } from './fluidBalance';
import { hoursBetween } from './monitoring';
import { POSITIONS } from './positions';
import { drugMarks, pendingPressures, setCell, setEvent, visibleMonitorLanes } from './timeGrid';

const T0 = '2026-11-20T10:00:00.000Z';
const at = (min: number) => new Date(new Date(T0).getTime() + min * 60_000).toISOString();

describe('clinician feedback 2026-11b — state', () => {
  it('sums the time-grid IV fluids per hour into the intake rows, and uses them in the balance', () => {
    const c = newCase('Dr. Demo');
    setCell(c.trans_record, 'fluido:Ringer lactato', 0, 500);
    setCell(c.trans_record, 'fluido:Ringer lactato', 30, 300);
    setCell(c.trans_record, 'fluido:Ringer lactato', 70, 500);
    setCell(c.trans_record, 'fluido:Gelatina succinilada', 65, 250);
    const grid = gridIntake(c.trans_record);
    expect(grid).toEqual({
      'Ingreso Critaloide': { '1hr': 800, '2hr': 500 },
      'Ingreso Coloide': { '2hr': 250 },
    });
    expect(gridFluidTotal(c.trans_record)).toBe(1550);

    const fb = c.fluid_balance;
    fb.matrix = { Diuresis: { '1hr': 100 }, Textiles: { '1hr': 50 }, Aspirador: { '1hr': 100, '2hr': 30 } };
    expect(bleeding(fb, '1hr')).toBe(150);
    expect(bleeding(fb, '3hr')).toBeNull();
    // 800 − (100 diuresis + 150 sangrado) = 550; 2hr: 750 − 30 = 720 (same as the server)
    expect(hourBalance(fb, '1hr', grid)).toBe(550);
    expect(cumulativeBalance(fb, '2hr', grid)).toBe(550 + 720);
    // a typed intake wins over the grid
    fb.matrix['Ingreso Critaloide'] = { '1hr': 1000 };
    expect(hourBalance(fb, '1hr', grid)).toBe(750);
    // an older typed "Sangrado" still counts when there is no breakdown
    expect(bleeding({ ...fb, matrix: { Sangrado: { '4hr': 80 } } }, '4hr')).toBe(80);
  });

  it('lists the columns whose blood pressure is pending, up to now and the end of anesthesia', () => {
    const c = newCase('Dr. Demo');
    const tr = c.trans_record;
    expect(pendingPressures(tr, Date.now())).toEqual([]); // no start time
    tr.inicio = T0;
    setCell(tr, 'fc', 0, 80);
    setCell(tr, 'ta_sys', 0, 120);
    setCell(tr, 'ta_sys', 10, 118);
    const now = new Date(at(22)).getTime();
    expect(pendingPressures(tr, now)).toEqual([5, 15, 20]);
    setEvent(tr, 15, 5); // termina anestesia at +15
    expect(pendingPressures(tr, now)).toEqual([5, 15]);
  });

  it('places each ledger letter at the column of its time; an infusion runs to its end', () => {
    const c = newCase('Dr. Demo');
    c.trans_record.inicio = T0;
    const a = { ...newDrug(), farmaco: 'Fentanilo', dose_value: 50, time: at(7) };
    const b = { ...newDrug(), farmaco: 'Noradrenalina', dose_value: 0.05, modo: 'infusion', time: at(15), fin: at(30) };
    const empty = { ...newDrug(), time: at(0) }; // no name: not marked
    const marks = drugMarks(c.trans_record, [empty, a, b], (i) => 'ABC'[i]!);
    expect(Object.fromEntries(marks)).toEqual({ 5: ['B'], 15: ['C'], 20: ['—'], 25: ['—'], 30: ['—'] });
  });

  it('starts a new drug row at the current minute (so it prints on the grid)', () => {
    expect(newDrug(new Date('2026-11-20T10:07:42.123Z')).time).toBe('2026-11-20T10:07:00.000Z');
  });

  it('hides the retired EKG row unless the case holds values in it', () => {
    const c = newCase('Dr. Demo');
    expect(visibleMonitorLanes(c.trans_record).map((l) => l.key)).not.toContain('ekg');
    setCell(c.trans_record, 'ekg', 0, 'Ritmo sinusal');
    expect(visibleMonitorLanes(c.trans_record).map((l) => l.key)).toContain('ekg');
  });

  it('computes the ischemia time, also over midnight', () => {
    expect(hoursBetween('11:00', '12:30')).toBe(1.5);
    expect(hoursBetween('23:30', '00:15')).toBe(0.75);
    expect(hoursBetween(null, '10:00')).toBeNull();
  });

  it('has the 17 position symbols of the reference sheet, with unique keys', () => {
    expect(POSITIONS).toHaveLength(17);
    expect(new Set(POSITIONS.map((p) => p.key)).size).toBe(17);
  });
});
