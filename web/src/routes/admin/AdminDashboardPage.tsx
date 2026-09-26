import { Link } from 'react-router-dom';
import { adminApi } from '../../api/adminApi';
import type { AdminStatsDTO } from '../../api/types';
import { EmptyState } from '../../components/EmptyState';
import { Section } from '../../components/Section';
import { formatDateTime } from '../../lib/datetime';
import { paths } from '../paths';
import { LoadError, LoadingRow } from './adminUi';
import { CasesPerDayChart } from './CasesPerDayChart';
import { useQuery } from './useQuery';

const compact = (n: number) =>
  n >= 10_000
    ? n.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
    : n.toLocaleString('en-US');

/**
 * Admin dashboard (`GET /admin/stats`): stat tiles (cases, drafts, finalized, documents), the
 * 30-day cases-per-day chart and the per-anesthesiologist table, each row linking to the case
 * list filtered to that owner. `cases_by_status` is read by its known keys, never by key order.
 */
export function AdminDashboardPage() {
  const q = useQuery('stats', () => adminApi.stats());
  const stats = q.data;

  return (
    <>
      <div className="admin-head">
        <h1 className="large-title">Dashboard</h1>
        {stats ? (
          <button type="button" className="btn-plain" onClick={q.reload} disabled={q.status === 'loading'}>
            {q.status === 'loading' ? 'Refreshing…' : 'Refresh'}
          </button>
        ) : null}
      </div>

      {!stats ? (
        <Section>
          {q.status === 'error' ? (
            <LoadError title="Couldn’t load the dashboard" error={q.error} onRetry={q.reload} />
          ) : (
            <LoadingRow label="Loading dashboard…" />
          )}
        </Section>
      ) : (
        <div className={q.status === 'loading' ? 'admin-refetching' : undefined} aria-busy={q.status === 'loading'}>
          {q.status === 'error' ? (
            <div className="banner" role="alert">
              <span className="banner__text">Couldn’t refresh: {q.error}</span>
              <button type="button" className="btn-plain" onClick={q.reload}>
                Retry
              </button>
            </div>
          ) : null}
          <StatTiles stats={stats} />
          <Section header="Cases per day · last 30 days (UTC)">
            <div className="admin-card-pad">
              <CasesPerDayChart days={stats.cases_per_day} />
            </div>
          </Section>
          <PerUserTable stats={stats} />
        </div>
      )}
    </>
  );
}

function StatTiles({ stats }: { stats: AdminStatsDTO }) {
  const tiles = [
    { label: 'Cases', value: stats.cases_total },
    { label: 'Drafts', value: stats.cases_by_status.draft ?? 0 },
    { label: 'Finalized', value: stats.cases_by_status.finalized ?? 0 },
    { label: 'Documents', value: stats.documents_total },
  ];
  return (
    <ul className="stat-tiles" aria-label="Totals">
      {tiles.map((t) => (
        <li key={t.label} className="stat-tile">
          <span className="stat-tile__label">{t.label}</span>
          <span className="stat-tile__value">{compact(t.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function PerUserTable({ stats }: { stats: AdminStatsDTO }) {
  const rows = stats.per_user;
  return (
    <Section header="By anesthesiologist">
      {rows.length === 0 ? (
        <EmptyState
          icon="person"
          title="No anesthesiologists yet"
          description={
            <>
              <Link to={paths.admin.newUser}>Create an account</Link> to get started.
            </>
          }
        />
      ) : (
        <div className="admin-table-scroll">
          <table className="admin-table">
            <caption className="visually-hidden">Cases by anesthesiologist</caption>
            <thead>
              <tr>
                <th scope="col">Anesthesiologist</th>
                <th scope="col" className="num">
                  Drafts
                </th>
                <th scope="col" className="num">
                  Finalized
                </th>
                <th scope="col" className="hide-narrow">
                  Last activity
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.user_id}>
                  <th scope="row">
                    <Link to={paths.admin.casesFor(u.user_id)} className="admin-table__link">
                      {u.full_name.trim() || u.username}
                      <span className="visually-hidden"> — view cases</span>
                    </Link>
                    <span className="admin-table__sub">{u.username}</span>
                  </th>
                  <td className="num">{u.drafts}</td>
                  <td className="num">{u.finalized}</td>
                  <td className="hide-narrow">{formatDateTime(u.last_activity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
