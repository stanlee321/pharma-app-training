import { create } from 'zustand';
import type { AuthApi } from '../api/authApi';
import { abortSessionRequests, DEFAULT_BASE_URL, setAuthHooks } from '../api/http';
import { CaseStoreProvider } from '../api/provider';
import type { AnesthesiaCase, UserDTO, UserRole } from '../api/types';
import {
  DRAFT_TTL_MS,
  purgeExpiredDrafts,
  readDrafts,
  readJSON,
  readString,
  removeKey,
  StorageKeys,
  writeDrafts,
  writeJSON,
  writeString,
  type DraftEntry,
} from '../lib/storage';
import { forgetCasesSearch } from '../routes/admin/paging';
import { caseStore, type DraftRestoreReport, type SessionDraft } from './caseStore';

export { DRAFT_TTL_MS };

/**
 * Real auth against the backend's local mode (`POST /auth/login` → Bearer JWT).
 *
 * - `{token, expiresAt, user}` is persisted (guarded localStorage, `auth_session_v1`) so a reload
 *   keeps the session; `refreshMe()` re-reads the user on boot (role / active / pending change).
 * - The token expires at `expiresAt`: a timer (and every token read) logs out with the
 *   "session expired" notice. There are no refresh tokens (one ~12 h shift).
 * - The shared HTTP layer reports 401 / 403 "password change required" back here through
 *   `setAuthHooks`; route guards react to the resulting state (redirects are state-driven).
 * - `changePassword()` → 204 revokes the current token server-side, so it logs in again
 *   automatically with the new password.
 * - Unsaved work survives an involuntary sign-out: 5 min before `expiresAt` the UI warns
 *   (`expiringSoon`); on an 'expired' / 'passwordChanged' logout the dirty cases are kept as a
 *   per-user draft (`case_drafts_v1:<user id>`, each case at most `DRAFT_TTL_MS` old) and given
 *   back when the SAME user signs in again — after checking the server copy (see
 *   `caseStore.restoreDrafts`: deleted → dropped, changed/finalized → parked for review, unchanged
 *   → saved). A deliberate Sign Out does not keep drafts. Every user's expired drafts are swept at
 *   boot, login and logout (`purgeExpiredDrafts`).
 * - Sign-out (or a different account signing in) resets the case store — which drops any response
 *   still in flight for the old session — and cancels the old session's requests.
 * - The Login "Server" value is saved only after a login against it succeeds.
 * - Other tabs follow this one through the `storage` event on `auth_session_v1`: a sign-out there
 *   signs this tab out, another account signing in there replaces this tab's session.
 */

/** Why the login screen is shown (a one-shot notice). */
export type AuthNotice = 'expired' | 'passwordChanged' | null;

export interface Session {
  token: string;
  expires_at: string;
  user: UserDTO;
}

export interface AuthState {
  api: AuthApi;
  token: string | null;
  /** ISO-8601 expiry of `token`. */
  expiresAt: string | null;
  user: UserDTO | null;
  /** Current Login "Server" (Advanced) value = API base. */
  serverUrl: string;
  notice: AuthNotice;
  /** True between a successful password change and the automatic re-login. */
  reauthenticating: boolean;
  /** The token expires within `SESSION_WARNING_MS` (the UI warns to save and sign in again). */
  expiringSoon: boolean;
  /** What happened to the previous session's drafts at this login (null = nothing to report). */
  restoredDrafts: DraftRestoreReport | null;

  login(username: string, password: string, serverUrl?: string): Promise<UserDTO>;
  logout(notice?: AuthNotice): void;
  /** GET /auth/me → refresh the stored user (on app boot). Network errors keep the session. */
  refreshMe(): Promise<void>;
  /** POST /auth/change-password, then log in again with the new password. */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  setServerUrl(url: string): void;
  /** Replace the signed-in user's record (e.g. an admin edited their own account). */
  setUser(user: UserDTO): void;
  clearNotice(): void;
  clearRestoredDrafts(): void;
}

