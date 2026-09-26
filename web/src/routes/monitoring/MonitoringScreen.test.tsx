import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { newCase } from '../../api/factory';
import { renderApp, restHarness, storeCase } from '../../test/restHarness';

const group = (name: string) => screen.getByRole('group', { name });

describe('MonitoringScreen', () => {
  it('edits monitoring chips, basal / termination vitals and complicaciones; Save PUTs snake_case', async () => {
    const c = newCase('Dr. Demo');
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/monitoring`, h.backend);
    expect(await screen.findByRole('heading', { name: 'Monitoring', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Ingrese signos basales y de terminación para ver la tendencia')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ECG' }));
    await user.click(screen.getByRole('button', { name: 'SpO2' }));
    // Swift onChange writes every option, true/false.
    expect(storeCase(c.id).trans_record.monitoring).toEqual({
      ECG: true,
      SpO2: true,
      EtCO2: false,
      BIS: false,
      TNM: false,
      Temp: false,
    });

    const basal = group('Signos basales');
    await user.type(within(basal).getByLabelText('FC'), '78');
    await user.type(within(basal).getByLabelText('TA sist.'), '120');
    await user.type(within(basal).getByLabelText('TA diast.'), '80');
    await user.type(within(basal).getByLabelText('SpO₂'), '99');
    const term = group('Signos de terminación');
    await user.type(within(term).getByLabelText('FC'), '72,5');
    await user.type(within(term).getByLabelText('FR'), '14');
    await user.type(screen.getByLabelText('Complicaciones'), 'Ninguna (ejemplo)');

    const tr = storeCase(c.id).trans_record;
    expect(tr.basal).toMatchObject({ fc: 78, ta_sys: 120, ta_dia: 80, spo2: 99, fr: null });
    expect(tr.termination).toMatchObject({ fc: 72.5, fr: 14, ta_sys: null });
    // Chart now renders the entered vitals.
    expect(screen.getByRole('img', { name: /Tendencia basal → fin\. FC: basal 78, fin 72\.5/ })).toBeInTheDocument();

    // Clearing a vital commits null.
    await user.clear(within(basal).getByLabelText('TA diast.'));
    expect(storeCase(c.id).trans_record.basal.ta_dia).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.puts).toHaveLength(1));
    const body = h.puts[0]!.body.trans_record as Record<string, unknown>;
    expect(body).toMatchObject({
      basal: { fc: 78, ta_sys: 120, ta_dia: null, spo2: 99 },
      termination: { fc: 72.5, fr: 14 },
      complicaciones: 'Ninguna (ejemplo)',
      monitoring: { ECG: true, SpO2: true, BIS: false },
    });
    expect(body.basal).not.toHaveProperty('taSys');
    expect(h.puts[0]!.body).not.toHaveProperty('transRecord');
  });

  it('shows stored values and preserves series / events it does not edit', async () => {
    const c = newCase('Dr. Demo');
    c.trans_record.monitoring = { BIS: true, ECG: false };
    c.trans_record.basal.fc = 88;
    c.trans_record.series = [{ lane: 'fc', points: [{ t: 0, value: 80 }, { t: 15, value: 76 }] }];
    c.trans_record.events = [{ marker: 1, t: 0, label: 'Inducción' }];
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/monitoring`, h.backend);
    expect(await screen.findByRole('button', { name: 'BIS' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'ECG' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(group('Signos basales')).getByLabelText('FC')).toHaveValue('88');
    expect(screen.getByText('1 (2 puntos)')).toBeInTheDocument();

    await user.type(within(group('Signos de terminación')).getByLabelText('SpO₂'), '97');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.puts).toHaveLength(1));
    expect(h.puts[0]!.body.trans_record).toMatchObject({
      series: [{ lane: 'fc', points: [{ t: 0, value: 80 }, { t: 15, value: 76 }] }],
      events: [{ marker: 1, t: 0, label: 'Inducción' }],
      termination: { spo2: 97 },
    });
  });

  it('rejects junk vitals without committing a value', async () => {
    const c = newCase('Dr. Demo');
    renderApp(`/cases/${c.id}/monitoring`, restHarness([c]).backend);
    const user = userEvent.setup();
    const fc = within(await screen.findByRole('group', { name: 'Signos basales' })).getByLabelText('FC');
    await user.type(fc, '7x');
    expect(fc).toHaveAttribute('aria-invalid', 'true');
    expect(storeCase(c.id).trans_record.basal.fc).toBeNull();
  });
});
