import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeUser } from '../../api/authApi';
import { newCase } from '../../api/factory';
import { RestBackend } from '../../api/restBackend';
import type { AnesthesiaCase, CaseStatus } from '../../api/types';
import { caseStore } from '../../state/caseStore';
import { newDrug } from '../../state/drugLedger';
import { signInAs } from '../../test/auth';
import { adminDocument, fakeAdminServer, ME_ADMIN } from '../../test/fakeAdminServer';
import { FUTURE } from '../../test/router';
import { AppRoutes } from '../AppRoutes';
import { paths } from '../paths';

const ANA = fakeUser({ id: 'u-ana', username: 'wf-ana', full_name: 'Dra. Ana Sintetica' });
const BETO = fakeUser({ id: 'u-beto', username: 'wf-beto', full_name: '' });

/** A synthetic case owned by `owner`, created `day` (UTC) — no real patient data. */
function synthCase(n: number, over: { status?: CaseStatus; owner?: string; day?: string } = {}): AnesthesiaCase {
  const c = newCase('Dr. Sintetico');
  const day = over.day ?? `2026-09-${String((n % 28) + 1).padStart(2, '0')}`;
  c.created_at = `${day}T10:${String(n % 60).padStart(2, '0')}:00Z`;
  c.updated_at = c.created_at;
  c.user_id = over.owner ?? ANA.id;
  c.status = over.status ?? 'draft';
  c.finalized_at = c.status === 'finalized' ? `${day}T12:00:00Z` : null;
  c.patient.nombre = `Paciente Sintetico ${n}`;
  c.patient.registro = `TEST-${n}`;
  c.diagnostico_preop = `Dx sintetico ${n}`;
  c.sala = 'Sala 1';
  c.drugs = [{ ...newDrug(), farmaco: 'Propofol', dose_value: 100, rust_model_id: 'marsh' }];
  return c;
}

/** The current URL, rendered next to the app so tests can assert filters ↔ URL. */
function LocationProbe() {
  const l = useLocation();
  return <output data-testid="location">{l.pathname + l.search}</output>;
}
const location = () => screen.getByTestId('location').textContent ?? '';
const searchParams = () => new URLSearchParams(location().split('?')[1] ?? '');

function setup(
  path: string,
  cases: AnesthesiaCase[],
  documents = [] as ReturnType<typeof adminDocument>[],
  prepare?: (server: ReturnType<typeof fakeAdminServer>) => void,
) {
  const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA, BETO], cases, documents });
  prepare?.(server);
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
  const listCalls = () => server.callsTo('GET', '/admin/cases');
  return { server, user, listCalls };
}

