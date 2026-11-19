/**
 * Fluid Balance grid spec + live derivation — layout ported from
 * PharmaApp/Views/Fluid/FluidBalanceScreen.swift, but the row keys and the balance formula follow
 * the backend (`backend/app/domain/derivations.py`), which wins on conflict. Hour keys are Swift's.
 */
import type { FluidBalance } from '../api/types';

/**
 * Matrix rows. `key` is the canonical `control_fluidos` row label the backend derives from
 * (`derivations._INTAKE_ROWS` / `_LOSS_ROWS`) and the renderer matches against the nota21 form —
 * the backend wins over Swift, whose rows `Cristaloide` / `Coloide` do not exist on the form (they
 * were silently dropped from the PDF) and whose NCL-as-intake formula contradicted the server's
 * `balance_parcial`. "Critaloide" is the form's own misspelling, kept verbatim so the key matches.
 * `label` is the short on-screen label.
 */
export const FLUID_ROWS = [
  { key: 'Ingreso Critaloide', label: 'Cristaloide', kind: 'intake' },
  { key: 'Ingreso Coloide', label: 'Coloide', kind: 'intake' },
  { key: 'Ingreso hemocomponente', label: 'Hemocomponente', kind: 'intake' },
  { key: 'NCL', label: 'NCL', kind: 'loss' },
  { key: 'DCL', label: 'DCL', kind: 'loss' },
  { key: '3er Espacio', label: '3er espacio', kind: 'loss' },
  { key: 'Diuresis', label: 'Diuresis', kind: 'loss' },
  { key: 'Circuito respiratorio', label: 'Circuito respiratorio', kind: 'loss' },
  { key: 'Sangrado', label: 'Sangrado', kind: 'loss' },
] as const;
export type FluidRow = (typeof FLUID_ROWS)[number];

export const FLUID_HOURS = ['1hr', '2hr', '3hr', '4hr', '5hr'] as const;
export const BLOOD_OPTIONS = ['Concentrado globular', 'Plasma', 'Plaquetas', 'Aféresis'] as const;

const INTAKE = FLUID_ROWS.filter((r) => r.kind === 'intake').map((r) => r.key);
const LOSSES = FLUID_ROWS.filter((r) => r.kind === 'loss').map((r) => r.key);

/** Swift-era row keys (not on the form) and the canonical row each one maps to. */
export const LEGACY_ROWS: Readonly<Record<string, string>> = {
  Cristaloide: 'Ingreso Critaloide',
  Coloide: 'Ingreso Coloide',
};

/** Legacy (Swift) row keys present in the matrix — values the PDF export will not show. */
export function legacyRowsPresent(f: FluidBalance): string[] {
  return Object.keys(LEGACY_ROWS).filter((k) => f.matrix[k] && Object.keys(f.matrix[k]).length > 0);
}

/**
 * Move legacy Swift rows onto their canonical rows. An hour is moved only when the canonical cell
 * is empty; a conflicting hour stays on the legacy row (returned count excludes it).
 */
export function migrateLegacyRows(f: FluidBalance): number {
  let moved = 0;
  for (const [legacy, canonical] of Object.entries(LEGACY_ROWS)) {
    const src = f.matrix[legacy];
    if (!src) continue;
    for (const [h, v] of Object.entries(src)) {
      if (cellValue(f, canonical, h) !== null) continue;
      (f.matrix[canonical] ??= {})[h] = v;
      delete src[h];
      moved += 1;
    }
    if (Object.keys(src).length === 0) delete f.matrix[legacy];
  }
  return moved;
}

export function cellValue(f: FluidBalance, row: string, hour: string): number | null {
  const v = f.matrix[row]?.[hour];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Write one cell. Clearing removes the hour key, and a row left empty is removed too (Swift left
 * an empty `[:]` row behind, which would keep the section "filled" after clearing every cell).
 */
export function setCell(f: FluidBalance, row: string, hour: string, v: number | null): void {
  if (v === null) {
    const r = f.matrix[row];
    if (!r) return;
    delete r[hour];
    if (Object.keys(r).length === 0) delete f.matrix[row];
  } else {
    (f.matrix[row] ??= {})[hour] = v;
  }
}

/**
 * Balance parcial for one hour — mirrors the backend `derivations.fluid_balance`:
 * Σ intake (Ingreso Critaloide + Ingreso Coloide + Ingreso hemocomponente) −
 * Σ losses (NCL + DCL + 3er Espacio + Diuresis + Circuito respiratorio + Sangrado); blanks count 0.
 */
export function hourBalance(f: FluidBalance, hour: string): number {
  const v = (row: string) => cellValue(f, row, hour) ?? 0;
  return INTAKE.reduce((s, r) => s + v(r), 0) - LOSSES.reduce((s, r) => s + v(r), 0);
}

/** Balance total — the backend's running sum of the per-hour balance parcial up to `hour`. */
export function cumulativeBalance(f: FluidBalance, hour: string): number {
  let total = 0;
  for (const h of FLUID_HOURS) {
    total += hourBalance(f, h);
    if (h === hour) break;
  }
  return total;
}

/** Swift `format`: whole numbers without decimals, else one decimal. */
export function formatMl(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
