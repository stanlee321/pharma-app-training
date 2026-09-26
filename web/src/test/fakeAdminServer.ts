import { vi } from 'vitest';
import { fakeUser } from '../api/authApi';
import {
  FORM_IDS,
  type AdminDocumentDTO,
  type AdminStatsDTO,
  type AnesthesiaCase,
  type CaseSummaryDTO,
  type FormId,
  type PatientDetailDTO,
  type PatientDTO,
  type UserDTO,
} from '../api/types';
import { LAST_ADMIN_DETAIL, SELF_GUARD_DETAIL, USERNAME_TAKEN_DETAIL } from '../lib/accounts';
import { TEST_TOKEN } from './auth';

/**
 * In-memory fake of the backend's `/admin` users + stats API for mocked-fetch suites, following
 * the as-built rules (docs/wiki/backend-api.md "Admin", backend/app/application/admin_service.py):
 * - Bearer `TEST_TOKEN` required (else 401); the caller is `me` (an admin).
 * - POST /admin/users: unknown fields, pattern, the reserved `gw-` prefix and password length →
 *   422 in FastAPI's shape; a taken username (case-insensitive) → 409; stored lower-cased with
 *   `must_change_password = true`.
 * - PATCH / DELETE guards (409): yourself; the last active admin; delete of a user owning cases.
 * - reset-password → 204 and `must_change_password = true`.
 * - Cases (`cases` seed): GET /admin/cases with status / user_id / q / date range filters and
 *   limit+offset paging (422 on a reversed range or a bad limit); GET / DELETE /admin/cases/{id};
 *   POST /admin/cases/{id}/reopen (409 on a draft). The admin's writes on /cases/** → 403.
 * - Documents (`documents` seed): GET /admin/documents (case_id must be a UUID, else 422; form
 *   filter; paging), GET/POST /cases/{id}/documents, GET /documents/{id}/file (synthetic PDF),
 *   DELETE /documents/{id}.
 * - Patients (`patients` seed): GET /admin/patients (q over nombre/registro, by name, paging;
 *   `cases_count` from the case seed), GET /patients/{id} (+ its cases, numbered by created_at),
 *   DELETE /admin/patients/{id} (409 "patient has cases; delete them first"). /admin/cases rows
 *   carry patient_id / patient_nombre / patient_registro and filter by `?patient_id=` (UUID, else
 *   422).
 * Synthetic accounts only.
 */
export interface AdminCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const detail = (status: number, d: string) => json({ detail: d }, status);
const invalid = (field: string, type: string, msg: string, input?: unknown) =>
  json({ detail: [{ type, loc: ['body', field], msg, ...(input === undefined ? {} : { input }) }] }, 422);

const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9._@-]*$/;
const CREATE_KEYS = new Set(['username', 'full_name', 'clave', 'role', 'password']);
const PATCH_KEYS = new Set(['full_name', 'clave', 'role', 'is_active']);

