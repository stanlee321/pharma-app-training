/**
 * Account-form rules shared by the admin Users screens, mirroring the backend
 * (`AdminUserCreate` / `AdminUserUpdate`, docs/wiki/backend-api.md "Admin"):
 * - username: 1–64 chars, `[A-Za-z0-9][A-Za-z0-9._@-]*`, stored lower-cased, unique
 *   case-insensitively (409). The `gw-` prefix is reserved for gateway users — that rule is
 *   the server's (422) and its message is shown on the field; it is not duplicated here.
 * - full name ≤ 255, clave ≤ 64; password 8–128.
 */
import { BackendError } from '../api/backend';
import { serverMessage } from '../api/serverMessages';

export const USERNAME_MAX = 64;
export const FULL_NAME_MAX = 255;
export const CLAVE_MAX = 64;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._@-]*$/;

/**
 * Spread onto an admin form field that holds ANOTHER user's credential (new username, temporary
 * password) so 1Password / LastPass neither offer nor save it; pair with `autoComplete="off"`.
 * Only the user's own Change password screen uses `autoComplete="new-password"`.
 */
export const PASSWORD_MANAGER_OFF = { 'data-1p-ignore': 'true', 'data-lpignore': 'true' } as const;

export const USERNAME_RULE = 'Solo letras, dígitos y . _ @ -; debe empezar con una letra o un dígito.';

/** Client-side username check (null = OK). */
export function usernameProblem(raw: string): string | null {
  const v = raw.trim();
  if (!v) return 'Escriba un nombre de usuario.';
  if (v.length > USERNAME_MAX) return `Como máximo ${USERNAME_MAX} caracteres.`;
  if (!USERNAME_RE.test(v)) return USERNAME_RULE;
  return null;
}

export function passwordProblem(v: string): string | null {
  if (v.length < PASSWORD_MIN) return `Al menos ${PASSWORD_MIN} caracteres.`;
  if (v.length > PASSWORD_MAX) return `Como máximo ${PASSWORD_MAX} caracteres.`;
  return null;
}

export function maxLengthProblem(v: string, max: number): string | null {
  return v.trim().length > max ? `Como máximo ${max} caracteres.` : null;
}

// ---- temporary passwords ------------------------------------------------------------------

// No look-alikes (0/O, 1/l/I) — the admin reads it out or writes it down.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const ALL = UPPER + LOWER + DIGITS;

/** Uniform random index in [0, n) from the platform CSPRNG (rejection sampling, no modulo bias). */
function randomIndex(n: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % n;
  }
}

/**
 * A random temporary password: three groups of 4 (e.g. `Xk7p-Qm3r-Tz8w`), 14 chars, with at least
 * one upper-case letter, one lower-case letter and one digit. ~70 bits of entropy. The user must
 * change it at first sign-in.
 */
export function generateTempPassword(): string {
  const chars = Array.from({ length: 12 }, () => ALL[randomIndex(ALL.length)]!);
  // Guarantee each class at distinct random positions.
  const slots = [...Array(12).keys()];
  for (const set of [UPPER, LOWER, DIGITS]) {
    const pos = slots.splice(randomIndex(slots.length), 1)[0]!;
    chars[pos] = set[randomIndex(set.length)]!;
  }
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((g) => g.join('')).join('-');
}

// ---- server errors → readable, per-field messages ------------------------------------------

export type AccountField = 'username' | 'full_name' | 'clave' | 'role' | 'password' | 'is_active';

/** Backend 409 detail strings (backend/app/application/admin_service.py). */
export const SELF_GUARD_DETAIL = 'admins cannot delete, deactivate or demote themselves';
export const LAST_ADMIN_DETAIL = 'the last active admin cannot be deleted, deactivated or demoted';
export const USERNAME_TAKEN_DETAIL = 'username already exists';

/** Readable text for the user-guard 409s (self / last admin / owns cases); null if not a guard. */
export function guardMessage(e: unknown): string | null {
  if (!(e instanceof BackendError) || e.status !== 409 || !e.detail) return null;
  if (e.detail === SELF_GUARD_DETAIL) return 'No puede eliminar, desactivar ni quitar el rol de administrador a su propia cuenta.';
  if (e.detail === LAST_ADMIN_DETAIL) {
    return 'Es el último administrador activo: no se puede eliminar, desactivar ni cambiar de rol. Primero haga administradora a otra cuenta.';
  }
  return null; // e.g. "user owns N case(s)…": the delete flow handles it (offers Deactivate)
}

/** The delete was refused because the user owns cases (the UI then offers Deactivate). */
export function ownsCases(e: unknown): boolean {
  return e instanceof BackendError && e.status === 409 && !!e.detail && /owns .*cases?/.test(e.detail);
}

interface ValidationItem {
  loc?: unknown[];
  msg?: string;
  type?: string;
}

/**
 * Per-field messages from a 422 (FastAPI validation list) or the 409 "username already exists".
 * Unknown shapes return {}; the caller then shows the general error text.
 */
export function fieldErrors(e: unknown): Partial<Record<AccountField, string>> {
  if (!(e instanceof BackendError)) return {};
  if (e.status === 409 && e.detail === USERNAME_TAKEN_DETAIL) {
    return { username: 'Ese nombre de usuario ya está en uso.' };
  }
  if (e.status !== 422) return {};
  let items: ValidationItem[] = [];
  try {
    const j = JSON.parse(e.body) as { detail?: unknown };
    if (Array.isArray(j.detail)) items = j.detail as ValidationItem[];
  } catch {
    return {};
  }
  const out: Partial<Record<AccountField, string>> = {};
  for (const it of items) {
    const field = Array.isArray(it.loc) ? it.loc[it.loc.length - 1] : undefined;
    if (typeof field !== 'string' || out[field as AccountField]) continue;
    let msg = it.msg ? serverMessage(it.msg) : 'Valor no válido.';
    if (it.type === 'string_pattern_mismatch' && field === 'username') msg = USERNAME_RULE;
    msg = msg.charAt(0).toUpperCase() + msg.slice(1);
    out[field as AccountField] = /[.!?]$/.test(msg) ? msg : `${msg}.`;
  }
  return out;
}
