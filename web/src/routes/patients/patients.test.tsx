import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeUser } from '../../api/authApi';
import { newCase } from '../../api/factory';
import type { AnesthesiaCase, CaseStatus, PatientDTO } from '../../api/types';
import { caseStore } from '../../state/caseStore';
import { fakePatient, renderApp, restHarness } from '../../test/restHarness';

/** Every value is synthetic. */
const ME = fakeUser().id;
const COLLEAGUE = 'bbbbbbbb-0000-4000-8000-00000000b002';
const AUTHORS = { [ME]: 'Dr. Demo', [COLLEAGUE]: 'Dra. Colega Sintética' };

function caseOf(p: PatientDTO, at: string, over: Partial<AnesthesiaCase> = {}, status: CaseStatus = 'draft'): AnesthesiaCase {
  const c = newCase('Dr. Demo', new Date(at));
  c.patient_id = p.id;
  c.patient.nombre = p.nombre;
  c.patient.registro = p.registro ?? '';
  c.user_id = ME;
  c.status = status;
  c.finalized_at = status === 'finalized' ? at : null;
  c.updated_at = at;
  return { ...c, ...over };
}

const puts = (h: ReturnType<typeof restHarness>) => h.calls.filter((c) => c.method === 'PUT');

describe('Historias clínicas (patient list)', () => {
  it('is the landing: /cases redirects to it; rows show registro, edad, sexo and case count', async () => {
    const ana = fakePatient({ nombre: 'Ana Sintética', registro: 'SYN-A', sexo: 'female', edad: 34 });
    const beto = fakePatient({ nombre: 'Beto Sintético', registro: 'SYN-B' });
    const h = restHarness([caseOf(ana, '2026-09-01T08:00:00Z'), caseOf(ana, '2026-09-02T08:00:00Z')], { patients: [beto, ana] });
    renderApp('/cases', h.backend);
    expect(await screen.findByRole('heading', { name: 'Historias clínicas', level: 1 })).toBeInTheDocument();
    const anaRow = (await screen.findByRole('link', { name: /Ana Sintética/ })) as HTMLElement;
    expect(anaRow).toHaveAttribute('href', `/pacientes/${ana.id}`);
    expect(anaRow).toHaveTextContent('Registro SYN-A · 34 años · Femenino · 2 casos');
    expect(screen.getByRole('link', { name: /Beto Sintético/ })).toHaveTextContent('Registro SYN-B · 0 casos');
    // ordered by name
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/pacientes/'));
    expect(links.map((a) => a.textContent)).toEqual([expect.stringContaining('Ana'), expect.stringContaining('Beto')]);
  });

  it('searches by nombre or registro (debounced, sent as ?q=) and explains an empty result', async () => {
    const h = restHarness([], {
      patients: [fakePatient({ nombre: 'Ana Sintética', registro: 'SYN-A' }), fakePatient({ nombre: 'Beto Sintético', registro: 'EXP-77' })],
    });
    const user = userEvent.setup();
    renderApp('/pacientes', h.backend);
    await screen.findByRole('link', { name: /Beto Sintético/ });
    await user.type(screen.getByRole('searchbox', { name: 'Buscar' }), 'exp-77');
    await waitFor(() => expect(screen.queryByRole('link', { name: /Ana Sintética/ })).toBeNull());
    expect(screen.getByRole('link', { name: /Beto Sintético/ })).toBeInTheDocument();
    expect(h.calls.some((c) => c.method === 'GET' && c.url.includes('/api/v1/patients?') && c.url.includes('q=exp-77'))).toBe(true);

    await user.clear(screen.getByRole('searchbox', { name: 'Buscar' }));
    await user.type(screen.getByRole('searchbox', { name: 'Buscar' }), 'nadie');
    expect(await screen.findByText('Sin resultados')).toBeInTheDocument();
    expect(screen.getByText('Ningún paciente coincide con «nadie».')).toBeInTheDocument();
  });

  it('shows the empty state when there are no patients', async () => {
    renderApp('/pacientes', restHarness([], { patients: [] }).backend);
    expect(await screen.findByText('Aún no hay pacientes')).toBeInTheDocument();
    expect(screen.getByText('Pulse + para registrar al primer paciente.')).toBeInTheDocument();
  });
});

