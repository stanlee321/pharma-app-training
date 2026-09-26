const pad = (n: number) => String(n).padStart(2, '0');

/** ISO-8601 instant → `<input type="datetime-local">` value in the viewer's local time ('' if none/invalid). */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` value (local time) → ISO-8601 UTC string, or null when cleared/invalid. */
export function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const esDateTime = new Intl.DateTimeFormat('es-MX', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const esTime = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** ISO instant → short local date + time for lists, es-MX ("25/09/2026, 14:03"; "—" if none/invalid). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return esDateTime.format(d);
}

/** ISO instant → local time of day, es-MX 24 h ("14:03"; "—" if none/invalid). */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : esTime.format(d);
}

const esDate = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

/** ISO instant → local date in Spanish (es-MX), e.g. "25 sept 2026" ("—" if none/invalid). */
export function formatDateEs(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : esDate.format(d);
}

/** A calendar date (`YYYY-MM-DD`, e.g. fecha de nacimiento) in Spanish, with no timezone shift. */
export function formatCalendarDateEs(ymd: string | null | undefined): string {
  const m = ymd ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd) : null;
  if (!m) return '—';
  return esDate.format(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Today as a local `YYYY-MM-DD` (the `max` of a birth-date input). */
export function todayYmd(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
