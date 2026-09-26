import { readString, StorageKeys } from '../lib/storage';
import { BackendError } from './backend';

/**
 * The ONE authenticated HTTP layer. Every API call (cases, auth, documents, admin) goes through
 * `HttpClient`, which:
 * - prefixes the API base (Login → Advanced → "Server", default `/api/v1`);
 * - sends `Authorization: Bearer <token>` (unless `auth: false`, e.g. the login call itself);
 * - on **401** for a request that carried a token → `hooks.onUnauthorized(token)` (the auth store
 *   logs out with a "session expired" notice; the route guard then redirects to /login);
 * - on **403** `{"detail":"password change required"}` → `hooks.onPasswordChangeRequired(token)`
 *   (the store flags the user; the guard redirects to /change-password);
 * - on **403** `{"detail":"admin only"}` → `hooks.onAdminOnly(token)` (the account was demoted
 *   while signed in: the store re-reads `/auth/me`, and the role guard redirects);
 * - every authenticated request carries the current session's `AbortSignal`, so
 *   `abortSessionRequests()` (called on sign-out) cancels whatever the old session had in flight;
 * - throws `BackendError` for every non-2xx (its `detail` = the server's `ErrorDTO.detail`).
 *
 * The auth store registers the hooks once (`setAuthHooks`), so this module never imports it.
 */

/** Default API base: same-origin, proxied to the local backend by Vite in dev. */
export const DEFAULT_BASE_URL = '/api/v1';

/** The 403 detail the backend sends while `must_change_password` is set. */
export const PASSWORD_CHANGE_REQUIRED = 'password change required';

/** The 403 detail of an `/admin/**` route called by a non-admin (e.g. an admin demoted meanwhile). */
export const ADMIN_ONLY = 'admin only';

/** Effective base: persisted Login "Server" value, else the default. */
export function storedBaseUrl(): string {
  const s = readString(StorageKeys.baseUrl)?.trim();
  return s ? s : DEFAULT_BASE_URL;
}

export interface AuthHooks {
  /** Current bearer token, or null when signed out / expired. */
  getToken(): string | null;
  /** A request sent with `token` got 401 (expired, revoked, deactivated). */
  onUnauthorized(token: string): void;
  /** A request sent with `token` got 403 "password change required". */
  onPasswordChangeRequired(token: string): void;
  /** A request sent with `token` got 403 "admin only" (the role changed server-side). */
  onAdminOnly(token: string): void;
}

const noHooks: AuthHooks = {
  getToken: () => null,
  onUnauthorized: () => {},
  onPasswordChangeRequired: () => {},
  onAdminOnly: () => {},
};
let registeredHooks: AuthHooks = noHooks;

/** Signal shared by every authenticated request of the current session. */
let sessionController = new AbortController();

/**
 * Cancel every authenticated request still in flight (sign-out / account change): the old
 * session's responses must never be applied to the next one. Later requests get a fresh signal.
 */
export function abortSessionRequests(): void {
  sessionController.abort();
  sessionController = new AbortController();
}

/** Called once by the auth store. */
export function setAuthHooks(hooks: AuthHooks): void {
  registeredHooks = hooks;
}

export interface HttpClientOptions {
  /** API base (e.g. "/api/v1" or "http://host:8000/api/v1"); read at request time. */
  baseUrl?: () => string;
  /** Bearer token source; defaults to the registered auth store. */
  token?: () => string | null;
  /** Session hooks; default to the registered auth store's. */
  hooks?: Partial<Omit<AuthHooks, 'getToken'>>;
  fetch?: typeof fetch;
}

export interface RequestOptions {
  /** JSON body (serialized here). */
  body?: unknown;
  accept?: string;
  /** Send the bearer token (default true). */
  auth?: boolean;
  /** Query parameters; `undefined`/`null`/'' values are skipped. */
  query?: Record<string, string | number | boolean | null | undefined>;
}

/** `base` + URI-encoded path segments. */
export function joinUrl(base: string, ...parts: string[]): string {
  const b = base.replace(/\/+$/, '');
  return [b, ...parts.map((p) => encodeURIComponent(p))].join('/');
}

