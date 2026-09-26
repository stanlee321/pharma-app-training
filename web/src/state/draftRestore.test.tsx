import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeUser, InMemoryAuthApi, type AuthApi } from '../api/authApi';
import { newCase } from '../api/factory';
import { RestBackend } from '../api/restBackend';
import type { AnesthesiaCase, LoginResponse, UserDTO } from '../api/types';
import { bootApp } from '../boot';
import {
  DRAFT_TTL_MS,
  purgeExpiredDrafts,
  readJSON,
  StorageKeys,
  writeJSON,
  writeString,
  type StoredDrafts,
} from '../lib/storage';
import { renderApp, restHarness, TEST_TOKEN } from '../test/restHarness';
import { useAuthStore, whenDraftsRestored } from './authStore';
import { caseStore } from './caseStore';

/**
 * Must-fix (increment 3): a restored session draft is never re-PUT blindly — the server copy is
 * checked first — and every user's expired drafts are swept (boot / login / logout).
 */

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

const ANES = fakeUser({ id: 'u-anes-1', username: 'wf-anes' });
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** A server-side case (synthetic) with a given `updated_at`. */
function serverCase(nombre: string, updatedAt: string | null, over: Partial<AnesthesiaCase> = {}): AnesthesiaCase {
  const c = newCase('Dr. Demo');
  c.patient.nombre = nombre;
  c.updated_at = updatedAt;
  return { ...c, ...over };
}

/** The local draft of `c`: same base `updated_at`, one unsaved edit. */
function draftOf(c: AnesthesiaCase, edit = 'edited offline'): AnesthesiaCase {
  return { ...JSON.parse(JSON.stringify(c)), diagnostico_preop: edit } as AnesthesiaCase;
}

function plantDrafts(userId: string, entries: StoredDrafts<AnesthesiaCase>['entries']) {
  writeJSON(StorageKeys.drafts(userId), { v: 2, entries } satisfies StoredDrafts<AnesthesiaCase>);
}

async function loginAndRestore(backend: RestBackend) {
  caseStore.getState().reset();
  caseStore.getState().setBackend(backend);
  useAuthStore.setState({ api: authAs(ANES) });
  await useAuthStore.getState().login('wf-anes', 'secret-password');
  await whenDraftsRestored();
  return useAuthStore.getState().restoredDrafts;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  useAuthStore.getState().logout();
  useAuthStore.setState({ api: new InMemoryAuthApi() });
});

