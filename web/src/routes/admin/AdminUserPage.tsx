import { plural, UI } from '../../lib/wording';
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
    const notFound = q.status === 'error' && q.error != null && /no encontrad/i.test(q.error);
    return (
      <>
        <Crumb />
        <h1 className="large-title">Cuenta</h1>
        <section className="section">
          <div className="section__card">
            {q.status === 'error' ? (
              <LoadError
                title={notFound ? 'Cuenta no encontrada' : 'No se pudo cargar la cuenta'}
                error={q.error}
                onRetry={q.reload}
              />
            ) : (
              <LoadingRow label="Cargando la cuenta…" />
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
          {isSelf ? <span className="status-badge admin-badge--self">Usted</span> : null}
        </span>
      </p>
      <p className="admin-user-dates">
        Creada {formatDateTime(user.created_at)} · Último acceso {formatDateTime(user.last_login_at)}
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
        <Section header="Su propia cuenta">
          <p className="admin-card-note">
            Aquí no puede cambiar el rol, desactivar, restablecer ni eliminar su propia cuenta. Use{' '}
            <strong>{UI.changePassword}</strong> en el menú de la cuenta para cambiar su contraseña.
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
      <Link to={paths.admin.users}>‹ Usuarios</Link>
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
      setResult({ tone: 'success', text: 'Cambios guardados.' });
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
    <form noValidate onSubmit={(e) => void submit(e)} aria-label="Editar cuenta">
      <Section
        header="Cuenta"
        footer={isSelf ? 'No puede cambiar su propio rol ni su estado activo (debe hacerlo otro administrador).' : undefined}
      >
        <TextRow label="Nombre completo" value={fullName} onChange={setFullName} error={errors.full_name} />
        <TextRow label="Clave" value={clave} onChange={setClave} noAutoCorrect error={errors.clave} />
        <div className="row">
          {isSelf ? (
            <>
              <span className="row__label">Rol</span>
              <RoleBadge role={user.role} />
            </>
          ) : (
            <SegmentedControl label="Rol" showLabel options={ROLE_OPTIONS} value={role} onChange={setRole} />
          )}
        </div>
        <ToggleRow label="Activa (puede iniciar sesión)" checked={active} onChange={setActive} disabled={isSelf} />
      </Section>
      {result ? <InlineAlert tone={result.tone}>{result.text}</InlineAlert> : null}
      <div className="admin-form-actions">
        <button type="submit" className="btn-primary btn-primary--compact" disabled={!changed || busy}>
          {busy ? UI.saving : UI.saveChanges}
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
      <OneTimeSecret title="Contraseña restablecida" username={user.username} password={issued} onDone={() => setIssued(null)} />
    );
  }

  return (
    <Section
      header="Contraseña"
      footer="Al restablecerla se cierran todas sus sesiones; deberá elegir una contraseña nueva en su próximo inicio de sesión."
    >
      {open ? (
        <form noValidate onSubmit={(e) => void submit(e)} aria-label="Restablecer contraseña">
          <PasswordField label="Contraseña temporal nueva" value={password} onChange={setPassword} error={error} />
          <div className="row admin-row-actions">
            <button type="button" className="btn-plain" onClick={() => setOpen(false)}>
              {UI.cancel}
            </button>
            <button type="submit" className="btn-primary btn-primary--compact" disabled={busy}>
              {busy ? 'Restableciendo…' : 'Restablecer contraseña'}
            </button>
          </div>
        </form>
      ) : (
        <div className="row admin-row-actions">
          <span className="row__label">Emitir una contraseña temporal nueva</span>
          <button type="button" className="btn-plain" onClick={start}>
            Restablecer contraseña…
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
      navigate(paths.admin.users, { state: { notice: `Se eliminó la cuenta ${user.username}.` } satisfies UsersNotice });
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
      setDone(`Se desactivó ${saved.username}: ya no puede iniciar sesión y sus casos se conservan.`);
      onChanged(saved);
    } catch (e) {
      setError(guardMessage(e) ?? errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const count = owns ? /owns (\d+)/.exec(owns)?.[1] : undefined;
  return (
    <Section header="Eliminar cuenta">
      {done ? <InlineAlert tone="success">{done}</InlineAlert> : null}
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      {owns ? (
        <InlineAlert tone="info">
          <p className="admin-alert__p">
            {user.username} tiene {count ? plural(Number(count), 'caso', 'casos') : 'casos'}, así que la cuenta no
            puede eliminarse (sus registros clínicos deben conservarse).
            {user.is_active
              ? ' Desactívela en su lugar: ya no podrá iniciar sesión y sus casos seguirán disponibles.'
              : ' La cuenta ya está inactiva.'}
          </p>
          {user.is_active ? (
            <p className="admin-alert__p">
              <button type="button" className="btn-destructive" disabled={busy} onClick={() => void deactivate()}>
                Desactivar en su lugar
              </button>{' '}
              <button type="button" className="btn-plain" onClick={() => setOwns(null)}>
                {UI.cancel}
              </button>
            </p>
          ) : null}
        </InlineAlert>
      ) : null}
      {confirming ? (
        <div className="row admin-row-actions" role="group" aria-label={`Confirmar eliminación de ${user.username}`}>
          <span className="row__label">¿Eliminar definitivamente {user.username}? No se puede deshacer.</span>
          <button type="button" className="btn-plain" onClick={() => setConfirming(false)} disabled={busy}>
            {UI.cancel}
          </button>
          <button type="button" className="btn-destructive" onClick={() => void doDelete()} disabled={busy}>
            {busy ? UI.deleting : UI.delete}
          </button>
        </div>
      ) : (
        <div className="row admin-row-actions">
          <span className="row__label">Solo pueden eliminarse las cuentas sin casos.</span>
          <button
            type="button"
            className="btn-plain btn-plain--destructive"
            onClick={() => {
              setConfirming(true);
              setError(null);
              setOwns(null);
            }}
          >
            Eliminar cuenta…
          </button>
        </div>
      )}
    </Section>
  );
}
