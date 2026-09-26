import { BackendError, type CaseBackend } from './backend';
import { HttpClient, http as appHttp } from './http';
import { newUUID } from '../lib/uuid';
import type {
  PatientCaseSummaryDTO,
  PatientConflictDTO,
  PatientCreate,
  PatientDTO,
  PatientDetailDTO,
  PatientPage,
  PatientUpdate,
} from './types';

/**
 * Patients ("historias clínicas") port. Patients are shared hospital-wide: every
 * anesthesiologist lists, reads, creates and edits every patient (plan:
 * docs/wiki/plans/patients-historias.md).
 *
 * Contract (under the API base, default `/api/v1`):
 * - `list(q, limit, offset)` → `GET /patients?q=&limit=&offset=` → `PatientPage` (by nombre)
 * - `get(id)` → `GET /patients/{id}` → `PatientDetailDTO` (cases ascending by `numero`)
 * - `create(req)` → `POST /patients` → `PatientDTO`; a duplicate registro is a 409
 *   `{detail: "patient exists", patient_id}` (see `existingPatientId`)
 * - `update(id, patch)` → `PATCH /patients/{id}` → `PatientDTO` (same 409 on a taken registro)
 */
export interface PatientApi {
  list(q: string, limit: number, offset: number): Promise<PatientPage>;
  get(id: string): Promise<PatientDetailDTO>;
  create(req: PatientCreate): Promise<PatientDTO>;
  update(id: string, patch: PatientUpdate): Promise<PatientDTO>;
}

/** The existing patient's id carried by a 409 "patient exists", else null. */
export function existingPatientId(e: unknown): string | null {
  if (!(e instanceof BackendError) || e.status !== 409) return null;
  try {
    const body = JSON.parse(e.body) as Partial<PatientConflictDTO>;
    return body.detail === 'patient exists' && typeof body.patient_id === 'string' ? body.patient_id : null;
  } catch {
    return null;
  }
}

/** Live patients API over the one authenticated HTTP layer. */
export class RestPatientApi implements PatientApi {
  private readonly http: HttpClient;

  constructor(client: HttpClient = appHttp) {
    this.http = client;
  }

  async list(q: string, limit: number, offset: number): Promise<PatientPage> {
    const page = await this.http.json<PatientPage>('GET', ['patients'], { query: { q: q.trim(), limit, offset } });
    if (!page || !Array.isArray(page.items)) throw new BackendError('invalidResponse', 'Respuesta de pacientes mal formada.');
    return page;
  }

  get(id: string): Promise<PatientDetailDTO> {
    return this.http.json<PatientDetailDTO>('GET', ['patients', id]);
  }

  create(req: PatientCreate): Promise<PatientDTO> {
    return this.http.json<PatientDTO>('POST', ['patients'], { body: req });
  }

  update(id: string, patch: PatientUpdate): Promise<PatientDTO> {
    return this.http.json<PatientDTO>('PATCH', ['patients', id], { body: patch });
  }
}

/** The one synthetic demo patient of the offline mode (owner of the demo case). */
export const DEMO_PATIENT_ID = '00000000-0000-4000-8000-0000000d3e30';

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/**
 * Offline patients (VITE_USE_INMEMORY=1): kept in memory; a patient's cases are read from the
 * in-memory case backend (by `patient_id`). Same unique-registro rule as the server.
 */
export class InMemoryPatientApi implements PatientApi {
  private patients = new Map<string, PatientDTO>();

  constructor(
    private readonly cases: CaseBackend,
    seed: PatientDTO[] = [demoPatient()],
  ) {
    for (const p of seed) this.patients.set(p.id, { ...p });
  }

  private conflict(id: string): BackendError {
    return BackendError.http(409, JSON.stringify({ detail: 'patient exists', patient_id: id }));
  }

  private async casesOf(id: string): Promise<PatientCaseSummaryDTO[]> {
    const all = (await this.cases.list()).filter((c) => c.patient_id === id);
    all.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
    return all.map((c, i) => ({
      id: c.id,
      numero: i + 1,
      created_at: c.created_at,
      fecha: c.fecha,
      diagnostico_preop: c.diagnostico_preop,
      status: c.status,
      user_id: c.user_id,
      author_name: c.owner || null,
      can_edit: c.status === 'draft',
    }));
  }

  async list(q: string, limit: number, offset: number): Promise<PatientPage> {
    const needle = norm(q);
    const all = [...this.patients.values()]
      .filter((p) => !needle || norm(p.nombre).includes(needle) || norm(p.registro).includes(needle))
      .sort((a, b) => norm(a.nombre).localeCompare(norm(b.nombre)));
    const items = await Promise.all(
      all.slice(offset, offset + limit).map(async (p) => ({ ...p, cases_count: (await this.casesOf(p.id)).length })),
    );
    return { items, total: all.length, limit, offset };
  }

  async get(id: string): Promise<PatientDetailDTO> {
    const p = this.patients.get(id);
    if (!p) throw new BackendError('notFound', 'Paciente no encontrado.', 404, '{"detail":"Patient not found"}');
    const cases = await this.casesOf(id);
    return { ...p, cases_count: cases.length, cases };
  }

  async create(req: PatientCreate): Promise<PatientDTO> {
    const taken = [...this.patients.values()].find((p) => norm(p.registro) === norm(req.registro));
    if (taken) throw this.conflict(taken.id);
    const now = new Date().toISOString();
    const p: PatientDTO = {
      id: newUUID(),
      ...req,
      registro: req.registro.trim(),
      nombre: req.nombre.trim(),
      created_at: now,
      updated_at: now,
      edad: null,
      cases_count: 0,
    };
    this.patients.set(p.id, p);
    return { ...p };
  }

  async update(id: string, patch: PatientUpdate): Promise<PatientDTO> {
    const p = this.patients.get(id);
    if (!p) throw new BackendError('notFound', 'Paciente no encontrado.', 404, '{"detail":"Patient not found"}');
    if (patch.registro != null) {
      const taken = [...this.patients.values()].find((x) => x.id !== id && norm(x.registro) === norm(patch.registro));
      if (taken) throw this.conflict(taken.id);
    }
    const next: PatientDTO = { ...p, updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(patch) as [keyof PatientUpdate, unknown][]) {
      if (v !== undefined) (next as Record<string, unknown>)[k] = v;
    }
    this.patients.set(id, next);
    return { ...next };
  }
}

/** The synthetic demo patient (offline mode only). */
export function demoPatient(): PatientDTO {
  return {
    id: DEMO_PATIENT_ID,
    registro: 'DEMO-0001',
    nombre: 'Paciente Demo (sintético)',
    sexo: 'female',
    fecha_nacimiento: null,
    grupo_sanguineo: 'O',
    rh: '+',
    created_at: '2026-01-01T08:00:00Z',
    updated_at: '2026-01-01T08:00:00Z',
    edad: null,
    cases_count: 0,
  };
}
