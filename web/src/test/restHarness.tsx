import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { fakeUser } from '../api/authApi';
import { applyIdentity, cloneCase } from '../api/factory';
import { HttpClient } from '../api/http';
import { RestPatientApi, type PatientApi } from '../api/patientApi';
import { RestBackend } from '../api/restBackend';
import {
  FORM_IDS,
  type AnesthesiaCase,
  type DocumentDTO,
  type FormId,
  type PatientCaseSummaryDTO,
  type PatientCreate,
  type PatientDTO,
  type PatientUpdate,
} from '../api/types';
import { AppRoutes } from '../routes/AppRoutes';
import { caseStore } from '../state/caseStore';
import { patientStore } from '../state/patientStore';
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
  /** Patients to start with (`/patients` routes). */
  patients?: PatientDTO[];
  /** The signed-in user's id (the patient detail's `can_edit`); default `fakeUser().id`. */
  viewerId?: string;
  /** Author names by user id (the patient detail's `author_name`). */
  authors?: Record<string, string>;
}

let patientSeq = 0;
/** A synthetic patient row. */
export function fakePatient(over: Partial<PatientDTO> = {}): PatientDTO {
  const n = ++patientSeq;
  return {
    id: `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`,
    registro: `SYN-${String(n).padStart(4, '0')}`,
    nombre: `Paciente Sintético ${n}`,
    sexo: '',
    fecha_nacimiento: null,
    grupo_sanguineo: '',
    rh: '',
    created_at: '2026-09-01T08:00:00Z',
    updated_at: '2026-09-01T08:00:00Z',
    edad: null,
    cases_count: 0,
    ...over,
  };
}

