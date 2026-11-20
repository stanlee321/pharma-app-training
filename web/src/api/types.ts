/**
 * Convenience aliases over the generated OpenAPI types (`schema.d.ts`, from `npm run gen:api`).
 *
 * The wire DTOs mark every field that has a server-side default as optional. The client works
 * with a *complete* shape instead (every object/collection present, nullable scalars explicit
 * `null`), produced by `normalizeCase()` in `factory.ts`. The complete shapes remain assignable
 * to the wire DTOs, so they can be PUT back unchanged.
 */
import type { components } from './schema';

type S = components['schemas'];

/** Make every property required (optional `?: T | null` becomes `: T | null`). */
type Req<T> = { [K in keyof T]-?: T[K] };

// --- raw wire DTOs -------------------------------------------------------------------------
export type AnesthesiaCaseDTO = S['AnesthesiaCaseDTO'];
export type CaseSummaryDTO = S['CaseSummaryDTO'];
export type PatientRecordDTO = S['PatientRecordDTO'];
export type PatientProfileDTO = S['PatientProfileDTO'];
export type PreanestheticAssessmentDTO = S['PreanestheticAssessmentDTO'];
export type AnestheticTechniqueDTO = S['AnestheticTechniqueDTO'];
export type TransanestheticRecordDTO = S['TransanestheticRecordDTO'];
export type VitalSeriesDTO = S['VitalSeriesDTO'];
export type VitalPointDTO = S['VitalPointDTO'];
export type VitalSnapshotDTO = S['VitalSnapshotDTO'];
export type VascularAccessDTO = S['VascularAccessDTO'];
export type SupplementalO2DTO = S['SupplementalO2DTO'];
export type SurgicalEventDTO = S['SurgicalEventDTO'];
export type DrugAdministrationDTO = S['DrugAdministrationDTO'];
export type FluidBalanceDTO = S['FluidBalanceDTO'];
export type RecoveryScoreDTO = S['RecoveryScoreDTO'];
export type NewbornRecordDTO = S['NewbornRecordDTO'];
export type ProviderDTO = S['ProviderDTO'];
export type IsquemiaDTO = S['IsquemiaDTO'];
export type NeumoperitoneoDTO = S['NeumoperitoneoDTO'];
/** PUT /cases/{id} body (no server-owned status/updated_at/finalized_at/user_id). */
export type AnesthesiaCaseWrite = S['AnesthesiaCaseWrite'];

// --- auth / accounts / documents / admin ---------------------------------------------------
export type UserDTO = S['UserDTO'];
export type UserRole = UserDTO['role'];
export type LoginRequest = S['LoginRequest'];
export type LoginResponse = S['LoginResponse'];
export type ChangePasswordRequest = S['ChangePasswordRequest'];
export type ErrorDTO = S['ErrorDTO'];
export type CaseStatus = AnesthesiaCaseDTO['status'];
export type DocumentDTO = S['DocumentDTO'];
export type AdminDocumentDTO = S['AdminDocumentDTO'];
export type AdminCasePage = S['AdminCasePage'];
export type AdminDocumentPage = S['AdminDocumentPage'];
export type AdminStatsDTO = S['AdminStatsDTO'];
export type AdminUserCreate = S['AdminUserCreate'];
export type AdminUserUpdate = S['AdminUserUpdate'];
export type FormInfoDTO = S['FormInfoDTO'];
export type FormSchemaDTO = S['FormSchemaDTO'];

// --- patients (historias clínicas) ---------------------------------------------------------
export type PatientDTO = S['PatientDTO'];
export type PatientDetailDTO = S['PatientDetailDTO'];
export type PatientCaseSummaryDTO = S['PatientCaseSummaryDTO'];
export type PatientPage = S['PatientPage'];
export type PatientCreate = S['PatientCreate'];
export type PatientUpdate = S['PatientUpdate'];
export type PatientConflictDTO = S['PatientConflictDTO'];
export type Sexo = PatientDTO['sexo'];

// Spanish labels (sexo, roles, lifecycle states, technique zones) live in lib/wording.ts.
export { ROLE_LABELS, SEXO_LABELS, STATUS_LABELS, TECHNIQUE_ZONE_TITLES } from '../lib/wording';

// --- complete client-side shapes ----------------------------------------------------------
export type PatientProfile = Req<PatientProfileDTO>;
export type Gender = 'male' | 'female';
export type PatientRecord = Omit<Req<PatientRecordDTO>, 'profile'> & { profile: PatientProfile };
export type PreanestheticAssessment = Req<PreanestheticAssessmentDTO>;
export type AnestheticTechnique = Req<AnestheticTechniqueDTO>;
export type VitalPoint = VitalPointDTO;
export type VitalSeries = Req<VitalSeriesDTO>;
export type SurgicalEvent = Req<SurgicalEventDTO>;
export type VitalSnapshot = Req<VitalSnapshotDTO>;
export type VascularAccess = Req<VascularAccessDTO>;
export type SupplementalO2 = Req<SupplementalO2DTO>;
export type TransanestheticRecord = Omit<
  Req<TransanestheticRecordDTO>,
  'series' | 'events' | 'basal' | 'termination' | 'accesos' | 'o2_suplementario'
> & {
  series: VitalSeries[];
  events: SurgicalEvent[];
  basal: VitalSnapshot;
  termination: VitalSnapshot;
  accesos: VascularAccess[];
  o2_suplementario: SupplementalO2;
};
export type DrugAdministration = Req<DrugAdministrationDTO>;
export type FluidBalance = Req<FluidBalanceDTO>;
export type RecoveryScore = Req<RecoveryScoreDTO>;
export type NewbornRecord = Req<NewbornRecordDTO>;
export type Provider = Req<ProviderDTO>;
export type Isquemia = Req<IsquemiaDTO>;
export type Neumoperitoneo = Req<NeumoperitoneoDTO>;

type NestedKeys =
  | 'isquemia'
  | 'neumoperitoneo'
  | 'anestesiologo'
  | 'cirujano'
  | 'patient'
  | 'pre_assessment'
  | 'technique'
  | 'trans_record'
  | 'fluid_balance'
  | 'recovery'
  | 'drugs'
  | 'newborns';

/** The full aggregate as the screens edit it (every child present). */
export type AnesthesiaCase = Omit<Req<AnesthesiaCaseDTO>, NestedKeys> & {
  isquemia: Isquemia;
  neumoperitoneo: Neumoperitoneo;
  anestesiologo: Provider;
  cirujano: Provider;
  patient: PatientRecord;
  pre_assessment: PreanestheticAssessment;
  technique: AnestheticTechnique;
  trans_record: TransanestheticRecord;
  fluid_balance: FluidBalance;
  recovery: RecoveryScore;
  drugs: DrugAdministration[];
  newborns: NewbornRecord[];
};

/** Technique modality zones (Swift TechniqueZone). */
export const TECHNIQUE_ZONES = ['general', 'neuraxial', 'peripheral'] as const;
export type TechniqueZone = (typeof TECHNIQUE_ZONES)[number];
export function isTechniqueZone(s: string | undefined): s is TechniqueZone {
  return !!s && (TECHNIQUE_ZONES as readonly string[]).includes(s);
}

/** Backend fill-pdf templates (`POST /cases/{id}/export/{form_id}`). */
export const FORM_IDS = [
  'registro_transanestesico',
  'nota_postanestesica',
  'imss_valoracion_preanestesica',
  'imss_registro_anestesia',
] as const;
export type FormId = (typeof FORM_IDS)[number];
