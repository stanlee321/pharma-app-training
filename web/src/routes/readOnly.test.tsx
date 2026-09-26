import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { newCase } from '../api/factory';
import type { AnesthesiaCase, CaseStatus } from '../api/types';
import { newDrug } from '../state/drugLedger';
import { newNewborn } from '../state/newborns';
import { caseStore } from '../state/caseStore';
import { renderApp, restHarness } from '../test/restHarness';
import { paths } from './paths';

/** A synthetic case with data in every section (incl. growable lists and a legacy fluid row). */
function fullCase(status: CaseStatus): AnesthesiaCase {
  const c = newCase('Dr. Demo');
  c.status = status;
  c.finalized_at = status === 'finalized' ? '2026-09-25T12:00:00Z' : null;
  c.patient.nombre = 'Paciente Demo (sintético)';
  c.patient.registro = 'TEST-0001';
  c.patient.hb = 13;
  c.diagnostico_preop = 'Dx demo';
  c.pre_assessment.alergia = 'Ninguna';
  c.pre_assessment.asa = 2;
  c.pre_assessment.labs = { urea: 30 };
  c.technique.modality = 'AGEV';
  c.technique.values = { induccion_propofol: true, induccion_propofol_val: 120 };
  c.trans_record.monitoring = { ECG: true };
  c.trans_record.basal.fc = 80;
  c.drugs = [{ ...newDrug(), farmaco: 'Propofol', dose_value: 120, rust_model_id: 'marsh' }];
  c.fluid_balance.matrix = { 'Ingreso Critaloide': { '1hr': 500 }, Cristaloide: { '2hr': 100 } };
  c.recovery.aldrete = { Actividad: { 'Al salir': 2 } };
  c.recovery.alta_a_piso = 'URPA';
  c.newborns = [{ ...newNewborn(), sexo: 'F', peso_gramos: 3100, apgar1: 8 }];
  return c;
}

/** Every case-scoped section screen. */
const SCREENS: [name: string, path: (id: string) => string][] = [
  ['Encounter Hub', paths.hub],
  ['Patient Data', paths.patient],
  ['Preanesthetic', paths.preanesthetic],
  ['Technique · General', (id) => paths.technique(id, 'general')],
  ['Technique · Neuraxial', (id) => paths.technique(id, 'neuraxial')],
  ['Technique · Peripheral', (id) => paths.technique(id, 'peripheral')],
  ['Monitoring', paths.monitoring],
  ['Drug Ledger', paths.drugs],
  ['Fluid Balance', paths.fluids],
  ['Recovery', paths.recovery],
  ['Newborn', paths.newborn],
  ['Review & Export', paths.review],
];

const CONTROLS = 'input, select, textarea, button';

async function openForm(status: CaseStatus, path: (id: string) => string) {
  const c = fullCase(status);
  const h = restHarness([c]);
  renderApp(path(c.id), h.backend);
  await screen.findByRole('button', { name: 'Save' });
  const form = document.querySelector('fieldset.readonly-scope') as HTMLFieldSetElement;
  expect(form).not.toBeNull();
  return { c, h, form };
}

describe('finalized case: every section screen is read-only (one mechanism)', () => {
  it.each(SCREENS)('%s', async (_name, path) => {
    const { c, h, form } = await openForm('finalized', path);

    expect(screen.getByTestId('readonly-banner')).toHaveTextContent('Finalized — read-only');
    expect(screen.getByText('Finalized', { selector: '.status-badge' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    // Every control of the case form is disabled …
    const controls = [...form.querySelectorAll<HTMLElement>(CONTROLS)];
    for (const el of controls) expect(el).toBeDisabled();
    // … and those rendered by the shared controls are disabled by the context itself, not only
    // by the surrounding fieldset (raw screen-specific inputs rely on the fieldset).
    for (const el of form.querySelectorAll<HTMLInputElement>('input.row__input, input.grid-cell, input[role="switch"], .chip, .segmented input, .repeat-button')) {
      expect(el).toHaveProperty('disabled', true);
    }
    // No add / delete / migrate affordances.
    expect(within(form).queryByRole('button', { name: /^(Add|Delete|Mover)/ })).toBeNull();
    expect(screen.queryByText(/^Add (drug|newborn)$/)).toBeNull();

    // Typing into the first text field changes nothing and sends nothing.
    const first = controls.find((e) => e instanceof HTMLInputElement && e.type === 'text') as HTMLInputElement | undefined;
    if (first) {
      const before = first.value;
      await userEvent.setup().type(first, '9');
      expect(first).toHaveValue(before);
    }
    expect(caseStore.getState().updateCase(c.id, (d) => void (d.sala = 'X'))).toBe(false);
    expect(caseStore.getState().isDirty(c.id)).toBe(false);
    expect(h.puts).toHaveLength(0);
  });
});

describe('draft case: the same screens stay editable', () => {
  it.each(SCREENS)('%s', async (_name, path) => {
    const { form } = await openForm('draft', path);
    expect(screen.queryByTestId('readonly-banner')).toBeNull();
    expect(screen.getByText('Draft', { selector: '.status-badge' })).toBeInTheDocument();
    expect(form.disabled).toBe(false);
    const enabled = [...form.querySelectorAll<HTMLElement>(CONTROLS)].filter((e) => !(e as HTMLInputElement).disabled);
    if (path !== paths.review) expect(enabled.length).toBeGreaterThan(0);
  });
});
