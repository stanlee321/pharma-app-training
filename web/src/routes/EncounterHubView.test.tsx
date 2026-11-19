import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { newCase } from '../api/factory';
import type { AnesthesiaCase } from '../api/types';
import { caseStore } from '../state/caseStore';
import { fakePatient, renderApp, restHarness, storeCase, TEST_TOKEN } from '../test/restHarness';

function seedCase(): AnesthesiaCase {
  const c = newCase('Dr. Demo', new Date('2026-01-01T08:00:00Z'));
  c.patient.nombre = 'Paciente Sintético Hub';
  c.diagnostico_preop = 'Dx de ejemplo';
  c.technique.values = { nivel: 'L3–L4' }; // neuraxial-only data
  return c;
}

const rowLink = (name: RegExp | string) => screen.getByRole('link', { name });

describe('EncounterHubView', () => {
  let c: AnesthesiaCase;
  beforeEach(() => {
    c = seedCase();
  });

  it('loads the full aggregate and renders envelope + every section row with completion', async () => {
    const h = restHarness([c]);
    renderApp(`/cases/${c.id}`, h.backend);
    expect(await screen.findByRole('heading', { name: 'Paciente Sintético Hub', level: 1 })).toBeInTheDocument();
    expect(h.fetch.mock.calls.some(([u, i]) => String(u) === `/api/v1/cases/${c.id}` && (i?.method ?? 'GET') === 'GET')).toBe(true);

    expect(screen.getByLabelText('Diagnóstico preop')).toHaveValue('Dx de ejemplo');
    expect(screen.getByLabelText('Sala')).toHaveValue('');
    expect(screen.getByLabelText('Servicio')).toHaveValue('');

    const expected: [RegExp, string][] = [
      [/^Datos del paciente/, `/cases/${c.id}/patient`],
      [/^Valoración preanestésica/, `/cases/${c.id}/preanesthetic`],
      [/^Técnica anestésica · General/, `/cases/${c.id}/technique/general`],
      [/^Técnica anestésica · Regional neuroaxial/, `/cases/${c.id}/technique/neuraxial`],
      [/^Técnica anestésica · Bloqueo periférico/, `/cases/${c.id}/technique/peripheral`],
      [/^Registro transanestésico/, `/cases/${c.id}/monitoring`],
      [/^Fármacos administrados/, `/cases/${c.id}/drugs`],
      [/^Balance de líquidos/, `/cases/${c.id}/fluids`],
      [/^Recuperación \(Aldrete\)/, `/cases/${c.id}/recovery`],
      [/^Recién nacido/, `/cases/${c.id}/newborn`],
      [/^Revisión y exportación/, `/cases/${c.id}/review`],
    ];
    for (const [name, href] of expected) expect(rowLink(name)).toHaveAttribute('href', href);

    // Completion: patient has a name → green; neuraxial has a key → green; general → blue.
    expect(rowLink(/^Datos del paciente/)).toHaveClass('link-row--filled');
    expect(within(rowLink(/^Datos del paciente/)).getByTitle('Completado')).toBeInTheDocument();
    expect(rowLink(/Regional neuroaxial/)).toHaveClass('link-row--filled');
    expect(rowLink(/Técnica anestésica · General/)).not.toHaveClass('link-row--filled');
    expect(rowLink(/^Valoración preanestésica/)).not.toHaveClass('link-row--filled');
    expect(rowLink(/^Revisión y exportación/)).not.toHaveClass('link-row--filled');
  });

  it('edits the envelope into the store draft and Save PUTs snake_case keys', async () => {
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}`, h.backend);
    await user.type(await screen.findByLabelText('Sala'), 'Q-7');
    await user.clear(screen.getByLabelText('Diagnóstico preop'));
    await user.type(screen.getByLabelText('Diagnóstico preop'), 'Dx editado');
    expect(storeCase(c.id).sala).toBe('Q-7');
    expect(screen.getByText('Cambios sin guardar')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(h.puts).toHaveLength(1));
    const put = h.puts[0]!;
    expect(put.url).toBe(`/api/v1/cases/${c.id}`);
    expect(put.authorization).toBe(`Bearer ${TEST_TOKEN}`);
    expect(put.body).toMatchObject({ id: c.id, sala: 'Q-7', diagnostico_preop: 'Dx editado' });
    expect(put.body).toHaveProperty('pre_assessment');
    expect(put.body).not.toHaveProperty('diagnosticoPreop');
    expect(await screen.findByText('Guardado')).toBeInTheDocument();
  });

  it('back goes to the case’s patient; unsaved edits are saved on leave, and not when clean', async () => {
    const p = fakePatient({ nombre: 'Paciente Sintético Hub', registro: 'SYN-HUB-1' });
    c.patient_id = p.id;
    const h = restHarness([c], { patients: [p] });
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}`, h.backend);
    await user.type(await screen.findByLabelText('Servicio'), 'Anestesia');
    await user.click(screen.getByRole('link', { name: 'Volver a Paciente' }));
    await waitFor(() => expect(h.puts).toHaveLength(1));
    expect(h.puts[0]!.body).toMatchObject({ servicio: 'Anestesia', patient_id: p.id });
    // The patient screen (between the list and the case).
    expect(await screen.findByRole('heading', { name: 'Paciente Sintético Hub', level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('patient-header')).toHaveTextContent('Registro SYN-HUB-1');

    // Re-open and leave without editing → no new PUT.
    await user.click(await screen.findByRole('link', { name: /Caso 1/ }));
    await screen.findByLabelText('Servicio');
    await user.click(screen.getByRole('link', { name: 'Volver a Paciente' }));
    await screen.findByTestId('patient-header');
    expect(h.puts).toHaveLength(1);
  });

  it('a case without a patient falls back to the patient list', async () => {
    renderApp(`/cases/${c.id}`, restHarness([c]).backend);
    expect(await screen.findByRole('link', { name: 'Volver a Historias clínicas' })).toHaveAttribute('href', '/pacientes');
  });

  it('greens the General technique row when the technique has data no zone recognises', async () => {
    const x = newCase('Dr. Demo');
    x.technique.modality = 'Modalidad-importada';
    x.technique.values = { clave_de_otro_cliente: true };
    renderApp(`/cases/${x.id}`, restHarness([x]).backend);
    expect(await screen.findByRole('link', { name: /Técnica anestésica · General/ })).toHaveClass('link-row--filled');
    expect(rowLink(/Regional neuroaxial/)).not.toHaveClass('link-row--filled');
    expect(rowLink(/Bloqueo periférico/)).not.toHaveClass('link-row--filled');
  });

  it('greens the new section rows from their data', async () => {
    const x = newCase('Dr. Demo');
    x.trans_record.basal.fc = 80;
    x.drugs = [{ id: 'a0000000-0000-4000-8000-000000000009', label: '', farmaco: 'X', dose_value: 1, dose_unit: 'mg', via: 'IV', time: null, modo: 'bolo', fin: null, rust_model_id: null }];
    x.recovery.alta_a_piso = 'URPA';
    renderApp(`/cases/${x.id}`, restHarness([x]).backend);
    expect(await screen.findByRole('link', { name: /^Registro transanestésico/ })).toHaveClass('link-row--filled');
    expect(rowLink(/^Fármacos administrados/)).toHaveClass('link-row--filled');
    expect(rowLink(/^Recuperación/)).toHaveClass('link-row--filled');
    expect(rowLink(/^Balance de líquidos/)).not.toHaveClass('link-row--filled');
    expect(rowLink(/^Recién nacido/)).not.toHaveClass('link-row--filled');
  });

  it('shows "Caso no encontrado" for an unknown id', async () => {
    const h = restHarness([]);
    renderApp('/cases/00000000-0000-4000-8000-000000000000', h.backend);
    expect(await screen.findByText('Caso no encontrado')).toBeInTheDocument();
    expect(caseStore.getState().cases).toHaveLength(0);
  });
});
