import { BackendError, type CaseBackend } from './backend';
import { newCase, normalizeCase, shellFromSummary, toWriteBody } from './factory';
import { HttpClient, http as appHttp, type HttpClientOptions } from './http';
import type { AnesthesiaCase, AnesthesiaCaseDTO, CaseSummaryDTO, DocumentDTO, FormId } from './types';

export { DEFAULT_BASE_URL, storedBaseUrl } from './http';

export interface RestBackendOptions extends HttpClientOptions {
  /** A ready client (tests); otherwise one is built from the other options, or the app's. */
  http?: HttpClient;
}

/**
 * Live `CaseBackend` over the FastAPI service (TS port of Swift `RestBackend`). Every call goes
 * through the shared authenticated `HttpClient` (Bearer token, 401/403 session handling).
 */
export class RestBackend implements CaseBackend {
  private readonly http: HttpClient;

  constructor(opts: RestBackendOptions = {}) {
    const { http, ...rest } = opts;
    this.http = http ?? (Object.keys(rest).length ? new HttpClient(rest) : appHttp);
  }

  async list(): Promise<AnesthesiaCase[]> {
    const rows = await this.http.json<CaseSummaryDTO[]>('GET', ['cases']);
    if (!Array.isArray(rows)) throw new BackendError('invalidResponse', 'Malformed case list.');
    return rows.map(shellFromSummary);
  }

  async load(id: string): Promise<AnesthesiaCase> {
    return normalizeCase(await this.http.json<AnesthesiaCaseDTO>('GET', ['cases', id]));
  }

  async loadForAdmin(id: string): Promise<AnesthesiaCase> {
    return normalizeCase(await this.http.json<AnesthesiaCaseDTO>('GET', ['admin', 'cases', id]));
  }

  async create(owner: string): Promise<AnesthesiaCase> {
    // Client owns the id: build locally, then PUT create-or-replace.
    return this.save(newCase(owner));
  }

  async save(c: AnesthesiaCase): Promise<AnesthesiaCase> {
    const dto = await this.http.json<AnesthesiaCaseDTO>('PUT', ['cases', c.id], { body: toWriteBody(c) });
    return normalizeCase(dto);
  }

  async delete(id: string): Promise<void> {
    await this.http.send('DELETE', ['cases', id]);
  }

  async exportForm(caseId: string, formId: string): Promise<Blob> {
    return this.http.blob('POST', ['cases', caseId, 'export', formId]);
  }

  async finalize(id: string): Promise<AnesthesiaCase> {
    return normalizeCase(await this.http.json<AnesthesiaCaseDTO>('POST', ['cases', id, 'finalize']));
  }

  async listDocuments(caseId: string): Promise<DocumentDTO[]> {
    const rows = await this.http.json<DocumentDTO[]>('GET', ['cases', caseId, 'documents']);
    if (!Array.isArray(rows)) throw new BackendError('invalidResponse', 'Malformed document list.');
    return rows;
  }

  generateDocument(caseId: string, formId: FormId): Promise<DocumentDTO> {
    return this.http.json<DocumentDTO>('POST', ['cases', caseId, 'documents'], { body: { form_id: formId } });
  }

  /** Built from path segments (not `download_url`) so the base URL and token always apply. */
  documentFile(docId: string): Promise<Blob> {
    return this.http.blob('GET', ['documents', docId, 'file']);
  }

  deleteDocument(docId: string): Promise<void> {
    return this.http.send('DELETE', ['documents', docId]);
  }
}
