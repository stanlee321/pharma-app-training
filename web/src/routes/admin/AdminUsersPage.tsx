import { useId } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { adminApi, type UserFilters } from '../../api/adminApi';
import { ROLE_LABELS, type UserRole } from '../../api/types';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { Section } from '../../components/Section';
import { formatDateTime } from '../../lib/datetime';
import { paths } from '../paths';
import { AccountBadges, InlineAlert, LoadError, LoadingRow, RoleBadge } from './adminUi';
import { useQuery } from './useQuery';
import { useUrlText } from './useUrlText';

/** Location state a user page leaves behind (e.g. after a delete). */
export interface UsersNotice {
  notice?: string;
}

/** Filters live in the URL (`?q=&role=&active=`) so Back and reload keep them. */
function filtersFrom(sp: URLSearchParams): UserFilters {
  const role = sp.get('role');
  const active = sp.get('active');
  return {
    q: sp.get('q') ?? '',
    role: role === 'admin' || role === 'anesthesiologist' ? role : '',
    is_active: active === 'true' ? true : active === 'false' ? false : '',
  };
}

/**
 * Users (`GET /admin/users`): search (username, full name or clave), role and active filters, and
 * the account table; each row opens the account. "New user" creates one.
 */
export function AdminUsersPage() {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const notice = (location.state as UsersNotice | null)?.notice;
  const f = filtersFrom(sp);
  const key = `${f.q}|${f.role}|${String(f.is_active)}`;
  const q = useQuery(key, () => adminApi.listUsers(f));
  // Debounced search ↔ URL (re-synced on Back / Forward).
  const [search, setSearch] = useUrlText(sp, setSp, 'q');
  const searchId = useId();
  const roleId = useId();
  const activeId = useId();

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(sp);
    if (value) next.set(name, value);
    else next.delete(name);
    setSp(next, { replace: true, state: location.state });
  };

  const filtered = !!(f.q || f.role || f.is_active !== '');
  const users = q.data;

  return (
    <>
      <div className="admin-head">
        <h1 className="large-title">Users</h1>
        <Link to={paths.admin.newUser} className="btn-primary btn-primary--compact admin-head__action">
          <Icon name="plus" size={18} />
          New user
        </Link>
      </div>

      {notice ? (
        <InlineAlert tone="success">
          <span>{notice}</span>{' '}
          <button
            type="button"
            className="btn-plain"
            onClick={() => navigate(location, { replace: true, state: null })}
          >
            Dismiss
          </button>
        </InlineAlert>
      ) : null}

      <form className="admin-filters" role="search" aria-label="Filter users" onSubmit={(e) => e.preventDefault()}>
        <div className="admin-filter admin-filter--grow">
          <label htmlFor={searchId}>Search</label>
          <input
            id={searchId}
            type="search"
            value={search}
            placeholder="Username, name or clave"
            autoComplete="off"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="admin-filter">
          <label htmlFor={roleId}>Role</label>
          <select id={roleId} value={f.role ?? ''} onChange={(e) => setParam('role', e.target.value)}>
            <option value="">All roles</option>
            {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div className="admin-filter">
          <label htmlFor={activeId}>Status</label>
          <select id={activeId} value={String(f.is_active)} onChange={(e) => setParam('active', e.target.value)}>
            <option value="">Any status</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
      </form>

      <Section
        header={
          users
            ? `${users.length} ${users.length === 1 ? 'account' : 'accounts'}${filtered ? ' (filtered)' : ''}`
            : 'Accounts'
        }
      >
        {!users ? (
          q.status === 'error' ? (
            <LoadError title="Couldn’t load users" error={q.error} onRetry={q.reload} />
          ) : (
            <LoadingRow label="Loading users…" />
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
            {users.length === 0 ? (
              <EmptyState
                icon="person"
                title={filtered ? 'No matching accounts' : 'No accounts yet'}
                description={
                  filtered ? 'Try another search or clear the filters.' : 'Create the first account with New user.'
                }
              />
            ) : (
              <div className="admin-table-scroll">
                <table className="admin-table">
                  <caption className="visually-hidden">Accounts</caption>
                  <thead>
                    <tr>
                      <th scope="col">Account</th>
                      <th scope="col" className="hide-narrow">
                        Clave
                      </th>
                      <th scope="col">Role</th>
                      <th scope="col">Status</th>
                      <th scope="col" className="hide-narrow">
                        Last sign-in
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id} className={u.is_active ? undefined : 'admin-table__row--muted'}>
                        <th scope="row">
                          <Link to={paths.admin.user(u.id)} className="admin-table__link">
                            {u.full_name.trim() || u.username}
                          </Link>
                          <span className="admin-table__sub">{u.username}</span>
                        </th>
                        <td className="hide-narrow">{u.clave || '—'}</td>
                        <td>
                          <RoleBadge role={u.role} />
                        </td>
                        <td>
                          <span className="admin-badges">
                            <AccountBadges user={u} />
                          </span>
                        </td>
                        <td className="hide-narrow">{formatDateTime(u.last_login_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Section>
    </>
  );
}
