import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeUser } from '../../api/authApi';
import { newCase } from '../../api/factory';
import { RestBackend } from '../../api/restBackend';
import type { AdminStatsDTO, AnesthesiaCase, CaseStatus, PatientDTO } from '../../api/types';
import { caseStore } from '../../state/caseStore';
import { signInAs } from '../../test/auth';
import { fakeAdminServer, ME_ADMIN, statsFixture } from '../../test/fakeAdminServer';
import { fakePatient } from '../../test/restHarness';
import { FUTURE } from '../../test/router';
import { AppRoutes } from '../AppRoutes';

const ANA = fakeUser({ id: 'u-ana', username: 'wf-ana', full_name: 'Dra. Ana Sintetica' });
const BETO = fakeUser({ id: 'u-beto', username: 'wf-beto', full_name: 'Dr. Beto Sintetico' });

// Synthetic patients only.
const P_ALFA = fakePatient({ nombre: 'Alfa Sintetico', registro: 'SYN-ALFA', sexo: 'female', edad: 41 });
const P_BETA = fakePatient({ nombre: 'Beta Sintetico', registro: 'SYN-BETA', sexo: 'male' });
const P_VACIO = fakePatient({ nombre: 'Vacio Sintetico', registro: 'SYN-VACIO' });

function synthCase(p: PatientDTO, n: number, over: { status?: CaseStatus; owner?: string } = {}): AnesthesiaCase {
  const c = newCase('Dr. Sintetico');
  c.id = `22222222-0000-4000-8000-${String(n).padStart(12, '0')}`;
  c.created_at = `2026-09-${String(n + 1).padStart(2, '0')}T10:00:00Z`;
  c.updated_at = c.created_at;
  c.user_id = over.owner ?? ANA.id;
  c.status = over.status ?? 'draft';
  c.patient_id = p.id;
  c.patient.nombre = p.nombre;
  c.patient.registro = p.registro ?? '';
  c.diagnostico_preop = `Dx sintetico ${n}`;
  return c;
}

const CASES = [
  synthCase(P_ALFA, 1),
  synthCase(P_ALFA, 2, { owner: BETO.id, status: 'finalized' }),
  synthCase(P_BETA, 3),
];

function LocationProbe() {
  const l = useLocation();
  return <output data-testid="location">{l.pathname + l.search}</output>;
}
const location = () => screen.getByTestId('location').textContent ?? '';

function setup(path: string, opts: { cases?: AnesthesiaCase[]; stats?: AdminStatsDTO } = {}) {
  const server = fakeAdminServer({
    me: ME_ADMIN(),
    users: [ANA, BETO],
    cases: opts.cases ?? CASES,
    patients: [P_ALFA, P_BETA, P_VACIO],
    stats: opts.stats,
  });
  vi.stubGlobal('fetch', server.fetch);
  caseStore.getState().reset();
  caseStore.getState().setBackend(new RestBackend());
  signInAs(ME_ADMIN());
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[path]} future={FUTURE}>
      <AppRoutes />
      <LocationProbe />
    </MemoryRouter>,
  );
  return { server, user };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Admin patients list', () => {
  it('is in the admin nav and lists every patient with its case count', async () => {
    const { server } = setup('/admin/patients');
    const nav = screen.getByRole('navigation', { name: 'Administración' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).toEqual([
      'Panel',
      'Pacientes',
      'Casos',
      'Usuarios',
      'Documentos',
    ]);
    expect(within(nav).getByRole('link', { name: 'Pacientes' })).toHaveAttribute('aria-current', 'page');

    const rows = await screen.findAllByTestId('patient-row');
    expect(rows.map((r) => within(r).getByRole('rowheader').textContent)).toEqual([
      'Alfa SinteticoRegistro SYN-ALFA',
      'Beta SinteticoRegistro SYN-BETA',
      'Vacio SinteticoRegistro SYN-VACIO',
    ]);
    expect(within(rows[0]!).getByRole('link', { name: '2 casos de Alfa Sintetico' })).toHaveAttribute(
      'href',
      `/admin/cases?patient_id=${P_ALFA.id}`,
    );
    expect(within(rows[0]!).getByText('41 años · Femenino')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Sin casos')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Sexo sin especificar')).toBeInTheDocument();
    expect(screen.getByText('3 pacientes')).toBeInTheDocument();
    expect(server.callsTo('GET', '/admin/patients').at(-1)!.query).toEqual({ limit: '25', offset: '0' });
  });

  it('reads the search from the URL and writes a new search back to it', async () => {
    const { server, user } = setup('/admin/patients?q=beta');
    expect(await screen.findAllByTestId('patient-row')).toHaveLength(1);
    expect(screen.getByLabelText('Buscar')).toHaveValue('beta');
    expect(server.callsTo('GET', '/admin/patients').at(-1)!.query.q).toBe('beta');
    expect(screen.getByText('1 paciente (filtrado)')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Buscar'));
    await user.type(screen.getByLabelText('Buscar'), 'SYN-VAC');
    await waitFor(() => expect(location()).toBe('/admin/patients?q=SYN-VAC'));
    await waitFor(() => expect(screen.getAllByTestId('patient-row').map((r) => r.dataset.patientId)).toEqual([P_VACIO.id]));

    await user.clear(screen.getByLabelText('Buscar'));
    await user.type(screen.getByLabelText('Buscar'), 'zzz');
    expect(await screen.findByText('Ningún paciente coincide')).toBeInTheDocument();
  });
});

