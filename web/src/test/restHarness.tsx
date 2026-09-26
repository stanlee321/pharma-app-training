import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { cloneCase } from '../api/factory';
import { RestBackend } from '../api/restBackend';
import { FORM_IDS, type AnesthesiaCase, type DocumentDTO, type FormId } from '../api/types';
import { AppRoutes } from '../routes/AppRoutes';
import { caseStore } from '../state/caseStore';
import { signInAs, TEST_TOKEN } from './auth';
import { FUTURE } from './router';

export { TEST_TOKEN } from './auth';

export interface PutCall {
  url: string;
  /** The Authorization header sent. */
  authorization: string | null;
  body: Record<string, unknown>;
}

export interface ExportCall {
  url: string;
  authorization: string | null;
  accept: string | null;
  caseId: string;
  formId: string;
  /** Number of PUTs recorded before this export arrived (export must follow the save). */
  putsBefore: number;
}

export interface HarnessOptions {
  /**
   * Response for `POST /cases/{id}/export/{form_id}`; default is a tiny `application/pdf` body.
   * Throw to simulate a network failure.
   */
  exportResponse?: (call: ExportCall) => Response | Promise<Response>;
  /** Override `POST /cases/{id}/finalize` (return a Response to short-circuit, undefined = default). */
  finalizeResponse?: (caseId: string) => Response | undefined;
  /** Override `GET /documents/{id}/file`. */
  fileResponse?: (docId: string) => Response | undefined;
  /** Stored documents to start with. */
  documents?: DocumentDTO[];
  /** Whose token this is (the server's delete rule differs for admins). Default anesthesiologist. */
  role?: 'anesthesiologist' | 'admin';
}

export interface Call {
  method: string;
  url: string;
}

let docSeq = 0;
/** A synthetic stored-document row (created `minutesAgo` before a fixed clock). */
export function fakeDocument(caseId: string, formId: FormId, minutesAgo = 0, over: Partial<DocumentDTO> = {}): DocumentDTO {
  const id = `00000000-0000-4000-8000-${String(++docSeq).padStart(12, '0')}`;
  return {
    id,
    case_id: caseId,
    form_id: formId,
    size_bytes: 2048,
    sha256: 'f'.repeat(64),
    generated_by: null,
    created_at: new Date(Date.parse('2026-09-25T12:00:00Z') - minutesAgo * 60_000).toISOString(),
    is_fallback: false,
    download_url: `/api/v1/documents/${id}/file`,
    ...over,
  };
}

/** Synthetic PDF bytes returned by the fake export endpoint. */
export const FAKE_PDF = '%PDF-1.4\n% synthetic test document\n%%EOF\n';

/**
 * A RestBackend whose `fetch` is an in-memory fake server: GET/PUT `/api/v1/cases/{id}` round-trip
 * JSON exactly as sent, so tests can assert the wire (snake_case) body of every PUT; POST
 * `/api/v1/cases/{id}/export/{form_id}` returns a synthetic PDF (or `opts.exportResponse`).
 */
