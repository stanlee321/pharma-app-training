/**
 * Intraoperative time grid (clinician feedback 2026-11, items 5–8 and 10) — the
 * `trans_record.series` / `events` editor model.
 *
 * - Columns every `intervalo_min` (5) minutes from `trans_record.inicio`; `t` is minutes.
 * - A lane is one row: vitals and monitors by fixed key, inhaled agents as `inhalado:<agent>`
 *   (value in %), IV fluids as `fluido:<full name>` (value in ml).
 * - Numeric lanes store numbers; text lanes (EKG rhythm, POCUS, neuromonitoring) store strings.
 *
 * The printed transanesthetic record (backend render/timegrid.py) reads the same keys.
 */
import type { DrugAdministration, SurgicalEvent, TransanestheticRecord } from '../api/types';

export type LaneKind = 'number' | 'text';

export interface LaneDef {
  key: string;
  label: string;
  unit?: string;
  kind: LaneKind;
  min?: number;
  max?: number;
  /** Monitoring option (trans_record.monitoring) that shows this row; absent = always shown. */
  requires?: string;
  /** Retired row: shown only while a case still holds values in it. */
  legacyOnly?: boolean;
}

/** Plotted vitals (the 20–240 axis of the printed record). */
export const VITAL_LANES: readonly LaneDef[] = [
  { key: 'fc', label: 'FC', unit: 'lpm', kind: 'number', min: 0, max: 300 },
  { key: 'ta_sys', label: 'TA sistólica', unit: 'mmHg', kind: 'number', min: 0, max: 300 },
  { key: 'ta_dia', label: 'TA diastólica', unit: 'mmHg', kind: 'number', min: 0, max: 250 },
  { key: 'fr', label: 'FR', unit: 'rpm', kind: 'number', min: 0, max: 80 },
  { key: 'temp', label: 'Temperatura', unit: '°C', kind: 'number', min: 25, max: 45, requires: 'Temp' },
];

/**
 * Monitoring rows, each with its own space (item 6). EKG, SpO₂ and O₂ are always shown; the rest
 * appear when their monitor is selected (or already hold data). POCUS replaces PVC (item 10).
 */
export const MONITOR_LANES: readonly LaneDef[] = [
  // EKG text row retired (clinician feedback 2026-11b, item 5): kept for cases that hold values
  { key: 'ekg', label: 'EKG', kind: 'text', legacyOnly: true },
  { key: 'spo2', label: 'SpO₂', unit: '%', kind: 'number', min: 0, max: 100 },
  { key: 'o2', label: 'O₂', unit: '%', kind: 'number', min: 0, max: 100 },
  { key: 'etco2', label: 'EtCO₂', unit: 'mmHg', kind: 'number', min: 0, max: 150, requires: 'EtCO2' },
  { key: 'pocus', label: 'POCUS', kind: 'text', requires: 'POCUS' },
  { key: 'bis', label: 'BIS', kind: 'number', min: 0, max: 100, requires: 'BIS' },
  { key: 'entropia', label: 'Entropía', kind: 'number', min: 0, max: 100, requires: 'Entropía' },
  { key: 'nindex', label: 'NINDEX', kind: 'number', min: 0, max: 100, requires: 'NINDEX' },
  { key: 'tnm', label: 'TNM (TOF)', unit: '%', kind: 'number', min: 0, max: 100, requires: 'TNM' },
  { key: 'neuromonitoreo', label: 'Neuromonitorización', kind: 'text', requires: 'Neuromonitorización' },
];

export const INHALED_PREFIX = 'inhalado:';
export const FLUID_PREFIX = 'fluido:';

/**
 * Inhaled anesthetics, concentration in % (item 7). Only sevoflurane is on the market
 * (clinician feedback 2026-11b, item 12); a case holding another agent keeps and prints it.
 */
export const INHALED_AGENTS = ['Sevoflurano'] as const;
export const MAX_INHALED = 1;

/** IV fluids by full name, never abbreviated (item 8). The printed record has 5 rows. */
export const FLUIDS: readonly { group: string; names: readonly string[] }[] = [
  {
    group: 'Cristaloides',
    names: [
      'Ringer lactato',
      'Solución fisiológica 0,9 %',
      'Solución glucosada 5 %',
      'Solución glucosada 10 %',
      'Solución mixta (glucosalina)',
      'Plasma-Lyte',
      'Solución salina hipertónica 3 %',
      'Bicarbonato de sodio',
      'Manitol 20 %',
    ],
  },
  {
    group: 'Coloides',
    names: ['Gelatina succinilada', 'Hidroxietilalmidón', 'Albúmina 5 %', 'Albúmina 20 %'],
  },
  {
    group: 'Hemocomponentes',
    names: ['Concentrado globular', 'Plasma fresco congelado', 'Concentrado plaquetario', 'Crioprecipitado'],
  },
];
export const MAX_FLUIDS = 5;

