import { useId } from 'react';
import { useReadOnly } from './readOnlyContext';
import { useNumberText, type NumberLimits } from './useNumberText';

/**
 * One editable numeric spreadsheet cell (Swift grid `TextField("—")` with a decimal pad). The
 * visible header gives context; the visually-hidden <label> carries the full accessible name
 * (e.g. "NCL 1hr"). Uses the shared `useNumberText` so invalid text never commits a stale prefix.
 */
export function GridNumberCell({
  label,
  value,
  onChange,
  ...limits
}: { label: string; value: number | null; onChange: (v: number | null) => void } & NumberLimits) {
  const id = useId();
  const off = useReadOnly();
  const { problem, inputProps } = useNumberText({ value, onChange, ...limits });
  return (
    <>
      <label className="visually-hidden" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="grid-cell"
        placeholder="—"
        disabled={off}
        aria-invalid={problem ? true : undefined}
        title={problem ?? undefined}
        {...inputProps}
      />
    </>
  );
}
