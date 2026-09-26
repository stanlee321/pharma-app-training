import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { adminApi } from '../../api/adminApi';
import { BackendError, errorMessage } from '../../api/backend';
import { ROLE_LABELS, type AdminUserUpdate, type UserDTO, type UserRole } from '../../api/types';
import { SegmentedControl, ToggleRow } from '../../components/Choice';
import { TextRow } from '../../components/FormRows';
import { Section } from '../../components/Section';
import { formatDateTime } from '../../lib/datetime';
import {
  CLAVE_MAX,
  FULL_NAME_MAX,
  fieldErrors,
  generateTempPassword,
  guardMessage,
  maxLengthProblem,
  ownsCases,
  passwordProblem,
  type AccountField,
} from '../../lib/accounts';
import { useAuthStore } from '../../state/authStore';
import { paths } from '../paths';
import type { UsersNotice } from './AdminUsersPage';
import { AccountBadges, InlineAlert, LoadError, LoadingRow, RoleBadge } from './adminUi';
import { OneTimeSecret } from './OneTimeSecret';
import { PasswordField } from './PasswordField';
import { useQuery } from './useQuery';

const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as UserRole[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }));

/**
 * One account (`/admin/users/:id`): edit (full name, clave, role, active), reset the password
 * (new temporary password shown once), delete (a 409 "owns cases" offers Deactivate instead).
 * The server's user guards (yourself / the last active admin, 409) are shown inline on the action
 * that hit them; your own role, active flag, password reset and delete are not offered at all.
 */
export function AdminUserPage() {
  const { id = '' } = useParams();
  const q = useQuery(`user:${id}`, () => adminApi.getUser(id));
  const me = useAuthStore((s) => s.user);
  const user = q.data;

  if (!user) {
    const notFound = q.status === 'error' && q.error != null && /not found/i.test(q.error);
    return (
      <>
        <Crumb />
        <h1 className="large-title">Account</h1>
        <section className="section">
          <div className="section__card">
            {q.status === 'error' ? (
              <LoadError
                title={notFound ? 'Account not found' : 'Couldn’t load the account'}
                error={q.error}
                onRetry={q.reload}
              />
            ) : (
              <LoadingRow label="Loading account…" />
            )}
          </div>
        </section>
      </>
    );
  }

  const isSelf = me?.id === user.id;
  return (
    <>
      <Crumb />
      <div className="admin-head">
        <h1 className="large-title">{user.full_name.trim() || user.username}</h1>
      </div>
      <p className="admin-user-meta">
        <span className="admin-user-meta__name">{user.username}</span>
        <span className="admin-badges">
          <RoleBadge role={user.role} />
          <AccountBadges user={user} />
          {isSelf ? <span className="status-badge admin-badge--self">You</span> : null}
        </span>
      </p>
      <p className="admin-user-dates">
        Created {formatDateTime(user.created_at)} · Last sign-in {formatDateTime(user.last_login_at)}
      </p>

      <EditAccount
        user={user}
        isSelf={isSelf}
        onSaved={(saved) => {
          q.setData(saved);
          // Your own account: keep the header / user menu (and the persisted session) current.
          if (saved.id === me?.id) useAuthStore.getState().setUser(saved);
        }}
      />
      {isSelf ? (
        <Section header="Your own account">
          <p className="admin-card-note">
            You can’t demote, deactivate, reset or delete your own account here. Use <strong>Change password</strong> in
            the account menu to change your password.
          </p>
        </Section>
      ) : (
        <>
          <ResetPassword user={user} onReset={() => q.setData({ ...user, must_change_password: true })} />
          <DeleteAccount user={user} onChanged={q.setData} />
        </>
      )}
    </>
  );
}

function Crumb() {
  return (
    <p className="admin-crumb">
      <Link to={paths.admin.users}>‹ Users</Link>
    </p>
  );
}

// ---- edit ---------------------------------------------------------------------------------

