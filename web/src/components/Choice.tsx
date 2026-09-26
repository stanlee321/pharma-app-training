import { useId } from 'react';
import { Icon } from './Icon';
import { useReadOnly } from './readOnlyContext';

export type Option<T extends string> = T | { value: T; label: string };
const optValue = <T extends string>(o: Option<T>): T => (typeof o === 'string' ? o : o.value);
const optLabel = <T extends string>(o: Option<T>): string => (typeof o === 'string' ? o : o.label);

export interface SegmentedControlProps<T extends string> {
  /** Accessible group name (visually hidden unless `showLabel`). */
  label: string;
  showLabel?: boolean;
  options: readonly Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
  name?: string;
}

/** iOS segmented picker: grey track, white selected pill. Native radios under the hood. */
export function SegmentedControl<T extends string>({
  label,
  showLabel = false,
  options,
  value,
  onChange,
  name,
}: SegmentedControlProps<T>) {
  const autoName = useId();
  const off = useReadOnly();
  return (
    <fieldset className="segmented" disabled={off}>
      <legend className={showLabel ? 'chips__title' : 'visually-hidden'}>{label}</legend>
      {options.map((o) => {
        const v = optValue(o);
        return (
          <label key={v} className="segmented__option">
            <input
              type="radio"
              name={name ?? autoName}
              value={v}
              checked={value === v}
              disabled={off}
              onChange={() => onChange(v)}
            />
            <span>{optLabel(o)}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

export interface ChoiceChipsProps<T extends string> {
  title: string;
  options: readonly Option<T>[];
  selection: readonly T[];
  onChange: (selection: T[]) => void;
  /** Multi-select; single-select (default) toggles the one chip off when re-tapped. */
  multiSelect?: boolean;
}

/** Port of Swift CheckboxGroupRow: caps title + adaptive grid of capsule chips. */
export function ChoiceChips<T extends string>({
  title,
  options,
  selection,
  onChange,
  multiSelect = false,
}: ChoiceChipsProps<T>) {
  const titleId = useId();
  const off = useReadOnly();
  const toggle = (v: T) => {
    if (off) return;
    const on = selection.includes(v);
    if (multiSelect) onChange(on ? selection.filter((x) => x !== v) : [...selection, v]);
    else onChange(on ? [] : [v]);
  };
  return (
    <div className="chips" role="group" aria-labelledby={titleId}>
      <p className="chips__title" id={titleId}>
        {title}
      </p>
      <div className="chips__grid">
        {options.map((o) => {
          const v = optValue(o);
          return (
            <button
              key={v}
              type="button"
              className="chip"
              aria-pressed={selection.includes(v)}
              disabled={off}
              onClick={() => toggle(v)}
            >
              {optLabel(o)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Label + iOS switch. */
export function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const off = useReadOnly() || disabled;
  return (
    <div className="row">
      <label className="row__label row__label--primary" htmlFor={id}>
        {label}
      </label>
      <span className="switch">
        <input
          id={id}
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={off}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="switch__track" aria-hidden="true" />
      </span>
    </div>
  );
}

/** Whole-row checkbox with a trailing blue checkmark (iOS list selection style). */
export function CheckRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const off = useReadOnly() || disabled;
  return (
    <label className="row check-row">
      <input type="checkbox" checked={checked} disabled={off} onChange={(e) => onChange(e.target.checked)} />
      <span className="row__label row__label--primary">{label}</span>
      <span className="check-row__mark" aria-hidden="true">
        <Icon name="check" size={20} />
      </span>
    </label>
  );
}
