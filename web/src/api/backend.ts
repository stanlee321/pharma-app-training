import { serverMessage } from './serverMessages';
import type { AnesthesiaCase, DocumentDTO, FormId } from './types';

/**
 * Persistence transport port (ADR-2) — TS port of Swift `CaseBackend`. Screens never call
 * `fetch` directly; they go through the case store, which adapts one of these.
 *
 * Contract (JSON snake_case, under the API base, default `/api/v1`):
 * - `list()`    → `GET    /cases`       → summaries as case *shells* (not the full aggregate!)
 * - `load(id)`  → `GET    /cases/{id}`  → the full aggregate
 * - `loadForAdmin(id)` → `GET /admin/cases/{id}` → the full aggregate, read as an admin
 * - `save(c)`   → `PUT    /cases/{id}`  → full-aggregate create-or-replace; returns server copy
 * - `delete(id)`→ `DELETE /cases/{id}`  → 204
 * - `exportForm(id, formId)` → `POST /cases/{id}/export/{formId}` → application/pdf bytes
 *   (legacy: streams, stores nothing)
 * - `finalize(id)` → `POST /cases/{id}/finalize` → the locked case (4 forms stored server-side)
 * - `listDocuments(caseId)` → `GET /cases/{id}/documents` → newest first
 * - `generateDocument(caseId, formId)` → `POST /cases/{id}/documents {form_id}` → the stored row
 * - `documentFile(docId)` → `GET /documents/{id}/file` → PDF bytes (authenticated, never a bare link)
 * - `deleteDocument(docId)` → `DELETE /documents/{id}` → 204
 */
export interface CaseBackend {
  list(): Promise<AnesthesiaCase[]>;
  load(id: string): Promise<AnesthesiaCase>;
  loadForAdmin(id: string): Promise<AnesthesiaCase>;
  create(owner: string): Promise<AnesthesiaCase>;
  save(c: AnesthesiaCase): Promise<AnesthesiaCase>;
  delete(id: string): Promise<void>;
  exportForm(caseId: string, formId: string): Promise<Blob>;
  finalize(id: string): Promise<AnesthesiaCase>;
  listDocuments(caseId: string): Promise<DocumentDTO[]>;
  generateDocument(caseId: string, formId: FormId): Promise<DocumentDTO>;
  documentFile(docId: string): Promise<Blob>;
  deleteDocument(docId: string): Promise<void>;
}

export type BackendErrorKind = 'http' | 'notFound' | 'network' | 'invalidResponse' | 'unsupported';

/**
 * The server's `ErrorDTO.detail` from an error body. FastAPI 422 bodies carry a list of
 * validation errors; their `msg`s are joined. Returns null when the body has no usable detail.
 */
export function parseErrorDetail(body: string): string | null {
  const t = body.trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t) as { detail?: unknown };
    if (typeof j.detail === 'string') return j.detail;
    if (Array.isArray(j.detail)) {
      const msgs = j.detail
        .map((d) => (d && typeof d === 'object' && typeof (d as { msg?: unknown }).msg === 'string' ? (d as { msg: string }).msg : null))
        .filter((m): m is string => !!m);
      return msgs.length ? msgs.join('; ') : null;
    }
  } catch {
    /* not JSON */
  }
  return null;
}

/** Errors surfaced by a `CaseBackend` / the HTTP layer (Swift `BackendError`). */
export class BackendError extends Error {
  readonly kind: BackendErrorKind;
  /** HTTP status for `http`/`notFound` from the server; null otherwise. */
  readonly status: number | null;
  /** Raw response body text (may be empty). */
  readonly body: string;
  /** `ErrorDTO.detail` when the server sent one (e.g. "case is finalized"). */
  readonly detail: string | null;

  constructor(
    kind: BackendErrorKind,
    message: string,
    status: number | null = null,
    body = '',
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'BackendError';
    this.kind = kind;
    this.status = status;
    this.body = body;
    this.detail = parseErrorDetail(body);
  }

  /**
   * A non-2xx response. With an `ErrorDTO` the message is its translated detail; any other body
   * (an nginx/ngrok HTML page, a proxy's plain text) is never shown — it stays in `body`.
   */
  static http(status: number, body: string): BackendError {
    const detail = parseErrorDetail(body);
    return new BackendError(
      status === 404 ? 'notFound' : 'http',
      detail
        ? `HTTP ${status}: ${serverMessage(detail)}`
        : `El servidor no está disponible (HTTP ${status}). Inténtelo de nuevo.`,
      status,
      body,
    );
  }
}

/** Human-readable (Spanish) message for any thrown value (the server's `detail`, translated, when there is one). */
export function errorMessage(e: unknown): string {
  if (e instanceof BackendError && e.detail) return serverMessage(e.detail);
  if (e instanceof Error) return e.message;
  return String(e);
}