/** Surgical event markers 1–6 (the printed legend). */
export const EVENT_MARKERS = [
  { marker: 1, label: 'Ingresa a quirófano' },
  { marker: 2, label: 'Inicia anestesia' },
  { marker: 3, label: 'Incisión quirúrgica' },
  { marker: 4, label: 'Termina cirugía' },
  { marker: 5, label: 'Termina anestesia' },
  { marker: 6, label: 'Sale de quirófano' },
] as const;

/** Ventilation mode over time (item 7 of 2026-11b): printed as a stepped line. */
export const VENTILATION_LANE = 'ventilacion';
export const VENTILATION_MODES = ['Controlada', 'Asistida', 'Espontánea'] as const;

/** Five one-hour blocks on the printed record. */
export const GRID_MAX_MIN = 300;
export const DEFAULT_COLUMNS = 12; // one hour

export type CellValue = number | string | null;

export const intervalOf = (tr: TransanestheticRecord) => (tr.intervalo_min > 0 ? tr.intervalo_min : 5);

export function laneDef(key: string): LaneDef | undefined {
  return [...VITAL_LANES, ...MONITOR_LANES].find((l) => l.key === key);
}

/** Lane keys of the named rows (inhaled agents or fluids), in the order they were added. */
export function namedLanes(tr: TransanestheticRecord, prefix: string): string[] {
  return tr.series.filter((s) => s.lane.startsWith(prefix)).map((s) => s.lane.slice(prefix.length));
}

/** Monitor rows on screen: always-on rows, selected monitors, and any row that holds data. */
export function visibleMonitorLanes(tr: TransanestheticRecord): LaneDef[] {
  const has = new Set(tr.series.filter((s) => s.points.length > 0).map((s) => s.lane));
  return MONITOR_LANES.filter((l) =>
    l.legacyOnly ? has.has(l.key) : !l.requires || tr.monitoring[l.requires] === true || has.has(l.key),
  );
}

export function visibleVitalLanes(tr: TransanestheticRecord): LaneDef[] {
  const has = new Set(tr.series.filter((s) => s.points.length > 0).map((s) => s.lane));
  return VITAL_LANES.filter((l) => !l.requires || tr.monitoring[l.requires] === true || has.has(l.key));
}

export function cell(tr: TransanestheticRecord, lane: string, t: number): CellValue {
  const p = tr.series.find((s) => s.lane === lane)?.points.find((x) => x.t === t);
  return p === undefined ? null : p.value;
}

/** Write one cell; clearing removes the point (and the lane once it has no points). */
export function setCell(tr: TransanestheticRecord, lane: string, t: number, v: CellValue): void {
  const empty = v === null || (typeof v === 'string' && v.trim() === '');
  let s = tr.series.find((x) => x.lane === lane);
  if (empty) {
    if (!s) return;
    s.points = s.points.filter((p) => p.t !== t);
    if (s.points.length === 0 && !isNamed(lane)) tr.series = tr.series.filter((x) => x !== s);
    return;
  }
  if (!s) {
    s = { lane, points: [] };
    tr.series.push(s);
  }
  const p = s.points.find((x) => x.t === t);
  if (p) p.value = v;
  else s.points.push({ t, value: v });
  s.points.sort((a, b) => a.t - b.t);
}

const isNamed = (lane: string) => lane.startsWith(INHALED_PREFIX) || lane.startsWith(FLUID_PREFIX);

/** Add an (empty) inhaled-agent or fluid row; no-op if that name is already a row. */
export function addNamedLane(tr: TransanestheticRecord, prefix: string, name: string): void {
  const lane = prefix + name;
  if (!tr.series.some((s) => s.lane === lane)) tr.series.push({ lane, points: [] });
}

/** Change the agent / fluid of a row, keeping its values (refused if the new name is taken). */
export function renameNamedLane(tr: TransanestheticRecord, prefix: string, from: string, to: string): boolean {
  if (from === to || tr.series.some((s) => s.lane === prefix + to)) return false;
  const s = tr.series.find((x) => x.lane === prefix + from);
  if (!s) return false;
  s.lane = prefix + to;
  return true;
}

