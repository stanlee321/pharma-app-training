import type { CaseMeta } from '../state/caseStore';
import { Icon } from './Icon';
import { useReadOnlyState } from './readOnlyContext';
import { saveStateOf, type SaveState } from './saveState';

export function SaveIndicator({ state, error }: { state: SaveState; error?: string | null }) {
  const cls =
    state === 'error' ? ' save-indicator--error' : state === 'saved' ? ' save-indicator--saved' : '';
  return (
    <span className={`save-indicator${cls}`} role="status" aria-live="polite">
      {state === 'saving' ? (
        <>
          <span className="spinner" aria-hidden="true" /> Saving…
        </>
      ) : state === 'error' ? (
        <>
          <Icon name="warning" size={16} /> Save failed{error ? `: ${error}` : ''}
        </>
      ) : state === 'dirty' ? (
        'Unsaved changes'
      ) : state === 'saved' ? (
        <>
          <Icon name="checkCircle" size={16} /> Saved
        </>
      ) : null}
    </span>
  );
}

/**
 * Sticky bottom bar: save indicator + Save button (Swift toolbar "Save"). In read-only mode the
 * indicator shows the lock and Save stays disabled.
 */
export function SaveBar({
  meta,
  onSave,
  label = 'Save',
}: {
  meta: CaseMeta | undefined;
  onSave: () => void;
  label?: string;
}) {
  const state = saveStateOf(meta);
  const ro = useReadOnlyState();
  if (ro.readOnly) {
    return (
      <div className="savebar">
        <span className="save-indicator" role="status">
          <Icon name="lock" size={16} /> {ro.reason === 'finalized' ? 'Finalized — read-only' : 'Read-only'}
        </span>
        <button type="button" className="btn-primary btn-primary--compact" disabled>
          {label}
        </button>
      </div>
    );
  }
  return (
    <div className="savebar">
      <SaveIndicator state={state} error={meta?.saveError} />
      <button
        type="button"
        className="btn-primary btn-primary--compact"
        onClick={onSave}
        disabled={state === 'saving'}
      >
        {state === 'error' ? 'Retry' : label}
      </button>
    </div>
  );
}
