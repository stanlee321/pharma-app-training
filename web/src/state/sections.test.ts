import { describe, expect, it } from 'vitest';
import { newCase } from '../api/factory';
import { matchedModel, pickerLabel, DRUG_MODELS } from '../lib/drugModels';
import { drugIsIncomplete, newDrug, rowLetter } from './drugLedger';
import {
  cumulativeBalance,
  formatMl,
  hourBalance,
  legacyRowsPresent,
  migrateLegacyRows,
  setCell,
} from './fluidBalance';
import { trendSamples } from './monitoring';
import { aldreteColumnTotal, setAldreteCell, ALDRETE_CRITERIA } from './recovery';

describe('drug ledger helpers', () => {
  it('matchedModel mirrors Swift (picker label or bare drug name, first match, trimmed)', () => {
    expect(DRUG_MODELS.map(pickerLabel)).toEqual([
      'Propofol [Marsh]',
      'Propofol [Schnider]',
      'Remifentanil [Minto]',
      'Dexmedetomidine [Hannivoort]',
    ]);
    expect(matchedModel('Propofol')?.rustModelId).toBe('marsh');
    expect(matchedModel('  Propofol [Schnider] ')?.rustModelId).toBe('schnider');
    expect(matchedModel('Dexmedetomidine')?.rustModelId).toBe('hannivoort');
    expect(matchedModel('Remifentanil')?.rustModelId).toBe('minto');
    expect(matchedModel('propofol')).toBeUndefined(); // case-sensitive, as Swift ==
    expect(matchedModel('')).toBeUndefined();
  });
  it('incomplete = no name or no dose; letters A…', () => {
    const d = newDrug();
    expect(drugIsIncomplete(d)).toBe(true);
    expect(drugIsIncomplete({ ...d, farmaco: ' x ', dose_value: 0 })).toBe(false);
    expect(drugIsIncomplete({ ...d, farmaco: '  ', dose_value: 5 })).toBe(true);
    expect([0, 14, 25, 26].map(rowLetter)).toEqual(['A', 'O', 'Z', '27']);
  });
});

describe('fluid balance helpers', () => {
  it('balance = backend intake − losses per hour; blanks are 0; format trims .0', () => {
    const f = newCase('x').fluid_balance;
    setCell(f, 'NCL', '1hr', 100); // loss, as in derivations._LOSS_ROWS
    setCell(f, 'Ingreso Coloide', '1hr', 250.25);
    setCell(f, 'Ingreso hemocomponente', '1hr', 50);
    setCell(f, 'Diuresis', '1hr', 20);
    setCell(f, 'Circuito respiratorio', '2hr', 30);
    expect(hourBalance(f, '1hr')).toBeCloseTo(180.25);
    expect(hourBalance(f, '2hr')).toBe(-30);
    expect(cumulativeBalance(f, '2hr')).toBeCloseTo(150.25);
    expect(cumulativeBalance(f, '5hr')).toBeCloseTo(150.25);
    expect(formatMl(130)).toBe('130');
    expect(formatMl(-50.25)).toBe('-50.3');
    setCell(f, 'Ingreso Coloide', '1hr', null);
    expect(f.matrix).toEqual({
      NCL: { '1hr': 100 },
      'Ingreso hemocomponente': { '1hr': 50 },
      Diuresis: { '1hr': 20 },
      'Circuito respiratorio': { '2hr': 30 },
    });
  });

  it('migrates legacy Swift rows only into empty canonical cells', () => {
    const f = newCase('x').fluid_balance;
    f.matrix = { Cristaloide: { '1hr': 400, '2hr': 10 }, 'Ingreso Critaloide': { '2hr': 99 } };
    expect(legacyRowsPresent(f)).toEqual(['Cristaloide']);
    expect(migrateLegacyRows(f)).toBe(1);
    expect(f.matrix).toEqual({ Cristaloide: { '2hr': 10 }, 'Ingreso Critaloide': { '1hr': 400, '2hr': 99 } });
  });
});

describe('recovery helpers', () => {
  it('column total is null until all five criteria are scored', () => {
    const r = newCase('x').recovery;
    for (const c of ALDRETE_CRITERIA.slice(0, 4)) setAldreteCell(r, c, '0', 2);
    expect(aldreteColumnTotal(r, '0')).toBeNull();
    setAldreteCell(r, 'Coloración', '0', 1);
    expect(aldreteColumnTotal(r, '0')).toBe(9);
  });
});

describe('monitoring trend samples', () => {
  it('skips missing values and metrics with no data', () => {
    const tr = newCase('x').trans_record;
    expect(trendSamples(tr.basal, tr.termination)).toEqual([]);
    tr.basal.fc = 80;
    tr.termination.spo2 = 97;
    const s = trendSamples(tr.basal, tr.termination);
    expect(s.map((m) => [m.name, m.points])).toEqual([
      ['FC', [{ x: 0, value: 80 }]],
      ['SpO₂', [{ x: 1, value: 97 }]],
    ]);
  });
});