export function removeLane(tr: TransanestheticRecord, lane: string): void {
  tr.series = tr.series.filter((s) => s.lane !== lane);
}

export function eventAt(tr: TransanestheticRecord, t: number): SurgicalEvent | undefined {
  return tr.events.find((e) => e.t === t);
}

/** One event per column; a marker is moved if it was already placed elsewhere. */
export function setEvent(tr: TransanestheticRecord, t: number, marker: number | null): void {
  tr.events = tr.events.filter((e) => e.t !== t && (marker === null || e.marker !== marker));
  if (marker !== null) {
    const label = EVENT_MARKERS.find((m) => m.marker === marker)?.label ?? '';
    tr.events.push({ marker, t, label });
    tr.events.sort((a, b) => a.t - b.t);
  }
}

/** Number of columns to show: one hour at least, and always one empty column after the last value. */
export function columnCount(tr: TransanestheticRecord, extra = 0): number {
  const step = intervalOf(tr);
  const last = Math.max(-1, ...tr.series.flatMap((s) => s.points.map((p) => p.t)), ...tr.events.map((e) => e.t));
  const used = last < 0 ? 0 : Math.floor(last / step) + 2;
  return Math.min(Math.max(DEFAULT_COLUMNS, used) + extra, Math.floor(GRID_MAX_MIN / step));
}

/** Column header: clock time when the grid start is set ("08:05"), else "+5 min". */
export function columnLabel(inicio: string | null, t: number): string {
  if (inicio) {
    const d = new Date(new Date(inicio).getTime() + t * 60_000);
    if (!Number.isNaN(d.getTime())) {
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
  }
  return `+${t} min`;
}

/** Minutes from the grid start to an ISO time, or null. */
export function minutesFrom(inicio: string | null, at: string | null): number | null {
  if (!inicio || !at) return null;
  const m = (new Date(at).getTime() - new Date(inicio).getTime()) / 60_000;
  return Number.isFinite(m) ? m : null;
}

/** Drug-ledger row letters per grid column: the column of each start; an infusion fills to its end. */
export function drugMarks(
  tr: TransanestheticRecord,
  drugs: readonly DrugAdministration[],
  letter: (i: number) => string,
): Map<number, string[]> {
  const step = intervalOf(tr);
  const marks = new Map<number, string[]>();
  const add = (t: number, s: string) => marks.set(t, [...(marks.get(t) ?? []), s]);
  drugs.forEach((d, i) => {
    const start = minutesFrom(tr.inicio, d.time);
    if (start === null || start < 0 || start >= GRID_MAX_MIN || d.farmaco.trim() === '') return;
    const col = Math.floor(start / step) * step;
    add(col, letter(i));
    if (d.modo === 'infusion') {
      const end = minutesFrom(tr.inicio, d.fin);
      const last = Math.min(end ?? col + step, GRID_MAX_MIN - step);
      for (let t = col + step; t <= last; t += step) add(t, '—');
    }
  });
  return marks;
}

/**
 * Columns whose blood pressure is still missing (the "presiones pendientes" reminder): from the
 * first column with a vital sign or event up to the column of `now`, stopping at the end of
 * anesthesia (event 5). Needs the grid start time.
 */
export function pendingPressures(tr: TransanestheticRecord, now: number): number[] {
  if (!tr.inicio) return [];
  const step = intervalOf(tr);
  const elapsed = (now - new Date(tr.inicio).getTime()) / 60_000;
  if (!Number.isFinite(elapsed) || elapsed < 0) return [];
  const vitals = tr.series.filter((s) => ['fc', 'ta_sys', 'ta_dia', 'spo2', 'fr'].includes(s.lane));
  const firsts = [...vitals.flatMap((s) => s.points.map((p) => p.t)), ...tr.events.map((e) => e.t)];
  if (firsts.length === 0) return [];
  const from = Math.min(...firsts);
  const endEv = tr.events.find((e) => e.marker === 5)?.t;
  const to = Math.min(Math.floor(elapsed / step) * step, endEv ?? Infinity, GRID_MAX_MIN - step);
  const out: number[] = [];
  for (let t = Math.floor(from / step) * step; t <= to; t += step) {
    if (cell(tr, 'ta_sys', t) === null) out.push(t);
  }
  return out;
}
