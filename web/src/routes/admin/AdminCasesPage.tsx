import { useEffect, useId } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { adminApi, type CaseFilters } from '../../api/adminApi';
import { STATUS_LABELS, type AdminCasePage, type CaseStatus, type UserDTO } from '../../api/types';
import { EmptyState } from '../../components/EmptyState';
import { Section } from '../../components/Section';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDateTime } from '../../lib/datetime';
import { paths } from '../paths';
import { InlineAlert, LoadError, LoadingRow } from './adminUi';
import { Pager } from './Pager';
import { isoDay, offsetOf, PAGE_SIZE, pageFrom, rememberCasesSearch, withParam } from './paging';
import { useQuery } from './useQuery';
import { useUrlText } from './useUrlText';

/** Location state left by a case page (e.g. after a delete). */
export interface CasesNotice {
  notice?: string;
}

interface UrlFilters {
  status: CaseStatus | '';
  user_id: string;
  q: string;
  date_from: string;
  date_to: string;
  page: number;
}

/** Filters live in the URL (`?status=&user_id=&q=&date_from=&date_to=&page=`): links, Back and reload keep them. */
function filtersFrom(sp: URLSearchParams): UrlFilters {
  const status = sp.get('status');
  return {
    status: status === 'draft' || status === 'finalized' ? status : '',
    user_id: sp.get('user_id') ?? '',
    q: sp.get('q') ?? '',
    date_from: isoDay(sp.get('date_from')),
    date_to: isoDay(sp.get('date_to')),
    page: pageFrom(sp),
  };
}

const ownerLabel = (u: Pick<UserDTO, 'full_name' | 'username'>) =>
  u.full_name.trim() ? `${u.full_name.trim()} (${u.username})` : u.username;

/**
 * Cases (`GET /admin/cases`): every anesthesiologist's cases, newest first, filterable by status,
 * anesthesiologist, created-date range (inclusive UTC days) and free text, paginated. Each row
 * opens the read-only case view. The dashboard's per-anesthesiologist links land here with
 * `?user_id=`.
 */
