import type { CaseMeta } from '../state/caseStore';
import { UI } from '../lib/wording';
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
          <span className="spinner" aria-hidden="true" /> Guardando…
        </>
      ) : state === 'error' ? (
        <>
          <Icon name="warning" size={16} /> No se pudo guardar{error ? `: ${error}` : ''}
        </>
      ) : state === 'dirty' ? (
        'Cambios sin guardar'
      ) : state === 'saved' ? (
        <>
          <Icon name="checkCircle" size={16} /> Guardado
        </>
      ) : null}
    </span>
  );
}

/**
 * Sticky bottom bar: save indicator + "Guardar" button (Swift toolbar "Save"). In read-only mode the
 * indicator shows the lock and Save stays disabled.
 */
export function SaveBar({
  meta,
  onSave,
  label = UI.save,
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
          <Icon name="lock" size={16} /> {ro.reason === 'finalized' ? 'Finalizado — solo lectura' : 'Solo lectura'}
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
        {state === 'error' ? UI.retry : label}
      </button>
    </div>
  );
}
