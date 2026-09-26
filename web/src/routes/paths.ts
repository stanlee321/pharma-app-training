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
  cases: '/cases',
  ...ownerSections,
  admin: {
    dashboard: '/admin',
    cases: '/admin/cases',
    /** The case list filtered to one owner (the dashboard's per-anesthesiologist links). */
    casesFor: (userId: string) => `/admin/cases?user_id=${encodeURIComponent(userId)}`,
    case: adminSections.hub,
    /** The read-only section screens of one case, for an admin. */
    caseSections: adminSections,
    users: '/admin/users',
    newUser: '/admin/users/new',
    user: (id: string) => `/admin/users/${id}`,
    documents: '/admin/documents',
    /** The document index filtered to one case. */
    documentsFor: (caseId: string) => `/admin/documents?case_id=${encodeURIComponent(caseId)}`,
  },
} as const;

export { ownerSections as ownerCasePaths };
