import { useState } from 'react';
import { UI } from '../lib/wording';
import { Icon } from './Icon';
import { useReadOnly } from './readOnlyContext';

/**
 * Trash button with an inline "Eliminar / Cancelar" confirmation — the web stand-in for SwiftUI's
 * swipe-to-delete / EditButton `.onDelete` on collection rows (same idiom as the Encounter list).
 * `label` is the accessible name of the trash button (e.g. "Eliminar fármaco A"). Hidden in read-only
 * mode (a finalized case has no deletable rows).
 */
export function ConfirmDeleteButton({ label, onDelete }: { label: string; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const off = useReadOnly();
  if (off) return null;
  if (confirming) {
    return (
      <span className="confirm-delete" role="group" aria-label={label}>
        <button type="button" className="btn-destructive" onClick={onDelete}>
          {UI.delete}
        </button>
        <button type="button" className="btn-plain" onClick={() => setConfirming(false)}>
          {UI.cancel}
        </button>
      </span>
    );
  }
  return (
    <button type="button" className="icon-button icon-button--delete" aria-label={label} onClick={() => setConfirming(true)}>
      <Icon name="trash" size={18} />
    </button>
  );
}
