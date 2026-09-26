import { newUUID } from '../lib/uuid';
import type {
  AnesthesiaCase,
  AnesthesiaCaseDTO,
  AnesthesiaCaseWrite,
  CaseSummaryDTO,
  PatientProfile,
  VitalSnapshot,
} from './types';

/** Swift `PatientProfile.defaultMale` (also the backend PatientProfileDTO defaults). */
export const DEFAULT_PROFILE: PatientProfile = {
  weight: 70,
  height: 170,
  age: 40,
  gender: 'male',
  dilution: 10,
};

const emptySnapshot = (): VitalSnapshot => ({
  fc: null,
  fr: null,
  ta_sys: null,
  ta_dia: null,
  spo2: null,
  pvc: null,
});

/**
 * A fresh, empty, wire-valid case — mirrors Swift `AnesthesiaCase(owner:)`: client-owned id,
 * `created_at`/`fecha` = now, default-male profile, empty children. Fields the Swift model lacks
 * take the backend DTO defaults. Server-derived fields (imc, balances, totals…) start empty/null;
 * the backend re-stamps them on every PUT.
 */
export function newCase(owner: string, now: Date = new Date()): AnesthesiaCase {
  const iso = now.toISOString();
  return {
    id: newUUID(),
    created_at: iso,
    owner,
    // Server-owned lifecycle fields (never sent back; see toWriteBody).
    status: 'draft',
    updated_at: null,
    finalized_at: null,
    user_id: null,
    fecha: iso,
    sala: '',
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
    asa: null,
    raq: null,
    isquemia: { hr_inicio: null, hr_termino: null, sitio: '' },
    neumoperitoneo: { hr_inicio: null },
    anestesiologo: { nombre: '', clave: '', cedula: '', universidad: '' },
    cirujano: { nombre: '', clave: '', cedula: '', universidad: '' },
    patient: {
      profile: { ...DEFAULT_PROFILE },
      registro: '',
      nombre: '',
      hb: null,
      hto: null,
      rh: '',
      grupo_sanguineo: '',
      cama: '',
      hab: '',
      imc: null,
      peso_ideal: null,
      vsc: null,
      vsc_25: null,
      vsc_15: null,
    },
    pre_assessment: {
      alergia: '',
      dentadura: '',
      cuello: '',
      via_aerea: '',
      estado_psiquico: '',
      aparato_respiratorio: '',
      aparato_cardiovascular: '',
      tegumentos: '',
      antecedentes_anestesicos: '',
      medicamentos_previos: '',
      analgesica_obstetrica: '',
      otros: '',
      premedicacion: '',
      ayuno: false,
      consentimiento: false,
      asa: null,
      raq: null,
      labs: {},
      notes: '',
    },
    technique: { modality: '', values: {} },
    trans_record: {
      series: [],
      events: [],
      monitoring: {},
      basal: emptySnapshot(),
      termination: emptySnapshot(),
      complicaciones: '',
    },
    fluid_balance: {
      matrix: {},
      blood_components: {},
      balance_parcial: {},
      balance_total: {},
      total_a_reponer: {},
      gasto_urinario: {},
      tasa_fentanilo: null,
    },
    recovery: { aldrete: {}, otras: {}, alta_a_piso: '', medico_responsable: '', totals: {} },
    drugs: [],
    newborns: [],
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep-fill: every key of `defaults` present in the result; `src` wins where it has a value. */
function fill(defaults: Obj, src: Obj): Obj {
  const out: Obj = { ...src };
  for (const [k, d] of Object.entries(defaults)) {
    const v = src[k];
    if (v === undefined) out[k] = d;
    else if (isObj(d) && isObj(v) && Object.keys(d).length > 0) out[k] = fill(d, v);
  }
  return out;
}

/**
 * Turn a wire `AnesthesiaCaseDTO` (fields may be absent) into a complete `AnesthesiaCase`.
 * Collections' items are filled too, so e.g. a drug without `dose_value` reads `null`.
 */
export function normalizeCase(dto: AnesthesiaCaseDTO): AnesthesiaCase {
  const base = newCase(dto.owner ?? '');
  const filled = fill(base as unknown as Obj, dto as unknown as Obj) as unknown as AnesthesiaCase;
  filled.drugs = (dto.drugs ?? []).map((d) => ({
    id: d.id ?? newUUID(),
    label: d.label ?? '',
    farmaco: d.farmaco ?? '',
    dose_value: d.dose_value ?? null,
    dose_unit: d.dose_unit ?? 'mg',
    via: d.via ?? 'IV',
    time: d.time ?? null,
    rust_model_id: d.rust_model_id ?? null,
  }));
  filled.newborns = (dto.newborns ?? []).map((n) => ({
    id: n.id ?? newUUID(),
    sexo: n.sexo ?? '',
    peso_gramos: n.peso_gramos ?? null,
    talla_cm: n.talla_cm ?? null,
    apgar1: n.apgar1 ?? null,
    apgar5: n.apgar5 ?? null,
    apgar10: n.apgar10 ?? null,
    expulsion_placenta: n.expulsion_placenta ?? '',
    estado_general: n.estado_general ?? '',
  }));
  filled.trans_record.series = (dto.trans_record?.series ?? []).map((s) => ({
    lane: s.lane,
    points: s.points ?? [],
  }));
  filled.trans_record.events = (dto.trans_record?.events ?? []).map((e) => ({
    marker: e.marker,
    t: e.t,
    label: e.label ?? '',
  }));
  return filled;
}

/**
 * Inflate a list row into a minimally-populated case "shell" (Swift `Summary.asShell()`).
 * A shell is NOT safe to PUT back — the store loads the full aggregate before editing/saving.
 */
export function shellFromSummary(s: CaseSummaryDTO): AnesthesiaCase {
  const c = newCase(s.owner ?? '', new Date(s.created_at));
  c.id = s.id;
  c.created_at = s.created_at;
  c.fecha = null;
  c.status = s.status ?? 'draft';
  c.updated_at = s.updated_at ?? null;
  c.finalized_at = s.finalized_at ?? null;
  c.user_id = s.user_id ?? null;
  c.patient.nombre = s.nombre ?? '';
  c.diagnostico_preop = s.diagnostico_preop ?? '';
  return c;
}

/**
 * The PUT /cases/{id} body: the aggregate minus the server-owned lifecycle fields
 * (`status`, `updated_at`, `finalized_at`, `user_id`), which the server ignores anyway.
 */
export function toWriteBody(c: AnesthesiaCase): AnesthesiaCaseWrite {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { status, updated_at, finalized_at, user_id, ...body } = c;
  return body;
}

/** Swift `AnesthesiaCase.title`. */
export function caseTitle(c: Pick<AnesthesiaCase, 'patient'>): string {
  return c.patient.nombre.trim() === '' ? 'Untitled case' : c.patient.nombre;
}

/** Swift `AnesthesiaCase.subtitle`. */
export function caseSubtitle(c: Pick<AnesthesiaCase, 'diagnostico_preop'>): string {
  return c.diagnostico_preop.trim() === '' ? 'No diagnosis' : c.diagnostico_preop;
}

/** Deep copy via JSON (cases are plain JSON data). */
export function cloneCase(c: AnesthesiaCase): AnesthesiaCase {
  return JSON.parse(JSON.stringify(c)) as AnesthesiaCase;
}
