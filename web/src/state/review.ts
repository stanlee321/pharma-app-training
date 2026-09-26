/**
 * Review & Export derivations + form catalogue — port of the helpers in
 * PharmaApp/Views/Review/ReviewExportScreen.swift.
 */
import { BackendError, errorMessage, parseErrorDetail } from '../api/backend';
import { serverMessage, translateDetail } from '../api/serverMessages';
import type { AnesthesiaCase, FormId, RecoveryScore } from '../api/types';
import { ALDRETE_TIME_POINTS } from './recovery';

/** Swift `FormOption` — the four backend `form_id`s with their picker titles (order as Swift). */
export const FORM_OPTIONS: readonly { id: FormId; title: string }[] = [
  { id: 'registro_transanestesico', title: 'Registro transanestésico' },
  { id: 'nota_postanestesica', title: 'Nota postanestésica' },
  { id: 'imss_valoracion_preanestesica', title: 'IMSS · Valoración preanestésica' },
  { id: 'imss_registro_anestesia', title: 'IMSS · Registro de anestesia' },
];

/** Swift default selection (`.nota21`). */
export const DEFAULT_FORM: FormId = 'registro_transanestesico';

export const formTitle = (id: FormId): string => FORM_OPTIONS.find((f) => f.id === id)?.title ?? id;

/** Swift `display(_:)`: empty → "—". */
export const display = (s: string | null | undefined): string => (s ? s : '—');

/** Swift `romanASA`: 1…5 → I…V (clamped). */
export function romanASA(n: number): string {
  return ['I', 'II', 'III', 'IV', 'V'][Math.max(0, Math.min(4, n - 1))]!;
}

/**
 * ASA shown on the review. Swift reads the root `AnesthesiaCase.asa`, but its Preanesthetic screen
 * (and ours) writes `pre_assessment.asa`, so the Swift review always showed "—". We show the root
 * value when set, else the pre-assessment value.
 */
export function caseAsa(c: AnesthesiaCase): number | null {
  return c.asa ?? c.pre_assessment.asa ?? null;
}

/**
 * Swift `aldreteTotals`: for every time point recorded under any criterion, the sum of the
 * criterion scores (missing = 0).
 *
 * Order: the form's own time-point order (`ALDRETE_TIME_POINTS`: Al salir, 0, 20, 60, 90, 120),
 * then any unknown point as a plain string sort. Never the object's key order — Postgres JSONB
 * does not keep it — and not Swift's plain string sort either ("120" < "20" < "Al salir").
 */
export function aldreteTotals(r: RecoveryScore): { point: string; total: number }[] {
  const points = new Set<string>();
  for (const byTime of Object.values(r.aldrete)) for (const tp of Object.keys(byTime)) points.add(tp);
  const known: readonly string[] = ALDRETE_TIME_POINTS;
  const rank = (p: string) => {
    const i = known.indexOf(p);
    return i < 0 ? known.length : i;
  };
  return [...points]
    .sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))
    .map((point) => ({
      point,
      total: Object.values(r.aldrete).reduce((s, byTime) => s + (byTime[point] ?? 0), 0),
    }));
}

/** The server's `ErrorDTO.detail` from an error body, else the trimmed (capped) text. */
function bodyDetail(body: string): string {
  const d = parseErrorDetail(body);
  if (d) return translateDetail(d) ?? d;
  const t = body.trim();
  return t.length > 200 ? `${t.slice(0, 200)}…` : t;
}

/**
 * A readable export error (Swift showed "Export failed: <localizedDescription>").
 * `online` is `navigator.onLine` at the time of failure; `action` is the Spanish lead naming what
 * failed (e.g. "No se pudo generar el formulario"), followed by ": <reason>".
 */
export function exportErrorMessage(e: unknown, online = true, action = 'No se pudo exportar'): string {
  return `${action}: ${errorText(e, online)}`;
}

function errorText(e: unknown, online: boolean): string {
  // A failed pre-export save wraps the backend error; report the underlying cause.
  if (!(e instanceof BackendError) && e instanceof Error && e.cause instanceof BackendError) e = e.cause;
  if (e instanceof BackendError) {
    switch (e.kind) {
      case 'network':
        return online
          ? 'no se pudo conectar con el servidor. Verifique que el servidor esté en marcha y el ajuste «Servidor» de la pantalla de inicio de sesión.'
          : 'parece que no hay conexión. Vuelva a conectarse e inténtelo de nuevo.';
      case 'unsupported':
        return 'los formularios los genera el servidor y esta sesión trabaja sin conexión (almacenamiento local).';
      case 'notFound':
        return 'el servidor no conoce este caso o formulario (HTTP 404).';
      case 'http': {
        const d = bodyDetail(e.body);
        return `el servidor respondió HTTP ${e.status ?? '?'}${d ? ` — ${d}` : ''}.`;
      }
      case 'invalidResponse':
        return `respuesta inesperada del servidor (${e.message}).`;
    }
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (!online) return `parece que no hay conexión. ${msg}`;
  return msg;
}

/** A readable finalize failure (409s explained, else the server's detail). */
export function finalizeErrorMessage(e: unknown): string {
  if (e instanceof BackendError && e.status === 409) {
    if (e.detail === 'case changed during finalize; retry') {
      return 'El caso cambió mientras se guardaban sus formularios, así que no se bloqueó. Se recargó el caso; revíselo y vuelva a finalizarlo.';
    }
    if (e.detail === 'case is finalized') return 'Este caso ya está finalizado. Se recargó la versión bloqueada.';
    return `No se pudo finalizar: ${e.detail ? serverMessage(e.detail) : 'conflicto.'} Se recargó el caso.`;
  }
  return `No se pudo finalizar: ${errorMessage(e)}`;
}