export function restHarness(seed: AnesthesiaCase[], opts: HarnessOptions = {}) {
  const server = new Map<string, unknown>(seed.map((c) => [c.id, JSON.parse(JSON.stringify(c))]));
  const puts: PutCall[] = [];
  const exports: ExportCall[] = [];
  const calls: Call[] = [];
  const documents = new Map<string, DocumentDTO>((opts.documents ?? []).map((d) => [d.id, d]));
  let clock = Date.parse('2026-09-25T13:00:00Z');
  const conflict = (detail: string) => Response.json({ detail }, { status: 409 });
  const statusOf = (id: string) => (server.get(id) as AnesthesiaCase | undefined)?.status ?? 'draft';
  const newDoc = (caseId: string, formId: FormId): DocumentDTO => {
    clock += 60_000;
    const d = fakeDocument(caseId, formId, 0, { created_at: new Date(clock).toISOString() });
    documents.set(d.id, d);
    return d;
  };
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ method, url });
    // Like the real backend (local auth mode): no valid bearer → 401.
    if (new Headers(init?.headers).get('Authorization') !== `Bearer ${TEST_TOKEN}`) {
      return new Response('{"detail":"Not authenticated"}', { status: 401 });
    }
    const fin = /\/api\/v1\/cases\/([^/]+)\/finalize$/.exec(url);
    if (fin && method === 'POST') {
      const id = decodeURIComponent(fin[1]!);
      const over = opts.finalizeResponse?.(id);
      if (over) return over;
      const c = server.get(id) as AnesthesiaCase | undefined;
      if (!c) return new Response('{"detail":"Not found"}', { status: 404 });
      if (c.status === 'finalized') return conflict('case is finalized');
      const now = new Date(clock).toISOString();
      const locked = { ...c, status: 'finalized', finalized_at: now, updated_at: now };
      server.set(id, locked);
      for (const f of FORM_IDS) newDoc(id, f);
      return Response.json(locked);
    }
    const docs = /\/api\/v1\/cases\/([^/]+)\/documents$/.exec(url);
    if (docs) {
      const id = decodeURIComponent(docs[1]!);
      if (method === 'GET') {
        return Response.json(
          [...documents.values()].filter((d) => d.case_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at)),
        );
      }
      if (method === 'POST') {
        const { form_id } = JSON.parse(String(init?.body)) as { form_id: FormId };
        return Response.json(newDoc(id, form_id));
      }
    }
    const file = /\/api\/v1\/documents\/([^/]+)\/file$/.exec(url);
    if (file && method === 'GET') {
      const id = decodeURIComponent(file[1]!);
      const over = opts.fileResponse?.(id);
      if (over) return over;
      if (!documents.has(id)) return new Response('{"detail":"Not found"}', { status: 404 });
      return new Response(FAKE_PDF, { status: 200, headers: { 'Content-Type': 'application/pdf' } });
    }
    const doc = /\/api\/v1\/documents\/([^/]+)$/.exec(url);
    if (doc && method === 'DELETE') {
      const d = documents.get(decodeURIComponent(doc[1]!));
      if (!d) return new Response('{"detail":"Not found"}', { status: 404 });
      if (opts.role !== 'admin' && statusOf(d.case_id) === 'finalized') return conflict('case is finalized');
      documents.delete(d.id);
      return new Response(null, { status: 204 });
    }
    const ex = /\/api\/v1\/cases\/([^/]+)\/export\/([^/]+)$/.exec(url);
    if (ex && method === 'POST') {
      const headers = new Headers(init?.headers);
      const call: ExportCall = {
        url,
        authorization: headers.get('Authorization'),
        accept: headers.get('Accept'),
        caseId: decodeURIComponent(ex[1]!),
        formId: decodeURIComponent(ex[2]!),
        putsBefore: puts.length,
      };
      exports.push(call);
      if (opts.exportResponse) return opts.exportResponse(call);
      return new Response(FAKE_PDF, {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      });
    }
    const m = /\/api\/v1\/cases(?:\/([^/]+))?$/.exec(url);
    if (!m) return new Response('not found', { status: 404 });
    const id = m[1] ? decodeURIComponent(m[1]) : undefined;
    if (!id && method === 'GET') {
      return Response.json(
        [...server.values()].map((c) => {
          const x = c as AnesthesiaCase;
          return {
            id: x.id,
            owner: x.owner,
            nombre: x.patient.nombre,
            diagnostico_preop: x.diagnostico_preop,
            created_at: x.created_at,
            status: x.status ?? 'draft',
            updated_at: x.updated_at ?? null,
            finalized_at: x.finalized_at ?? null,
          };
        }),
      );
    }
    if (id && method === 'GET') {
      const c = server.get(id);
      return c ? Response.json(c) : new Response('{"detail":"Not found"}', { status: 404 });
    }
    if (id && method === 'PUT') {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      puts.push({ url, authorization: new Headers(init?.headers).get('Authorization'), body });
      if (statusOf(id) === 'finalized') return conflict('case is finalized');
      // Server-owned lifecycle fields are never taken from the body.
      const prev = server.get(id) as AnesthesiaCase | undefined;
      const saved = { ...body, status: prev?.status ?? 'draft', finalized_at: prev?.finalized_at ?? null };
      server.set(id, saved);
      return Response.json(saved);
    }
    return new Response('unsupported', { status: 405 });
  });
  const backend = new RestBackend({ baseUrl: () => '/api/v1', fetch });
  return { backend, fetch, puts, exports, server, calls, documents };
}

/** Reset the app store onto `backend`, sign a synthetic anesthesiologist in, render the app at `path`. */
export function renderApp(path: string, backend: RestBackend, user: Parameters<typeof signInAs>[0] = {}) {
  caseStore.getState().reset();
  caseStore.getState().setBackend(backend);
  signInAs(user);
  return render(
    <MemoryRouter initialEntries={[path]} future={FUTURE}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

export const storeCase = (id: string): AnesthesiaCase => cloneCase(caseStore.getState().getCase(id)!);
