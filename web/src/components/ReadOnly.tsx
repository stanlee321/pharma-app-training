import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { ReadOnlyContext, useReadOnly, useReadOnlyState, type ReadOnlyState } from './readOnlyContext';

/** Scope for the read-only flag (see `readOnlyContext.ts`). */
export function ReadOnlyProvider({ value, children }: { value: ReadOnlyState; children: ReactNode }) {
  return <ReadOnlyContext.Provider value={value}>{children}</ReadOnlyContext.Provider>;
}

/** Renders its children only while editing is allowed (add / migrate actions). */
export function EditOnly({ children }: { children: ReactNode }) {
  return useReadOnly() ? null : <>{children}</>;
}

const BANNER_TEXT: Record<NonNullable<ReadOnlyState['reason']>, string> = {
  finalized: 'Caso finalizado — solo lectura',
  viewer: 'Vista de solo lectura',
  foreign: 'Caso de otro anestesiólogo — solo lectura',
};

/** The visible lock banner at the top of every read-only case screen. */
export function ReadOnlyBanner() {
  const { readOnly, reason } = useReadOnlyState();
  if (!readOnly) return null;
  return (
    <div className="banner banner--locked" role="status" data-testid="readonly-banner">
      <Icon name="lock" size={18} />
      <span className="banner__text">{BANNER_TEXT[reason ?? 'viewer']}</span>
    </div>
  );
}

/** "+ Add …" row button of a growable list; hidden in read-only mode. */
export function AddRowButton({
  label,
  ariaLabel,
  onAdd,
}: {
  label: string;
  ariaLabel?: string;
  onAdd: () => void;
}) {
  if (useReadOnly()) return null;
  return (
    <button type="button" className="row add-row" aria-label={ariaLabel} onClick={onAdd}>
      <Icon name="plus" size={20} />
      {label}
    </button>
  );
}