/** Warn this long before the token expires. */
export const SESSION_WARNING_MS = 5 * 60_000;
const earliest = (a: string, b: string) => (Date.parse(a) <= Date.parse(b) ? a : b);

/**
 * Merge `drafts` into `userId`'s stored drafts. Each case keeps its own `saved_at`; when a case is
 * already stored, the EARLIER timestamp wins, so a merge never extends the life of stored data.
 */
function mergeStoredDrafts(userId: string, drafts: SessionDraft[]): void {
  if (drafts.length === 0) return;
  const byId = new Map<string, DraftEntry<AnesthesiaCase>>();
  for (const e of readDrafts<AnesthesiaCase>(userId)) if (e.case?.id) byId.set(e.case.id, e);
  for (const d of drafts) {
    const prev = byId.get(d.case.id);
    byId.set(d.case.id, {
      saved_at: prev ? earliest(prev.saved_at, d.savedAt) : d.savedAt,
      pending_create: d.pendingCreate,
      case: d.case,
    });
  }
  writeDrafts(userId, [...byId.values()]);
}

/** Keep the case store's unsaved edits (and unresolved draft conflicts) for `userId`. */
function stashDrafts(userId: string): void {
  mergeStoredDrafts(userId, caseStore.getState().dirtyDrafts());
}

const reportIsEmpty = (r: DraftRestoreReport) =>
  r.saved === 0 && r.conflicts.length === 0 && r.deleted.length === 0 && r.unsaved.length === 0 && r.kept.length === 0;

/**
 * Take (and delete) `userId`'s unexpired stored drafts and hand them to the case store, which
 * checks each against the server before saving anything. Drafts it could not check (server
 * unreachable) are stored again with their original `saved_at`.
 */
async function restoreDrafts(userId: string): Promise<DraftRestoreReport | null> {
  const entries = readDrafts<AnesthesiaCase>(userId);
  removeKey(StorageKeys.drafts(userId));
  if (entries.length === 0) return null;
  const report = await caseStore.getState().restoreDrafts(
    entries.map((e) => ({ case: e.case, savedAt: e.saved_at, pendingCreate: !!e.pending_create })),
  );
  // Keep what could not be checked — unless this user signed out deliberately meanwhile (a
  // deliberate Sign Out keeps no drafts; an involuntary one leaves a notice).
  const s = useAuthStore.getState();
  if (s.user?.id === userId || (!s.user && s.notice)) mergeStoredDrafts(userId, report.kept);
  return reportIsEmpty(report) ? null : report;
}

/** The restore started by the latest login (tests await it). */
let restoring: Promise<void> = Promise.resolve();
/** Resolves once the drafts restore started by the latest login has finished. */
export function whenDraftsRestored(): Promise<void> {
  return restoring;
}

const ROLES: readonly UserRole[] = ['anesthesiologist', 'admin'];

function isValidSession(s: unknown): s is Session {
  if (!s || typeof s !== 'object') return false;
  const x = s as Partial<Session>;
  return (
    typeof x.token === 'string' &&
    x.token.length > 0 &&
    typeof x.expires_at === 'string' &&
    !Number.isNaN(Date.parse(x.expires_at)) &&
    !!x.user &&
    typeof x.user.id === 'string' &&
    typeof x.user.username === 'string' &&
    ROLES.includes(x.user.role)
  );
}

export function isExpired(expiresAt: string | null, now = Date.now()): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  return Number.isNaN(t) || t <= now;
}

/** Initial state from storage: a valid, unexpired session, or a signed-out state. */
function initialSession(): Pick<AuthState, 'token' | 'expiresAt' | 'user' | 'notice'> {
  const s = readJSON<unknown>(StorageKeys.session);
  if (!isValidSession(s)) {
    if (s != null) removeKey(StorageKeys.session);
    return { token: null, expiresAt: null, user: null, notice: null };
  }
  if (isExpired(s.expires_at)) {
    removeKey(StorageKeys.session);
    return { token: null, expiresAt: null, user: null, notice: 'expired' };
  }
  return { token: s.token, expiresAt: s.expires_at, user: s.user, notice: null };
}