/** The patients API each harness backend talks to (looked up by `renderApp`). */
const patientApis = new WeakMap<RestBackend, PatientApi>();

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
  const patients = new Map<string, PatientDTO>((opts.patients ?? []).map((p) => [p.id, { ...p }]));
  const viewerId = opts.viewerId ?? fakeUser().id;
  const norm = (x: string | null | undefined) => (x ?? '').trim().toLowerCase();
  const casesOf = (pid: string): PatientCaseSummaryDTO[] =>
    [...server.values()]
      .map((x) => x as AnesthesiaCase)
      .filter((x) => x.patient_id === pid)
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
      .map((x, i) => ({
        id: x.id,
        numero: i + 1,
        created_at: x.created_at,
        fecha: x.fecha,
        diagnostico_preop: x.diagnostico_preop,
        status: x.status ?? 'draft',
        user_id: x.user_id,
        author_name: (x.user_id && opts.authors?.[x.user_id]) || x.owner || null,
        can_edit: (x.status ?? 'draft') === 'draft' && (x.user_id ?? viewerId) === viewerId,
      }));
  const withCount = (p: PatientDTO): PatientDTO => ({ ...p, cases_count: casesOf(p.id).length });
  const patientConflict = (id: string) => Response.json({ detail: 'patient exists', patient_id: id }, { status: 409 });
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
    const pat = /\/api\/v1\/patients(?:\/([^/?]+))?(?:\?(.*))?$/.exec(url);
    if (pat) {
      const pid = pat[1] ? decodeURIComponent(pat[1]) : undefined;
      if (!pid && method === 'GET') {
        const q = norm(new URLSearchParams(pat[2] ?? '').get('q'));
        const items = [...patients.values()]
          .filter((p) => !q || norm(p.nombre).includes(q) || norm(p.registro).includes(q))
          .sort((a, b) => norm(a.nombre).localeCompare(norm(b.nombre)))
          .map(withCount);
        return Response.json({ items, total: items.length, limit: 100, offset: 0 });
      }
      if (!pid && method === 'POST') {
        const b = JSON.parse(String(init?.body)) as PatientCreate;
        const taken = [...patients.values()].find((p) => norm(p.registro) === norm(b.registro));
        if (taken) return patientConflict(taken.id);
        const p = fakePatient({ ...b, fecha_nacimiento: b.fecha_nacimiento ?? null, created_at: new Date(clock).toISOString() });
        patients.set(p.id, p);
        return Response.json(p);
      }
      const p = pid ? patients.get(pid) : undefined;
      if (!p) return new Response('{"detail":"Patient not found"}', { status: 404 });
      if (method === 'GET') return Response.json({ ...withCount(p), cases: casesOf(p.id) });
      if (method === 'PATCH') {
        const b = JSON.parse(String(init?.body)) as PatientUpdate;
        if (b.registro != null) {
          const taken = [...patients.values()].find((x) => x.id !== p.id && norm(x.registro) === norm(b.registro));
          if (taken) return patientConflict(taken.id);
        }
        const next = { ...p } as Record<string, unknown>;
        for (const [k, v] of Object.entries(b)) if (v !== undefined) next[k] = v;
        const saved = next as unknown as PatientDTO;
        patients.set(p.id, saved);
        // Like the server: the identity of the patient's DRAFT cases follows the patient.
        for (const [cid, raw] of server) {
          const x = raw as AnesthesiaCase;
          if (x.patient_id === p.id && (x.status ?? 'draft') === 'draft') {
            const copy = cloneCase(x);
            applyIdentity(copy, saved);
            server.set(cid, copy);
          }
        }
        return Response.json(withCount(saved));
      }
      return new Response('unsupported', { status: 405 });
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
      // Like the server: creating a case requires an existing patient; patient_id never changes.
      if (!prev && !body.patient_id) {
        return Response.json({ detail: [{ loc: ['body', 'patient_id'], msg: 'patient_id is required to create a case' }] }, { status: 422 });
      }
      const patientId = (prev ? prev.patient_id : body.patient_id) as string | null;
      if (!prev && patientId && opts.patients && !patients.has(patientId)) {
        return new Response('{"detail":"Patient not found"}', { status: 404 });
      }
      const saved = {
        ...body,
        patient_id: patientId,
        status: prev?.status ?? 'draft',
        finalized_at: prev?.finalized_at ?? null,
        // A created case is the caller's (null = "the signed-in user" unless `viewerId` is given).
        user_id: prev ? prev.user_id : (opts.viewerId ?? null),
      } as unknown as AnesthesiaCase;
      // …and the identity snapshot of a draft always equals its patient.
      const owner = patientId ? patients.get(patientId) : undefined;
      if (owner) applyIdentity(saved, owner);
      server.set(id, saved);
      return Response.json(saved);
    }
    if (id && method === 'DELETE') {
      if (!server.has(id)) return new Response('{"detail":"Case not found"}', { status: 404 });
      if (statusOf(id) === 'finalized') return conflict('case is finalized');
      server.delete(id);
      return new Response(null, { status: 204 });
    }
    return new Response('unsupported', { status: 405 });
  });
  const backend = new RestBackend({ baseUrl: () => '/api/v1', fetch });
  const patientApi = new RestPatientApi(new HttpClient({ baseUrl: () => '/api/v1', fetch }));
  patientApis.set(backend, patientApi);
  return { backend, fetch, puts, exports, server, calls, documents, patients, patientApi };
}

/** Reset the app store onto `backend`, sign a synthetic anesthesiologist in, render the app at `path`. */
export function renderApp(path: string, backend: RestBackend, user: Parameters<typeof signInAs>[0] = {}) {
  caseStore.getState().reset();
  caseStore.getState().setBackend(backend);
  patientStore.getState().reset();
  const patientApi = patientApis.get(backend);
  if (patientApi) patientStore.getState().setApi(patientApi);
  signInAs(user);
  return render(
    <MemoryRouter initialEntries={[path]} future={FUTURE}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

export const storeCase = (id: string): AnesthesiaCase => cloneCase(caseStore.getState().getCase(id)!);
