import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeUser, RestAuthApi } from '../api/authApi';
import { HttpClient } from '../api/http';
import { RestBackend } from '../api/restBackend';
import type { CaseSummaryDTO } from '../api/types';
import { casesListUrl, rememberCasesSearch } from '../routes/admin/paging';
import { AppRoutes } from '../routes/AppRoutes';
import { signOutState } from '../test/auth';
import { ADMIN, ANES, fakeAuthServer, type FakeAccount } from '../test/fakeAuthServer';
import { FUTURE } from '../test/router';
import { useAuthStore } from './authStore';
import { caseStore } from './caseStore';

/** A second synthetic anesthesiologist (no real person). */
const OTHER: FakeAccount = {
  password: 'Other-Horse-2',
  user: fakeUser({ id: 'bbbbbbbb-0000-4000-8000-00000000b002', username: 'dr.otro', full_name: 'Dr. Otro Sintetico' }),
};

/** A case summary of account A, carrying a synthetic patient name. */
const A_SHELL: CaseSummaryDTO = {
  id: 'aaaaaaaa-0000-4000-8000-0000000000c1',
  owner: 'Dra. Demo',
  created_at: '2026-09-25T10:00:00Z',
  status: 'draft',
  updated_at: '2026-09-25T10:00:00Z',
  finalized_at: null,
  user_id: ANES().user.id,
  nombre: 'Paciente Sintetico de A',
  diagnostico_preop: 'Dx A',
} as CaseSummaryDTO;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * The fake auth server, except that account A's (tok-1) `GET /cases` and `GET /cases/{id}` hang
 * until the test answers them, and every request's `signal` is recorded.
 */
function setupServer() {
  const server = fakeAuthServer([ANES(), OTHER, ADMIN()]);
  const aList = deferred<Response>();
  const aCase = deferred<Response>();
  const signals: AbortSignal[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal) signals.push(init.signal);
    const path = new URL(String(input), 'http://localhost').pathname.replace(/^\/api\/v1/, '');
    const auth = new Headers(init?.headers).get('Authorization');
    if (auth === 'Bearer tok-1' && path === '/cases') return aList.promise;
    if (auth === 'Bearer tok-1' && path === `/cases/${A_SHELL.id}`) return aCase.promise;
    return server.fetch(input, init);
  });
  vi.stubGlobal('fetch', fetch);
  signOutState(new RestAuthApi());
  caseStore.getState().reset();
  caseStore.getState().setBackend(new RestBackend());
  return { server, aList, aCase, signals };
}

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  useAuthStore.getState().logout();
  vi.unstubAllGlobals();
});

describe('no case data crosses accounts in one tab', () => {
  it('login A with a pending list → logout → login B → the late answer shows none of A’s cases', async () => {
    const { aList, signals } = setupServer();
    await useAuthStore.getState().login('dra.demo', 'Correct-Horse-1');
    const pending = caseStore.getState().refresh(); // A's list, still in flight
    await waitFor(() => expect(signals.length).toBeGreaterThan(0));
    const aSignal = signals.at(-1)!;

    useAuthStore.getState().logout();
    // The old session's request was cancelled on sign-out.
    expect(aSignal.aborted).toBe(true);
    await useAuthStore.getState().login('dr.otro', 'Other-Horse-2');
    await caseStore.getState().refresh(); // B's own (empty) list

    aList.resolve(json([A_SHELL]));
    await pending;
    expect(useAuthStore.getState().user?.username).toBe('dr.otro');
    expect(caseStore.getState().cases).toEqual([]);
    expect(caseStore.getState().meta[A_SHELL.id]).toBeUndefined();
  });

  it('a case load in flight for A never lands in B’s session', async () => {
    const { aCase } = setupServer();
    await useAuthStore.getState().login('dra.demo', 'Correct-Horse-1');
    const pending = caseStore.getState().load(A_SHELL.id);
    useAuthStore.getState().logout();
    await useAuthStore.getState().login('dr.otro', 'Other-Horse-2');
    aCase.resolve(json({ id: A_SHELL.id }));
    expect(await pending).toBeUndefined();
    expect(caseStore.getState().getCase(A_SHELL.id)).toBeUndefined();
  });

  it('signing out forgets the remembered admin case filters (a q= may hold a patient name)', async () => {
    setupServer();
    await useAuthStore.getState().login('admin.demo', 'Admin-Secret-1');
    rememberCasesSearch('?q=Paciente%20Sintetico');
    expect(casesListUrl('/admin/cases')).toBe('/admin/cases?q=Paciente%20Sintetico');
    useAuthStore.getState().logout();
    expect(casesListUrl('/admin/cases')).toBe('/admin/cases');
  });
});

