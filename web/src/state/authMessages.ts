import { BackendError } from '../api/backend';
import type { AuthNotice } from './authStore';

/** Readable message for a failed login (the server's `ErrorDTO.detail` when it sent one). */
export function loginErrorMessage(e: unknown): string {
  if (e instanceof BackendError) {
    if (e.kind === 'network') {
      return 'Could not reach the server. Check that the backend is running and the Server setting under Advanced.';
    }
    if (e.status === 401) return e.detail ?? 'Invalid username or password.';
    if (e.status === 404 && e.detail) return `Sign-in is not available: ${e.detail}.`;
    if (e.status === 422) return 'Enter your username and password.';
    if (e.detail) return e.detail;
    return `Sign-in failed (HTTP ${e.status ?? '?'}).`;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Readable message for a failed POST /auth/change-password. */
export function changePasswordErrorMessage(e: unknown): string {
  if (e instanceof BackendError) {
    if (e.kind === 'network') return 'Could not reach the server. Try again.';
    if (e.status === 422) {
      return e.detail ? `The new password was rejected: ${e.detail}` : 'The new password must be 8–128 characters.';
    }
    if (e.detail) return e.detail;
    return `Password change failed (HTTP ${e.status ?? '?'}).`;
  }
  return e instanceof Error ? e.message : String(e);
}

/** One-shot notice text on the login screen. */
export function noticeText(n: AuthNotice): string | null {
  switch (n) {
    case 'expired':
      return 'Your session has expired. Please sign in again.';
    case 'passwordChanged':
      return 'Your password was changed. Sign in with your new password.';
    default:
      return null;
  }
}

/** Client-side check before POST /auth/change-password (server: 8–128 chars). */
export function newPasswordProblem(current: string, next: string, confirm: string): string | null {
  if (next.length < 8) return 'The new password must be at least 8 characters.';
  if (next.length > 128) return 'The new password must be at most 128 characters.';
  if (next !== confirm) return 'The new passwords do not match.';
  if (next === current) return 'The new password must be different from the current one.';
  return null;
}
