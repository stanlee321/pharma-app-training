import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { newCase } from '../../api/factory';
import { ALDRETE_CRITERIA } from '../../state/recovery';
import { renderApp, restHarness, storeCase } from '../../test/restHarness';

const cell = (crit: string, tp: string) => screen.getByRole('group', { name: `${crit} ${tp}` });

describe('RecoveryScreen', () => {
  it('scores the Aldrete grid with a live TOTAL, edits scales + discharge, and saves', async () => {
    const c = newCase('Dr. Demo');
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/recovery`, h.backend);
    expect(await screen.findByRole('heading', { name: 'Recovery', level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('aldrete-total-Al salir')).toHaveTextContent('—');

    // Partial column → "—".
    await user.click(within(cell('Actividad', 'Al salir')).getByRole('radio', { name: '2' }));
    expect(screen.getByTestId('aldrete-total-Al salir')).toHaveTextContent('—');
    for (const crit of ALDRETE_CRITERIA.slice(1)) {
      await user.click(within(cell(crit, 'Al salir')).getByRole('radio', { name: '2' }));
    }
    expect(screen.getByTestId('aldrete-total-Al salir')).toHaveTextContent('10');
    expect(screen.getByTestId('aldrete-total-Al salir')).toHaveClass('value--complete');
    await user.click(within(cell('Coloración', 'Al salir')).getByRole('radio', { name: '1' }));
    expect(screen.getByTestId('aldrete-total-Al salir')).toHaveTextContent('9');
    expect(screen.getByTestId('aldrete-total-Al salir')).not.toHaveClass('value--complete');
    await user.click(within(cell('Respiración', '20')).getByRole('radio', { name: '0' }));
    expect(storeCase(c.id).recovery.aldrete).toMatchObject({
      Actividad: { 'Al salir': 2 },
      Coloración: { 'Al salir': 1 },
      Respiración: { 'Al salir': 2, '20': 0 },
    });

    // Steppers start at the Swift fallbacks; a step writes the key.
    expect(screen.getByLabelText('Ramsay')).toHaveValue('2');
    expect(screen.getByLabelText('ENA')).toHaveValue('0');
    await user.click(screen.getByRole('button', { name: 'Increase Ramsay' }));
    await user.click(screen.getByRole('button', { name: 'Increase ENA' }));
    await user.click(screen.getByRole('button', { name: 'Increase ENA' }));
    // Keys are the ones the backend crosswalk reads (Ramsay/Bromage/ENA), not Swift's lowercase.
    expect(storeCase(c.id).recovery.otras).toEqual({ Ramsay: 3, ENA: 2 });

    await user.type(screen.getByLabelText('Alta a su piso'), 'URPA');
    await user.type(screen.getByLabelText('Médico responsable'), 'Dr. Ejemplo');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.puts).toHaveLength(1));
    expect(h.puts[0]!.body.recovery).toMatchObject({
      aldrete: { Actividad: { 'Al salir': 2 }, Respiración: { '20': 0 } },
      otras: { Ramsay: 3, ENA: 2 },
      alta_a_piso: 'URPA',
      medico_responsable: 'Dr. Ejemplo',
    });
    expect(h.puts[0]!.body.recovery).not.toHaveProperty('altaAPiso');
  }, 30_000); // 90-radio grid: user-event is slow in jsdom

  it('shows stored scores and clamps scale steppers to their ranges', async () => {
    const c = newCase('Dr. Demo');
    c.recovery.aldrete = { Conciencia: { '60': 1 } };
    c.recovery.otras = { bromage: 3 };
    renderApp(`/cases/${c.id}/recovery`, restHarness([c]).backend);
    expect(await screen.findByRole('group', { name: 'Conciencia 60' })).toBeInTheDocument();
    expect(within(cell('Conciencia', '60')).getByRole('radio', { name: '1' })).toBeChecked();
    expect(within(cell('Conciencia', '90')).getByRole('radio', { name: '1' })).not.toBeChecked();
    expect(screen.getByLabelText('Bromage')).toHaveValue('3');
    expect(screen.getByRole('button', { name: 'Increase Bromage' })).toBeDisabled();
    // Legacy lowercase (Swift) key is migrated to the crosswalk key on write.
    await userEvent.setup().click(screen.getByRole('button', { name: 'Decrease Bromage' }));
    expect(storeCase(c.id).recovery.otras).toEqual({ Bromage: 2 });
  });
});
