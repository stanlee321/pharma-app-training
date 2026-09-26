/**
 * Recovery (Aldrete) spec + derivation — port of PharmaApp/Views/Recovery/RecoveryScreen.swift.
 * Criterion / time-point strings are exactly the Swift keys of `recovery.aldrete[criterion][tp]`.
 */
import type { RecoveryScore } from '../api/types';

export const ALDRETE_CRITERIA = ['Actividad', 'Respiración', 'Circulación', 'Conciencia', 'Coloración'] as const;
export const ALDRETE_TIME_POINTS = ['Al salir', '0', '20', '60', '90', '120'] as const;

/**
 * Término scales (Swift `otrasBinding` + StepperRow): key, label, fallback, range, unit.
 *
 * `key` is what the backend crosswalk reads (`otras.get('Ramsay' | 'Bromage' | 'ENA')`, no
 * normalisation) — the backend wins over Swift, which writes lowercase keys that never reach the
 * nota_postanestesica PDF. `legacyKey` is the Swift spelling, read as a fallback so cases written
 * by the iOS app still display, and removed when the scale is written.
 */
export const OTRAS_SCALES = [
  { key: 'Ramsay', legacyKey: 'ramsay', label: 'Ramsay', fallback: 2, min: 1, max: 6, unit: '' },
  { key: 'Bromage', legacyKey: 'bromage', label: 'Bromage', fallback: 0, min: 0, max: 3, unit: '' },
  { key: 'ENA', legacyKey: 'ena', label: 'ENA', fallback: 0, min: 0, max: 10, unit: '/10' },
] as const;

export type OtrasScale = (typeof OTRAS_SCALES)[number];

/** Stored value of a término scale (canonical key first, then the Swift lowercase key), or null. */
export function otrasValue(r: RecoveryScore, s: OtrasScale): number | null {
  const v = r.otras[s.key] ?? r.otras[s.legacyKey];
  return typeof v === 'number' ? v : null;
}

/** Write a término scale under the crosswalk key and drop any Swift lowercase duplicate. */
export function setOtras(r: RecoveryScore, s: OtrasScale, v: number): void {
  r.otras[s.key] = Math.round(v);
  delete r.otras[s.legacyKey];
}

export function aldreteCell(r: RecoveryScore, criterion: string, tp: string): number | null {
  const v = r.aldrete[criterion]?.[tp];
  return typeof v === 'number' ? v : null;
}

export function setAldreteCell(r: RecoveryScore, criterion: string, tp: string, v: number): void {
  (r.aldrete[criterion] ??= {})[tp] = v;
}

/** Swift `columnTotal`: Σ of the 5 criteria, or null ("—") while any criterion is unscored. */
export function aldreteColumnTotal(r: RecoveryScore, tp: string): number | null {
  let sum = 0;
  for (const c of ALDRETE_CRITERIA) {
    const v = aldreteCell(r, c, tp);
    if (v === null) return null;
    sum += v;
  }
  return sum;
}
