import { useEffect, useRef, useState } from 'react';
import { parseNumber } from '../lib/number';

export function formatNumber(v: number | null): string {
  return v == null || Number.isNaN(v) ? '' : String(v);
}

export interface NumberLimits {
  min?: number;
  max?: number;
  /** Integer-only entry (e.g. ASA, Apgar). */
  integer?: boolean;
}

/** Validation message for a parsed number, or null when it may be committed. */
export function numberProblem(n: number | null, { min, max, integer }: NumberLimits): string | null {
  if (n === null) return null;
  if (Number.isNaN(n)) return 'No es un número';
  if (integer && !Number.isInteger(n)) return 'Debe ser un número entero';
  if (min !== undefined && n < min) return `Mínimo ${min}`;
  if (max !== undefined && n > max) return `Máximo ${max}`;
  return null;
}

/**
 * Raw-text state for a nullable numeric input (shared by NumberRow and CheckboxValueRow).
 * Partial input ("7.", "-") is allowed; a number (or null when cleared) is committed upstream.
 *
 * Invalid input (non-numeric, out of range, fractional where `integer`) never leaves a *stale
 * prefix* committed: while the text is invalid the committed value is the one the field held when
 * this edit began (typing "300" with max 250 commits 3, 30, then reverts to the pre-edit value —
 * never 30). On blur, invalid text is reset to the committed value, so the screen never shows a
 * number that is not stored.
 */
export function useNumberText({
  value,
  onChange,
  ...limits
}: { value: number | null; onChange: (v: number | null) => void } & NumberLimits) {
  const [text, setText] = useState(formatNumber(value));
  const lastCommitted = useRef<number | null>(value);
  /** The committed value when the current edit began — restored while the text is invalid. */
  const editBase = useRef<number | null>(value);

  // Sync external changes (e.g. server copy swapped in) without fighting the user's typing.
  useEffect(() => {
    if (value !== lastCommitted.current) {
      lastCommitted.current = value;
      editBase.current = value;
      setText(formatNumber(value));
    }
  }, [value]);

  const problem = numberProblem(parseNumber(text), limits);

  const commit = (n: number | null) => {
    if (n !== lastCommitted.current) {
      lastCommitted.current = n;
      onChange(n);
    }
  };

  return {
    problem,
    inputProps: {
      type: 'text' as const,
      inputMode: (limits.integer ? 'numeric' : 'decimal') as 'numeric' | 'decimal',
      autoComplete: 'off',
      value: text,
      onFocus: () => {
        editBase.current = lastCommitted.current;
      },
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        const t = e.target.value;
        setText(t);
        const n = parseNumber(t);
        // Valid → commit it; invalid → the pre-edit value (never a stale valid prefix).
        commit(numberProblem(n, limits) ? editBase.current : n);
      },
      onBlur: () => {
        if (problem) setText(formatNumber(lastCommitted.current));
        editBase.current = lastCommitted.current;
      },
    },
  };
}
