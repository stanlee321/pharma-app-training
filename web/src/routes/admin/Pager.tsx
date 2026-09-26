import { formatCount } from '../../lib/wording';
import { pageCount, rangeLabel } from './paging';

/**
 * Previous / Next paging under an admin table: "26–50 of 73 · Page 2 of 3". The page lives in
 * the URL (`?page=`), so the caller maps `onPage` to a search-param update.
 */
export function Pager({
  page,
  pageSize,
  total,
  shown,
  label,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  shown: number;
  /** What the rows are (accessible name of the nav), e.g. "Cases pages". */
  label: string;
  onPage: (page: number) => void;
}) {
  const pages = pageCount(total, pageSize);
  const offset = (page - 1) * pageSize;
  return (
    <nav className="admin-pager" aria-label={label}>
      <span className="admin-pager__range" aria-live="polite">
        {rangeLabel(offset, shown, total)}
        <span className="admin-pager__page"> · Página {formatCount(page)} de {formatCount(pages)}</span>
      </span>
      <span className="admin-pager__buttons">
        <button type="button" className="btn-plain" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ‹ Anterior
        </button>
        <button type="button" className="btn-plain" disabled={offset + shown >= total} onClick={() => onPage(page + 1)}>
          Siguiente ›
        </button>
      </span>
    </nav>
  );
}
