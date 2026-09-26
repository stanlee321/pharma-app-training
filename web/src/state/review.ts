/**
 * Review & Export derivations + form catalogue — port of the helpers in
 * PharmaApp/Views/Review/ReviewExportScreen.swift.
 */
import { BackendError, errorMessage, parseErrorDetail } from '../api/backend';
import type { AnesthesiaCase, FormId, RecoveryScore } from '../api/types';
import { ALDRETE_TIME_POINTS } from './recovery';

/** Swift `FormOption` — the four backend `form_id`s with their picker titles (order as Swift). */
export const FORM_OPTIONS: readonly { id: FormId; title: string }[] = [
  { id: 'registro_transanestesico', title: 'Registro transanestésico' },
  { id: 'nota_postanestesica', title: 'Nota postanestésica' },
  { id: 'imss_valoracion_preanestesica', title: 'IMSS · Valoración' },
  { id: 'imss_registro_anestesia', title: 'IMSS · Registro' },
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
  if (d) return d;
  const t = body.trim();
  return t.length > 200 ? `${t.slice(0, 200)}…` : t;
}

/**
 * A readable export error (Swift showed "Export failed: <localizedDescription>").
 * `online` is `navigator.onLine` at the time of failure; `action` names what failed
 * (e.g. "Generating the form", "Download").
 */
export function exportErrorMessage(e: unknown, online = true, action = 'Export'): string {
  return errorText(e, online).replace(/^Export failed/, `${action} failed`);
}

function errorText(e: unknown, online: boolean): string {
  // A failed pre-export save wraps the backend error; report the underlying cause.
  if (!(e instanceof BackendError) && e instanceof Error && e.cause instanceof BackendError) e = e.cause;
  if (e instanceof BackendError) {
    switch (e.kind) {
      case 'network':
        return online
          ? 'Export failed: the server could not be reached. Check that the backend is running and the Server setting on the login screen.'
          : 'Export failed: you appear to be offline. Reconnect and try again.';
      case 'unsupported':
        return 'Export failed: filled forms are rendered by the server, and this session uses the offline (in-memory) store.';
      case 'notFound':
        return 'Export failed: the server does not know this case or form (HTTP 404).';
      case 'http': {
        const d = bodyDetail(e.body);
        return `Export failed: the server returned HTTP ${e.status ?? '?'}${d ? ` — ${d}` : ''}.`;
      }
      case 'invalidResponse':
        return `Export failed: unexpected response from the server (${e.message}).`;
    }
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (!online) return `Export failed: you appear to be offline. ${msg}`;
  return `Export failed: ${msg}`;
}

/** A readable finalize failure (409s explained, else the server's detail). */
export function finalizeErrorMessage(e: unknown): string {
  if (e instanceof BackendError && e.status === 409) {
    if (e.detail === 'case changed during finalize; retry') {
      return 'The case changed while its forms were being stored, so nothing was locked. The case was reloaded; review it and finalize again.';
    }
    if (e.detail === 'case is finalized') return 'This case is already finalized. The locked version was reloaded.';
    return `Finalize refused: ${e.detail ?? 'conflict'}. The case was reloaded.`;
  }
  return `Finalize failed: ${errorMessage(e)}`;
}
