import { useId, useRef, useState, type ReactNode } from 'react';
import { PASSWORD_MANAGER_OFF } from '../lib/accounts';
import { parseNumber } from '../lib/number';
import { useReadOnly } from './readOnlyContext';
import { RepeatButton } from './RepeatButton';
import { useNumberText } from './useNumberText';

/*
 * Labeled input rows — the one "labeled text/notes row" widget the screen specs asked for
 * (Swift LabeledTextRow). IMPORTANT (Swift lesson): keep the <label> and the input as separate,
 * individually focusable elements; never collapse an editable row into one opaque element.
 */

export interface TextRowProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  unit?: string;
  /** Stacked textarea (notes) instead of a trailing single-line field. */
  multiline?: boolean;
  type?: 'text' | 'url' | 'email' | 'tel' | 'search' | 'password';
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  autoComplete?: string;
  maxLength?: number;
  disabled?: boolean;
  /** Smaller value text (Swift `.font(.caption)` on the Server field). */
  small?: boolean;
  /** Disable autocapitalize/autocorrect/spellcheck (URLs, codes). */
  noAutoCorrect?: boolean;
  id?: string;
  /** Validation message shown under the row (the row turns invalid, the input references it). */
  error?: string | null;
  /** Helper text under the row (when there is no error). */
  hint?: string;
  required?: boolean;
  /**
   * Keep browser / password-manager autofill away from this field (e.g. an admin typing ANOTHER
   * user's username): `data-1p-ignore` + `data-lpignore` on top of `autoComplete="off"`.
   */
  noPasswordManager?: boolean;
}

export function TextRow({
  label,
  value,
  onChange,
  placeholder,
  unit,
  multiline = false,
  type = 'text',
  inputMode,
  autoComplete = 'off',
  maxLength,
  disabled,
  small,
  noAutoCorrect = type === 'url' || type === 'password',
  id,
  error,
  hint,
  required,
  noPasswordManager = false,
}: TextRowProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const noteId = `${inputId}-note`;
  const off = useReadOnly() || disabled;
  const note = error ? (
    <div className="row__hint" id={noteId} role="alert">
      {error}
    </div>
  ) : hint ? (
    <div className="row__hint row__hint--info" id={noteId}>
      {hint}
    </div>
  ) : null;
  const described = note ? noteId : undefined;
  if (multiline) {
    return (
      <div className="row row--stacked">
        <label className="row__label" htmlFor={inputId}>
          {label}
        </label>
        <textarea
          id={inputId}
          className="row__textarea"
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={off}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          onChange={(e) => onChange(e.target.value)}
        />
        {note}
      </div>
    );
  }
  return (
    <>
      <div className={`row${error ? ' row--invalid' : ''}`}>
        <label className="row__label" htmlFor={inputId}>
          {label}
        </label>
        <input
          id={inputId}
          className="row__input"
          style={small ? { fontSize: 'var(--text-caption)' } : undefined}
          type={type}
          inputMode={inputMode}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          autoCapitalize={noAutoCorrect ? 'none' : undefined}
          autoCorrect={noAutoCorrect ? 'off' : undefined}
          spellCheck={noAutoCorrect ? false : undefined}
          maxLength={maxLength}
          disabled={off}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={described}
          {...(noPasswordManager ? PASSWORD_MANAGER_OFF : null)}
          onChange={(e) => onChange(e.target.value)}
        />
        {unit ? <span className="row__unit">{unit}</span> : null}
      </div>
      {note}
    </>
  );
}

export interface NumberRowProps {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  unit?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  /** Integer-only entry (e.g. ASA, Apgar). */
  integer?: boolean;
  disabled?: boolean;
  id?: string;
}

