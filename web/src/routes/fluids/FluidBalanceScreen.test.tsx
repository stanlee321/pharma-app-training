import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { newCase } from '../../api/factory';
import { renderApp, restHarness, storeCase } from '../../test/restHarness';

describe('FluidBalanceScreen', () => {
  it('edits the matrix, shows the live per-hour balance, toggles blood components, and saves', async () => {
    const c = newCase('Dr. Demo');
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/fluids`, h.backend);
    expect(await screen.findByRole('heading', { name: 'Balance de líquidos', level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('balance-1hr')).toHaveTextContent('0');

    await user.type(screen.getByLabelText('NCL 1hr'), '300');
    await user.type(screen.getByLabelText('Cristaloide 1hr'), '500');
    // Sangrado is the sum of its sources (clinician feedback 2026-11b)
    await user.type(screen.getByLabelText('Sangrado · Textiles 1hr'), '60');
    await user.type(screen.getByLabelText('Sangrado · Aspirador 1hr'), '40');
    expect(screen.getByTestId('sangrado-1hr')).toHaveTextContent('100');
    await user.type(screen.getByLabelText('Diuresis 1hr'), '150,5');
    // Backend formula: intake (500) − losses (NCL 300 + Sangrado 100 + Diuresis 150.5) = −50.5.
    expect(screen.getByTestId('balance-1hr')).toHaveTextContent('-50.5');
    expect(screen.getByTestId('balance-1hr')).toHaveClass('value--negative');
    await user.type(screen.getByLabelText('Coloide 2hr'), '250');
    expect(screen.getByTestId('balance-2hr')).toHaveTextContent('250');
    expect(screen.getByTestId('balance-2hr')).not.toHaveClass('value--negative');
    // Balance total is the running sum.
    expect(screen.getByTestId('balance-total-2hr')).toHaveTextContent('199.5');

    await user.click(screen.getByRole('button', { name: 'Plasma' }));
    expect(storeCase(c.id).fluid_balance.blood_components).toEqual({
      'Concentrado globular': false,
      Plasma: true,
      Plaquetas: false,
      Aféresis: false,
    });

    // Clearing the only cell of a row removes the row.
    await user.clear(screen.getByLabelText('Coloide 2hr'));
    // Keys are the canonical control_fluidos rows the backend and the PDF use.
    expect(storeCase(c.id).fluid_balance.matrix).toEqual({
      NCL: { '1hr': 300 },
      'Ingreso Critaloide': { '1hr': 500 },
      Textiles: { '1hr': 60 },
      Aspirador: { '1hr': 40 },
      Diuresis: { '1hr': 150.5 },
    });

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(h.puts).toHaveLength(1));
    expect(h.puts[0]!.body.fluid_balance).toMatchObject({
      matrix: { NCL: { '1hr': 300 }, 'Ingreso Critaloide': { '1hr': 500 }, Diuresis: { '1hr': 150.5 } },
      blood_components: { Plasma: true },
    });
    expect(h.puts[0]!.body).not.toHaveProperty('fluidBalance');
  });

  it('shows stored cells and flags junk input without committing it', async () => {
    const c = newCase('Dr. Demo');
    c.fluid_balance.matrix = { Diuresis: { '3hr': 80 } };
    c.fluid_balance.blood_components = { Plaquetas: true };
    renderApp(`/cases/${c.id}/fluids`, restHarness([c]).backend);
    const user = userEvent.setup();
    expect(await screen.findByLabelText('Diuresis 3hr')).toHaveValue('80');
    expect(screen.getByTestId('balance-3hr')).toHaveTextContent('-80');
    expect(screen.getByRole('button', { name: 'Plaquetas' })).toHaveAttribute('aria-pressed', 'true');
    await user.type(screen.getByLabelText('NCL 3hr'), 'abc');
    expect(screen.getByLabelText('NCL 3hr')).toHaveAttribute('aria-invalid', 'true');
    expect(storeCase(c.id).fluid_balance.matrix).toEqual({ Diuresis: { '3hr': 80 } });
  });

  it('offers to move legacy Swift rows (Cristaloide/Coloide) onto the canonical rows', async () => {
    const c = newCase('Dr. Demo');
    c.fluid_balance.matrix = { Cristaloide: { '1hr': 400 }, Coloide: { '2hr': 100 } };
    renderApp(`/cases/${c.id}/fluids`, restHarness([c]).backend);
    const user = userEvent.setup();
    expect(await screen.findByText(/filas de una versión anterior \(Cristaloide, Coloide\)/)).toBeInTheDocument();
    // Legacy rows are not intake for the server, so the balance ignores them until moved.
    expect(screen.getByTestId('balance-1hr')).toHaveTextContent('0');
    await user.click(screen.getByRole('button', { name: /Mover a/ }));
    expect(storeCase(c.id).fluid_balance.matrix).toEqual({
      'Ingreso Critaloide': { '1hr': 400 },
      'Ingreso Coloide': { '2hr': 100 },
    });
    expect(screen.queryByText(/filas de una versión anterior/)).not.toBeInTheDocument();
    expect(screen.getByTestId('balance-1hr')).toHaveTextContent('400');
    expect(screen.getByLabelText('Cristaloide 1hr')).toHaveValue('400');
  });
});