export function AdminCasesPage() {
  const [sp, setSp] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const notice = (location.state as CasesNotice | null)?.notice;
  const f = filtersFrom(sp);
  const [search, setSearch] = useUrlText(sp, setSp, 'q');
  const badRange = !!(f.date_from && f.date_to && f.date_from > f.date_to);
  const ids = { q: useId(), status: useId(), owner: useId(), from: useId(), to: useId() };

  useEffect(() => {
    rememberCasesSearch(location.search);
  }, [location.search]);

  const query: CaseFilters = {
    status: f.status,
    user_id: f.user_id,
    q: f.q,
    date_from: f.date_from,
    date_to: f.date_to,
    limit: PAGE_SIZE,
    offset: offsetOf(f.page),
  };
  const key = JSON.stringify(query) + (badRange ? '!' : '');
  // An impossible date range is reported locally (the server would 422) and not requested.
  const q = useQuery<AdminCasePage | null>(key, () => (badRange ? Promise.resolve(null) : adminApi.listCases(query)));
  // Only anesthesiologists own cases; an unknown ?user_id= still gets its own "Account …" option.
  const owners = useQuery('owners', () => adminApi.listUsers({ role: 'anesthesiologist' }));

  const set = (name: string, value: string) => setSp(withParam(sp, name, value), { replace: true });
  const goPage = (page: number) => setSp(withParam(sp, 'page', page > 1 ? String(page) : ''));
  const filtered = !!(f.status || f.user_id || f.q || f.date_from || f.date_to);

  const ownerOptions = [...(owners.data ?? [])].sort((a, b) => ownerLabel(a).localeCompare(ownerLabel(b)));
  const knownOwner = !f.user_id || ownerOptions.some((u) => u.id === f.user_id);

  const page = q.data ?? undefined;

  return (
    <>
      <div className="admin-head">
        <h1 className="large-title">Cases</h1>
      </div>

      {notice ? (
        <InlineAlert tone="success">
          <span>{notice}</span>{' '}
          <button type="button" className="btn-plain" onClick={() => navigate(location, { replace: true, state: null })}>
            Dismiss
          </button>
        </InlineAlert>
      ) : null}

      <form className="admin-filters" role="search" aria-label="Filter cases" onSubmit={(e) => e.preventDefault()}>
        <div className="admin-filter admin-filter--grow">
          <label htmlFor={ids.q}>Search</label>
          <input
            id={ids.q}
            type="search"
            value={search}
            placeholder="Patient, registro, diagnosis, owner, case id"
            autoComplete="off"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="admin-filter">
          <label htmlFor={ids.status}>Status</label>
          <select id={ids.status} value={f.status} onChange={(e) => set('status', e.target.value)}>
            <option value="">Any status</option>
            {(Object.keys(STATUS_LABELS) as CaseStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="admin-filter">
          <label htmlFor={ids.owner}>Anesthesiologist</label>
          <select id={ids.owner} value={f.user_id} onChange={(e) => set('user_id', e.target.value)}>
            <option value="">Everyone</option>
            {knownOwner ? null : <option value={f.user_id}>Account {f.user_id.slice(0, 8)}…</option>}
            {ownerOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {ownerLabel(u)}
              </option>
            ))}
          </select>
        </div>
        <div className="admin-filter">
          <label htmlFor={ids.from}>Created from</label>
          <input
            id={ids.from}
            type="date"
            value={f.date_from}
            max={f.date_to || undefined}
            aria-invalid={badRange || undefined}
            onChange={(e) => set('date_from', isoDay(e.target.value))}
          />
        </div>
        <div className="admin-filter">
          <label htmlFor={ids.to}>Created to</label>
          <input
            id={ids.to}
            type="date"
            value={f.date_to}
            min={f.date_from || undefined}
            aria-invalid={badRange || undefined}
            onChange={(e) => set('date_to', isoDay(e.target.value))}
          />
        </div>
        {filtered ? (
          <button
            type="button"
            className="btn-plain admin-filters__clear"
            onClick={() => {
              setSearch('');
              setSp(new URLSearchParams(), { replace: true });
            }}
          >
            Clear filters
          </button>
        ) : null}
      </form>

      {badRange ? (
        <InlineAlert>“Created from” is after “Created to”. Pick a start day on or before the end day.</InlineAlert>
      ) : null}

      <Section
        header={
          page
            ? `${page.total.toLocaleString('en-US')} ${page.total === 1 ? 'case' : 'cases'}${filtered ? ' (filtered)' : ''}`
            : 'Cases'
        }
        footer="Dates are UTC calendar days of creation, inclusive."
      >
        {badRange ? (
          <EmptyState icon="warning" title="Invalid date range" description="No cases were requested." />
        ) : !page ? (
          q.status === 'error' ? (
            <LoadError title="Couldn’t load cases" error={q.error} onRetry={q.reload} />
          ) : (
            <LoadingRow label="Loading cases…" />
          )
        ) : (
          <div className={q.status === 'loading' ? 'admin-refetching' : undefined} aria-busy={q.status === 'loading'}>
            {q.status === 'error' ? (
              <InlineAlert>
                Couldn’t refresh: {q.error}{' '}
                <button type="button" className="btn-plain" onClick={q.reload}>
                  Retry
                </button>
              </InlineAlert>
            ) : null}
            {page.items.length === 0 ? (
              page.total > 0 ? (
                <EmptyState
                  icon="tray"
                  title="This page is empty"
                  description={`There are only ${page.total} matching cases.`}
                  action={
                    <button type="button" className="btn-plain" onClick={() => goPage(1)}>
                      Go to the first page
                    </button>
                  }
                />
              ) : (
                <EmptyState
                  icon="tray"
                  title={filtered ? 'No matching cases' : 'No cases yet'}
                  description={
                    filtered
                      ? 'Try another search or clear the filters.'
                      : 'Cases appear here once an anesthesiologist creates one.'
                  }
                />
              )
            ) : (
              <>
                <div className="admin-table-scroll">
                  <table className="admin-table">
                    <caption className="visually-hidden">Cases</caption>
                    <thead>
                      <tr>
                        <th scope="col">Patient</th>
                        <th scope="col">Anesthesiologist</th>
                        <th scope="col">Status</th>
                        <th scope="col" className="hide-narrow">
                          Created
                        </th>
                        <th scope="col" className="hide-narrow">
                          Updated
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.items.map((c) => (
                        <tr key={c.id} data-testid="case-row" data-case-id={c.id}>
                          <th scope="row">
                            <Link to={paths.admin.case(c.id)} className="admin-table__link">
                              {c.nombre.trim() || 'Sin nombre'}
                            </Link>
                            <span className="admin-table__sub">{c.diagnostico_preop.trim() || '—'}</span>
                          </th>
                          <td>
                            {c.owner_name?.trim() || c.owner || '—'}
                            {c.user_id && !f.user_id ? (
                              <Link to={paths.admin.casesFor(c.user_id)} className="admin-table__sub">
                                Only this anesthesiologist
                              </Link>
                            ) : null}
                          </td>
                          <td>
                            <StatusBadge status={c.status ?? 'draft'} />
                          </td>
                          <td className="hide-narrow">{formatDateTime(c.created_at)}</td>
                          <td className="hide-narrow">{formatDateTime(c.updated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {page.total > 0 ? (
              <Pager
                page={f.page}
                pageSize={PAGE_SIZE}
                total={page.total}
                shown={page.items.length}
                label="Case pages"
                onPage={goPage}
              />
            ) : null}
          </div>
        )}
      </Section>
    </>
  );
}
