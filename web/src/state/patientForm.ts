import { edadLabel, plural } from '../lib/wording';
import { SEXO_LABELS, type PatientCreate, type PatientDTO, type PatientUpdate, type Sexo } from '../api/types';
import { todayYmd } from '../lib/datetime';

/*
 * Patient screens' pure logic: the identity form (new patient and "Editar paciente") values,
 * client validation (Spanish messages) and wire bodies, plus list display helpers. The
 * components are in routes/patients/.
 */

/** The editable identity of a patient (form state; `fecha_nacimiento` '' = unknown). */
export interface PatientFormValues {
  nombre: string;
  registro: string;
  sexo: Sexo;
  fecha_nacimiento: string;
  grupo_sanguineo: string;
  rh: string;
}

export type PatientFormErrors = Partial<Record<keyof PatientFormValues, string>>;

/** Mirrors the backend limits (dto.PatientCreate). */
export const NOMBRE_MAX = 255;
export const REGISTRO_MAX = 255;
export const BLOOD_MAX = 16;

export const EMPTY_PATIENT: PatientFormValues = {
  nombre: '',
  registro: '',
  sexo: '',
  fecha_nacimiento: '',
  grupo_sanguineo: '',
  rh: '',
};

export function valuesOf(p: PatientDTO): PatientFormValues {
  return {
    nombre: p.nombre,
    registro: p.registro ?? '',
    sexo: p.sexo,
    fecha_nacimiento: p.fecha_nacimiento ?? '',
    grupo_sanguineo: p.grupo_sanguineo,
    rh: p.rh,
  };
}

/** Client-side checks (the server re-validates): required nombre, registro and sexo; no future birth date. */
export function validatePatient(v: PatientFormValues, today: string = todayYmd()): PatientFormErrors {
  const errors: PatientFormErrors = {};
  if (!v.nombre.trim()) errors.nombre = 'Escriba el nombre del paciente.';
  if (!v.registro.trim()) errors.registro = 'Escriba el registro / expediente.';
  // Sex feeds the PK models (James LBM, peso ideal): never leave it unknown.
  if (v.sexo !== 'male' && v.sexo !== 'female') errors.sexo = 'Seleccione el sexo del paciente.';
  if (v.fecha_nacimiento && !/^\d{4}-\d{2}-\d{2}$/.test(v.fecha_nacimiento)) {
    errors.fecha_nacimiento = 'Fecha no válida.';
  } else if (v.fecha_nacimiento && v.fecha_nacimiento > today) {
    errors.fecha_nacimiento = 'La fecha de nacimiento no puede ser futura.';
  }
  return errors;
}

/** POST /patients body (trimmed; unknown birth date → null). */
export function toCreate(v: PatientFormValues): PatientCreate {
  return {
    nombre: v.nombre.trim(),
    registro: v.registro.trim(),
    sexo: v.sexo,
    fecha_nacimiento: v.fecha_nacimiento || null,
    grupo_sanguineo: v.grupo_sanguineo.trim(),
    rh: v.rh.trim(),
  };
}

/** PATCH /patients/{id} body: only what changed (empty = nothing to send). */
export function toUpdate(before: PatientFormValues, v: PatientFormValues): PatientUpdate {
  const next = toCreate(v);
  const prev = toCreate(before);
  const patch: PatientUpdate = {};
  if (next.nombre !== prev.nombre) patch.nombre = next.nombre;
  if (next.registro !== prev.registro) patch.registro = next.registro;
  if (next.sexo !== prev.sexo) patch.sexo = next.sexo;
  if (next.fecha_nacimiento !== prev.fecha_nacimiento) patch.fecha_nacimiento = next.fecha_nacimiento;
  if (next.grupo_sanguineo !== prev.grupo_sanguineo) patch.grupo_sanguineo = next.grupo_sanguineo;
  if (next.rh !== prev.rh) patch.rh = next.rh;
  return patch;
}

/**
 * Shown wherever a patient's sex is unknown ('' — legacy / migrated patients): the case keeps the
 * DTO default ("male") for the PK models until the patient is edited.
 */
export const SEXO_UNKNOWN_WARNING =
  'Sexo sin especificar: los cálculos farmacocinéticos lo tratarán como masculino hasta que edite el paciente.';

/** Debounce of the search box before the list is re-read. */
export const SEARCH_DEBOUNCE_MS = 250;

/** "Registro X · 45 años · Femenino · 2 casos" */
export function patientSubtitle(p: Pick<PatientDTO, 'registro' | 'edad' | 'sexo' | 'cases_count'>): string {
  const parts = [p.registro ? `Registro ${p.registro}` : 'Sin registro'];
  if (p.edad != null) parts.push(edadLabel(p.edad));
  if (p.sexo) parts.push(SEXO_LABELS[p.sexo]);
  parts.push(plural(p.cases_count, 'caso', 'casos'));
  return parts.join(' · ');
}

/** "45 años · Femenino" / "Sexo sin especificar" (the admin patient tables). */
export function patientFacts(p: Pick<PatientDTO, 'edad' | 'sexo'>): string {
  const parts: string[] = [];
  if (p.edad != null) parts.push(edadLabel(p.edad));
  parts.push(p.sexo ? SEXO_LABELS[p.sexo] : 'Sexo sin especificar');
  return parts.join(' · ');
}