let urlSeq = 0;
beforeEach(() => {
  urlSeq = 0;
  Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:test/${++urlSeq}`),
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Admin cases list', () => {
  it('reads every filter from the URL and sends it to /admin/cases', async () => {
    const { listCalls } = setup(
      '/admin/cases?status=finalized&user_id=u-ana&q=sint&date_from=2026-09-01&date_to=2026-09-30&page=2',
      [synthCase(1)],
    );
    await screen.findByText(/0 cases \(filtered\)/);
    expect(listCalls().at(-1)!.query).toEqual({
      status: 'finalized',
      user_id: 'u-ana',
      q: 'sint',
      date_from: '2026-09-01',
      date_to: '2026-09-30',
      limit: '25',
      offset: '25',
    });
    expect(screen.getByLabelText('Status')).toHaveValue('finalized');
    await waitFor(() => expect(screen.getByLabelText('Anesthesiologist')).toHaveValue('u-ana'));
    expect(screen.getByLabelText('Search')).toHaveValue('sint');
    expect(screen.getByLabelText('Created from')).toHaveValue('2026-09-01');
    expect(screen.getByLabelText('Created to')).toHaveValue('2026-09-30');
  });

  it('writes filter changes to the URL (resetting the page) and re-queries', async () => {
    const cases = [synthCase(1), synthCase(2, { status: 'finalized' }), synthCase(3, { owner: BETO.id })];
    const { user, listCalls } = setup('/admin/cases?page=3', cases);
    expect(await screen.findByText('This page is empty')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Status'), 'finalized');
    await waitFor(() => expect(searchParams().get('status')).toBe('finalized'));
    expect(searchParams().get('page')).toBeNull();
    await waitFor(() => expect(listCalls().at(-1)!.query.status).toBe('finalized'));
    expect(await screen.findAllByTestId('case-row')).toHaveLength(1);

    await user.selectOptions(screen.getByLabelText('Anesthesiologist'), 'u-beto');
    await waitFor(() => expect(searchParams().get('user_id')).toBe('u-beto'));
    expect(await screen.findByText(/No matching cases/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Created from'), '2026-09-10');
    await waitFor(() => expect(searchParams().get('date_from')).toBe('2026-09-10'));

    // Clear filters empties the URL.
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(location()).toBe('/admin/cases'));
    expect(await screen.findAllByTestId('case-row')).toHaveLength(3);
  });

  it('debounces the text search into ?q= and re-syncs the box when the URL changes elsewhere', async () => {
    const cases = [synthCase(1), synthCase(2)];
    const { user, listCalls } = setup('/admin/cases', cases);
    await screen.findAllByTestId('case-row');
    const before = listCalls().length;
    await user.type(screen.getByLabelText('Search'), 'Sintetico 2');
    await waitFor(() => expect(searchParams().get('q')).toBe('Sintetico 2'));
    await waitFor(() => expect(listCalls().at(-1)!.query.q).toBe('Sintetico 2'));
    // One request for the whole word, not one per keystroke.
    expect(listCalls().length - before).toBe(1);
    expect(await screen.findAllByTestId('case-row')).toHaveLength(1);
    // A navigation that drops ?q= (the admin nav link, Back, …) empties the box too.
    await user.click(within(screen.getByRole('navigation', { name: 'Admin' })).getByRole('link', { name: 'Cases' }));
    await waitFor(() => expect(location()).toBe('/admin/cases'));
    expect(screen.getByLabelText('Search')).toHaveValue('');
    expect(await screen.findAllByTestId('case-row')).toHaveLength(2);
  });

  it('paginates 25 per page with Previous / Next and ?page=', async () => {
    const cases = Array.from({ length: 60 }, (_, i) => synthCase(i + 1));
    const { user, listCalls } = setup('/admin/cases', cases);
    expect(await screen.findAllByTestId('case-row')).toHaveLength(25);
    const nav = screen.getByRole('navigation', { name: 'Case pages' });
    expect(nav).toHaveTextContent('1–25 of 60 · Page 1 of 3');
    expect(within(nav).getByRole('button', { name: '‹ Previous' })).toBeDisabled();

    await user.click(within(nav).getByRole('button', { name: 'Next ›' }));
    await waitFor(() => expect(searchParams().get('page')).toBe('2'));
    await waitFor(() => expect(listCalls().at(-1)!.query.offset).toBe('25'));
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Case pages' })).toHaveTextContent('26–50 of 60'));

    await user.click(screen.getByRole('button', { name: 'Next ›' }));
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Case pages' })).toHaveTextContent('51–60 of 60 · Page 3 of 3'));
    expect(screen.getAllByTestId('case-row')).toHaveLength(10);
    expect(screen.getByRole('button', { name: 'Next ›' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '‹ Previous' }));
    await waitFor(() => expect(searchParams().get('page')).toBe('2'));
  });

  it('a page past the end offers the first page', async () => {
    const { user } = setup('/admin/cases?page=9', [synthCase(1)]);
    expect(await screen.findByText('This page is empty')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Go to the first page' }));
    expect(await screen.findAllByTestId('case-row')).toHaveLength(1);
    expect(searchParams().get('page')).toBeNull();
  });

  it('a reversed date range is explained locally and not requested', async () => {
    const { listCalls } = setup('/admin/cases?date_from=2026-09-20&date_to=2026-09-01', [synthCase(1)]);
    expect(await screen.findByText(/“Created from” is after “Created to”/)).toBeInTheDocument();
    expect(screen.getByLabelText('Created from')).toHaveAttribute('aria-invalid', 'true');
    expect(listCalls()).toHaveLength(0);
  });

  it('the dashboard link (?user_id=) pre-selects the anesthesiologist; rows show owner and status', async () => {
    const cases = [synthCase(1), synthCase(2, { status: 'finalized' }), synthCase(3, { owner: BETO.id })];
    setup(paths.admin.casesFor('u-ana'), cases);
    const rows = await screen.findAllByTestId('case-row');
    expect(rows).toHaveLength(2);
    await waitFor(() => expect(screen.getByLabelText('Anesthesiologist')).toHaveValue('u-ana'));
    expect(rows[0]).toHaveTextContent('Paciente Sintetico 2');
    expect(rows[0]).toHaveTextContent('Dra. Ana Sintetica');
    expect(within(rows[0]!).getByText('Finalized')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Draft')).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('link', { name: 'Paciente Sintetico 2' })).toHaveAttribute(
      'href',
      `/admin/cases/${cases[1]!.id}`,
    );
  });

  it('the owner filter lists only anesthesiologists; an unknown ?user_id= keeps its own option', async () => {
    const unknown = '0f0f0f0f-0000-4000-8000-000000000000';
    const { server } = setup(`/admin/cases?user_id=${unknown}`, [synthCase(1)]);
    const select = screen.getByLabelText('Anesthesiologist');
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(4));
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Everyone',
      'Account 0f0f0f0f…',
      'Dra. Ana Sintetica (wf-ana)',
      'wf-beto',
    ]);
    // The signed-in admin (an admin account owns no cases) is not offered.
    expect(within(select).queryByRole('option', { name: /admin\.demo/ })).toBeNull();
    expect(server.callsTo('GET', '/admin/users').at(-1)!.query).toEqual({ role: 'anesthesiologist' });
    expect(select).toHaveValue(unknown);
  });

  it('a list error shows the server detail and Retry', async () => {
    const { server, user } = setup('/admin/cases', [synthCase(1)], [], (s) =>
      s.override('GET /admin/cases', () => Response.json({ detail: 'database unavailable' }, { status: 500 })),
    );
    expect(await screen.findByText('Couldn’t load cases')).toBeInTheDocument();
    expect(screen.getByText('database unavailable')).toBeInTheDocument();
    server.clearOverride('GET /admin/cases');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findAllByTestId('case-row')).toHaveLength(1);
  });
});

describe('Admin read-only case view', () => {
  const CONTROLS = 'input, select, textarea, button';

  async function openCase(status: CaseStatus, sub = '') {
    const c = synthCase(7, { status });
    const docs = [adminDocument(c.id, 'nota_postanestesica', { id: 'dddddddd-0000-4000-8000-0000000000a1' })];
    const ctx = setup(paths.admin.case(c.id) + sub, [c], docs);
    await screen.findByRole('button', { name: 'Save' });
    return { c, ...ctx };
  }

  it('loads through GET /admin/cases/{id} and disables every input (Hub)', async () => {
    const { c, server } = await openCase('draft');
    expect(server.callsTo('GET', `/admin/cases/${c.id}`)).toHaveLength(1);
    expect(server.callsTo('GET', `/cases/${c.id}`)).toHaveLength(0);
    expect(screen.getByTestId('readonly-banner')).toHaveTextContent('Read-only view');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    const form = document.querySelector('fieldset.readonly-scope') as HTMLFieldSetElement;
    const controls = [...form.querySelectorAll<HTMLInputElement>(CONTROLS)];
    expect(controls.length).toBeGreaterThan(0);
    for (const el of controls) expect(el).toBeDisabled();
    expect(screen.getByLabelText('Sala')).toHaveValue('Sala 1');
    // Section links stay inside the admin area.
    expect(screen.getByRole('link', { name: /Patient Data/ })).toHaveAttribute('href', `/admin/cases/${c.id}/patient`);
    expect(screen.getByRole('link', { name: 'Back to Cases' })).toHaveAttribute('href', '/admin/cases');
    // A draft has no Reopen; the admin actions are usable (outside the disabled fieldset).
    expect(screen.queryByRole('button', { name: 'Reopen…' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete case…' })).toBeEnabled();
  });

  it.each([
    ['patient', '/patient'],
    ['drugs', '/drugs'],
    ['technique', '/technique/general'],
    ['review', '/review'],
  ])('section %s is read-only too, never PUTs, and goes back to the admin Hub', async (_name, sub) => {
    const { c, server, user } = await openCase('draft', sub);
    const form = document.querySelector('fieldset.readonly-scope') as HTMLFieldSetElement;
    for (const el of form.querySelectorAll(CONTROLS)) expect(el).toBeDisabled();
    // No add / delete affordances in read-only mode.
    expect(within(form).queryByRole('button', { name: /^Add|^Delete/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Encounter' })).toHaveAttribute('href', `/admin/cases/${c.id}`);
    // Typing into a disabled field changes nothing; the store refuses edits of an admin copy.
    const first = form.querySelector('input') as HTMLInputElement | null;
    if (first) await user.type(first, 'x');
    expect(caseStore.getState().updateCase(c.id, (d) => void (d.sala = 'hack'))).toBe(false);
    await user.click(screen.getByRole('link', { name: 'Back to Encounter' }));
    await screen.findByRole('button', { name: 'Delete case…' });
    expect(server.calls.filter((x) => x.method === 'PUT' || x.method === 'PATCH')).toHaveLength(0);
  });

  it('the Hub shows the owning account (linked) apart from the form’s free-text anesthesiologist', async () => {
    await openCase('draft'); // synthCase: owner (form) 'Dr. Sintetico', account ANA
    const fact = (label: string) => screen.getByText(label, { selector: '.row__label' }).closest('.row') as HTMLElement;
    const account = await within(fact('Account')).findByRole('link', { name: 'Dra. Ana Sintetica (wf-ana)' });
    expect(account).toHaveAttribute('href', '/admin/users/u-ana');
    expect(fact('Anesthesiologist (form)')).toHaveTextContent('Dr. Sintetico');
    expect(screen.queryByText('Owner', { selector: '.row__label' })).toBeNull();
  });

  it('the Hub falls back to the account id when the owning account cannot be read', async () => {
    const orphan = synthCase(8, { owner: '0e0e0e0e-0000-4000-8000-000000000000' });
    setup(paths.admin.case(orphan.id), [orphan]);
    await screen.findByRole('button', { name: 'Save' });
    const row = screen.getByText('Account', { selector: '.row__label' }).closest('.row') as HTMLElement;
    await waitFor(() => expect(row).toHaveTextContent('Account 0e0e0e0e…'));
  });

  it('an unknown sub-route falls back to the admin Hub', async () => {
    const { c } = await openCase('draft', '/nope');
    await waitFor(() => expect(location()).toBe(`/admin/cases/${c.id}`));
  });

  it('Reopen (finalized only): Cancel sends nothing; confirming makes it a draft and keeps it read-only', async () => {
    const { c, server, user } = await openCase('finalized');
    expect(screen.getByTestId('readonly-banner')).toHaveTextContent('Finalized — read-only');
    await user.click(screen.getByRole('button', { name: 'Reopen…' }));
    const confirm = screen.getByRole('group', { name: 'Confirm reopen' });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(server.callsTo('POST', `/admin/cases/${c.id}/reopen`)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Reopen…' }));
    await user.click(screen.getByRole('button', { name: 'Reopen case' }));
    await waitFor(() => expect(server.callsTo('POST', `/admin/cases/${c.id}/reopen`)).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('readonly-banner')).toHaveTextContent('Read-only view'));
    expect(screen.queryByRole('button', { name: 'Reopen…' })).not.toBeInTheDocument();
    expect(document.querySelector('.navbar [data-status]')).toHaveAttribute('data-status', 'draft');
    expect(screen.getByLabelText('Sala')).toBeDisabled();
    expect(caseStore.getState().getCase(c.id)?.status).toBe('draft');
  });

  it('Reopen refused (409: already a draft) shows the reason and reloads', async () => {
    const { c, server, user } = await openCase('finalized');
    server.override(`POST /admin/cases/${c.id}/reopen`, () =>
      Response.json({ detail: 'case is not finalized' }, { status: 409 }),
    );
    await user.click(screen.getByRole('button', { name: 'Reopen…' }));
    await user.click(screen.getByRole('button', { name: 'Reopen case' }));
    expect(await screen.findByText('Reopen failed: case is not finalized')).toBeInTheDocument();
    await waitFor(() => expect(server.callsTo('GET', `/admin/cases/${c.id}`).length).toBeGreaterThanOrEqual(2));
  });

  it('Delete: Cancel sends nothing; confirming deletes and returns to the (filtered) list with a notice', async () => {
    const other = synthCase(8);
    const c = synthCase(7);
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA], cases: [c, other] });
    vi.stubGlobal('fetch', server.fetch);
    caseStore.getState().reset();
    caseStore.getState().setBackend(new RestBackend());
    signInAs(ME_ADMIN());
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/admin/cases?status=draft']} future={FUTURE}>
        <AppRoutes />
        <LocationProbe />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('link', { name: 'Paciente Sintetico 7' }));
    await user.click(await screen.findByRole('button', { name: 'Delete case…' }));
    const confirm = screen.getByRole('group', { name: 'Confirm deleting the case' });
    expect(confirm).toHaveTextContent('all its stored documents permanently');
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(server.callsTo('DELETE', `/admin/cases/${c.id}`)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Delete case…' }));
    await user.click(screen.getByRole('button', { name: 'Delete case' }));
    expect(await screen.findByText(/Deleted case “.*Paciente Sintetico 7.*” and its documents\./)).toBeInTheDocument();
    expect(server.callsTo('DELETE', `/admin/cases/${c.id}`)).toHaveLength(1);
    expect(location()).toBe('/admin/cases?status=draft');
    expect(caseStore.getState().getCase(c.id)).toBeUndefined();
    const rows = await screen.findAllByTestId('case-row');
    expect(rows.map((r) => r.getAttribute('data-case-id'))).toEqual([other.id]);
  });

  it('a failed delete stays on the case and explains', async () => {
    const { c, server, user } = await openCase('draft');
    server.override(`DELETE /admin/cases/${c.id}`, () => Response.json({ detail: 'Case not found' }, { status: 404 }));
    await user.click(screen.getByRole('button', { name: 'Delete case…' }));
    await user.click(screen.getByRole('button', { name: 'Delete case' }));
    expect(await screen.findByText('Delete failed: Case not found')).toBeInTheDocument();
    expect(location()).toBe(`/admin/cases/${c.id}`);
  });

  it('documents panel: the admin can view, generate and delete (even on a finalized case)', async () => {
    const { c, server, user } = await openCase('finalized');
    const group = await screen.findByRole('group', { name: /Nota postanest/i });
    await user.click(within(group).getByRole('button', { name: /^View / }));
    await waitFor(() => expect(server.callsTo('GET', '/documents/dddddddd-0000-4000-8000-0000000000a1/file')).toHaveLength(1));
    expect(await screen.findByRole('link', { name: 'Download PDF' })).toHaveAttribute('href', 'blob:test/1');

    await user.click(within(group).getByRole('button', { name: /^Delete / }));
    await user.click(within(group).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(server.callsTo('DELETE', '/documents/dddddddd-0000-4000-8000-0000000000a1')).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: /Generate & store/ }));
    await waitFor(() => expect(server.callsTo('POST', `/cases/${c.id}/documents`)).toHaveLength(1));
    // The admin never PUTs the case (generate saves only a dirty owner draft).
    expect(server.calls.filter((x) => x.method === 'PUT')).toHaveLength(0);
    expect(screen.getByRole('link', { name: /This case in the document index/ })).toHaveAttribute(
      'href',
      `/admin/documents?case_id=${c.id}`,
    );
  });

  it('an unknown case shows Case not found', async () => {
    setup(paths.admin.case('0f0f0f0f-0000-4000-8000-000000000000'), []);
    expect(await screen.findByText('Case not found', { selector: '.empty-state__title' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete case…' })).not.toBeInTheDocument();
  });
});