export class HttpClient {
  private readonly baseUrl: () => string;
  private readonly token: () => string | null;
  private readonly hooks: HttpClientOptions['hooks'];
  private readonly fetchImpl: typeof fetch;

  private readonly opts: HttpClientOptions;

  constructor(opts: HttpClientOptions = {}) {
    this.opts = opts;
    this.baseUrl = opts.baseUrl ?? storedBaseUrl;
    this.token = opts.token ?? (() => registeredHooks.getToken());
    this.hooks = opts.hooks;
    // Bind lazily so tests can stub globalThis.fetch after construction.
    this.fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  /** The same client bound to another API base (e.g. a Login "Server" value not yet saved). */
  withBaseUrl(url: string): HttpClient {
    return new HttpClient({ ...this.opts, baseUrl: () => url });
  }

  /** Absolute request URL for path segments (each segment is URI-encoded). */
  url(parts: string[], query?: RequestOptions['query']): string {
    const u = joinUrl(this.baseUrl(), ...parts);
    if (!query) return u;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      qs.set(k, String(v));
    }
    const s = qs.toString();
    return s ? `${u}?${s}` : u;
  }

  /** Run a request, enforce 2xx, return the raw response. */
  async request(method: string, parts: string[], opts: RequestOptions = {}): Promise<Response> {
    const { body, accept = 'application/json', auth = true, query } = opts;
    // ngrok's free tier answers API calls with its "Visit site" HTML page unless this header is
    // present; it is ignored everywhere else.
    const headers: Record<string, string> = { Accept: accept, 'ngrok-skip-browser-warning': '1' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = auth ? this.token() : null;
    if (token) headers.Authorization = `Bearer ${token}`;

    // Only a session's (authenticated) requests are cancelled on sign-out; login itself is not.
    const signal = token ? sessionController.signal : undefined;
    let res: Response;
    try {
      res = await this.fetchImpl(this.url(parts, query), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
    } catch (e) {
      if (signal?.aborted) throw new BackendError('network', 'Request cancelled: the session ended.');
      throw new BackendError(
        'network',
        `Could not reach the server (${e instanceof Error ? e.message : String(e)}).`,
      );
    }
    if (res.ok) return res;

    let text = '';
    try {
      text = await res.text();
    } catch {
      /* ignore */
    }
    const err = BackendError.http(res.status, text);
    if (token && res.status === 401) {
      (this.hooks?.onUnauthorized ?? registeredHooks.onUnauthorized)(token);
    } else if (token && res.status === 403 && err.detail === PASSWORD_CHANGE_REQUIRED) {
      (this.hooks?.onPasswordChangeRequired ?? registeredHooks.onPasswordChangeRequired)(token);
    } else if (token && res.status === 403 && err.detail === ADMIN_ONLY) {
      (this.hooks?.onAdminOnly ?? registeredHooks.onAdminOnly)(token);
    }
    throw err;
  }

  /** Request + parse a JSON body. */
  async json<T>(method: string, parts: string[], opts: RequestOptions = {}): Promise<T> {
    const res = await this.request(method, parts, opts);
    try {
      return (await res.json()) as T;
    } catch {
      throw new BackendError('invalidResponse', 'Malformed response from backend.');
    }
  }

  /** Request with no meaningful response body (204). */
  async send(method: string, parts: string[], opts: RequestOptions = {}): Promise<void> {
    await this.request(method, parts, opts);
  }

  /**
   * Authenticated binary download (PDFs). Never hand an API URL to an `<a href>`: it would go
   * out without the token. Fetch it here, then show it via `URL.createObjectURL(blob)` and revoke
   * the URL on unmount.
   */
  async blob(method: string, parts: string[], opts: RequestOptions = {}): Promise<Blob> {
    const res = await this.request(method, parts, { accept: 'application/pdf', ...opts });
    return res.blob();
  }
}

/** The app-wide client (base URL from storage, token from the auth store). */
export const http = new HttpClient();