describe('restoring a draft checks the server copy first', () => {
  it('unchanged on the server → saved, and the count reflects the save', async () => {
    const c = serverCase('Paciente A (sintético)', '2026-09-25T10:00:00Z');
    const h = restHarness([c]);
    plantDrafts(ANES.id, [{ saved_at: ago(60_000), pending_create: false, case: draftOf(c) }]);
    const report = await loginAndRestore(h.backend);
    expect(report).toMatchObject({ saved: 1, conflicts: [], deleted: [], unsaved: [] });
    expect(h.calls.filter((x) => x.method === 'GET' && x.url.endsWith(c.id))).toHaveLength(1);
    expect(h.puts).toHaveLength(1);
    expect(h.puts[0]!.body.diagnostico_preop).toBe('edited offline');
  });

  it('deleted on the server (404) → dropped and reported, never re-created', async () => {
    const c = serverCase('Paciente Borrado (sintético)', '2026-09-25T10:00:00Z');
    const h = restHarness([]); // an admin deleted it meanwhile
    plantDrafts(ANES.id, [{ saved_at: ago(60_000), pending_create: false, case: draftOf(c) }]);
    const report = await loginAndRestore(h.backend);
    expect(report?.deleted).toEqual(['Paciente Borrado (sintético)']);
    expect(report?.saved).toBe(0);
    expect(h.puts).toHaveLength(0);
    expect(caseStore.getState().getCase(c.id)).toBeUndefined();
    expect(readJSON(StorageKeys.drafts(ANES.id))).toBeNull();
  });

  it('never created on the server (pending create, 404) → created now', async () => {
    const c = serverCase('Paciente Nuevo (sintético)', null);
    const h = restHarness([]);
    plantDrafts(ANES.id, [{ saved_at: ago(60_000), pending_create: true, case: draftOf(c) }]);
    const report = await loginAndRestore(h.backend);
    expect(report?.saved).toBe(1);
    expect(h.puts).toHaveLength(1);
  });

  it('changed on the server since (updated_at differs) → no PUT; server copy shown; re-apply or discard', async () => {
    const base = serverCase('Paciente C (sintético)', '2026-09-25T10:00:00Z');
    const newer = { ...base, updated_at: '2026-09-25T11:30:00Z', diagnostico_preop: 'saved on another device' };
    const h = restHarness([newer]);
    plantDrafts(ANES.id, [{ saved_at: ago(60_000), pending_create: false, case: draftOf(base) }]);
    const report = await loginAndRestore(h.backend);
    expect(report).toMatchObject({ saved: 0, conflicts: ['Paciente C (sintético)'] });
    expect(h.puts).toHaveLength(0);
    expect(caseStore.getState().getCase(base.id)?.diagnostico_preop).toBe('saved on another device');
    expect(caseStore.getState().isDirty(base.id)).toBe(false);
    expect(caseStore.getState().draftConflicts[base.id]?.reason).toBe('changed');

    // Re-apply: the draft's content goes on top of the server's lifecycle fields, then a PUT.
    expect(caseStore.getState().reapplyDraft(base.id)).toBe(true);
    await vi.waitFor(() => expect(h.puts).toHaveLength(1));
    expect(h.puts[0]!.body.diagnostico_preop).toBe('edited offline');
    expect(caseStore.getState().draftConflicts[base.id]).toBeUndefined();
  });

  it('finalized on the server since → no PUT, cannot be re-applied, only dismissed', async () => {
    const base = serverCase('Paciente F (sintético)', '2026-09-25T10:00:00Z');
    const h = restHarness([{ ...base, status: 'finalized', finalized_at: '2026-09-25T11:00:00Z' }]);
    plantDrafts(ANES.id, [{ saved_at: ago(60_000), pending_create: false, case: draftOf(base) }]);
    const report = await loginAndRestore(h.backend);
    expect(report?.conflicts).toEqual(['Paciente F (sintético)']);
    expect(caseStore.getState().draftConflicts[base.id]?.reason).toBe('finalized');
    expect(caseStore.getState().reapplyDraft(base.id)).toBe(false);
    expect(h.puts).toHaveLength(0);
    caseStore.getState().discardDraft(base.id);
    expect(caseStore.getState().draftConflicts[base.id]).toBeUndefined();
  });

  it('a failed save is not counted as restored', async () => {
    const c = serverCase('Paciente S (sintético)', '2026-09-25T10:00:00Z');
    const h = restHarness([c]);
    const failingPut = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === 'PUT' ? new Response('{"detail":"boom"}', { status: 500 }) : h.fetch(input, init),
    );
    plantDrafts(ANES.id, [{ saved_at: ago(60_000), pending_create: false, case: draftOf(c) }]);
    const report = await loginAndRestore(new RestBackend({ baseUrl: () => '/api/v1', fetch: failingPut }));
    expect(report).toMatchObject({ saved: 0, unsaved: ['Paciente S (sintético)'] });
    expect(caseStore.getState().isDirty(c.id)).toBe(true); // still on screen as unsaved
  });

  it('server unreachable → nothing applied; the draft is kept with its ORIGINAL saved_at', async () => {
    const c = serverCase('Paciente U (sintético)', '2026-09-25T10:00:00Z');
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const savedAt = ago(3 * 3600_000);
    plantDrafts(ANES.id, [{ saved_at: savedAt, pending_create: false, case: draftOf(c) }]);
    const report = await loginAndRestore(new RestBackend({ baseUrl: () => '/api/v1', fetch: offline }));
    expect(report?.kept).toHaveLength(1);
    expect(caseStore.getState().getCase(c.id)).toBeUndefined();
    const stored = readJSON<StoredDrafts<AnesthesiaCase>>(StorageKeys.drafts(ANES.id));
    expect(stored?.entries.map((e) => [e.case.id, e.saved_at])).toEqual([[c.id, savedAt]]);
  });

  it('the case screen offers Re-apply / Discard for a changed case', async () => {
    const base = serverCase('Paciente R (sintético)', '2026-09-25T10:00:00Z');
    const newer = { ...base, updated_at: '2026-09-25T11:30:00Z', diagnostico_preop: 'server version' };
    const h = restHarness([newer]);
    renderApp(`/cases/${base.id}/patient`, h.backend, { id: ANES.id });
    await act(async () => {
      await caseStore.getState().restoreDrafts([{ case: draftOf(base), savedAt: ago(1000), pendingCreate: false }]);
    });
    const alert = await screen.findByText(/it was changed on the server since/);
    expect(alert).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Discard them' }));
    expect(screen.queryByText(/it was changed on the server since/)).toBeNull();
    expect(h.puts).toHaveLength(0);
  });
});

