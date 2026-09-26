import { useEffect } from 'react';
import { caseStore } from './caseStore';

/**
 * Persist a case when its screen goes away — the web equivalent of the Swift Hub's
 * `.onDisappear { store.save(caseID) }`, applied to every case screen so edits made on a
 * section screen are PUT when the user navigates back (the store's copy is the shared draft, so
 * nothing is lost in between). Only saves when there are unsaved edits; the store serializes
 * overlapping saves. While the case is dirty, closing/reloading the tab asks for confirmation.
 */
export function useSaveOnLeave(id: string): void {
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!caseStore.getState().isDirty(id)) return;
      e.preventDefault();
      // Legacy browsers (older Chrome/Safari) only prompt when returnValue is set.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      const s = caseStore.getState();
      if (s.meta[id]?.loaded && s.isDirty(id)) void s.save(id);
    };
  }, [id]);
}