function EditAccount({ user, isSelf, onSaved }: { user: UserDTO; isSelf: boolean; onSaved: (u: UserDTO) => void }) {
  const [fullName, setFullName] = useState(user.full_name);
  const [clave, setClave] = useState(user.clave);
  const [role, setRole] = useState<UserRole>(user.role);
  const [active, setActive] = useState(user.is_active);
  const [errors, setErrors] = useState<Partial<Record<AccountField, string>>>({});
  const [result, setResult] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // The account changed on the server side of this page (saved, deactivated): show its values.
  useEffect(() => {
    setFullName(user.full_name);
    setClave(user.clave);
    setRole(user.role);
    setActive(user.is_active);
  }, [user]);

  const patch: AdminUserUpdate = {};
  if (fullName.trim() !== user.full_name) patch.full_name = fullName.trim();
  if (clave.trim() !== user.clave) patch.clave = clave.trim();
  if (role !== user.role) patch.role = role;
  if (active !== user.is_active) patch.is_active = active;
  const changed = Object.keys(patch).length > 0;

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy || !changed) return;
    const e: Partial<Record<AccountField, string>> = {};
    const n = maxLengthProblem(fullName, FULL_NAME_MAX);
    if (n) e.full_name = n;
    const c = maxLengthProblem(clave, CLAVE_MAX);
    if (c) e.clave = c;
    setErrors(e);
    setResult(null);
    if (Object.keys(e).length > 0) return;
    setBusy(true);
    try {
      const saved = await adminApi.updateUser(user.id, patch);
      setResult({ tone: 'success', text: 'Changes saved.' });
      onSaved(saved);
    } catch (err) {
      const guard = guardMessage(err);
      const fe = guard ? {} : fieldErrors(err);
      setErrors(fe);
      if (Object.keys(fe).length === 0) setResult({ tone: 'error', text: guard ?? errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={(e) => void submit(e)} aria-label="Edit account">
      <Section
        header="Account"
        footer={isSelf ? 'Your own role and active status can’t be changed (another admin must do it).' : undefined}
      >
        <TextRow label="Full name" value={fullName} onChange={setFullName} error={errors.full_name} />
        <TextRow label="Clave" value={clave} onChange={setClave} noAutoCorrect error={errors.clave} />
        <div className="row">
          {isSelf ? (
            <>
              <span className="row__label">Role</span>
              <RoleBadge role={user.role} />
            </>
          ) : (
            <SegmentedControl label="Role" showLabel options={ROLE_OPTIONS} value={role} onChange={setRole} />
          )}
        </div>
        <ToggleRow label="Active (can sign in)" checked={active} onChange={setActive} disabled={isSelf} />
      </Section>
      {result ? <InlineAlert tone={result.tone}>{result.text}</InlineAlert> : null}
      <div className="admin-form-actions">
        <button type="submit" className="btn-primary btn-primary--compact" disabled={!changed || busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  );
}

// ---- reset password ------------------------------------------------------------------------

function ResetPassword({ user, onReset }: { user: UserDTO; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The new temporary password: shown once. */
  const [issued, setIssued] = useState<string | null>(null);

  // A different account is shown (same component instance): forget any secret of the previous one.
  useEffect(() => {
    setIssued(null);
    setOpen(false);
  }, [user.id]);

  const start = () => {
    setPassword(generateTempPassword());
    setError(null);
    setOpen(true);
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    const p = passwordProblem(password);
    setError(p);
    if (p) return;
    setBusy(true);
    try {
      await adminApi.resetPassword(user.id, password);
      setIssued(password);
      setPassword('');
      setOpen(false);
      onReset();
    } catch (e) {
      setError(fieldErrors(e).password ?? errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (issued) {
    return (
      <OneTimeSecret title="Password reset" username={user.username} password={issued} onDone={() => setIssued(null)} />
    );
  }

  return (
    <Section
      header="Password"
      footer="Resetting signs them out everywhere; they must choose a new password at their next sign-in."
    >
      {open ? (
        <form noValidate onSubmit={(e) => void submit(e)} aria-label="Reset password">
          <PasswordField label="New temporary password" value={password} onChange={setPassword} error={error} />
          <div className="row admin-row-actions">
            <button type="button" className="btn-plain" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary btn-primary--compact" disabled={busy}>
              {busy ? 'Resetting…' : 'Reset password'}
            </button>
          </div>
        </form>
      ) : (
        <div className="row admin-row-actions">
          <span className="row__label">Issue a new temporary password</span>
          <button type="button" className="btn-plain" onClick={start}>
            Reset password…
          </button>
        </div>
      )}
    </Section>
  );
}

// ---- delete / deactivate ------------------------------------------------------------------

function DeleteAccount({ user, onChanged }: { user: UserDTO; onChanged: (u: UserDTO) => void }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Delete refused because the account owns cases: offer Deactivate. */
  const [owns, setOwns] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const doDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.deleteUser(user.id);
      navigate(paths.admin.users, { state: { notice: `Account ${user.username} deleted.` } satisfies UsersNotice });
    } catch (e) {
      setConfirming(false);
      if (ownsCases(e)) {
        setOwns(e instanceof BackendError ? e.detail : null);
      } else {
        setError(guardMessage(e) ?? errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await adminApi.updateUser(user.id, { is_active: false });
      setOwns(null);
      setDone(`${saved.username} was deactivated: they can no longer sign in, and their cases are kept.`);
      onChanged(saved);
    } catch (e) {
      setError(guardMessage(e) ?? errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const count = owns ? /owns (\d+)/.exec(owns)?.[1] : undefined;
  return (
    <Section header="Delete account">
      {done ? <InlineAlert tone="success">{done}</InlineAlert> : null}
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      {owns ? (
        <InlineAlert tone="info">
          <p className="admin-alert__p">
            {user.username} owns {count ? `${count} ${count === '1' ? 'case' : 'cases'}` : 'cases'}, so the account
            can’t be deleted (their clinical records must be kept).
            {user.is_active
              ? ' Deactivate it instead: they can no longer sign in, and their cases stay available.'
              : ' The account is already inactive.'}
          </p>
          {user.is_active ? (
            <p className="admin-alert__p">
              <button type="button" className="btn-destructive" disabled={busy} onClick={() => void deactivate()}>
                Deactivate instead
              </button>{' '}
              <button type="button" className="btn-plain" onClick={() => setOwns(null)}>
                Cancel
              </button>
            </p>
          ) : null}
        </InlineAlert>
      ) : null}
      {confirming ? (
        <div className="row admin-row-actions" role="group" aria-label={`Confirm deleting ${user.username}`}>
          <span className="row__label">Delete {user.username} permanently? This can’t be undone.</span>
          <button type="button" className="btn-plain" onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-destructive" onClick={() => void doDelete()} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      ) : (
        <div className="row admin-row-actions">
          <span className="row__label">Only accounts that own no cases can be deleted.</span>
          <button
            type="button"
            className="btn-plain btn-plain--destructive"
            onClick={() => {
              setConfirming(true);
              setError(null);
              setOwns(null);
            }}
          >
            Delete account…
          </button>
        </div>
      )}
    </Section>
  );
}
