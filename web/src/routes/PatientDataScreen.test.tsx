import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { newCase } from '../api/factory';
import { renderApp, restHarness, storeCase } from '../test/restHarness';

const PATIENT_ID = '11111111-0000-4000-8000-0000000000aa';

/** Default male 70/170/40, belonging to a synthetic patient. */
const seed = () => {
  const c = newCase('Dr. Demo', new Date('2026-01-01T08:00:00Z'));
  c.patient_id = PATIENT_ID;
  c.patient.nombre = 'Paciente Sintético';
  c.patient.registro = 'SYN-0001';
  c.patient.grupo_sanguineo = 'O';
  c.patient.rh = '+';
  return c;
};

const valueOf = (label: string) => screen.getByText(label, { selector: '.row__label' }).nextElementSibling;

describe('PatientDataScreen', () => {
  it('renders profile steppers and Swift-exact derived IMC / peso ideal / VSC', async () => {
    const c = seed();
    renderApp(`/cases/${c.id}/patient`, restHarness([c]).backend);
    expect(await screen.findByRole('heading', { name: 'Datos del paciente', level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText('Peso')).toHaveValue('70');
    expect(screen.getByLabelText('Talla')).toHaveValue('170');
    expect(screen.getByLabelText('Edad')).toHaveValue('40');
    expect(screen.getByLabelText('Dilución')).toHaveValue('10.0');
    expect(screen.getByText('24.2')).toBeInTheDocument(); // IMC
    expect(screen.getByText('65.9')).toBeInTheDocument(); // Devine male
    expect(screen.getByText('4900')).toBeInTheDocument(); // VSC
  });

  it('shows the identity read-only (from the patient) with a link to edit the patient', async () => {
    const c = seed();
    c.patient.profile.gender = 'female';
    renderApp(`/cases/${c.id}/patient`, restHarness([c]).backend);
    await screen.findByRole('heading', { name: 'Datos del paciente', level: 1 });
    expect(valueOf('Nombre')).toHaveTextContent('Paciente Sintético');
    expect(valueOf('Registro')).toHaveTextContent('SYN-0001');
    expect(valueOf('Sexo')).toHaveTextContent('Femenino');
    expect(valueOf('Grupo sanguíneo')).toHaveTextContent('O');
    expect(valueOf('Rh')).toHaveTextContent('+');
    // No editable identity inputs and no sex chips on the case.
    expect(screen.queryByRole('textbox', { name: 'Nombre' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Registro' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Femenino' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Editar paciente' })).toHaveAttribute(
      'href',
      `/pacientes/${PATIENT_ID}?editar=1`,
    );
    expect(screen.getByText('61.4')).toBeInTheDocument(); // Devine female (45.5 + 15.937)
  });

  it('steppers update the draft and the derived card live', async () => {
    const c = seed();
    renderApp(`/cases/${c.id}/patient`, restHarness([c]).backend);
    const inc = await screen.findByRole('button', { name: 'Aumentar Peso' });
    fireEvent.click(inc, { detail: 0 }); // keyboard-style click = one step
    expect(storeCase(c.id).patient.profile.weight).toBe(71);
    expect(screen.getByText('4970')).toBeInTheDocument();
  });

  it('per-encounter fields → draft → Save PUTs the snake_case patient (identity untouched)', async () => {
    const c = seed();
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/patient`, h.backend);
    await user.type(await screen.findByLabelText('Cama'), '12');
    await user.type(screen.getByLabelText('Hb'), '13,5');
    await user.type(screen.getByLabelText('Hto'), '40');
    expect(storeCase(c.id).patient).toMatchObject({ cama: '12', hb: 13.5, hto: 40 });

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(h.puts).toHaveLength(1));
    const patient = h.puts[0]!.body.patient as Record<string, unknown>;
    expect(patient).toMatchObject({
      nombre: 'Paciente Sintético',
      registro: 'SYN-0001',
      cama: '12',
      grupo_sanguineo: 'O',
      rh: '+',
      hb: 13.5,
      hto: 40,
      profile: { weight: 70, height: 170, age: 40, gender: 'male', dilution: 10 },
    });
    expect(patient).not.toHaveProperty('grupoSanguineo');
  });

  it('edits survive navigating back and are saved on leave; the Hub row is green', async () => {
    const c = seed();
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/patient`, h.backend);
    await user.type(await screen.findByLabelText('Cama'), '7');
    await user.click(screen.getByRole('link', { name: 'Volver a Caso' }));
    expect(await screen.findByRole('heading', { name: 'Paciente Sintético', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Datos del paciente/ })).toHaveClass('link-row--filled');
    await waitFor(() => expect(h.puts).toHaveLength(1));
    expect(h.puts[0]!.body.patient).toMatchObject({ cama: '7' });
  });
});