export function fakeAdminServer(opts: {
  me: UserDTO;
  users?: UserDTO[];
  /** user id → number of cases owned (delete → 409). */
  caseCounts?: Record<string, number>;
  stats?: AdminStatsDTO;
  /** Full synthetic cases (an admin reads any of them). */
  cases?: AnesthesiaCase[];
  /** Stored documents (with admin-only `storage_path`). */
  documents?: AdminDocumentDTO[];
  /** Synthetic patients (cases link to them through `patient_id`). */
  patients?: PatientDTO[];
}) {
  const patients = new Map<string, PatientDTO>((opts.patients ?? []).map((p) => [p.id, { ...p }]));
  const cases = new Map<string, AnesthesiaCase>((opts.cases ?? []).map((c) => [c.id, JSON.parse(JSON.stringify(c))]));
  const documents = new Map<string, AdminDocumentDTO>((opts.documents ?? []).map((d) => [d.id, { ...d }]));
  let docSeq = 0;
  let clock = Date.parse('2026-09-25T13:00:00Z');
  const users = new Map<string, UserDTO>([opts.me, ...(opts.users ?? [])].map((u) => [u.id, { ...u }]));
  const passwords = new Map<string, string>();
  const calls: AdminCall[] = [];
  const overrides = new Map<string, () => Response | Promise<Response>>();
  let seq = 0;

  const activeAdmins = () => [...users.values()].filter((u) => u.role === 'admin' && u.is_active);

  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    calls.push({ method, path, query: Object.fromEntries(url.searchParams), body });

    const forced = overrides.get(`${method} ${path}`);
    if (forced) return forced();
    if (new Headers(init?.headers).get('Authorization') !== `Bearer ${TEST_TOKEN}`)
      return detail(401, 'Not authenticated');

    const caseRes = caseRoutes(method, path, url.searchParams, body);
    if (caseRes) return caseRes;

    if (method === 'GET' && path === '/admin/stats') {
      return opts.stats ? json(opts.stats) : detail(500, 'no stats fixture');
    }

    if (path === '/admin/users') {
      if (method === 'GET') {
        const q = (url.searchParams.get('q') ?? '').toLowerCase();
        const role = url.searchParams.get('role');
        const active = url.searchParams.get('is_active');
        const list = [...users.values()]
          .filter((u) => !q || [u.username, u.full_name, u.clave].some((s) => s.toLowerCase().includes(q)))
          .filter((u) => !role || u.role === role)
          .filter((u) => active == null || String(u.is_active) === active)
          .sort((a, b) => a.username.localeCompare(b.username));
        return json(list);
      }
      if (method === 'POST') {
        const b = body as Record<string, unknown>;
        const extra = Object.keys(b).find((k) => !CREATE_KEYS.has(k));
        if (extra) return invalid(extra, 'extra_forbidden', 'Extra inputs are not permitted');
        const username = String(b.username ?? '');
        if (!USERNAME_RE.test(username)) {
          return invalid(
            'username',
            'string_pattern_mismatch',
            "String should match pattern '^[A-Za-z0-9][A-Za-z0-9._@-]*$'",
            username,
          );
        }
        if (username.trim().toLowerCase().startsWith('gw-')) {
          return invalid(
            'username',
            'value_error',
            "Value error, usernames starting with 'gw-' are reserved",
            username,
          );
        }
        const pw = String(b.password ?? '');
        if (pw.length < 8) return invalid('password', 'string_too_short', 'String should have at least 8 characters');
        const lower = username.toLowerCase();
        if ([...users.values()].some((u) => u.username === lower)) return detail(409, USERNAME_TAKEN_DETAIL);
        const u = fakeUser({
          id: `bbbbbbbb-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
          username: lower,
          full_name: String(b.full_name ?? ''),
          clave: String(b.clave ?? ''),
          role: b.role === 'admin' ? 'admin' : 'anesthesiologist',
          must_change_password: true,
          last_login_at: null,
        });
        users.set(u.id, u);
        passwords.set(u.id, pw);
        return json(u);
      }
    }

    const reset = /^\/admin\/users\/([^/]+)\/reset-password$/.exec(path);
    if (reset && method === 'POST') {
      const u = users.get(decodeURIComponent(reset[1]!));
      if (!u) return detail(404, 'User not found');
      const pw = String((body as { password?: string }).password ?? '');
      if (pw.length < 8) return invalid('password', 'string_too_short', 'String should have at least 8 characters');
      passwords.set(u.id, pw);
      users.set(u.id, { ...u, must_change_password: true });
      return new Response(null, { status: 204 });
    }

    const one = /^\/admin\/users\/([^/]+)$/.exec(path);
    if (one) {
      const u = users.get(decodeURIComponent(one[1]!));
      if (!u) return detail(404, 'User not found');
      if (method === 'GET') return json(u);
      if (method === 'PATCH') {
        const p = body as Record<string, unknown>;
        const extra = Object.keys(p).find((k) => !PATCH_KEYS.has(k));
        if (extra) return invalid(extra, 'extra_forbidden', 'Extra inputs are not permitted');
        const demotes = 'role' in p && p.role !== 'admin' && u.role === 'admin';
        const deactivates = p.is_active === false && u.is_active;
        if (demotes || deactivates) {
          if (u.id === opts.me.id) return detail(409, SELF_GUARD_DETAIL);
          if (u.role === 'admin' && u.is_active && activeAdmins().length <= 1) return detail(409, LAST_ADMIN_DETAIL);
        }
        const next = {
          ...u,
          ...(p as Partial<UserDTO>),
          updated_at: new Date(Date.parse(u.updated_at) + 1000).toISOString(),
        };
        users.set(u.id, next);
        return json(next);
      }
      if (method === 'DELETE') {
        if (u.id === opts.me.id) return detail(409, SELF_GUARD_DETAIL);
        if (u.role === 'admin' && u.is_active && activeAdmins().length <= 1) return detail(409, LAST_ADMIN_DETAIL);
        const owned = opts.caseCounts?.[u.id] ?? 0;
        if (owned) return detail(409, `user owns ${owned} case(s); deactivate the account instead`);
        users.delete(u.id);
        return new Response(null, { status: 204 });
      }
    }
    return detail(404, 'Not Found');
  });

  /** Cases, documents and files (see the header). Returns undefined for other paths. */
  function caseRoutes(method: string, path: string, sp: URLSearchParams, body: unknown): Response | undefined {
    const pageOf = <T,>(rows: T[]) => {
      const limit = Number(sp.get('limit') ?? 50);
      const offset = Number(sp.get('offset') ?? 0);
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        return json({ detail: [{ type: 'less_than_equal', loc: ['query', 'limit'], msg: 'bad limit' }] }, 422);
      }
      return json({ items: rows.slice(offset, offset + limit), total: rows.length, limit, offset });
    };
    const ownerName = (uid: string | null | undefined) => {
      const u = uid ? users.get(uid) : undefined;
      return u ? u.full_name || u.username : null;
    };

    if (method === 'GET' && path === '/admin/cases') {
      const from = sp.get('date_from');
      const to = sp.get('date_to');
      if (from && to && from > to) return detail(422, 'date_from must be on or before date_to');
      const status = sp.get('status');
      const uid = sp.get('user_id');
      const pid = sp.get('patient_id');
      if (pid && !/^[0-9a-f-]{36}$/i.test(pid)) {
        return json({ detail: [{ type: 'uuid_parsing', loc: ['query', 'patient_id'], msg: 'Input should be a valid UUID' }] }, 422);
      }
      const q = (sp.get('q') ?? '').toLowerCase();
      const rows: CaseSummaryDTO[] = [...cases.values()]
        .filter((c) => !status || c.status === status)
        .filter((c) => !uid || c.user_id === uid)
        .filter((c) => !pid || c.patient_id === pid)
        .filter((c) => !from || c.created_at.slice(0, 10) >= from)
        .filter((c) => !to || c.created_at.slice(0, 10) <= to)
        .filter(
          (c) =>
            !q ||
            [c.patient.nombre, c.patient.registro, c.diagnostico_preop, c.owner, c.id, ownerName(c.user_id) ?? '']
              .some((x) => x.toLowerCase().includes(q)),
        )
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((c) => ({
          id: c.id,
          owner: c.owner,
          nombre: c.patient.nombre,
          registro: c.patient.registro,
          diagnostico_preop: c.diagnostico_preop,
          created_at: c.created_at,
          status: c.status,
          updated_at: c.updated_at ?? null,
          finalized_at: c.finalized_at ?? null,
          user_id: c.user_id ?? null,
          owner_name: ownerName(c.user_id),
          patient_id: c.patient_id ?? null,
          patient_nombre: c.patient_id ? (patients.get(c.patient_id)?.nombre ?? null) : null,
          patient_registro: c.patient_id ? (patients.get(c.patient_id)?.registro ?? null) : null,
        }));
      return pageOf(rows);
    }

    const casesOf = (pid: string) =>
      [...cases.values()]
        .filter((c) => c.patient_id === pid)
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    const withCount = (p: PatientDTO): PatientDTO => ({ ...p, cases_count: casesOf(p.id).length });

    if (method === 'GET' && path === '/admin/patients') {
      const q = (sp.get('q') ?? '').trim().toLowerCase();
      const rows = [...patients.values()]
        .filter((p) => !q || [p.nombre, p.registro ?? ''].some((x) => x.toLowerCase().includes(q)))
        .sort((a, b) => a.nombre.toLowerCase().localeCompare(b.nombre.toLowerCase()))
        .map(withCount);
      return pageOf(rows);
    }

    const onePatient = /^\/(admin\/)?patients\/([^/]+)$/.exec(path);
    if (onePatient) {
      const p = patients.get(decodeURIComponent(onePatient[2]!));
      const isAdminPath = !!onePatient[1];
      if (method === 'GET' && !isAdminPath) {
        if (!p) return detail(404, 'Patient not found');
        const detailDto: PatientDetailDTO = {
          ...withCount(p),
          cases: casesOf(p.id).map((c, i) => ({
            id: c.id,
            numero: i + 1,
            created_at: c.created_at,
            fecha: c.fecha ?? null,
            diagnostico_preop: c.diagnostico_preop,
            status: c.status,
            user_id: c.user_id ?? null,
            author_name: ownerName(c.user_id),
            can_edit: false,
          })),
        };
        return json(detailDto);
      }
      if (method === 'DELETE' && isAdminPath) {
        if (!p) return detail(404, 'Patient not found');
        if (casesOf(p.id).length) return detail(409, 'patient has cases; delete them first');
        patients.delete(p.id);
        return new Response(null, { status: 204 });
      }
    }

    const reopen = /^\/admin\/cases\/([^/]+)\/reopen$/.exec(path);
    if (reopen && method === 'POST') {
      const c = cases.get(decodeURIComponent(reopen[1]!));
      if (!c) return detail(404, 'Case not found');
      if (c.status !== 'finalized') return detail(409, 'case is not finalized');
      clock += 60_000;
      const next = { ...c, status: 'draft' as const, finalized_at: null, updated_at: new Date(clock).toISOString() };
      cases.set(c.id, next);
      return json(next);
    }

    const adminCase = /^\/admin\/cases\/([^/]+)$/.exec(path);
    if (adminCase) {
      const id = decodeURIComponent(adminCase[1]!);
      const c = cases.get(id);
      if (!c) return detail(404, 'Case not found');
      if (method === 'GET') return json(c);
      if (method === 'DELETE') {
        cases.delete(id);
        for (const d of [...documents.values()]) if (d.case_id === id) documents.delete(d.id);
        return new Response(null, { status: 204 });
      }
    }

    if (method === 'GET' && path === '/admin/documents') {
      const caseId = sp.get('case_id');
      if (caseId && !/^[0-9a-f-]{36}$/i.test(caseId)) {
        return json({ detail: [{ type: 'uuid_parsing', loc: ['query', 'case_id'], msg: 'Input should be a valid UUID' }] }, 422);
      }
      const form = sp.get('form_id');
      const rows = [...documents.values()]
        .filter((d) => !caseId || d.case_id === caseId.toLowerCase())
        .filter((d) => !form || d.form_id === form)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return pageOf(rows);
    }

    const caseDocs = /^\/cases\/([^/]+)\/documents$/.exec(path);
    if (caseDocs) {
      const id = decodeURIComponent(caseDocs[1]!);
      if (!cases.has(id)) return detail(404, 'Case not found');
      if (method === 'GET') {
        return json(
          [...documents.values()]
            .filter((d) => d.case_id === id)
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map(publicDoc),
        );
      }
      if (method === 'POST') {
        const formId = (body as { form_id: FormId }).form_id;
        if (!FORM_IDS.includes(formId)) return detail(422, 'unknown form');
        clock += 60_000;
        const d = adminDocument(id, formId, {
          id: `dddddddd-0000-4000-8000-${String(++docSeq).padStart(12, '0')}`,
          created_at: new Date(clock).toISOString(),
        });
        documents.set(d.id, d);
        return json(publicDoc(d));
      }
    }

    const file = /^\/documents\/([^/]+)\/file$/.exec(path);
    if (file && method === 'GET') {
      if (!documents.has(decodeURIComponent(file[1]!))) return detail(404, 'Document not found');
      return new Response(FAKE_ADMIN_PDF, { status: 200, headers: { 'Content-Type': 'application/pdf' } });
    }
    const doc = /^\/documents\/([^/]+)$/.exec(path);
    if (doc && method === 'DELETE') {
      const id = decodeURIComponent(doc[1]!);
      if (!documents.delete(id)) return detail(404, 'Document not found');
      return new Response(null, { status: 204 });
    }

    // An admin never writes case content (backend-api.md matrix): content writes → 403.
    if (/^\/cases(\/|$)/.test(path) && method !== 'GET') return detail(403, 'admins cannot modify cases through /cases; use /admin');
    if (/^\/cases\/[^/]+$/.test(path) && method === 'GET') {
      const c = cases.get(decodeURIComponent(path.split('/')[2]!));
      return c ? json(c) : detail(404, 'Case not found');
    }
    return undefined;
  }

  return {
    fetch,
    calls,
    users,
    passwords,
    cases,
    documents,
    patients,
    /** Force `METHOD /path` (without /api/v1) to answer with `respond()`. */
    override(key: string, respond: () => Response | Promise<Response>) {
      overrides.set(key, respond);
    },
    clearOverride(key: string) {
      overrides.delete(key);
    },
    /** Calls matching method + path. */
    callsTo(method: string, path: string) {
      return calls.filter((c) => c.method === method && c.path === path);
    },
  };
}

/** A synthetic admin (the signed-in caller). */
export const ME_ADMIN = () =>
  fakeUser({
    id: 'aaaaaaaa-0000-4000-8000-00000000ad01',
    username: 'admin.demo',
    full_name: 'Admin Demo',
    role: 'admin',
  });

/** A 30-day zero-filled stats fixture ending `end` (UTC day), with `counts` on given days. */
export function statsFixture(
  end: string,
  counts: Record<string, number>,
  over: Partial<AdminStatsDTO> = {},
): AdminStatsDTO {
  const endT = Date.parse(`${end}T00:00:00Z`);
  const cases_per_day = Array.from({ length: 30 }, (_, i) => {
    const date = new Date(endT - (29 - i) * 86_400_000).toISOString().slice(0, 10);
    return { date, count: counts[date] ?? 0 };
  });
  const total = cases_per_day.reduce((s, d) => s + d.count, 0);
  return {
    patients_total: 0,
    cases_total: total,
    cases_by_status: { draft: total, finalized: 0 },
    cases_per_day,
    per_user: [],
    documents_total: 0,
    ...over,
  };
}

/** A `DocumentDTO` as the per-case routes return it (no admin-only storage fields). */
function publicDoc(d: AdminDocumentDTO): Omit<AdminDocumentDTO, 'storage_path' | 'storage_backend'> {
  const copy: Partial<AdminDocumentDTO> = { ...d };
  delete copy.storage_path;
  delete copy.storage_backend;
  return copy as Omit<AdminDocumentDTO, 'storage_path' | 'storage_backend'>;
}

/** Synthetic PDF bytes served for stored documents. */
export const FAKE_ADMIN_PDF = '%PDF-1.4\n% synthetic admin test document\n%%EOF\n';

/** A synthetic stored-document row as `/admin/documents` returns it. */
let adminDocSeq = 0;
export function adminDocument(caseId: string, formId: FormId, over: Partial<AdminDocumentDTO> = {}): AdminDocumentDTO {
  const id = over.id ?? `cccccccc-0000-4000-8000-${String(++adminDocSeq).padStart(12, '0')}`;
  return {
    id,
    case_id: caseId,
    form_id: formId,
    size_bytes: 4096,
    sha256: 'e'.repeat(64),
    generated_by: null,
    created_at: '2026-09-25T12:00:00Z',
    is_fallback: false,
    download_url: `/api/v1/documents/${id}/file`,
    storage_backend: 'local',
    storage_path: `/var/documents/${caseId}/${formId}_${id.slice(0, 8)}.pdf`,
    ...over,
  };
}
