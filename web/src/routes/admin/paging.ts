import { formatCount } from '../../lib/wording';

/** Paging + URL-filter helpers shared by the admin tables (`/admin/cases`, `/admin/documents`). */

/** Rows per page (the server allows 1–200). */
export const PAGE_SIZE = 25;

/** 1-based page from `?page=` (anything invalid → 1). */
export function pageFrom(sp: URLSearchParams): number {
  const raw = sp.get('page');
  if (!raw || !/^\d+$/.test(raw)) return 1;
  const n = Number(raw);
  return n >= 1 && Number.isSafeInteger(n) ? n : 1;
}

export const offsetOf = (page: number, size = PAGE_SIZE) => (page - 1) * size;

/** "26–50 de 73" (or "0 de 0"), es-MX numbers. */
export function rangeLabel(offset: number, shown: number, total: number): string {
  if (shown === 0) return `0 de ${formatCount(total)}`;
  return `${formatCount(offset + 1)}–${formatCount(offset + shown)} de ${formatCount(total)}`;
}

export const pageCount = (total: number, size = PAGE_SIZE) => Math.max(1, Math.ceil(total / size));

/**
 * A copy of `sp` with `name` set (or removed when empty). Changing a filter always goes back to
 * page 1, since the old page may not exist under the new filter.
 */
export function withParam(sp: URLSearchParams, name: string, value: string): URLSearchParams {
  const next = new URLSearchParams(sp);
  if (value) next.set(name, value);
  else next.delete(name);
  if (name !== 'page') next.delete('page');
  return next;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A `YYYY-MM-DD` calendar day that exists, else ''. */
export function isoDay(v: string | null): string {
  if (!v || !ISO_DAY.test(v)) return '';
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== v ? '' : v;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The server only accepts UUIDs for case/document ids (else 422). */
export const isUuid = (v: string) => UUID.test(v.trim());

/**
 * The last query string of the admin case list, so "‹ Cases" from a case (and after a delete)
 * returns to the same filtered page. In memory only, and cleared on sign-out: the free-text `q=`
 * filter can hold a patient name.
 */
let lastCasesSearch = '';
export function rememberCasesSearch(search: string): void {
  lastCasesSearch = search;
}
/** Forget the remembered filters (sign-out: a `q=` may hold a patient name). */
export function forgetCasesSearch(): void {
  lastCasesSearch = '';
}
export function casesListUrl(base: string): string {
  return `${base}${lastCasesSearch}`;
}
