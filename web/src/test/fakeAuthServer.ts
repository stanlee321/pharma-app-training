import { vi } from 'vitest';
import { fakeUser } from '../api/authApi';
import type { UserDTO } from '../api/types';

/**
 * In-memory fake of the backend's local auth mode for mocked-fetch suites (no server). Mirrors
 * the as-built rules in docs/wiki/backend-api.md:
 * - POST /auth/login → LoginResponse; wrong password / unknown / inactive → the same 401;
 * - every other route needs a valid, unrevoked Bearer token (else 401);
 * - while must_change_password: only /auth/me and /auth/change-password (else 403
 *   "password change required");
 * - POST /auth/change-password → 204, wrong current → 400, short → 422; revokes older tokens;
 * - /admin/** → 403 "admin only" for a non-admin; GET /cases → [] for the caller.
 * Synthetic accounts only.
 */
export interface FakeAccount {
  password: string;
  user: UserDTO;
}

export interface RecordedCall {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const detail = (status: number, d: string) => json({ detail: d }, status);

export function fakeAuthServer(accounts: FakeAccount[], opts: { expiresAt?: string } = {}) {
  const byName = new Map(accounts.map((a) => [a.user.username, { ...a, user: { ...a.user } }]));
  /** token → username */
  const tokens = new Map<string, string>();
  const revoked = new Set<string>();
  const calls: RecordedCall[] = [];
  let n = 0;
  /** Paths (method + path) forced to answer with a given response. */
  const overrides = new Map<string, () => Response>();

  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = init?.method ?? 'GET';
    const authorization = new Headers(init?.headers).get('Authorization');
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    calls.push({ method, path, authorization, body });

    const forced = overrides.get(`${method} ${path}`);
    if (forced) return forced();

    if (method === 'POST' && path === '/auth/login') {
      const { username, password } = body as { username: string; password: string };
      const acc = byName.get(username.toLowerCase());
      if (!acc || acc.password !== password || !acc.user.is_active) return detail(401, 'Invalid username or password');
      const token = `tok-${++n}`;
      tokens.set(token, acc.user.username);
      return json({
        access_token: token,
        token_type: 'bearer',
        expires_at: opts.expiresAt ?? '2999-01-01T00:00:00Z',
        user: acc.user,
      });
    }

    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
    const uname = token && !revoked.has(token) ? tokens.get(token) : undefined;
    const acc = uname ? byName.get(uname) : undefined;
    if (!acc || !acc.user.is_active) return detail(401, token ? 'Invalid or expired token' : 'Not authenticated');

    if (method === 'GET' && path === '/auth/me') return json(acc.user);
    if (method === 'POST' && path === '/auth/change-password') {
      const b = body as { current_password: string; new_password: string };
      if (b.current_password !== acc.password) return detail(400, 'Current password is incorrect');
      if (b.new_password.length < 8) {
        return json({ detail: [{ loc: ['body', 'new_password'], msg: 'String should have at least 8 characters' }] }, 422);
      }
      acc.password = b.new_password;
      acc.user = { ...acc.user, must_change_password: false };
      // Revoke every token of this account (the caller's too).
      for (const [t, u] of tokens) if (u === acc.user.username) revoked.add(t);
      return new Response(null, { status: 204 });
    }
    if (acc.user.must_change_password) return detail(403, 'password change required');
    if (path.startsWith('/admin') && acc.user.role !== 'admin') return detail(403, 'admin only');
    if (method === 'GET' && path === '/cases') return json([]);
    return detail(404, 'Not Found');
  });

  return {
    fetch,
    calls,
    accounts: byName,
    /** Revoke a token (as a deactivation or password reset would). */
    revoke(token: string) {
      revoked.add(token);
    },
    /** Force `METHOD /path` (path without /api/v1) to answer with `respond()`. */
    override(key: string, respond: () => Response) {
      overrides.set(key, respond);
    },
  };
}

/** Synthetic accounts used across the auth suites. */
export const ANES = (over: Partial<UserDTO> = {}): FakeAccount => ({
  password: 'Correct-Horse-1',
  user: fakeUser({ id: 'aaaaaaaa-0000-4000-8000-00000000a001', username: 'dra.demo', full_name: 'Dra. Demo Sintetica', ...over }),
});
export const ADMIN = (over: Partial<UserDTO> = {}): FakeAccount => ({
  password: 'Admin-Secret-1',
  user: fakeUser({ id: 'aaaaaaaa-0000-4000-8000-00000000ad01', username: 'admin.demo', full_name: 'Admin Demo', role: 'admin', ...over }),
});
