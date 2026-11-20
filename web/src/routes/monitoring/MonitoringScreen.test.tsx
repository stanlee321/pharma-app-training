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
    expect(await screen.findByRole('heading', { name: 'Registro transanestésico', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Ingrese los signos en reposo y al finalizar la cirugía para ver la tendencia')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'ECG' }));
    await user.click(screen.getByRole('button', { name: 'SpO2' }));
    // Swift onChange writes every option, true/false.
    expect(storeCase(c.id).trans_record.monitoring).toEqual({
      ECG: true,
      SpO2: true,
      PANI: false,
      PAI: false,
      EtCO2: false,
      BIS: false,
      Entropía: false,
      NINDEX: false,
      TNM: false,
      Neuromonitorización: false,
      POCUS: false,
      Temp: false,
    });

    const basal = group('Signos en reposo (basales)');
    await user.type(within(basal).getByLabelText('FC'), '78');
    await user.type(within(basal).getByLabelText('TA sist.'), '120');
    await user.type(within(basal).getByLabelText('TA diast.'), '80');
    await user.type(within(basal).getByLabelText('SpO₂'), '99');
    const term = group('Signos al finalizar la cirugía');
    await user.type(within(term).getByLabelText('FC'), '72,5');
    await user.type(within(term).getByLabelText('FR'), '14');
    await user.type(screen.getByLabelText('Complicaciones'), 'Ninguna (ejemplo)');

    const tr = storeCase(c.id).trans_record;
    expect(tr.basal).toMatchObject({ fc: 78, ta_sys: 120, ta_dia: 80, spo2: 99, fr: null });
    expect(tr.termination).toMatchObject({ fc: 72.5, fr: 14, ta_sys: null });
    // Chart now renders the entered vitals.
    expect(screen.getByRole('img', { name: /Tendencia de reposo → fin de la cirugía\. FC: reposo 78, fin 72\.5/ })).toBeInTheDocument();

    // Clearing a vital commits null.
    await user.clear(within(basal).getByLabelText('TA diast.'));
    expect(storeCase(c.id).trans_record.basal.ta_dia).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
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
    expect(within(group('Signos en reposo (basales)')).getByLabelText('FC')).toHaveValue('88');
    // Stored series / events show in the 5-minute grid.
    expect(screen.getByLabelText('FC +15 min')).toHaveValue('76');
    expect(screen.getByLabelText('Evento +0 min')).toHaveValue('1');

    await user.type(within(group('Signos al finalizar la cirugía')).getByLabelText('SpO₂'), '97');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
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
    const fc = within(await screen.findByRole('group', { name: 'Signos en reposo (basales)' })).getByLabelText('FC');
    await user.type(fc, '7x');
    expect(fc).toHaveAttribute('aria-invalid', 'true');
    expect(storeCase(c.id).trans_record.basal.fc).toBeNull();
  });

  it('records the 5-minute grid: vitals, EKG text, inhaled %, fluids by name, events', async () => {
    const c = newCase('Dr. Demo');
    c.trans_record.inicio = new Date(2026, 10, 19, 8, 0).toISOString();
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/monitoring`, h.backend);
    await screen.findByRole('heading', { name: 'Registro transanestésico', level: 1 });

    // Columns every 5 minutes from the start time.
    await user.type(screen.getByLabelText('FC 08:00'), '80');
    await user.type(screen.getByLabelText('FC 08:05'), '82');
    await user.type(screen.getByLabelText('SpO₂ 08:05'), '95');
    // EKG text row retired (2026-11b)
    expect(screen.queryByLabelText('EKG 08:00')).toBeNull();
    // Selecting a monitor shows its own row.
    expect(screen.queryByLabelText('NINDEX 08:00')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'NINDEX' }));
    await user.type(screen.getByLabelText('NINDEX 08:00'), '42');
    await user.click(screen.getByRole('button', { name: 'POCUS' }));
    await user.type(screen.getByLabelText('POCUS 08:10'), 'Deslizamiento pleural');

    // Ventilation mode and position over time (2026-11b)
    await user.selectOptions(screen.getByLabelText('Ventilación 08:00'), 'Espontánea');
    await user.selectOptions(screen.getByLabelText('Ventilación 08:10'), 'Controlada');
    await user.selectOptions(screen.getByLabelText('Posición 08:00'), 'litotomia');
    expect(screen.getByRole('img', { name: 'Litotomía' })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Agregar anestésico inhalado'), 'Sevoflurano');
    // only sevoflurane is offered, so the add row is gone once it is in
    expect(screen.queryByLabelText('Agregar anestésico inhalado')).toBeNull();
    await user.type(screen.getByLabelText('Sevoflurano 08:00 (%)'), '2');
    await user.type(screen.getByLabelText('Sevoflurano 08:20 (%)'), '2,5');
    await user.selectOptions(screen.getByLabelText('Agregar fluido'), 'Ringer lactato');
    await user.type(screen.getByLabelText('Ringer lactato 08:00 (ml)'), '500');
    await user.selectOptions(screen.getByLabelText('Evento 08:00'), '2');

    await user.click(screen.getByRole('button', { name: 'Corte de energía eléctrica' }));
    await user.type(screen.getByLabelText('Descripción'), '10 minutos');

    const tr = storeCase(c.id).trans_record;
    const lane = (k: string) => tr.series.find((s) => s.lane === k)?.points;
    expect(lane('fc')).toEqual([{ t: 0, value: 80 }, { t: 5, value: 82 }]);
    expect(lane('spo2')).toEqual([{ t: 5, value: 95 }]);
    expect(lane('nindex')).toEqual([{ t: 0, value: 42 }]);
    expect(lane('pocus')).toEqual([{ t: 10, value: 'Deslizamiento pleural' }]);
    expect(lane('inhalado:Sevoflurano')).toEqual([{ t: 0, value: 2 }, { t: 20, value: 2.5 }]);
    expect(lane('fluido:Ringer lactato')).toEqual([{ t: 0, value: 500 }]);
    expect(lane('ventilacion')).toEqual([{ t: 0, value: 'Espontánea' }, { t: 10, value: 'Controlada' }]);
    expect(lane('posicion')).toEqual([{ t: 0, value: 'litotomia' }]);
    expect(tr.events).toEqual([{ marker: 2, t: 0, label: 'Inicia anestesia' }]);
    expect(tr.intercurrencias_tipos).toEqual({ 'Corte de energía eléctrica': true });
    expect(tr.intercurrencias).toBe('10 minutos');

    // Clearing the last value of a lane removes the lane.
    await user.clear(screen.getByLabelText('SpO₂ 08:05'));
    expect(storeCase(c.id).trans_record.series.some((s) => s.lane === 'spo2')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(h.puts).toHaveLength(1));
    expect(h.puts[0]!.body.trans_record).toMatchObject({ intervalo_min: 5, intercurrencias: '10 minutos' });
  }, 60_000); // a long user-event script over a large grid
});
