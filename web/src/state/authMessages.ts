import { BackendError } from '../api/backend';
import { serverMessage } from '../api/serverMessages';
import type { AuthNotice } from './authStore';

/** Readable message for a failed login (the server's `ErrorDTO.detail` when it sent one). */
export function loginErrorMessage(e: unknown): string {
  if (e instanceof BackendError) {
    if (e.kind === 'network') {
      return 'No se pudo conectar con el servidor. Verifique que el servidor esté en marcha y el ajuste «Servidor» en Opciones avanzadas.';
    }
    if (e.status === 401) return e.detail ? serverMessage(e.detail) : 'Usuario o contraseña incorrectos.';
    if (e.status === 404 && e.detail) return `El inicio de sesión no está disponible: ${serverMessage(e.detail)}`;
    if (e.status === 422) return 'Escriba su usuario y contraseña.';
    if (e.detail) return serverMessage(e.detail);
    return `No se pudo iniciar sesión (HTTP ${e.status ?? '?'}).`;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Readable message for a failed POST /auth/change-password. */
export function changePasswordErrorMessage(e: unknown): string {
  if (e instanceof BackendError) {
    if (e.kind === 'network') return 'No se pudo conectar con el servidor. Inténtelo de nuevo.';
    if (e.status === 422) {
      return e.detail ? `La nueva contraseña fue rechazada: ${serverMessage(e.detail)}` : 'La nueva contraseña debe tener de 8 a 128 caracteres.';
    }
    if (e.detail) return serverMessage(e.detail);
    return `No se pudo cambiar la contraseña (HTTP ${e.status ?? '?'}).`;
  }
  return e instanceof Error ? e.message : String(e);
}

/** One-shot notice text on the login screen. */
export function noticeText(n: AuthNotice): string | null {
  switch (n) {
    case 'expired':
      return 'Su sesión expiró. Inicie sesión de nuevo.';
    case 'passwordChanged':
      return 'Su contraseña se cambió. Inicie sesión con la nueva contraseña.';
    default:
      return null;
  }
}

/** Client-side check before POST /auth/change-password (server: 8–128 chars). */
export function newPasswordProblem(current: string, next: string, confirm: string): string | null {
  if (next.length < 8) return 'La nueva contraseña debe tener al menos 8 caracteres.';
  if (next.length > 128) return 'La nueva contraseña debe tener como máximo 128 caracteres.';
  if (next !== confirm) return 'Las contraseñas nuevas no coinciden.';
  if (next === current) return 'La nueva contraseña debe ser distinta de la actual.';
  return null;
}
