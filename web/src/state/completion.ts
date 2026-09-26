/**
 * Section-completion flags for the Encounter Hub (port of Swift CaseCompletion.swift): empty
 * sections read blue ("to do"), sections with any captured data read green ("done").
 *
 * Deviation (DTO wins): the backend DTOs carry fields the Swift models lack (PatientRecord.hab,
 * the extra PreanestheticAssessment strings). Any of those being non-empty also counts as data.
 * Server-derived fields (imc, balances, totals) never count.
 */
import type {
  AnesthesiaCase,
  AnestheticTechnique,
  FluidBalance,
  PatientRecord,
  PreanestheticAssessment,
  RecoveryScore,
  TransanestheticRecord,
} from '../api/types';

const filled = (s: string | null | undefined) => !!s && s.length > 0;
const nonEmpty = (o: object | null | undefined) => !!o && Object.keys(o).length > 0;

export function patientHasData(p: PatientRecord): boolean {
  return (
    filled(p.nombre) ||
    filled(p.registro) ||
    p.hb != null ||
    p.hto != null ||
    filled(p.rh) ||
    filled(p.grupo_sanguineo) ||
    filled(p.cama) ||
    filled(p.hab)
  );
}

export function preAssessmentHasData(a: PreanestheticAssessment): boolean {
  return (
    filled(a.alergia) ||
    filled(a.dentadura) ||
    filled(a.cuello) ||
    filled(a.via_aerea) ||
    filled(a.estado_psiquico) ||
    filled(a.premedicacion) ||
    filled(a.notes) ||
    filled(a.aparato_respiratorio) ||
    filled(a.aparato_cardiovascular) ||
    filled(a.tegumentos) ||
    filled(a.antecedentes_anestesicos) ||
    filled(a.medicamentos_previos) ||
    filled(a.analgesica_obstetrica) ||
    filled(a.otros) ||
    a.ayuno ||
    a.consentimiento ||
    a.asa != null ||
    a.raq != null ||
    nonEmpty(a.labs)
  );
}

export function techniqueHasData(t: AnestheticTechnique): boolean {
  return filled(t.modality) || nonEmpty(t.values);
}

export function transRecordHasData(r: TransanestheticRecord): boolean {
  return (
    r.series.length > 0 ||
    r.events.length > 0 ||
    nonEmpty(r.monitoring) ||
    filled(r.complicaciones) ||
    r.basal.fc != null ||
    r.basal.spo2 != null ||
    r.basal.ta_sys != null
  );
}

export function fluidBalanceHasData(f: FluidBalance): boolean {
  return nonEmpty(f.matrix) || nonEmpty(f.blood_components);
}

export function recoveryHasData(r: RecoveryScore): boolean {
  return nonEmpty(r.aldrete) || nonEmpty(r.otras) || filled(r.alta_a_piso);
}

export function drugsHasData(c: Pick<AnesthesiaCase, 'drugs'>): boolean {
  return c.drugs.length > 0;
}

export function newbornsHasData(c: Pick<AnesthesiaCase, 'newborns'>): boolean {
  return c.newborns.length > 0;
}

export type HubSection =
  | 'patient'
  | 'preanesthetic'
  | 'technique'
  | 'monitoring'
  | 'drugs'
  | 'fluids'
  | 'recovery'
  | 'newborn';

/** All Hub completion flags for one case. */
export function sectionCompletion(c: AnesthesiaCase): Record<HubSection, boolean> {
  return {
    patient: patientHasData(c.patient),
    preanesthetic: preAssessmentHasData(c.pre_assessment),
    technique: techniqueHasData(c.technique),
    monitoring: transRecordHasData(c.trans_record),
    drugs: drugsHasData(c),
    fluids: fluidBalanceHasData(c.fluid_balance),
    recovery: recoveryHasData(c.recovery),
    newborn: newbornsHasData(c),
  };
}
