import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { newCase } from '../../api/factory';
import { renderApp, restHarness, storeCase } from '../../test/restHarness';

const values = (id: string) => storeCase(id).technique.values;

describe('TechniqueScreen — General', () => {
  it('writes modality + values blob keys exactly as TechniqueScreen.swift and PUTs them', async () => {
    const c = newCase('Dr. Demo');
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/technique/general`, h.backend);
    expect(await screen.findByRole('heading', { name: 'Technique · General', level: 1 })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'AGEV' }));
    expect(storeCase(c.id).technique.modality).toBe('AGEV');

    await user.click(screen.getByRole('button', { name: 'Sevoflurano' }));
    await user.click(screen.getByRole('button', { name: 'N2O' }));
    expect(values(c.id)).toMatchObject({
      volatil_Sevoflurano: true,
      volatil_Desflurano: false,
      volatil_Isoflurano: false,
      volatil_N2O: true,
    });

    // checkbox_value: value disabled until ticked.
    const dose = screen.getByLabelText('Propofol (mg)');
    expect(dose).toBeDisabled();
    await user.click(screen.getByLabelText('Propofol'));
    expect(dose).toBeEnabled();
    await user.type(dose, '120');
    expect(values(c.id)).toMatchObject({ ind_propofol: true, ind_propofol_val: 120 });
    await user.clear(dose);
    expect(values(c.id)).not.toHaveProperty('ind_propofol_val');
    await user.type(dose, '150');

    // Steppers show the Swift fallback until touched.
    expect(screen.getByLabelText('TET calibre')).toHaveValue('7.0');
    expect(values(c.id)).not.toHaveProperty('va_tet_calibre');
    fireEvent.click(screen.getByRole('button', { name: 'Increase TET calibre' }), { detail: 0 });
    fireEvent.click(screen.getByRole('button', { name: 'Decrease Flujo' }), { detail: 0 });
    expect(values(c.id)).toMatchObject({ va_tet_calibre: 7.5, va_flujo: 1.5 });

    await user.click(screen.getByRole('switch', { name: 'Intubación endotraqueal' }));
    await user.click(screen.getByRole('switch', { name: 'Ventilación controlada' }));

    // TCI chip (Marsh, default 70 kg / 10 mg/ml): fallback target 4.0 → 63.84 mg = 6.4 ml bolus
    // (validation reference §4 TC1) and (0.119+0.112+0.042)·63.84·60/10 = 104.6 ml/h.
    const slot = document.querySelector('[data-slot="tci-chip"]');
    expect(slot).not.toBeNull();
    expect(slot).toHaveAttribute('data-model-id', 'marsh');
    expect(screen.getByLabelText('Target Cp')).toHaveValue('4.0');
    expect(screen.getByTestId('tci-bolus')).toHaveTextContent('Bolo 6.4 ml');
    expect(screen.getByTestId('tci-infusion')).toHaveTextContent('104.6 ml/h');
    expect(values(c.id)).not.toHaveProperty('tci_target_cp');
    fireEvent.click(screen.getByRole('button', { name: 'Increase Target Cp' }), { detail: 0 });
    // 4.5 mcg/ml → 71.82 mg = 7.2 ml; 0.273·71.82·6 = 117.6 ml/h; the target is persisted.
    expect(values(c.id)).toMatchObject({ tci_target_cp: 4.5 });
    expect(screen.getByTestId('tci-bolus')).toHaveTextContent('Bolo 7.2 ml');
    expect(screen.getByTestId('tci-infusion')).toHaveTextContent('117.6 ml/h');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.puts).toHaveLength(1));
    expect(h.puts[0]!.body.technique).toEqual({
      modality: 'AGEV',
      values: {
        volatil_Sevoflurano: true,
        volatil_Desflurano: false,
        volatil_Isoflurano: false,
        volatil_N2O: true,
        ind_propofol: true,
        ind_propofol_val: 150,
        va_tet_calibre: 7.5,
        va_flujo: 1.5,
        va_intubacion: true,
        vent_controlada: true,
        tci_target_cp: 4.5,
      },
    });
  });
});

describe('TechniqueScreen — Neuraxial', () => {
  it('Abordaje drives modality; Aguja is single-select flags; text keys stored as text', async () => {
    const c = newCase('Dr. Demo');
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/technique/neuraxial`, h.backend);
    await screen.findByRole('heading', { name: 'Technique · Regional Neuraxial', level: 1 });

    await user.click(screen.getByRole('button', { name: 'Subaracnoidea' }));
    await user.click(screen.getByRole('button', { name: 'Tuohy' }));
    await user.click(screen.getByRole('button', { name: 'Whitacre' })); // single-select replaces
    await user.type(screen.getByLabelText('Nivel'), 'L3–L4');
    await user.type(screen.getByLabelText('Nº aguja'), '27');
    await user.click(screen.getByLabelText('Bupivacaína'));
    await user.type(screen.getByLabelText('Bupivacaína (mg)'), '10');

    expect(storeCase(c.id).technique.modality).toBe('Subaracnoidea');
    expect(values(c.id)).toEqual({
      aguja_Tuohy: false,
      aguja_Quincke: false,
      aguja_Whitacre: true,
      nivel: 'L3–L4',
      aguja_calibre: '27',
      dx_bupivacaina: true,
      dx_bupivacaina_val: 10,
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.puts).toHaveLength(1));
    expect(h.puts[0]!.body.technique).toMatchObject({ modality: 'Subaracnoidea', values: { nivel: 'L3–L4' } });
  });
});

describe('TechniqueScreen — Peripheral', () => {
  it('writes sitio / volumen / toggles / local-anaesthetic flags / doses', async () => {
    const c = newCase('Dr. Demo');
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/technique/peripheral`, restHarness([c]).backend);
    await screen.findByRole('heading', { name: 'Technique · Peripheral Block', level: 1 });

    await user.type(screen.getByLabelText('Sitio del bloqueo'), 'Interescalénico');
    await user.type(screen.getByLabelText('Volumen'), '20');
    await user.click(screen.getByRole('switch', { name: 'Ecoguiado' }));
    await user.click(screen.getByRole('button', { name: 'Ropivacaína' }));
    await user.click(screen.getByRole('button', { name: 'Lidocaína' }));
    await user.click(screen.getByLabelText('Concentración'));
    await user.type(screen.getByLabelText('Concentración (%)'), '0.5');

    expect(storeCase(c.id).technique.modality).toBe('');
    expect(values(c.id)).toEqual({
      sitio_bloqueo: 'Interescalénico',
      volumen_ml: 20,
      ecoguiado: true,
      al_Bupivacaína: false,
      al_Lidocaína: true,
      al_Ropivacaína: true,
      al_Mepivacaína: false,
      dx_concentracion: true,
      dx_concentracion_val: 0.5,
    });
  });

  it('an unknown zone redirects to General', async () => {
    const c = newCase('Dr. Demo');
    renderApp(`/cases/${c.id}/technique/bogus`, restHarness([c]).backend);
    expect(await screen.findByRole('heading', { name: 'Technique · General', level: 1 })).toBeInTheDocument();
  });
});
