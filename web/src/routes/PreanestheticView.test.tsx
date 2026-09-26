import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { newCase } from '../api/factory';
import { renderApp, restHarness, storeCase } from '../test/restHarness';

describe('PreanestheticView', () => {
  it('shows stored ASA / R.A.Q. / labs', async () => {
    const c = newCase('Dr. Demo');
    c.pre_assessment.asa = 2;
    c.pre_assessment.raq = 4;
    c.pre_assessment.labs = { urea: 32, glucosa: '98' };
    renderApp(`/cases/${c.id}/preanesthetic`, restHarness([c]).backend);
    expect(await screen.findByRole('heading', { name: 'Preanesthetic', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'II' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '4' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Urea')).toHaveValue('32');
    expect(screen.getByLabelText('Glucosa')).toHaveValue('98');
    expect(screen.getByLabelText('Creatinina')).toHaveValue('');
  });

  it('edits every control type into the draft and Save PUTs snake_case keys', async () => {
    const c = newCase('Dr. Demo');
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/preanesthetic`, h.backend);
    await user.type(await screen.findByLabelText('Alergias'), 'Ninguna conocida');
    await user.type(screen.getByLabelText('Dentadura'), 'Propia');
    await user.type(screen.getByLabelText('Cuello / vía aérea'), 'Mallampati II');
    await user.type(screen.getByLabelText('Estado psíquico'), 'Orientado');
    await user.click(screen.getByRole('switch', { name: 'Ayuno confirmado' }));
    await user.click(screen.getByRole('switch', { name: 'Consentimiento' }));
    await user.click(screen.getByRole('button', { name: 'III' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.type(screen.getByLabelText('Urea'), '30');
    await user.type(screen.getByLabelText('Creatinina'), '0.9');
    await user.type(screen.getByLabelText('Notes'), 'Midazolam (ejemplo)');

    const pa = storeCase(c.id).pre_assessment;
    // Forms export `cuello`; `via_aerea` is mirrored for Swift-written records.
    expect(pa).toMatchObject({ asa: 3, raq: 2, ayuno: true, consentimiento: true, cuello: 'Mallampati II', via_aerea: 'Mallampati II' });
    expect(pa.labs).toEqual({ urea: 30, creatinina: 0.9 });

    // Deselect ASA → null; clear a lab → key removed (Swift `labs[key] = nil`).
    await user.click(screen.getByRole('button', { name: 'III' }));
    await user.clear(screen.getByLabelText('Urea'));
    expect(storeCase(c.id).pre_assessment.asa).toBeNull();
    expect(storeCase(c.id).pre_assessment.labs).toEqual({ creatinina: 0.9 });

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.puts).toHaveLength(1));
    expect(h.puts[0]!.body.pre_assessment).toMatchObject({
      alergia: 'Ninguna conocida',
      dentadura: 'Propia',
      cuello: 'Mallampati II',
      via_aerea: 'Mallampati II',
      estado_psiquico: 'Orientado',
      ayuno: true,
      consentimiento: true,
      asa: null,
      raq: 2,
      labs: { creatinina: 0.9 },
      premedicacion: 'Midazolam (ejemplo)',
    });
    expect(h.puts[0]!.body.pre_assessment).not.toHaveProperty('viaAerea');
  });
});
