import { describe, expect, it } from 'vitest';
import { caseSubtitle, caseTitle, newCase, normalizeCase } from './factory';
import type { AnesthesiaCaseDTO } from './types';

describe('newCase / normalizeCase', () => {
  it('newCase mirrors Swift AnesthesiaCase(owner:) defaults', () => {
    const c = newCase('Dr. Demo', new Date('2026-02-03T04:05:06Z'));
    expect(c.owner).toBe('Dr. Demo');
    expect(c.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(c.created_at).toBe('2026-02-03T04:05:06.000Z');
    expect(c.fecha).toBe(c.created_at);
    expect(c.patient.profile).toEqual({ weight: 70, height: 170, age: 40, gender: 'male', dilution: 10 });
    expect(c.drugs).toEqual([]);
    expect(c.asa).toBeNull();
    expect(caseTitle(c)).toBe('Untitled case');
    expect(caseSubtitle(c)).toBe('No diagnosis');
  });

  it('normalizeCase fills missing nested fields', () => {
    const dto: AnesthesiaCaseDTO = {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      owner: 'o',
      status: 'draft',
      sala: 'Q1',
      servicio: '',
      turno: '',
      tipo_admision: '',
      tipo: '',
      procedimiento: '',
      posicion: '',
      duracion_anestesia: '',
      diagnostico_preop: '',
      diagnostico_postop: '',
      operacion_propuesta: '',
      operacion_realizada: '',
      equipo_quirurgico: '',
      observaciones: '',
      complicaciones_post: '',
      patient: { registro: 'R', nombre: 'N', rh: '', grupo_sanguineo: '', cama: '', hab: '' },
      drugs: [{ label: 'A', farmaco: 'Propofol', dose_unit: 'mg', via: 'IV' }],
    };
    const c = normalizeCase(dto);
    expect(c.sala).toBe('Q1');
    expect(c.patient.nombre).toBe('N');
    expect(c.patient.profile.weight).toBe(70);
    expect(c.trans_record.basal.fc).toBeNull();
    expect(c.drugs[0]!.dose_value).toBeNull();
    expect(c.drugs[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(c.recovery.aldrete).toEqual({});
    expect(c.status).toBe('draft');
    expect(c.finalized_at).toBeNull();
  });
});
