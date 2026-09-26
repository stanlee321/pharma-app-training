import { BackendError, type CaseBackend } from './backend';
import { cloneCase, newCase } from './factory';
import { DEMO_PATIENT_ID } from './patientApi';
import type { AnesthesiaCase, DocumentDTO } from './types';

/** One obviously-synthetic demo case (no real patient data). */
export function demoCase(): AnesthesiaCase {
  const c = newCase('demo', new Date('2026-01-01T08:00:00Z'));
  c.patient.nombre = 'Paciente Demo (sintético)';
  c.patient.registro = 'DEMO-0001';
  c.patient_id = DEMO_PATIENT_ID;
  c.patient.profile = { weight: 72, height: 161, age: 54, gender: 'female', dilution: 10 };
  c.diagnostico_preop = 'Diagnóstico de ejemplo';
  c.sala = 'Q-DEMO';
  c.servicio = 'Servicio de ejemplo';
  return c;
}

/**
 * Offline `CaseBackend` (Swift `InMemoryBackend`) — for tests and running with no server.
 * Stores deep copies so callers can't mutate its state by reference.
 */
export class InMemoryBackend implements CaseBackend {
  private cases = new Map<string, AnesthesiaCase>();

  constructor(seed: AnesthesiaCase[] = [demoCase()]) {
    for (const c of seed) this.cases.set(c.id, cloneCase(c));
  }

  async list(): Promise<AnesthesiaCase[]> {
    return [...this.cases.values()]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(cloneCase);
  }

  async load(id: string): Promise<AnesthesiaCase> {
    const c = this.cases.get(id);
    if (!c) throw new BackendError('notFound', `Caso ${id} no encontrado.`, 404);
    return cloneCase(c);
  }

  /** Offline mode has no admin API; an admin read is the same local copy. */
  loadForAdmin(id: string): Promise<AnesthesiaCase> {
    return this.load(id);
  }

  async create(owner: string): Promise<AnesthesiaCase> {
    const c = newCase(owner);
    this.cases.set(c.id, cloneCase(c));
    return cloneCase(c);
  }

  async save(c: AnesthesiaCase): Promise<AnesthesiaCase> {
    const prev = this.cases.get(c.id);
    // Like the server: a finalized case is locked, and the lifecycle fields are server-owned.
    if (prev?.status === 'finalized') throw BackendError.http(409, JSON.stringify({ detail: 'case is finalized' }));
    const next: AnesthesiaCase = {
      ...cloneCase(c),
      status: 'draft',
      finalized_at: null,
      updated_at: new Date().toISOString(),
    };
    this.cases.set(c.id, next);
    return cloneCase(next);
  }

  async delete(id: string): Promise<void> {
    if (this.cases.get(id)?.status === 'finalized') {
      throw BackendError.http(409, JSON.stringify({ detail: 'case is finalized' }));
    }
    this.cases.delete(id);
  }

  async finalize(id: string): Promise<AnesthesiaCase> {
    const c = this.cases.get(id);
    if (!c) throw new BackendError('notFound', `Caso ${id} no encontrado.`, 404);
    if (c.status === 'finalized') throw BackendError.http(409, JSON.stringify({ detail: 'case is finalized' }));
    const now = new Date().toISOString();
    const locked: AnesthesiaCase = { ...cloneCase(c), status: 'finalized', finalized_at: now, updated_at: now };
    this.cases.set(id, locked);
    return cloneCase(locked);
  }

  /** Offline: nothing is ever stored (PDFs are rendered by the server). */
  async listDocuments(): Promise<DocumentDTO[]> {
    return [];
  }

  async generateDocument(): Promise<DocumentDTO> {
    throw new BackendError('unsupported', 'Los documentos guardados necesitan el servidor (el servidor genera los formularios).');
  }

  async documentFile(): Promise<Blob> {
    throw new BackendError('unsupported', 'Los documentos guardados necesitan el servidor.');
  }

  async deleteDocument(): Promise<void> {
    throw new BackendError('unsupported', 'Los documentos guardados necesitan el servidor.');
  }

  async exportForm(): Promise<Blob> {
    throw new BackendError(
      'unsupported',
      'La exportación de formularios necesita el servidor.',
    );
  }
}