function persist(token: string, expiresAt: string, user: UserDTO): void {
  writeJSON(StorageKeys.session, { token, expires_at: expiresAt, user } satisfies Session);
}

// setTimeout's delay is a signed 32-bit int; longer delays fire immediately.
const MAX_TIMEOUT = 2_147_483_647;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

/** Drop everything local to the signed-in session (not the persisted session key). */
function endLocalSession(): void {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  abortSessionRequests();
  caseStore.getState().reset();
  forgetCasesSearch();
}

export const useAuthStore = create<AuthState>()((set, get) => {
  const setUser = (user: UserDTO) => {
    const { token, expiresAt } = get();
    set({ user });
    if (token && expiresAt) persist(token, expiresAt, user);
  };

  return {
    api: CaseStoreProvider.makeAuthApi(),
    ...initialSession(),
    serverUrl: readString(StorageKeys.baseUrl) ?? DEFAULT_BASE_URL,
    reauthenticating: false,
    expiringSoon: false,
    restoredDrafts: null,

    async login(username, password, serverUrl) {
      // A new Server value is only tried here; it is saved once a login against it succeeds, so a
      // mistyped (or planted) URL never receives a later session's Bearer token.
      const candidate = serverUrl === undefined ? undefined : serverUrl.trim() || DEFAULT_BASE_URL;
      const res = await get().api.login(username.trim(), password, candidate);
      if (isExpired(res.expires_at)) throw new Error('The server issued an already-expired session.');
      if (candidate !== undefined) {
        writeString(StorageKeys.baseUrl, candidate);
        set({ serverUrl: candidate });
      }
      const prevUserId = get().user?.id;
      // Another account's local case copies (and its in-flight requests) must never leak into
      // this session.
      if (prevUserId !== res.user.id) {
        abortSessionRequests();
        caseStore.getState().reset();
        forgetCasesSearch();
      }
      persist(res.access_token, res.expires_at, res.user);
      set({ token: res.access_token, expiresAt: res.expires_at, user: res.user, notice: null });
      startSessionTimer();
      purgeExpiredDrafts();
      // In the background: it reads the server first, so it must not hold up the sign-in.
      const userId = res.user.id;
      set({ restoredDrafts: null });
      restoring = restoreDrafts(userId).then(
        (report) => {
          if (report && get().user?.id === userId) set({ restoredDrafts: report });
        },
        () => {},
      );
      return res.user;
    },

    logout(notice = null) {
      // Involuntary sign-out: keep unsaved edits for this user's next login.
      const user = get().user;
      if (notice && user) stashDrafts(user.id);
      purgeExpiredDrafts();
      removeKey(StorageKeys.session);
      endLocalSession();
      set({
        token: null,
        expiresAt: null,
        user: null,
        notice,
        reauthenticating: false,
        expiringSoon: false,
        restoredDrafts: null,
      });
    },

    async refreshMe() {
      if (!get().token) return;
      try {
        setUser(await get().api.me());
      } catch {
        /* 401 → logged out by the HTTP hook; network errors keep the cached session */
      }
    },

    async changePassword(currentPassword, newPassword) {
      const user = get().user;
      if (!user) throw new Error('Not signed in.');
      await get().api.changePassword(currentPassword, newPassword);
      // 204: every older token (ours included) is now revoked → log in again.
      set({ reauthenticating: true });
      try {
        await get().login(user.username, newPassword);
      } catch (e) {
        get().logout('passwordChanged');
        throw e;
      } finally {
        set({ reauthenticating: false });
      }
    },

    setServerUrl(url) {
      set({ serverUrl: url });
    },

    setUser(user) {
      if (get().user?.id === user.id) setUser(user);
    },

    clearNotice() {
      set({ notice: null });
    },

    clearRestoredDrafts() {
      set({ restoredDrafts: null });
    },
  };
});