/**
 * Nullable numeric field. Keeps the raw text locally so partial input ("7.", "-") is allowed;
 * commits a number (or null when cleared) upstream.
 *
 * Invalid input (non-numeric, out of range, fractional where `integer`) is shown in the invalid
 * tint and never leaves a *stale prefix* committed: while the text is invalid the committed value
 * is the one the field held when this edit began (typing "300" with max 250 commits 3, 30, then
 * reverts the committed value to the pre-edit one — never 30). On blur, invalid text is reset to
 * that committed value, so the screen never shows a number that is not stored.
 */
export function NumberRow({
  label,
  value,
  onChange,
  unit,
  placeholder = '—',
  min,
  max,
  integer = false,
  disabled,
  id,
}: NumberRowProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const off = useReadOnly() || disabled;
  const { problem, inputProps } = useNumberText({ value, onChange, min, max, integer });

  return (
    <>
      <div className={`row${problem ? ' row--invalid' : ''}`}>
        <label className="row__label" htmlFor={inputId}>
          {label}
        </label>
        <input
          id={inputId}
          className="row__input"
          placeholder={placeholder}
          disabled={off}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? hintId : undefined}
          {...inputProps}
        />
        {unit ? <span className="row__unit">{unit}</span> : null}
      </div>
      {problem ? (
        <div className="row__hint" id={hintId} role="alert">
          {problem}
        </div>
      ) : null}
    </>
  );
}

function decimalsOf(step: number): number {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

export interface StepperRowProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  step: number;
  min: number;
  max: number;
  /** Fraction digits shown (defaults to the step's precision). */
  decimals?: number;
}

/**
 * Port of Swift StepperRow: label · monospaced value · unit · [−] [+], where the buttons
 * accelerate on hold. The value is also directly editable (click it to type).
 */
export function StepperRow({ label, value, onChange, unit, step, min, max, decimals }: StepperRowProps) {
  const id = useId();
  const off = useReadOnly();
  const digits = decimals ?? decimalsOf(step);
  const latest = useRef(value);
  latest.current = value;
  const [editing, setEditing] = useState<string | null>(null);
  /** Text shown when editing began — a focus+blur with no typing must not write anything. */
  const initialText = useRef<string | null>(null);

  const clampRound = (v: number) => {
    const p = 10 ** Math.max(digits, decimalsOf(step));
    return Math.min(max, Math.max(min, Math.round(v * p) / p));
  };
  const bump = (delta: number) => {
    if (off) return;
    const next = clampRound(latest.current + delta);
    if (next !== latest.current) {
      latest.current = next;
      onChange(next);
    }
  };
  const commitText = () => {
    if (editing === null || off) return;
    const untouched = editing === initialText.current;
    initialText.current = null;
    setEditing(null);
    if (untouched) return;
    const n = parseNumber(editing);
    if (n === null || Number.isNaN(n)) return;
    const next = clampRound(n);
    if (next !== value) onChange(next);
  };

  return (
    <div className="row">
      <label className="row__label row__label--primary" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="row__input stepper__value"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        disabled={off}
        value={editing ?? value.toFixed(digits)}
        aria-valuemin={min}
        aria-valuemax={max}
        onFocus={(e) => {
          initialText.current = value.toFixed(digits);
          setEditing(initialText.current);
          e.currentTarget.select();
        }}
        onChange={(e) => setEditing(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'ArrowUp') {
            e.preventDefault();
            bump(step);
            setEditing(null);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            bump(-step);
            setEditing(null);
          }
        }}
      />
      <span className="stepper__unit" aria-hidden={unit ? undefined : true}>
        {unit ?? ''}
      </span>
      <div className="stepper__buttons">
        <RepeatButton kind="minus" label={`Decrease ${label}`} onStep={() => bump(-step)} disabled={off || value <= min} />
        <RepeatButton kind="plus" label={`Increase ${label}`} onStep={() => bump(step)} disabled={off || value >= max} />
      </div>
    </div>
  );
}

/** Generic wrapper row for custom content (label + trailing children). */
export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`row${className ? ` ${className}` : ''}`}>{children}</div>;
}
