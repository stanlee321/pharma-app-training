import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeUser, InMemoryAuthApi, type AuthApi } from '../api/authApi';
import { newCase } from '../api/factory';
import type { LoginResponse, UserDTO } from '../api/types';
import { readJSON, StorageKeys, writeJSON, type StoredDrafts } from '../lib/storage';
import { SessionExpiryBanner } from '../routes/SessionExpiryBanner';
import { signInAs } from '../test/auth';
import { restHarness, TEST_TOKEN } from '../test/restHarness';
import { DRAFT_TTL_MS, SESSION_WARNING_MS, startSessionTimer, useAuthStore, whenDraftsRestored } from './authStore';
import { caseStore } from './caseStore';

/** An auth API that signs in as `user` with the harness token. */
function authAs(user: UserDTO): AuthApi {
  return {
    async login(): Promise<LoginResponse> {
      return {
        access_token: TEST_TOKEN,
        token_type: 'bearer',
        expires_at: new Date(Date.now() + 12 * 3600_000).toISOString(),
        user,
      };
    },
    me: async () => user,
    changePassword: async () => {},
  };
}

/** Case ids stored as `userId`'s drafts (null = no key). */
const storedIds = (userId: string) =>
  readJSON<StoredDrafts<{ id: string }>>(StorageKeys.drafts(userId))?.entries.map((e) => e.case.id) ?? null;

const ANES = fakeUser({ id: 'u-anes-1', username: 'wf-anes' });
const OTHER = fakeUser({ id: 'u-anes-2', username: 'wf-other' });

/** Signed in as ANES with one loaded case that has an unsaved edit. */
async function withDirtyCase() {
  const c = newCase('Dr. Demo');
  c.patient.nombre = 'Paciente Demo (sintético)';
  const h = restHarness([c]);
  caseStore.getState().reset();
  caseStore.getState().setBackend(h.backend);
  signInAs(ANES, authAs(ANES));
  await caseStore.getState().load(c.id);
  caseStore.getState().updateCase(c.id, (d) => {
    d.diagnostico_preop = 'edit not yet saved';
  });
  expect(caseStore.getState().isDirty(c.id)).toBe(true);
  return { c, h };
}

afterEach(() => {
  vi.useRealTimers();
  useAuthStore.getState().logout();
});

describe('unsaved edits survive an involuntary sign-out', () => {
  it('token expiry keeps a per-user draft; the same user gets it back (dirty) and it is saved', async () => {
    const { c, h } = await withDirtyCase();
    useAuthStore.getState().logout('expired');
    expect(caseStore.getState().cases).toEqual([]);
    expect(storedIds(ANES.id)).toEqual([c.id]);

    await useAuthStore.getState().login('wf-anes', 'secret-password');
    await whenDraftsRestored();
    expect(useAuthStore.getState().restoredDrafts?.saved).toBe(1);
    expect(readJSON(StorageKeys.drafts(ANES.id))).toBeNull(); // taken, not left behind
    expect(caseStore.getState().getCase(c.id)?.diagnostico_preop).toBe('edit not yet saved');
    await vi.waitFor(() => expect(h.puts).toHaveLength(1));
    expect(h.puts[0]!.body.diagnostico_preop).toBe('edit not yet saved');
    await vi.waitFor(() => expect(caseStore.getState().isDirty(c.id)).toBe(false));
  });

  it('a 401 on a request (revoked / expired token) keeps the draft too', async () => {
    const { c } = await withDirtyCase();
    useAuthStore.setState({ token: 'revoked-token' });
    expect(await caseStore.getState().save(c.id)).toBe(false);
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().notice).toBe('expired');
    expect(storedIds(ANES.id)).toEqual([c.id]);
  });

  it('a deliberate Sign Out keeps nothing', async () => {
    await withDirtyCase();
    useAuthStore.getState().logout();
    expect(readJSON(StorageKeys.drafts(ANES.id))).toBeNull();
  });

  it('another account never receives the drafts', async () => {
    await withDirtyCase();
    useAuthStore.getState().logout('expired');
    useAuthStore.setState({ api: authAs(OTHER) });
    await useAuthStore.getState().login('wf-other', 'secret-password');
    await whenDraftsRestored();
    expect(useAuthStore.getState().restoredDrafts).toBeNull();
    expect(caseStore.getState().cases).toEqual([]);
    expect(readJSON(StorageKeys.drafts(ANES.id))).not.toBeNull();
  });

  it('drafts older than the TTL are dropped, not restored', async () => {
    const c = newCase('Dr. Demo');
    writeJSON(StorageKeys.drafts(ANES.id), {
      saved_at: new Date(Date.now() - DRAFT_TTL_MS - 60_000).toISOString(),
      cases: [c],
    });
    caseStore.getState().reset();
    caseStore.getState().setBackend(restHarness([]).backend);
    useAuthStore.setState({ api: authAs(ANES) });
    await useAuthStore.getState().login('wf-anes', 'secret-password');
    await whenDraftsRestored();
    expect(useAuthStore.getState().restoredDrafts).toBeNull();
    expect(readJSON(StorageKeys.drafts(ANES.id))).toBeNull();
  });
});

describe('session expiry warning', () => {
  it('warns 5 minutes before expiry, then logs out with the notice and keeps the draft', async () => {
    const { c } = await withDirtyCase();
    vi.useFakeTimers();
    useAuthStore.setState({ expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() });
    startSessionTimer();
    render(<SessionExpiryBanner />);
    expect(useAuthStore.getState().expiringSoon).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();

    act(() => vi.advanceTimersByTime(10 * 60_000 - SESSION_WARNING_MS + 1));
    expect(useAuthStore.getState().expiringSoon).toBe(true);
    expect(screen.getByRole('alert')).toHaveTextContent(/Your session ends at \d\d:\d\d\. Save your work, then sign in again\./);
    expect(screen.getByRole('button', { name: 'Save now' })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(SESSION_WARNING_MS));
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().notice).toBe('expired');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(storedIds(ANES.id)).toEqual([c.id]);
  });

  it('"Save now" saves every dirty case', async () => {
    const { h } = await withDirtyCase();
    useAuthStore.setState({ expiringSoon: true });
    render(<SessionExpiryBanner />);
    await act(async () => {
      screen.getByRole('button', { name: 'Save now' }).click();
    });
    await vi.waitFor(() => expect(h.puts).toHaveLength(1));
    expect(await screen.findByText(/All changes saved\./)).toBeInTheDocument();
  });
});

// Keep the default offline auth API from leaking into other suites.
afterEach(() => useAuthStore.setState({ api: new InMemoryAuthApi() }));