describe('a demoted admin', () => {
  it('403 "admin only" re-reads the account', async () => {
    const { server } = setupServer();
    await useAuthStore.getState().login('admin.demo', 'Admin-Secret-1');
    const acc = server.accounts.get('admin.demo')!;
    acc.user = { ...acc.user, role: 'anesthesiologist' }; // demoted by another admin
    await expect(new HttpClient().json('GET', ['admin', 'stats'])).rejects.toMatchObject({ status: 403 });
    await waitFor(() => expect(useAuthStore.getState().user?.role).toBe('anesthesiologist'));
    expect(server.calls.some((c) => c.path === '/auth/me')).toBe(true);
  });

  it('is redirected out of /admin instead of seeing error pages', async () => {
    const { server } = setupServer();
    await useAuthStore.getState().login('admin.demo', 'Admin-Secret-1');
    const acc = server.accounts.get('admin.demo')!;
    acc.user = { ...acc.user, role: 'anesthesiologist' };
    render(
      <MemoryRouter initialEntries={['/admin']} future={FUTURE}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Historias clínicas', level: 1 })).toBeInTheDocument();
  });

  it('a 403 "admin only" for an anesthesiologist does not re-read anything', async () => {
    const { server } = setupServer();
    await useAuthStore.getState().login('dra.demo', 'Correct-Horse-1');
    await expect(new HttpClient().json('GET', ['admin', 'stats'])).rejects.toMatchObject({ status: 403 });
    expect(server.calls.some((c) => c.path === '/auth/me')).toBe(false);
  });
});

describe('other tabs follow this tab’s session (storage event)', () => {
  const fire = (newValue: string | null) =>
    window.dispatchEvent(new StorageEvent('storage', { key: 'auth_session_v1', newValue }));

  it('a sign-out in another tab signs this tab out and drops its cases', async () => {
    setupServer();
    await useAuthStore.getState().login('dr.otro', 'Other-Horse-2');
    caseStore.getState().createCase('Dr. Otro');
    expect(caseStore.getState().cases).toHaveLength(1);
    fire(null);
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(caseStore.getState().cases).toEqual([]);
  });

  it('another account signing in elsewhere replaces this tab’s session and drops its cases', async () => {
    setupServer();
    await useAuthStore.getState().login('dra.demo', 'Correct-Horse-1');
    caseStore.getState().createCase('Dra. Demo');
    fire(JSON.stringify({ token: 'tok-other', expires_at: '2999-01-01T00:00:00Z', user: OTHER.user }));
    expect(useAuthStore.getState()).toMatchObject({ token: 'tok-other', user: { id: OTHER.user.id } });
    expect(caseStore.getState().cases).toEqual([]);
  });

  it('the same account with a new token (e.g. password changed there) keeps the cases', async () => {
    setupServer();
    const me = await useAuthStore.getState().login('dra.demo', 'Correct-Horse-1');
    caseStore.getState().createCase('Dra. Demo');
    fire(JSON.stringify({ token: 'tok-new', expires_at: '2999-01-01T00:00:00Z', user: me }));
    expect(useAuthStore.getState().token).toBe('tok-new');
    expect(caseStore.getState().cases).toHaveLength(1);
  });
});
