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
  /** Where the Hub's back link goes. */
  list: { to: string; label: string };
}

export const OWNER_SCOPE: CaseScope = {
  access: 'owner',
  paths: ownerCasePaths,
  list: { to: paths.cases, label: 'Encounters' },
};

export const ADMIN_SCOPE: CaseScope = {
  access: 'admin',
  paths: paths.admin.caseSections,
  list: { to: paths.admin.cases, label: 'Cases' },
};

export const CaseScopeContext = createContext<CaseScope>(OWNER_SCOPE);

export function useCaseScope(): CaseScope {
  return useContext(CaseScopeContext);
}