describe('Nuevo paciente', () => {
  it('validates, POSTs the identity and opens the new patient', async () => {
    const h = restHarness([], { patients: [] });
    const user = userEvent.setup();
    renderApp('/pacientes', h.backend);
    await screen.findByText('Aún no hay pacientes');
    await user.click(screen.getByRole('button', { name: 'Nuevo paciente' }));
    expect(await screen.findByRole('heading', { name: 'Nuevo paciente', level: 1 })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Registrar paciente' }));
    expect(screen.getByText('Escriba el nombre del paciente.')).toBeInTheDocument();
    expect(screen.getByText('Escriba el registro / expediente.')).toBeInTheDocument();
    // Sex feeds the PK models: a new patient cannot be registered without it.
    expect(screen.getByText('Seleccione el sexo del paciente.')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Sin especificar' })).toBeNull();
    expect(h.calls.some((c) => c.method === 'POST')).toBe(false);

    await user.type(screen.getByRole('textbox', { name: 'Nombre' }), '  Carla Sintética ');
    await user.type(screen.getByRole('textbox', { name: 'Registro / expediente' }), 'SYN-NEW-1');
    await user.click(screen.getByRole('radio', { name: 'Femenino' }));
    await user.type(screen.getByLabelText('Fecha de nacimiento'), '1990-05-04');
    await user.click(screen.getByRole('radio', { name: 'AB' }));
    await user.click(screen.getByRole('radio', { name: 'Negativo (−)' }));
    await user.click(screen.getByRole('button', { name: 'Registrar paciente' }));

    expect(await screen.findByRole('heading', { name: 'Carla Sintética', level: 1 })).toBeInTheDocument();
    const created = [...h.patients.values()][0]!;
    expect(created).toMatchObject({
      nombre: 'Carla Sintética',
      registro: 'SYN-NEW-1',
      sexo: 'female',
      fecha_nacimiento: '1990-05-04',
      grupo_sanguineo: 'AB',
      rh: '-',
    });
    expect(screen.getByText('Sin casos')).toBeInTheDocument();
  });

  it('a duplicate registro (409) offers to open the existing patient', async () => {
    const existing = fakePatient({ nombre: 'Dora Sintética', registro: 'SYN-DUP' });
    const h = restHarness([], { patients: [existing] });
    const user = userEvent.setup();
    renderApp('/pacientes/nuevo', h.backend);
    await user.type(await screen.findByRole('textbox', { name: 'Nombre' }), 'Otra Persona');
    await user.type(screen.getByRole('textbox', { name: 'Registro / expediente' }), ' syn-dup ');
    await user.click(screen.getByRole('radio', { name: 'Masculino' }));
    await user.click(screen.getByRole('button', { name: 'Registrar paciente' }));

    expect(await screen.findByText('Ya existe un paciente con el registro «syn-dup».')).toBeInTheDocument();
    expect(screen.getByText('Este registro ya pertenece a otro paciente.')).toBeInTheDocument();
    expect(h.patients.size).toBe(1);
    await user.click(screen.getByRole('button', { name: 'Abrir paciente existente' }));
    expect(await screen.findByRole('heading', { name: 'Dora Sintética', level: 1 })).toBeInTheDocument();
  });
});

describe('Paciente (patient screen)', () => {
  function seeded() {
    const p = fakePatient({ nombre: 'Elena Sintética', registro: 'SYN-E', sexo: 'female', edad: 51, grupo_sanguineo: 'O', rh: '+' });
    const c1 = caseOf(p, '2026-09-01T08:00:00Z', { diagnostico_preop: 'Colecistitis' }, 'finalized');
    const c2 = caseOf(p, '2026-09-10T08:00:00Z', { user_id: COLLEAGUE, owner: 'Dra. Colega Sintética', diagnostico_preop: 'Apendicitis' });
    const c3 = caseOf(p, '2026-09-20T08:00:00Z', { diagnostico_preop: '' });
    const h = restHarness([c3, c1, c2], { patients: [p], authors: AUTHORS });
    return { p, c1, c2, c3, h };
  }

  it('shows the header, the data and every case numbered, with status, author and editability', async () => {
    const { p, c1, c2, c3, h } = seeded();
    renderApp(`/pacientes/${p.id}`, h.backend);
    expect(await screen.findByRole('heading', { name: 'Elena Sintética', level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('patient-header')).toHaveTextContent('Registro SYN-E51 añosFemenino');
    expect(screen.getByText('Casos (3)')).toBeInTheDocument();

    const rows = screen.getAllByTestId('patient-case');
    expect(rows.map((r) => r.dataset.caseId)).toEqual([c1.id, c2.id, c3.id]);
    const [r1, r2, r3] = rows as [HTMLElement, HTMLElement, HTMLElement];
    expect(within(r1).getByText('Caso 1')).toBeInTheDocument();
    expect(within(r1).getByText('Finalizado')).toHaveClass('status-badge--finalized');
    expect(r1).toHaveTextContent('Colecistitis · Dr. Demo');
    expect(within(r2).getByText('Caso 2')).toBeInTheDocument();
    expect(within(r2).getByText('Borrador')).toHaveClass('status-badge--draft');
    expect(within(r2).getByText('Solo lectura')).toBeInTheDocument();
    expect(r2).toHaveTextContent('Apendicitis · Dra. Colega Sintética');
    expect(within(r3).getByText('Caso 3')).toBeInTheDocument();
    expect(r3).toHaveTextContent('Sin diagnóstico');
    expect(within(r3).queryByText('Solo lectura')).toBeNull();

    // Only an own draft (can_edit) can be deleted; every row opens the case Hub.
    expect(within(r1).queryByRole('button', { name: /Eliminar/ })).toBeNull();
    expect(within(r2).queryByRole('button', { name: /Eliminar/ })).toBeNull();
    expect(within(r3).getByRole('button', { name: 'Eliminar Caso 3' })).toBeInTheDocument();
    for (const [r, c] of [[r1, c1], [r2, c2], [r3, c3]] as const) {
      expect(within(r).getByRole('link')).toHaveAttribute('href', `/cases/${c.id}`);
    }
  });

  it('"+" creates a case for this patient (patient_id sent) and lands on its Hub', async () => {
    const { p, h } = seeded();
    const user = userEvent.setup();
    renderApp(`/pacientes/${p.id}`, h.backend);
    await screen.findByText('Casos (3)');
    await user.click(screen.getByRole('button', { name: 'Nuevo caso' }));

    expect(await screen.findByLabelText('Diagnóstico preop')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Elena Sintética', level: 1 })).toBeInTheDocument();
    await waitFor(() => expect(puts(h)).toHaveLength(1));
    const body = JSON.parse(String(h.fetch.mock.calls.find(([, i]) => i?.method === 'PUT')![1]!.body)) as AnesthesiaCase;
    expect(body.patient_id).toBe(p.id);
    expect(body.patient).toMatchObject({ nombre: 'Elena Sintética', registro: 'SYN-E', grupo_sanguineo: 'O', rh: '+' });
    expect(body.patient.profile.gender).toBe('female');
    // The age comes from the patient (edad, from fecha_nacimiento), never the 40-year default.
    expect(body.patient.profile.age).toBe(51);

    // Back from the Hub → this patient, now with 4 cases.
    await user.click(screen.getByRole('link', { name: 'Volver a Paciente' }));
    expect(await screen.findByText('Casos (4)')).toBeInTheDocument();
    expect(screen.getByText('Caso 4')).toBeInTheDocument();
  });

  it('a patient with no recorded sex is flagged on the header, the case and the edit form', async () => {
    const p = fakePatient({ nombre: 'Nora Sintética', registro: 'SYN-NOSEX', sexo: '' });
    const c = caseOf(p, '2026-09-20T08:00:00Z', {});
    const h = restHarness([c], { patients: [p] });
    const user = userEvent.setup();
    renderApp(`/pacientes/${p.id}`, h.backend);
    expect(await screen.findByRole('heading', { name: 'Nora Sintética', level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('patient-header')).toHaveTextContent('Sexo sin especificar');
    expect(screen.getByTestId('sexo-warning')).toHaveTextContent('lo tratarán como masculino');

    // The case's Patient Data shows the patient's unknown sex, not the snapshot's "male" default.
    await user.click(screen.getByRole('link', { name: /Caso 1/ }));
    await user.click(await screen.findByRole('link', { name: /^Datos del paciente/ }));
    await screen.findByRole('heading', { name: 'Datos del paciente', level: 1 });
    expect(await screen.findByTestId('sexo-warning')).toBeInTheDocument();
    expect(screen.getByText('Sexo', { selector: '.row__label' }).nextElementSibling).toHaveTextContent('Sin especificar');

    // "Editar paciente": saving without choosing a sex is refused locally.
    await user.click(screen.getByRole('link', { name: 'Editar paciente' }));
    await user.click(await screen.findByRole('button', { name: 'Guardar cambios' }));
    expect(screen.getByText('Seleccione el sexo del paciente.')).toBeInTheDocument();
    expect(h.calls.some((x) => x.method === 'PATCH')).toBe(false);
    await user.click(screen.getByRole('radio', { name: 'Femenino' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(h.patients.get(p.id)?.sexo).toBe('female'));
    expect(await screen.findByTestId('patient-header')).toHaveTextContent('Femenino');
    expect(screen.queryByTestId('sexo-warning')).toBeNull();
  });

  it('a colleague’s case opens read-only and never sends a PUT', async () => {
    const { p, c2, h } = seeded();
    const user = userEvent.setup();
    renderApp(`/pacientes/${p.id}`, h.backend);
    await user.click(await screen.findByRole('link', { name: /Caso 2/ }));

    expect(await screen.findByTestId('readonly-banner')).toHaveTextContent('Caso de otro anestesiólogo — solo lectura');
    expect(screen.getByLabelText('Diagnóstico preop')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    expect(caseStore.getState().meta[c2.id]?.foreign).toBe(true);
    expect(caseStore.getState().updateCase(c2.id, (d) => void (d.sala = 'X'))).toBe(false);
    expect(await caseStore.getState().save(c2.id)).toBe(false);

    // A section screen is read-only too, and so is Review (no Finalize, no Generate). The section
    // links sit inside the disabled <fieldset>: browsers follow them, user-event refuses to
    // click there, so these clicks are dispatched directly.
    fireEvent.click(screen.getByRole('link', { name: /^Datos del paciente/ }));
    expect(await screen.findByLabelText('Cama')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Aumentar Peso' })).toBeDisabled();
    await user.click(screen.getByRole('link', { name: 'Volver a Caso' }));
    fireEvent.click(await screen.findByRole('link', { name: /^Revisión y exportación/ }));
    await screen.findByText('Aún no hay documentos guardados');
    expect(screen.queryByRole('button', { name: /Finalizar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Generar y guardar' })).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Volver a Caso' }));
    await user.click(await screen.findByRole('link', { name: 'Volver a Paciente' }));
    await screen.findByText('Casos (3)');

    expect(puts(h)).toHaveLength(0);
    expect(h.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('an own draft opens editable; an own finalized case opens read-only as finalized', async () => {
    const { p, c1, h } = seeded();
    const user = userEvent.setup();
    renderApp(`/pacientes/${p.id}`, h.backend);
    await user.click(await screen.findByRole('link', { name: /Caso 3/ }));
    expect(await screen.findByLabelText('Diagnóstico preop')).toBeEnabled();
    expect(screen.queryByTestId('readonly-banner')).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Volver a Paciente' }));
    await user.click(await screen.findByRole('link', { name: /Caso 1/ }));
    expect(await screen.findByTestId('readonly-banner')).toHaveTextContent('Caso finalizado — solo lectura');
    expect(caseStore.getState().meta[c1.id]?.foreign).toBe(false);
  });

  it('edits the patient (PATCH with only the changes); the Hub’s "Editar paciente" opens the form', async () => {
    const { p, c3, h } = seeded();
    const user = userEvent.setup();
    renderApp(`/cases/${c3.id}/patient`, h.backend);
    await user.click(await screen.findByRole('link', { name: 'Editar paciente' }));
    const nombre = await screen.findByRole('textbox', { name: 'Nombre' });
    expect(nombre).toHaveValue('Elena Sintética');
    await user.clear(nombre);
    await user.type(nombre, 'Elena Sintética Ruiz');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByRole('heading', { name: 'Elena Sintética Ruiz', level: 1 })).toBeInTheDocument();
    const patch = h.fetch.mock.calls.find(([, i]) => i?.method === 'PATCH')!;
    expect(String(patch[0])).toBe(`/api/v1/patients/${p.id}`);
    expect(JSON.parse(String(patch[1]!.body))).toEqual({ nombre: 'Elena Sintética Ruiz' });
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).toBeNull();

    // The draft case follows the patient (the server re-copied its snapshot).
    await user.click(screen.getByRole('link', { name: /Caso 3/ }));
    expect(await screen.findByRole('heading', { name: 'Elena Sintética Ruiz', level: 1 })).toBeInTheDocument();
  });

  it('editing to a registro that belongs to another patient offers to open it', async () => {
    const { p, h } = seeded();
    const other = fakePatient({ nombre: 'Fausto Sintético', registro: 'SYN-F' });
    h.patients.set(other.id, other);
    const user = userEvent.setup();
    renderApp(`/pacientes/${p.id}?editar=1`, h.backend);
    const registro = await screen.findByRole('textbox', { name: 'Registro / expediente' });
    await user.clear(registro);
    await user.type(registro, 'syn-f');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Ese registro ya pertenece a otro paciente.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Abrir paciente existente' }));
    expect(await screen.findByRole('heading', { name: 'Fausto Sintético', level: 1 })).toBeInTheDocument();
  });

  it('deletes an own draft after inline confirmation', async () => {
    const { p, c3, h } = seeded();
    const user = userEvent.setup();
    renderApp(`/pacientes/${p.id}`, h.backend);
    await user.click(await screen.findByRole('button', { name: 'Eliminar Caso 3' }));
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(await screen.findByText('Casos (2)')).toBeInTheDocument();
    expect(h.calls.some((c) => c.method === 'DELETE' && c.url.endsWith(`/cases/${c3.id}`))).toBe(true);
  });

  it('an unknown patient shows "Paciente no encontrado"', async () => {
    renderApp('/pacientes/11111111-0000-4000-8000-00000000dead', restHarness([], { patients: [] }).backend);
    expect(await screen.findByText('Paciente no encontrado')).toBeInTheDocument();
  });

  it('a malformed patient id is "Paciente no encontrado" without a request (no English 422)', async () => {
    const h = restHarness([], { patients: [] });
    renderApp('/pacientes/not-a-uuid', h.backend);
    expect(await screen.findByText('Paciente no encontrado')).toBeInTheDocument();
    expect(screen.queryByText(/Input should be|valid UUID|se esperaba/i)).not.toBeInTheDocument();
    expect(h.calls.some((c) => c.url.includes('/patients/not-a-uuid'))).toBe(false);
  });
});
