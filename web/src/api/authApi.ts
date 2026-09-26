import { newUUID } from '../lib/uuid';
import { BackendError } from './backend';
import { HttpClient, http as appHttp } from './http';
import type { LoginResponse, UserDTO } from './types';

/** Auth endpoints (`/auth/*`) as a port, so tests and the offline mode can swap them. */
export interface AuthApi {
  /**
   * POST /auth/login (unauthenticated). 401 on bad credentials or an inactive account.
   * `baseUrl`: try this API base instead of the saved one (the caller saves it only on success).
   */
  login(username: string, password: string, baseUrl?: string): Promise<LoginResponse>;
  /** GET /auth/me (allowed while a password change is pending). */
  me(): Promise<UserDTO>;
  /** POST /auth/change-password → 204. The server revokes every older token, the caller's too. */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
}

export class RestAuthApi implements AuthApi {
  constructor(private readonly http: HttpClient = appHttp) {}

  login(username: string, password: string, baseUrl?: string): Promise<LoginResponse> {
    const client = baseUrl === undefined ? this.http : this.http.withBaseUrl(baseUrl);
    return client.json<LoginResponse>('POST', ['auth', 'login'], {
      body: { username, password },
      auth: false,
    });
  }

  me(): Promise<UserDTO> {
    return this.http.json<UserDTO>('GET', ['auth', 'me']);
  }

  changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return this.http.send('POST', ['auth', 'change-password'], {
      body: { current_password: currentPassword, new_password: newPassword },
    });
  }
}

/** Fixed id of the offline fake anesthesiologist (in-memory mode and tests). */
export const OFFLINE_USER_ID = '00000000-0000-4000-8000-00000000c0de';

/** A synthetic anesthesiologist account (no real person). */
export function fakeUser(over: Partial<UserDTO> = {}): UserDTO {
  const now = new Date().toISOString();
  return {
    id: OFFLINE_USER_ID,
    username: 'demo',
    full_name: 'Dr. Demo',
    clave: 'DEMO-01',
    role: 'anesthesiologist',
    is_active: true,
    must_change_password: false,
    created_at: now,
    updated_at: now,
    last_login_at: now,
    ...over,
  };
}

/**
 * Offline auth for `VITE_USE_INMEMORY=1` (pairs with `InMemoryBackend`): any username with a
 * non-empty password signs in as a fake anesthesiologist. No network, no real security.
 */
export class InMemoryAuthApi implements AuthApi {
  private user: UserDTO = fakeUser();

  async login(username: string, password: string): Promise<LoginResponse> {
    if (!username.trim() || !password) {
      throw BackendError.http(401, JSON.stringify({ detail: 'Invalid username or password' }));
    }
    const name = username.trim().toLowerCase();
    this.user = fakeUser({ username: name, full_name: username.trim() });
    return {
      access_token: `offline-${newUUID()}`,
      token_type: 'bearer',
      expires_at: new Date(Date.now() + 12 * 3600_000).toISOString(),
      user: this.user,
    };
  }

  async me(): Promise<UserDTO> {
    return this.user;
  }

  async changePassword(_current: string, next: string): Promise<void> {
    if (next.length < 8) {
      throw BackendError.http(422, JSON.stringify({ detail: [{ msg: 'String should have at least 8 characters' }] }));
    }
    this.user = { ...this.user, must_change_password: false };
  }
}
