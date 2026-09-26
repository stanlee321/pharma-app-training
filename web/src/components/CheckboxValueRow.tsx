import { useId } from 'react';
import { useReadOnly } from './readOnlyContext';
import { useNumberText, type NumberLimits } from './useNumberText';

export interface CheckboxValueRowProps extends NumberLimits {
  label: string;
  unit: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  value: number | null;
  onValueChange: (value: number | null) => void;
}

/**
 * A `checkbox_value` row (Swift `TechCheckboxValueRow`): leading checkbox, label, trailing numeric
 * field + unit. The number field is disabled/dimmed until the checkbox is on. The value is kept
 * when the box is unticked (Swift keeps the `_val` key too).
 */
export function CheckboxValueRow({
  label,
  unit,
  checked,
  onCheckedChange,
  value,
  onValueChange,
  ...limits
}: CheckboxValueRowProps) {
  const checkId = useId();
  const valueId = useId();
  const hintId = `${valueId}-hint`;
  const off = useReadOnly();
  const { problem, inputProps } = useNumberText({ value, onChange: onValueChange, ...limits });
  return (
    <>
      <div className={`row cbv-row${problem ? ' row--invalid' : ''}`}>
        <input
          id={checkId}
          className="cbv-row__check"
          type="checkbox"
          checked={checked}
          disabled={off}
          onChange={(e) => onCheckedChange(e.target.checked)}
        />
        <label className="row__label row__label--primary cbv-row__label" htmlFor={checkId}>
          {label}
        </label>
        <label className="visually-hidden" htmlFor={valueId}>
          {`${label} (${unit})`}
        </label>
        <input
          id={valueId}
          className="row__input cbv-row__value"
          placeholder="—"
          disabled={off || !checked}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? hintId : undefined}
          {...inputProps}
        />
        <span className="row__unit cbv-row__unit">{unit}</span>
      </div>
      {problem ? (
        <div className="row__hint" id={hintId} role="alert">
          {problem}
        </div>
      ) : null}
    </>
  );
}