describe('Admin patient page', () => {
  it('shows the identity and every case (any author), each opening the admin case view', async () => {
    const { user } = setup('/admin/patients');
    await user.click(await screen.findByRole('link', { name: 'Alfa Sintetico' }));
    expect(await screen.findByRole('heading', { name: 'Alfa Sintetico', level: 1 })).toBeInTheDocument();
    expect(location()).toBe(`/admin/patients/${P_ALFA.id}`);
    expect(screen.getByTestId('admin-patient-header')).toHaveTextContent('Registro SYN-ALFA41 años · Femenino');
    // Read-only: no inputs, no edit affordance.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Editar/ })).toBeNull();

    const rows = screen.getAllByTestId('admin-patient-case');
    expect(rows.map((r) => within(r).getByRole('link').textContent)).toEqual(['Caso 1', 'Caso 2']);
    expect(within(rows[1]!).getByText('Dr. Beto Sintetico')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Finalizado')).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('link', { name: 'Caso 1' })).toHaveAttribute('href', `/admin/cases/${CASES[0]!.id}`);

    // With cases, delete is not offered and the page says why.
    expect(screen.queryByRole('button', { name: /Eliminar paciente/ })).toBeNull();
    expect(screen.getByText(/El paciente tiene 2 casos\. Solo se puede eliminar un paciente sin casos/)).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Ver en la lista de casos ›' }));
    await waitFor(() => expect(location()).toBe(`/admin/cases?patient_id=${P_ALFA.id}`));
  });

  it('deletes an empty patient after an in-page confirmation and returns to the list', async () => {
    const { server, user } = setup(`/admin/patients/${P_VACIO.id}`);
    expect(await screen.findByText('Sin casos')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Eliminar paciente…' }));
    const confirm = screen.getByRole('group', { name: 'Confirmar eliminación del paciente' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancelar' }));
    expect(server.callsTo('DELETE', `/admin/patients/${P_VACIO.id}`)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Eliminar paciente…' }));
    await user.click(screen.getByRole('button', { name: 'Eliminar paciente' }));
    await waitFor(() => expect(location()).toBe('/admin/patients'));
    expect(server.callsTo('DELETE', `/admin/patients/${P_VACIO.id}`)).toHaveLength(1);
    expect(await screen.findByText('Se eliminó el paciente «Vacio Sintetico».')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByTestId('patient-row')).toHaveLength(2));
    expect(server.patients.has(P_VACIO.id)).toBe(false);
  });

  it('shows the server guard in Spanish when a case appeared meanwhile, and reloads', async () => {
    const { server, user } = setup(`/admin/patients/${P_VACIO.id}`);
    await screen.findByText('Sin casos');
    // Another anesthesiologist adds a case after the page loaded.
    const late = synthCase(P_VACIO, 9);
    server.cases.set(late.id, late);
    await user.click(screen.getByRole('button', { name: 'Eliminar paciente…' }));
    await user.click(screen.getByRole('button', { name: 'Eliminar paciente' }));
    expect(await screen.findByText('No se pudo eliminar: El paciente tiene casos; elimínelos primero.')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Caso 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Eliminar paciente/ })).toBeNull();
    expect(location()).toBe(`/admin/patients/${P_VACIO.id}`);
    expect(server.patients.has(P_VACIO.id)).toBe(true);
  });

  it('reports an unknown patient', async () => {
    setup('/admin/patients/11111111-0000-4000-8000-999999999999');
    expect(await screen.findByText('Paciente no encontrado')).toBeInTheDocument();
  });

  it('a malformed patient id is "Paciente no encontrado" without a request (no English 422)', async () => {
    const { server } = setup('/admin/patients/not-a-uuid');
    expect(await screen.findByText('Paciente no encontrado')).toBeInTheDocument();
    expect(screen.queryByText(/Input should be|valid UUID|se esperaba/i)).not.toBeInTheDocument();
    expect(server.callsTo('GET', '/patients/not-a-uuid')).toHaveLength(0);
  });
});

describe('Admin cases by patient', () => {
  it('shows each case with its patient (nombre + registro) and filters by ?patient_id=', async () => {
    const { server, user } = setup(`/admin/cases?patient_id=${P_ALFA.id}`);
    const rows = await screen.findAllByTestId('case-row');
    expect(server.callsTo('GET', '/admin/cases').at(-1)!.query.patient_id).toBe(P_ALFA.id);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(within(r).getByRole('link', { name: 'Alfa Sintetico' })).toBeInTheDocument();
      expect(within(r).getByTestId('case-row-registro')).toHaveTextContent('Registro SYN-ALFA');
    }
    const chip = screen.getByTestId('patient-filter');
    expect(await within(chip).findByRole('link', { name: 'Alfa Sintetico · Registro SYN-ALFA' })).toHaveAttribute(
      'href',
      `/admin/patients/${P_ALFA.id}`,
    );
    expect(screen.getByText('2 casos (filtrado)')).toBeInTheDocument();

    await user.click(within(chip).getByRole('button', { name: 'Quitar filtro de paciente' }));
    await waitFor(() => expect(location()).toBe('/admin/cases'));
    await waitFor(() => expect(screen.getAllByTestId('case-row')).toHaveLength(3));
    expect(server.callsTo('GET', '/admin/cases').at(-1)!.query.patient_id).toBeUndefined();

    // Each unfiltered row offers its patient's filter.
    const beta = screen.getAllByTestId('case-row').find((r) => r.dataset.caseId === CASES[2]!.id)!;
    await user.click(within(beta).getByRole('link', { name: 'Solo este paciente' }));
    await waitFor(() => expect(location()).toBe(`/admin/cases?patient_id=${P_BETA.id}`));
    await waitFor(() => expect(screen.getAllByTestId('case-row').map((r) => r.dataset.caseId)).toEqual([CASES[2]!.id]));
  });

  it("falls back to the case's snapshot registro when the patient has none", async () => {
    const legacy = fakePatient({ nombre: 'Legado Sintetico', registro: null });
    const withSnap = synthCase(legacy, 7);
    withSnap.patient.registro = 'LEG-SNAP-7';
    const bare = synthCase(legacy, 8);
    bare.patient.registro = '';
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA], cases: [withSnap, bare], patients: [legacy] });
    vi.stubGlobal('fetch', server.fetch);
    caseStore.getState().reset();
    signInAs(ME_ADMIN());
    render(
      <MemoryRouter initialEntries={['/admin/cases']} future={FUTURE}>
        <AppRoutes />
      </MemoryRouter>,
    );
    const rows = await screen.findAllByTestId('case-row');
    const reg = (id: string) =>
      within(rows.find((r) => r.dataset.caseId === id)!).getByTestId('case-row-registro').textContent;
    expect(reg(withSnap.id)).toBe('Registro LEG-SNAP-7');
    expect(reg(bare.id)).toBe('Sin registro');
  });

  it('does not request a malformed ?patient_id= and says so', async () => {
    const { server } = setup('/admin/cases?patient_id=not-a-uuid');
    expect(await screen.findByText('Filtro de paciente no válido')).toBeInTheDocument();
    expect(screen.getByText(/no es un identificador válido/)).toBeInTheDocument();
    expect(server.callsTo('GET', '/admin/cases')).toHaveLength(0);
  });

  it("links the admin case view to the case's patient", async () => {
    setup(`/admin/cases/${CASES[0]!.id}`);
    expect(await screen.findByRole('link', { name: 'Alfa Sintetico · Registro SYN-ALFA' })).toHaveAttribute(
      'href',
      `/admin/patients/${P_ALFA.id}`,
    );
  });
});

describe('Admin dashboard patients tile', () => {
  it('shows patients_total and opens the patient list', async () => {
    const stats = statsFixture('2026-09-25', { '2026-09-25': 3 }, { patients_total: 42 });
    const { user } = setup('/admin', { stats });
    const tile = await screen.findByTestId('stat-Pacientes');
    expect(tile.textContent?.replace(/\s/g, '')).toBe('Pacientes42');
    await user.click(within(tile).getByRole('link'));
    await waitFor(() => expect(location()).toBe('/admin/patients'));
    expect(await screen.findAllByTestId('patient-row')).toHaveLength(3);
  });
});
