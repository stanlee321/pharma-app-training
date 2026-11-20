/**
 * Fluid Balance grid spec + live derivation — layout ported from
 * PharmaApp/Views/Fluid/FluidBalanceScreen.swift, but the row keys and the balance formula follow
 * the backend (`backend/app/domain/derivations.py`), which wins on conflict. Hour keys are Swift's.
 */
import type { FluidBalance, TransanestheticRecord } from '../api/types';
import { FLUID_PREFIX, FLUIDS } from './timeGrid';

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
  // Sangrado broken down by source (clinician feedback 2026-11b); "Sangrado" is their sum
  { key: 'Textiles', label: 'Sangrado · Textiles', kind: 'bleed' },
  { key: 'Aspirador', label: 'Sangrado · Aspirador', kind: 'bleed' },
  { key: 'Recuperador', label: 'Sangrado · Recuperador', kind: 'bleed' },
] as const;
export type FluidRow = (typeof FLUID_ROWS)[number];

export const FLUID_HOURS = ['1hr', '2hr', '3hr', '4hr', '5hr'] as const;
export const BLOOD_OPTIONS = ['Concentrado globular', 'Plasma', 'Plaquetas', 'Aféresis'] as const;

const INTAKE = FLUID_ROWS.filter((r) => r.kind === 'intake').map((r) => r.key);
const LOSSES = FLUID_ROWS.filter((r) => r.kind === 'loss').map((r) => r.key);
const BLEED = FLUID_ROWS.filter((r) => r.kind === 'bleed').map((r) => r.key);

/** Intake rows per hour from the time grid's IV fluids (by catalogue group), as the server does. */
export type GridIntake = Record<string, Record<string, number>>;
const GROUP_ROW: Record<string, string> = {
  Cristaloides: 'Ingreso Critaloide',
  Coloides: 'Ingreso Coloide',
  Hemocomponentes: 'Ingreso hemocomponente',
};
export function gridIntake(tr: TransanestheticRecord): GridIntake {
  const out: GridIntake = {};
  for (const s of tr.series) {
    if (!s.lane.startsWith(FLUID_PREFIX)) continue;
    const name = s.lane.slice(FLUID_PREFIX.length);
    const group = FLUIDS.find((g) => g.names.includes(name))?.group;
    const row = group ? GROUP_ROW[group] : undefined;
    if (!row) continue;
    for (const p of s.points) {
      const h = FLUID_HOURS[Math.floor(p.t / 60)];
      if (!h || typeof p.value !== 'number') continue;
      (out[row] ??= {})[h] = (out[row]?.[h] ?? 0) + p.value;
    }
  }
  return out;
}

/** Total ml of IV fluids in the time grid ("Total fluidos infundidos"). */
export function gridFluidTotal(tr: TransanestheticRecord): number {
  return tr.series
    .filter((s) => s.lane.startsWith(FLUID_PREFIX))
    .flatMap((s) => s.points)
    .reduce((sum, p) => sum + (typeof p.value === 'number' ? p.value : 0), 0);
}

/** An intake cell: the typed value, else the time-grid sum of that hour. */
export function intakeValue(f: FluidBalance, row: string, hour: string, grid: GridIntake): number | null {
  return cellValue(f, row, hour) ?? grid[row]?.[hour] ?? null;
}

/** Sangrado of one hour: Textiles + Aspirador + Recuperador, else an older typed Sangrado value. */
export function bleeding(f: FluidBalance, hour: string): number | null {
  const parts = BLEED.map((r) => cellValue(f, r, hour));
  if (parts.some((p) => p !== null)) return parts.reduce<number>((s, p) => s + (p ?? 0), 0);
  return cellValue(f, 'Sangrado', hour);
}

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
 * Σ intake (Ingreso Critaloide + Ingreso Coloide + Ingreso hemocomponente; an empty cell takes the
 * time-grid fluids of that hour) − Σ losses (NCL + DCL + 3er Espacio + Diuresis + Circuito
 * respiratorio + Sangrado); blanks count 0.
 */
export function hourBalance(f: FluidBalance, hour: string, grid: GridIntake = {}): number {
  const v = (row: string) => cellValue(f, row, hour) ?? 0;
  const intake = INTAKE.reduce((s, r) => s + (intakeValue(f, r, hour, grid) ?? 0), 0);
  return intake - LOSSES.reduce((s, r) => s + v(r), 0) - (bleeding(f, hour) ?? 0);
}

/** Balance total — the backend's running sum of the per-hour balance parcial up to `hour`. */
export function cumulativeBalance(f: FluidBalance, hour: string, grid: GridIntake = {}): number {
  let total = 0;
  for (const h of FLUID_HOURS) {
    total += hourBalance(f, h, grid);
    if (h === hour) break;
  }
  return total;
}

/** Swift `format`: whole numbers without decimals, else one decimal. */
export function formatMl(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
