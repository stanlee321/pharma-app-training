import type { CaseMeta } from '../state/caseStore';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/** Collapse a case's store metadata into one indicator state. */
export function saveStateOf(meta: CaseMeta | undefined): SaveState {
  if (!meta) return 'idle';
  if (meta.saving) return 'saving';
  if (meta.saveError) return 'error';
  if (meta.rev !== meta.savedRev) return 'dirty';
  if (meta.savedAt) return 'saved';
  return 'idle';
}
