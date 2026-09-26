import { createContext, useContext } from 'react';
import { ownerCasePaths, paths, type CaseSectionPaths } from '../routes/paths';

/**
 * Who is looking at a case, and where its screens live. The section screens are shared between
 * the anesthesiologist's editable flow (`/cases/{id}/…`, loaded with `GET /cases/{id}`) and the
 * admin's read-only view (`/admin/cases/{id}/…`, loaded with `GET /admin/cases/{id}`): they read
 * their links and the load route from this scope instead of hard-coding `/cases`.
 */
export type CaseAccess = 'owner' | 'admin';

export interface CaseScope {
  access: CaseAccess;
  /** URLs of the case's section screens under this scope. */
  paths: CaseSectionPaths;
  /** Where the Hub's back link goes (when the case's patient is not known / not linkable). */
  list: { to: string; label: string };
  /**
   * The Hub's back link to the case's patient screen (owner scope only: the patient screens are
   * the anesthesiologist's). Null → `list`.
   */
  patient: ((patientId: string) => { to: string; label: string }) | null;
}

export const OWNER_SCOPE: CaseScope = {
  access: 'owner',
  paths: ownerCasePaths,
  list: { to: paths.pacientes, label: 'Historias clínicas' },
  patient: (patientId) => ({ to: paths.paciente(patientId), label: 'Paciente' }),
};

export const ADMIN_SCOPE: CaseScope = {
  access: 'admin',
  paths: paths.admin.caseSections,
  list: { to: paths.admin.cases, label: 'Casos' },
  patient: null,
};

export const CaseScopeContext = createContext<CaseScope>(OWNER_SCOPE);

export function useCaseScope(): CaseScope {
  return useContext(CaseScopeContext);
}
