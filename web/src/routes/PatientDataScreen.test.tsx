import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { newCase } from '../api/factory';
import { renderApp, restHarness, storeCase } from '../test/restHarness';

const seed = () => newCase('Dr. Demo', new Date('2026-01-01T08:00:00Z')); // default male 70/170/40

describe('PatientDataScreen', () => {
  it('renders profile steppers and Swift-exact derived IMC / peso ideal / VSC', async () => {
    const c = seed();
    renderApp(`/cases/${c.id}/patient`, restHarness([c]).backend);
    expect(await screen.findByRole('heading', { name: 'Patient', level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText('Weight')).toHaveValue('70');
    expect(screen.getByLabelText('Height')).toHaveValue('170');
    expect(screen.getByLabelText('Age')).toHaveValue('40');
    expect(screen.getByLabelText('Dilution')).toHaveValue('10.0');
    expect(screen.getByRole('button', { name: 'Male' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('24.2')).toBeInTheDocument(); // IMC
    expect(screen.getByText('65.9')).toBeInTheDocument(); // Devine male
    expect(screen.getByText('4900')).toBeInTheDocument(); // VSC
  });

  it('steppers/sex update the draft and the derived card live; deselecting sex is ignored', async () => {
    const c = seed();
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/patient`, restHarness([c]).backend);
    const inc = await screen.findByRole('button', { name: 'Increase Weight' });
    fireEvent.click(inc, { detail: 0 }); // keyboard-style click = one step
    expect(storeCase(c.id).patient.profile.weight).toBe(71);
    expect(screen.getByText('4970')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Female' }));
    expect(storeCase(c.id).patient.profile.gender).toBe('female');
    expect(screen.getByText('61.4')).toBeInTheDocument(); // 45.5 + 15.937
    await user.click(screen.getByRole('button', { name: 'Female' })); // deselect → ignored
    expect(storeCase(c.id).patient.profile.gender).toBe('female');
  });

  it('text + numeric fields → draft → Save PUTs the snake_case patient', async () => {
    const c = seed();
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/patient`, h.backend);
    await user.type(await screen.findByLabelText('Nombre'), 'Paciente Sintético');
    await user.type(screen.getByLabelText('Registro'), 'DEMO-1');
    await user.type(screen.getByLabelText('Cama'), '12');
    await user.type(screen.getByLabelText('Grupo sanguíneo'), 'O');
    await user.type(screen.getByLabelText('Rh'), '+');
    await user.type(screen.getByLabelText('Hb'), '13,5');
    await user.type(screen.getByLabelText('Hto'), '40');
    await user.click(screen.getByRole('button', { name: 'Female' }));
    expect(storeCase(c.id).patient).toMatchObject({ nombre: 'Paciente Sintético', hb: 13.5, hto: 40 });

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.puts).toHaveLength(1));
    const patient = h.puts[0]!.body.patient as Record<string, unknown>;
    expect(patient).toMatchObject({
      nombre: 'Paciente Sintético',
      registro: 'DEMO-1',
      cama: '12',
      grupo_sanguineo: 'O',
      rh: '+',
      hb: 13.5,
      hto: 40,
      profile: { weight: 70, height: 170, age: 40, gender: 'female', dilution: 10 },
    });
    expect(patient).not.toHaveProperty('grupoSanguineo');
  });

  it('edits survive navigating back and are saved on leave; the Hub row turns green', async () => {
    const c = seed();
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/patient`, h.backend);
    await user.type(await screen.findByLabelText('Nombre'), 'Paciente Sintético');
    await user.click(screen.getByRole('link', { name: 'Back to Encounter' }));
    expect(await screen.findByRole('heading', { name: 'Paciente Sintético', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Patient Data/ })).toHaveClass('link-row--filled');
    await waitFor(() => expect(h.puts).toHaveLength(1));
    expect(h.puts[0]!.body.patient).toMatchObject({ nombre: 'Paciente Sintético' });
  });
});
