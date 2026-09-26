import { plural } from '../../lib/wording';

/** Pure helpers of the cases-per-day chart (kept apart so the component file only exports components). */

export interface DayCount {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  count: number;
}

const DAY_MS = 86_400_000;
const utcDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * The series in date order with any missing day between the first and the last filled with 0.
 * The server already zero-fills its 30 days; this keeps the chart honest if it ever does not
 * (and never trusts the array order).
 */
export function normalizeDays(days: readonly DayCount[]): DayCount[] {
  const valid = days.filter((d) => !Number.isNaN(utcDay(d.date)));
  if (valid.length === 0) return [];
  const byDay = new Map<number, number>();
  for (const d of valid) byDay.set(utcDay(d.date), (byDay.get(utcDay(d.date)) ?? 0) + Math.max(0, d.count));
  const ts = [...byDay.keys()].sort((a, b) => a - b);
  const out: DayCount[] = [];
  for (let t = ts[0]!; t <= ts[ts.length - 1]!; t += DAY_MS) out.push({ date: isoDay(t), count: byDay.get(t) ?? 0 });
  return out;
}

/** "25 sep" (the day is a UTC calendar day: format it in UTC so no time zone shifts it). */
export function shortDay(iso: string): string {
  return new Date(utcDay(iso)).toLocaleDateString('es-MX', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
export function longDay(iso: string): string {
  return new Date(utcDay(iso)).toLocaleDateString('es-MX', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
export const casesLabel = (n: number) => plural(n, 'caso', 'casos');

/** Clean integer axis: a 1/2/5×10ⁿ step giving at most 4 intervals above 0. */
export function niceAxis(max: number): { top: number; step: number } {
  if (!(max > 0)) return { top: 1, step: 1 };
  for (let mag = 1; ; mag *= 10) {
    for (const m of [1, 2, 5]) {
      const step = m * mag;
      if (Math.ceil(max / step) <= 4) return { top: step * Math.ceil(max / step), step };
    }
  }
}

/** Rendered height of the chart tooltip (2 text lines + padding), for its above/below flip. */
export const TOOLTIP_H = 48;
