import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { newCase } from '../../api/factory';
import { renderApp, restHarness, storeCase } from '../../test/restHarness';

const row = (letter: string) => screen.getByRole('group', { name: `Fila ${letter}` });

describe('DrugLedgerScreen', () => {
  it('adds, edits and saves rows; maps modelled agents to rust_model_id as Swift does', async () => {
    const c = newCase('Dr. Demo');
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/drugs`, h.backend);
    expect(await screen.findByRole('heading', { name: 'Fármacos administrados', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Aún no hay fármacos registrados.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Agregar fármaco' }));
    expect(storeCase(c.id).drugs).toHaveLength(1);
    expect(storeCase(c.id).drugs[0]).toMatchObject({ farmaco: '', dose_value: null, dose_unit: 'mg', via: 'IV', rust_model_id: null });
    // Incomplete → red bar.
    expect(row('A')).toHaveClass('drug-row--incomplete');

    // Bare drug name matches the first model of that drug (Swift matchedModel) → marsh.
    await user.type(within(row('A')).getByLabelText('Fármaco A'), 'Propofol');
    expect(storeCase(c.id).drugs[0]!.rust_model_id).toBe('marsh');
    // Live TCI chip (Marsh, default 70 kg / 10 mg/ml, Cp 3.0 from zero): bolus 3/1000·15960 mg =
    // 47.88 mg = 4.8 ml; maintenance (0.119+0.112+0.042)·47.88 mg/min ·60/10 = 78.4 ml/h.
    const chip = within(row('A')).getByRole('group', { name: 'Dosis TCI recomendada' });
    expect(chip).toHaveAttribute('data-slot', 'drug-tci-chip');
    expect(chip).toHaveAttribute('data-model-id', 'marsh');
    expect(chip).toHaveTextContent('TCI: bolo 4.8 ml · 78.4 ml/h');
    expect(chip).toHaveTextContent('@ 3.0');
    expect(row('A')).toHaveClass('drug-row--incomplete'); // still no dose

    await user.type(within(row('A')).getByLabelText('Dosis A'), '120');
    expect(row('A')).not.toHaveClass('drug-row--incomplete');
    await user.click(within(row('A')).getByRole('button', { name: 'Aumentar dosis A' }));
    expect(storeCase(c.id).drugs[0]!.dose_value).toBe(125);
    await user.selectOptions(within(row('A')).getByLabelText('Unidad A'), 'mcg/kg/min');
    await user.selectOptions(within(row('A')).getByLabelText('Vía'), 'Epidural');
    fireEvent.change(within(row('A')).getByLabelText('Hora'), { target: { value: '2026-01-01T08:30' } });
    expect(storeCase(c.id).drugs[0]!.time).toBe(new Date('2026-01-01T08:30').toISOString());

    // Second row: pick a model from the menu → farmaco = picker label + id.
    await user.click(screen.getByRole('button', { name: 'Agregar fármaco' }));
    await user.selectOptions(within(row('B')).getByLabelText('Modelo PK B'), 'minto');
    expect(storeCase(c.id).drugs[1]).toMatchObject({ farmaco: 'Remifentanil [Minto]', rust_model_id: 'minto' });
    // Clear model keeps the name, drops the id and the chip.
    await user.selectOptions(within(row('B')).getByLabelText('Modelo PK B'), '');
    expect(storeCase(c.id).drugs[1]).toMatchObject({ farmaco: 'Remifentanil [Minto]', rust_model_id: null });
    expect(within(row('B')).queryByRole('group', { name: 'Dosis TCI recomendada' })).toBeNull();
    // A non-modelled name → null.
    await user.clear(within(row('B')).getByLabelText('Fármaco B'));
    await user.type(within(row('B')).getByLabelText('Fármaco B'), 'Ketamina');
    await user.type(within(row('B')).getByLabelText('Dosis B'), '50');
    expect(storeCase(c.id).drugs[1]).toMatchObject({ farmaco: 'Ketamina', rust_model_id: null, dose_value: 50 });

    // Decrease never goes below 0.
    await user.clear(within(row('B')).getByLabelText('Dosis B'));
    await user.type(within(row('B')).getByLabelText('Dosis B'), '3');
    await user.click(within(row('B')).getByRole('button', { name: 'Disminuir dosis B' }));
    expect(storeCase(c.id).drugs[1]!.dose_value).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(h.puts).toHaveLength(1));
    const drugs = h.puts[0]!.body.drugs as Record<string, unknown>[];
    expect(drugs).toHaveLength(2);
    expect(drugs[0]).toMatchObject({
      farmaco: 'Propofol',
      dose_value: 125,
      dose_unit: 'mcg/kg/min',
      via: 'Epidural',
      rust_model_id: 'marsh',
    });
    expect(drugs[0]).not.toHaveProperty('doseValue');
    expect(drugs[0]).not.toHaveProperty('recommended');
    expect(drugs[1]).toMatchObject({ farmaco: 'Ketamina', dose_value: 0, rust_model_id: null });
  });

  it('deletes a row after inline confirmation', async () => {
    const c = newCase('Dr. Demo');
    c.drugs = [
      { id: 'a0000000-0000-4000-8000-000000000001', label: '', farmaco: 'Fentanilo', dose_value: 100, dose_unit: 'mcg', via: 'IV', time: null, modo: 'bolo', fin: null, rust_model_id: null },
      { id: 'a0000000-0000-4000-8000-000000000002', label: '', farmaco: 'Rocuronio', dose_value: 40, dose_unit: 'mg', via: 'IV', time: null, modo: 'bolo', fin: null, rust_model_id: null },
    ];
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/drugs`, h.backend);
    expect(await screen.findByLabelText('Fármaco A')).toHaveValue('Fentanilo');
    await user.click(screen.getByRole('button', { name: 'Eliminar fármaco A' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(storeCase(c.id).drugs).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Eliminar fármaco A' }));
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(storeCase(c.id).drugs.map((d) => d.farmaco)).toEqual(['Rocuronio']);
    expect(screen.getByLabelText('Fármaco A')).toHaveValue('Rocuronio');

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(h.puts).toHaveLength(1));
    expect((h.puts[0]!.body.drugs as unknown[]).length).toBe(1);
  });

  it('marks a continuous infusion with its rate unit and end time (clinician feedback item 9)', async () => {
    const c = newCase('Dr. Demo');
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/drugs`, h.backend);
    await user.click(await screen.findByRole('button', { name: 'Agregar fármaco' }));
    await user.type(within(row('A')).getByLabelText('Fármaco A'), 'Noradrenalina');
    expect(within(row('A')).queryByLabelText('Fin')).toBeNull();
    await user.click(within(row('A')).getByRole('radio', { name: 'Infusión continua' }));
    expect(storeCase(c.id).drugs[0]).toMatchObject({ modo: 'infusion', dose_unit: 'mcg/kg/min' });
    await user.type(within(row('A')).getByLabelText('Dosis A'), '0,1');
    await user.click(within(row('A')).getByRole('button', { name: 'Fin ahora A' }));
    expect(storeCase(c.id).drugs[0]!.fin).not.toBeNull();
    // Back to a bolus: the end time is dropped (mcg/kg/min is valid for both, so it stays).
    await user.click(within(row('A')).getByRole('radio', { name: 'Bolo' }));
    expect(storeCase(c.id).drugs[0]).toMatchObject({ modo: 'bolo', fin: null, dose_unit: 'mcg/kg/min', dose_value: 0.1 });

    await user.click(within(row('A')).getByRole('radio', { name: 'Infusión continua' }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(h.puts).toHaveLength(1));
    expect((h.puts[0]!.body.drugs as Record<string, unknown>[])[0]).toMatchObject({ farmaco: 'Noradrenalina', modo: 'infusion' });
  });
});

