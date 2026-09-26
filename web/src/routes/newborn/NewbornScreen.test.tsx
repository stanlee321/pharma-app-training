import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { newCase } from '../../api/factory';
import { renderApp, restHarness, storeCase } from '../../test/restHarness';

const nb = (n: number) => screen.getByRole('group', { name: `Newborn ${n}` });

describe('NewbornScreen', () => {
  it('adds, edits, deletes newborn records and saves them snake_case', async () => {
    const c = newCase('Dr. Demo');
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/newborn`, h.backend);
    expect(await screen.findByRole('heading', { name: 'Newborns', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('No newborn records')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add newborn record' }));
    await user.click(screen.getByRole('button', { name: 'Add newborn record' }));
    expect(storeCase(c.id).newborns).toHaveLength(2);

    const first = nb(1);
    await user.click(within(first).getByRole('button', { name: 'F' }));
    await user.type(within(first).getByLabelText('Peso'), '3250');
    await user.type(within(first).getByLabelText('Talla'), '50.5');
    await user.selectOptions(within(first).getByLabelText("Apgar 1'"), '8');
    await user.selectOptions(within(first).getByLabelText("Apgar 5'"), '9');
    await user.selectOptions(within(first).getByLabelText("Apgar 10'"), '10');
    await user.type(within(first).getByLabelText('Expulsión de placenta'), 'Espontánea');
    await user.type(within(first).getByLabelText('Estado general'), 'Vigoroso');
    await user.click(within(nb(2)).getByRole('button', { name: 'M' }));
    // Re-tap deselects → ''.
    await user.click(within(nb(2)).getByRole('button', { name: 'M' }));
    await user.selectOptions(within(nb(2)).getByLabelText("Apgar 1'"), '0');
    await user.selectOptions(within(nb(2)).getByLabelText("Apgar 1'"), '');

    const [a, b] = storeCase(c.id).newborns;
    expect(a).toMatchObject({
      sexo: 'F',
      peso_gramos: 3250,
      talla_cm: 50.5,
      apgar1: 8,
      apgar5: 9,
      apgar10: 10,
      expulsion_placenta: 'Espontánea',
      estado_general: 'Vigoroso',
    });
    expect(b).toMatchObject({ sexo: '', apgar1: null });

    await user.click(within(nb(1)).getByRole('button', { name: 'Delete Newborn 1' }));
    await user.click(within(nb(1)).getByRole('button', { name: 'Delete' }));
    expect(storeCase(c.id).newborns).toHaveLength(1);
    expect(storeCase(c.id).newborns[0]!.id).toBe(b!.id);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.puts).toHaveLength(1));
    const sent = h.puts[0]!.body.newborns as Record<string, unknown>[];
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ id: b!.id, sexo: '', peso_gramos: null, apgar1: null });
    expect(sent[0]).not.toHaveProperty('pesoGramos');
  });

  it('shows stored newborns', async () => {
    const c = newCase('Dr. Demo');
    c.newborns = [
      {
        id: 'b0000000-0000-4000-8000-000000000001',
        sexo: 'M',
        peso_gramos: 3100,
        talla_cm: 49,
        apgar1: 7,
        apgar5: 9,
        apgar10: null,
        expulsion_placenta: '',
        estado_general: '',
      },
    ];
    renderApp(`/cases/${c.id}/newborn`, restHarness([c]).backend);
    const first = await screen.findByRole('group', { name: 'Newborn 1' });
    expect(within(first).getByRole('button', { name: 'M' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(first).getByLabelText('Peso')).toHaveValue('3100');
    expect(within(first).getByLabelText("Apgar 1'")).toHaveValue('7');
    expect(within(first).getByLabelText("Apgar 10'")).toHaveValue('');
  });
});
