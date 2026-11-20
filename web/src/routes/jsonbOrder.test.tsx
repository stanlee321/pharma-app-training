import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { newCase } from '../api/factory';
import type { AnesthesiaCase } from '../api/types';
import { FLUID_HOURS, FLUID_ROWS } from '../state/fluidBalance';
import { MONITORING_OPTIONS } from '../state/monitoring';
import { ALDRETE_CRITERIA, ALDRETE_TIME_POINTS } from '../state/recovery';
import { renderApp, restHarness } from '../test/restHarness';
import { paths } from './paths';

/**
 * Postgres JSONB does not keep object key order. These tests feed cases whose dict-valued fields
 * arrive with their keys REVERSED (at every level) and check that every grid / list still renders
 * in the known form order, with each value in its own cell.
 */
function reversedKeys<T>(v: T): T {
  if (Array.isArray(v)) return v.map(reversedKeys) as T;
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .reverse()
        .map(([k, x]) => [k, reversedKeys(x)]),
    ) as T;
  }
  return v;
}

function shuffledCase(): AnesthesiaCase {
  const c = newCase('Dr. Demo');
  c.recovery.aldrete = Object.fromEntries(
    ALDRETE_CRITERIA.map((crit, i) => [crit, Object.fromEntries(ALDRETE_TIME_POINTS.map((tp) => [tp, i === 0 && tp === '20' ? 1 : 2]))]),
  );
  c.fluid_balance.matrix = Object.fromEntries(
    FLUID_ROWS.map((r, i) => [r.key, Object.fromEntries(FLUID_HOURS.map((h, j) => [h, (i + 1) * 100 + j]))]),
  );
  c.pre_assessment.labs = { urea: 30, creatinina: 0.9, glucosa: 95, hb: 13, hto: 40 };
  c.trans_record.monitoring = Object.fromEntries(MONITORING_OPTIONS.map((o) => [o, o !== 'BIS']));
  const shuffled = reversedKeys(c);
  // Sanity: the key order on the wire differs from the form order. (Integer-like keys such as the
  // Aldrete minutes always enumerate first, ascending, in JS — so "Al salir" comes last.)
  expect(Object.keys(shuffled.recovery.aldrete)[0]).toBe('Coloración');
  expect(Object.keys(shuffled.recovery.aldrete['Actividad']!)).toEqual(['0', '20', '60', '90', '120', 'Al salir']);
  expect(Object.keys(shuffled.fluid_balance.matrix)[0]).toBe('Recuperador');
  expect(Object.keys(shuffled.fluid_balance.matrix['NCL']!)[0]).toBe('5hr');
  expect(Object.keys(shuffled.pre_assessment.labs)[0]).toBe('hto');
  return shuffled;
}

const texts = (els: Iterable<Element>) => [...els].map((e) => e.textContent?.trim());

describe('JSONB key order never drives what is rendered', () => {
  it('Review: Aldrete totals in the form time-point order', async () => {
    const c = shuffledCase();
    renderApp(paths.review(c.id), restHarness([c]).backend);
    const section = (await screen.findByRole('heading', { name: 'Aldrete (recuperación)', level: 2 })).closest('section')!;
    expect(texts(section.querySelectorAll('.row__label'))).toEqual([...ALDRETE_TIME_POINTS]);
    expect(texts(section.querySelectorAll('.review-row__value'))).toEqual(['10 / 10', '10 / 10', '9 / 10', '10 / 10', '10 / 10', '10 / 10']);
  });

  it('Recovery: Aldrete grid rows/columns in form order, each score in its own cell', async () => {
    const c = shuffledCase();
    renderApp(paths.recovery(c.id), restHarness([c]).backend);
    const table = (await screen.findByRole('table', { name: 'Aldrete' })) as HTMLTableElement;
    expect(texts(table.tHead!.querySelectorAll('th')).slice(1)).toEqual([...ALDRETE_TIME_POINTS]);
    const rowHeads = texts(table.tBodies[0]!.querySelectorAll('th[scope="row"]'));
    expect(rowHeads).toEqual([...ALDRETE_CRITERIA, 'TOTAL']);
    // The single 1 is Actividad @ 20.
    const checked = (label: string) =>
      (screen.getByRole('group', { name: label }).querySelector('input:checked') as HTMLInputElement | null)?.value;
    expect(checked('Actividad 20')).toBe('1');
    expect(checked('Actividad 0')).toBe('2');
    expect(screen.getByTestId('aldrete-total-20')).toHaveTextContent('9');
  });

  it('Fluid balance: rows and hours in form order, values in the right cells', async () => {
    const c = shuffledCase();
    renderApp(paths.fluids(c.id), restHarness([c]).backend);
    const table = (await screen.findByRole('table', { name: /Balance hídrico horario/ })) as HTMLTableElement;
    expect(texts(table.tHead!.querySelectorAll('th')).slice(1)).toEqual([...FLUID_HOURS]);
    expect(texts(table.tBodies[0]!.querySelectorAll('th[scope="row"]')).slice(0, FLUID_ROWS.length)).toEqual(
      FLUID_ROWS.map((r) => r.label),
    );
    expect(screen.getByLabelText('Cristaloide 1hr')).toHaveValue('100');
    expect(screen.getByLabelText('NCL 3hr')).toHaveValue('402');
    expect(screen.getByLabelText('Sangrado · Recuperador 5hr')).toHaveValue('1104');
  });

  it('Preanesthetic: labs in the form order with their own values', async () => {
    const c = shuffledCase();
    renderApp(paths.preanesthetic(c.id), restHarness([c]).backend);
    const section = (await screen.findByRole('heading', { name: 'Laboratorios', level: 2 })).closest('section')!;
    expect(texts(section.querySelectorAll('label'))).toEqual(['Urea', 'Creatinina', 'Glucosa', 'Hb', 'Hto', 'Plaquetas (PTL)', 'TP', 'TPT', 'INR']);
    expect([...section.querySelectorAll('input')].map((i) => i.value)).toEqual(['30', '0.9', '95', '13', '40', '', '', '', '']);
  });

  it('Monitoring: chips in the form order', async () => {
    const c = shuffledCase();
    renderApp(paths.monitoring(c.id), restHarness([c]).backend);
    const group = await screen.findByRole('group', { name: 'Monitorización' });
    const chips = [...group.querySelectorAll('button')];
    expect(texts(chips)).toEqual([...MONITORING_OPTIONS]);
    expect(chips.map((b) => b.getAttribute('aria-pressed'))).toEqual(MONITORING_OPTIONS.map((o) => String(o !== 'BIS')));
  });
});
