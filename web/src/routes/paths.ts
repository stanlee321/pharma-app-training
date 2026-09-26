import type { TechniqueZone } from '../api/types';

/** The URLs of one case's screens under a root (`/cases/{id}` or `/admin/cases/{id}`). */
export interface CaseSectionPaths {
  hub: (id: string) => string;
  patient: (id: string) => string;
  preanesthetic: (id: string) => string;
  technique: (id: string, zone?: TechniqueZone) => string;
  monitoring: (id: string) => string;
  drugs: (id: string) => string;
  fluids: (id: string) => string;
  recovery: (id: string) => string;
  newborn: (id: string) => string;
  review: (id: string) => string;
}

function sectionPaths(root: (id: string) => string): CaseSectionPaths {
  return {
    hub: root,
    patient: (id) => `${root(id)}/patient`,
    preanesthetic: (id) => `${root(id)}/preanesthetic`,
    technique: (id, zone = 'general') => `${root(id)}/technique/${zone}`,
    monitoring: (id) => `${root(id)}/monitoring`,
    drugs: (id) => `${root(id)}/drugs`,
    fluids: (id) => `${root(id)}/fluids`,
    recovery: (id) => `${root(id)}/recovery`,
    newborn: (id) => `${root(id)}/newborn`,
    review: (id) => `${root(id)}/review`,
  };
}

const ownerSections = sectionPaths((id) => `/cases/${id}`);
const adminSections = sectionPaths((id) => `/admin/cases/${id}`);

/** Single source for app URLs (the web equivalent of the Swift `Route` enum). */
export const paths = {
  login: '/login',
  changePassword: '/change-password',
  /** Legacy list URL: redirects to the patient list. */
  cases: '/cases',
  ...ownerSections,
  /** Historias clínicas: the patient list (the anesthesiologist's landing). */
  pacientes: '/pacientes',
  pacienteNuevo: '/pacientes/nuevo',
  /** One patient: identity + their cases. */
  paciente: (id: string) => `/pacientes/${id}`,
  /** The patient screen with the identity form open. */
  pacienteEditar: (id: string) => `/pacientes/${id}?editar=1`,
  admin: {
    dashboard: '/admin',
    cases: '/admin/cases',
    /** The case list filtered to one owner (the dashboard's per-anesthesiologist links). */
    casesFor: (userId: string) => `/admin/cases?user_id=${encodeURIComponent(userId)}`,
    /** The case list filtered to one patient (from the patient page). */
    casesForPatient: (patientId: string) => `/admin/cases?patient_id=${encodeURIComponent(patientId)}`,
    case: adminSections.hub,
    /** The read-only section screens of one case, for an admin. */
    caseSections: adminSections,
    /** Historias clínicas (every patient, read-only for the admin; delete when empty). */
    patients: '/admin/patients',
    patient: (id: string) => `/admin/patients/${id}`,
    users: '/admin/users',
    newUser: '/admin/users/new',
    user: (id: string) => `/admin/users/${id}`,
    documents: '/admin/documents',
    /** The document index filtered to one case. */
    documentsFor: (caseId: string) => `/admin/documents?case_id=${encodeURIComponent(caseId)}`,
  },
} as const;

export { ownerSections as ownerCasePaths };