// Wire the shared HTTP layer to this store (the HTTP module never imports it).
setAuthHooks({
  getToken() {
    const { token, expiresAt } = useAuthStore.getState();
    if (!token) return null;
    if (isExpired(expiresAt)) {
      useAuthStore.getState().logout('expired');
      return null;
    }
    return token;
  },
  onUnauthorized(tokenUsed) {
    const s = useAuthStore.getState();
    // Ignore late 401s for a token already replaced (e.g. revoked by our own password change).
    if (s.reauthenticating || tokenUsed !== s.token) return;
    s.logout('expired');
  },
  onAdminOnly(tokenUsed) {
    const s = useAuthStore.getState();
    // Only a signed-in admin can have been demoted; re-read the account so the role guard reacts.
    if (tokenUsed !== s.token || s.user?.role !== 'admin') return;
    void s.refreshMe();
  },
  onPasswordChangeRequired(tokenUsed) {
    const s = useAuthStore.getState();
    if (tokenUsed !== s.token || !s.user || s.user.must_change_password) return;
    const user = { ...s.user, must_change_password: true };
    useAuthStore.setState({ user });
    if (s.token && s.expiresAt) persist(s.token, s.expiresAt, user);
  },
});

/**
 * Follow the session other tabs write to `auth_session_v1` (the `storage` event fires only in the
 * OTHER tabs of this origin):
 * - removed / invalid → sign this tab out too (no notice, no drafts kept: it was a Sign Out);
 * - another account → drop this tab's session state, then take the new session;
 * - same account, new token (e.g. its password was changed there) → take the new token.
 */
export function onSessionStorageChange(newValue: string | null): void {
  const s = useAuthStore.getState();
  let next: unknown = null;
  try {
    next = newValue == null ? null : JSON.parse(newValue);
  } catch {
    next = null;
  }
  if (!isValidSession(next) || isExpired(next.expires_at)) {
    if (!s.token) return;
    purgeExpiredDrafts();
    endLocalSession();
    useAuthStore.setState({
      token: null,
      expiresAt: null,
      user: null,
      notice: null,
      reauthenticating: false,
      expiringSoon: false,
      restoredDrafts: null,
    });
    return;
  }
  if (next.token === s.token) return;
  if (s.user?.id !== next.user.id) endLocalSession();
  useAuthStore.setState({ token: next.token, expiresAt: next.expires_at, user: next.user, notice: null });
  startSessionTimer();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e: StorageEvent) => {
    // `key === null`: the other tab cleared all of storage.
    if (e.key === StorageKeys.session || e.key === null) onSessionStorageChange(e.key === null ? null : e.newValue);
  });
}

/**
 * (Re)arm the session timer: sets `expiringSoon` once the token has less than
 * `SESSION_WARNING_MS` left, and logs out with the "session expired" notice at `expiresAt`
 * (keeping unsaved edits as a draft). Called after login and once at app boot for a session
 * restored from storage; it re-arms itself for the next deadline.
 */
export function startSessionTimer(): void {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  const s = useAuthStore.getState();
  if (!s.token) return;
  const ms = Date.parse(s.expiresAt ?? '') - Date.now();
  if (!(ms > 0)) {
    s.logout('expired');
    return;
  }
  const soon = ms <= SESSION_WARNING_MS;
  if (s.expiringSoon !== soon) useAuthStore.setState({ expiringSoon: soon });
  const next = soon ? ms : ms - SESSION_WARNING_MS;
  expiryTimer = setTimeout(startSessionTimer, Math.min(next, MAX_TIMEOUT));
}

/** Where a signed-in user lands. */
export function landingPath(user: Pick<UserDTO, 'role'>): string {
  return user.role === 'admin' ? '/admin' : '/cases';
}

/** Whether `path` belongs to the area of `role` (to honour a remembered "from" path). */
export function pathAllowedFor(role: UserRole, path: string): boolean {
  const isAdminPath = path === '/admin' || path.startsWith('/admin/');
  const isCasePath = path === '/cases' || path.startsWith('/cases/');
  return role === 'admin' ? isAdminPath : isCasePath;
}

/** Display name: full name, else username. */
export function displayName(user: Pick<UserDTO, 'full_name' | 'username'>): string {
  return user.full_name.trim() || user.username;
}