describe('expired drafts are swept for every user', () => {
  it('boot removes another user’s expired key and unparsable keys, and keeps fresh ones', async () => {
    const old = serverCase('Paciente Viejo (sintético)', null);
    plantDrafts('someone-else', [{ saved_at: ago(DRAFT_TTL_MS + 60_000), pending_create: false, case: old }]);
    writeString(StorageKeys.drafts('garbage-user'), '{not json');
    plantDrafts('fresh-user', [{ saved_at: ago(60_000), pending_create: false, case: old }]);
    // Legacy v1 shape, expired.
    writeJSON(StorageKeys.drafts('legacy-user'), { saved_at: ago(DRAFT_TTL_MS + 1), cases: [old] });
    writeString('unrelated_key', 'kept');

    await bootApp();

    expect(readJSON(StorageKeys.drafts('someone-else'))).toBeNull();
    expect(window.localStorage.getItem(StorageKeys.drafts('garbage-user'))).toBeNull();
    expect(readJSON(StorageKeys.drafts('legacy-user'))).toBeNull();
    expect(readJSON(StorageKeys.drafts('fresh-user'))).not.toBeNull();
    expect(window.localStorage.getItem('unrelated_key')).toBe('kept');
  });

  it('a partly expired set keeps only the fresh entries', () => {
    const a = serverCase('A (sintético)', null);
    const b = serverCase('B (sintético)', null);
    plantDrafts('u', [
      { saved_at: ago(DRAFT_TTL_MS + 1000), pending_create: false, case: a },
      { saved_at: ago(1000), pending_create: false, case: b },
    ]);
    purgeExpiredDrafts();
    expect(readJSON<StoredDrafts<AnesthesiaCase>>(StorageKeys.drafts('u'))?.entries.map((e) => e.case.id)).toEqual([
      b.id,
    ]);
  });

  it('logout (even a deliberate Sign Out) sweeps other users’ expired drafts', () => {
    plantDrafts('someone-else', [
      { saved_at: ago(DRAFT_TTL_MS + 60_000), pending_create: false, case: serverCase('X', null) },
    ]);
    useAuthStore.getState().logout();
    expect(readJSON(StorageKeys.drafts('someone-else'))).toBeNull();
  });

  it('merging a new stash never extends an older entry’s lifetime', async () => {
    const c = serverCase('Paciente M (sintético)', null);
    const h = restHarness([c]);
    caseStore.getState().reset();
    caseStore.getState().setBackend(h.backend);
    useAuthStore.setState({ api: authAs(ANES) });
    await useAuthStore.getState().login('wf-anes', 'x');
    await whenDraftsRestored();
    await caseStore.getState().load(c.id);
    caseStore.getState().updateCase(c.id, (d) => {
      d.diagnostico_preop = 'unsaved';
    });
    // An older stored entry for the same case (e.g. kept from an earlier unreachable restore).
    const older = ago(20 * 3600_000);
    plantDrafts(ANES.id, [{ saved_at: older, pending_create: false, case: c }]);
    useAuthStore.getState().logout('expired');
    const stored = readJSON<StoredDrafts<AnesthesiaCase>>(StorageKeys.drafts(ANES.id));
    expect(stored?.entries).toHaveLength(1);
    expect(stored?.entries[0]!.saved_at).toBe(older);
    expect(stored?.entries[0]!.case.diagnostico_preop).toBe('unsaved');
    await waitFor(() => expect(useAuthStore.getState().token).toBeNull());
  });
});
