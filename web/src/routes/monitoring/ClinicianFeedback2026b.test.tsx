import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { newCase } from '../../api/factory';
import { newDrug } from '../../state/drugLedger';
import { renderApp, restHarness, storeCase } from '../../test/restHarness';

describe('Registro transanestésico — clinician feedback 2026-11b', () => {
  it('records diagnosis/procedure, vascular access, O₂, monitors, isquemia, neumoperitoneo and notes', async () => {
    const c = newCase('Dr. Demo');
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/monitoring`, h.backend);
    await screen.findByRole('heading', { name: 'Registro transanestésico', level: 1 });

    await user.click(screen.getByRole('button', { name: 'PANI' }));
    await user.click(screen.getByRole('button', { name: 'PAI' }));
    expect(screen.queryByRole('group', { name: 'Temperatura · sitio' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Temp' }));
    await user.click(within(screen.getByRole('group', { name: 'Temperatura · sitio' })).getByRole('button', { name: 'Esofágica' }));
    await user.type(screen.getByLabelText('Otra monitorización'), 'Doppler');

    await user.type(screen.getByLabelText('Diagnóstico operatorio'), 'Dx op');
    await user.type(screen.getByLabelText('Procedimiento realizado'), 'Proc');

    await user.click(screen.getByRole('button', { name: '+ Vena periférica' }));
    const vena = screen.getByRole('group', { name: 'Vena periférica 1' });
    await user.type(within(vena).getByLabelText('Calibre'), '18G');
    await user.type(within(vena).getByLabelText('Ubicación'), 'Dorso mano');
    await user.click(screen.getByRole('button', { name: '+ Línea arterial' }));
    // one arterial line on the form: its add button goes away
    expect(screen.queryByRole('button', { name: '+ Línea arterial' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Puntas nasales' }));
    await user.type(screen.getByLabelText('Flujo'), '3');

    const isq = screen.getByRole('heading', { name: 'Isquemia', level: 2 }).closest('section')!;
    await user.type(within(isq).getByLabelText('Hora de inicio'), '11:00');
    await user.type(within(isq).getByLabelText('Hora de término'), '12:30');
    await user.type(within(isq).getByLabelText('Presión'), '250');
    expect(within(isq).getByText('1.5 h')).toBeInTheDocument();
    const neumo = screen.getByRole('heading', { name: 'Neumoperitoneo', level: 2 }).closest('section')!;
    await user.type(within(neumo).getByLabelText('Presión'), '12');
    await user.type(screen.getByLabelText('Medicación adicional y notas'), 'Dexametasona 4 mg IV');

    const d = storeCase(c.id);
    expect(d.trans_record.monitoring).toMatchObject({ PANI: true, PAI: true, Temp: true, Esofágica: true });
    expect(d.trans_record.monitoring_otro).toBe('Doppler');
    expect(d.diagnostico_postop).toBe('Dx op');
    expect(d.operacion_realizada).toBe('Proc');
    expect(d.trans_record.accesos).toEqual([
      { tipo: 'periferica', calibre: '18G', ubicacion: 'Dorso mano' },
      { tipo: 'arterial', calibre: '', ubicacion: '' },
    ]);
    expect(d.trans_record.o2_suplementario).toEqual({ dispositivo: 'puntas_nasales', flujo: 3 });
    expect(d.isquemia).toMatchObject({ hr_inicio: '11:00', hr_termino: '12:30', presion: 250 });
    expect(d.neumoperitoneo.presion).toBe(12);
    expect(d.trans_record.notas).toBe('Dexametasona 4 mg IV');

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(h.puts).toHaveLength(1));
    expect(h.puts[0]!.body).toMatchObject({
      isquemia: { presion: 250 },
      trans_record: { accesos: [{ tipo: 'periferica' }, { tipo: 'arterial' }], o2_suplementario: { flujo: 3 } },
    });
  }, 60_000);

  it('reminds the pending blood pressures and shows the ledger letters on the grid', async () => {
    const c = newCase('Dr. Demo');
    const start = new Date(Date.now() - 22 * 60_000);
    start.setSeconds(0, 0);
    c.trans_record.inicio = start.toISOString();
    c.trans_record.series = [
      { lane: 'fc', points: [{ t: 0, value: 80 }] },
      { lane: 'ta_sys', points: [{ t: 0, value: 120 }] },
    ];
    c.drugs = [{ ...newDrug(), farmaco: 'Fentanilo', dose_value: 50, time: new Date(start.getTime() + 6 * 60_000).toISOString() }];
    renderApp(`/cases/${c.id}/monitoring`, restHarness([c]).backend);
    const banner = await screen.findByTestId('pending-pressures');
    expect(banner).toHaveTextContent('Presión arterial pendiente');
    expect(screen.getByTestId('drugs-5')).toHaveTextContent('A');
  });
});

describe('Balance hídrico — fluids from the grid', () => {
  it('shows the grid sum where an intake cell is empty and counts it in the balance', async () => {
    const c = newCase('Dr. Demo');
    c.trans_record.series = [{ lane: 'fluido:Ringer lactato', points: [{ t: 0, value: 500 }, { t: 30, value: 300 }] }];
    renderApp(`/cases/${c.id}/fluids`, restHarness([c]).backend);
    const cell = await screen.findByLabelText('Cristaloide 1hr');
    expect(cell).toHaveValue('');
    expect(cell).toHaveAttribute('placeholder', '800');
    expect(screen.getByTestId('balance-1hr')).toHaveTextContent('800');
    expect(screen.getByText('800 ml')).toBeInTheDocument(); // total fluidos infundidos
  });
});
