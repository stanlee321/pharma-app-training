import { useCallback, useEffect } from 'react';
import type { AnesthesiaCase } from '../api/types';
import { caseStore, useCaseStore, type CaseMeta } from './caseStore';
import { useCaseScope } from './caseScope';

export type CaseLoadStatus = 'loading' | 'ready' | 'error';

export interface UseCaseResult {
  /** The full aggregate once loaded (undefined while loading / on error / for a list shell). */
  data: AnesthesiaCase | undefined;
  status: CaseLoadStatus;
  error: string | null;
  meta: CaseMeta | undefined;
  dirty: boolean;
  /** Local edit — see `CaseStoreState.updateCase`. */
  update: (recipe: (draft: AnesthesiaCase) => AnesthesiaCase | void) => void;
  save: () => Promise<boolean>;
  reload: () => void;
}

/**
 * Screen hook for one case: ensures the full aggregate is loaded (the list only holds shells),
 * then exposes it with `update`/`save`. Every section screen should use this rather than
 * reading `cases` directly. Under the admin scope (`state/caseScope.ts`) the case is read with
 * `GET /admin/cases/{id}` and kept view-only in the store.
 */
export function useCase(id: string): UseCaseResult {
  const c = useCaseStore((s) => s.cases.find((x) => x.id === id));
  const meta = useCaseStore((s) => s.meta[id]);
  const { access } = useCaseScope();
  const viewOnly = access === 'admin';
  // Only a copy read under this scope's access counts (an admin reads via /admin/cases/{id}).
  const loaded = !!meta?.loaded && meta.viewOnly === viewOnly;

  useEffect(() => {
    if (!loaded) void caseStore.getState().load(id, { access });
  }, [id, loaded, access]);

  const update = useCallback(
    (recipe: (draft: AnesthesiaCase) => AnesthesiaCase | void) => {
      caseStore.getState().updateCase(id, recipe);
    },
    [id],
  );
  const save = useCallback(() => caseStore.getState().save(id), [id]);
  const reload = useCallback(() => {
    void caseStore.getState().load(id, { force: true, access });
  }, [id, access]);

  const status: CaseLoadStatus = loaded && c ? 'ready' : meta?.loadError ? 'error' : 'loading';
  return {
    data: loaded ? c : undefined,
    status,
    error: meta?.loadError ?? null,
    meta,
    dirty: !!meta && meta.rev !== meta.savedRev,
    update,
    save,
    reload,
  };
}
