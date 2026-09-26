import { UI } from '../../lib/wording';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminApi } from '../../api/adminApi';
import { errorMessage } from '../../api/backend';
import { ROLE_LABELS, type UserDTO, type UserRole } from '../../api/types';
import { SegmentedControl } from '../../components/Choice';
import { TextRow } from '../../components/FormRows';
import { Section } from '../../components/Section';
import {
  CLAVE_MAX,
  FULL_NAME_MAX,
  fieldErrors,
  maxLengthProblem,
  passwordProblem,
  USERNAME_RULE,
  usernameProblem,
  type AccountField,
} from '../../lib/accounts';
import { paths } from '../paths';
import { InlineAlert } from './adminUi';
import { OneTimeSecret } from './OneTimeSecret';
import { PasswordField } from './PasswordField';

const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as UserRole[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }));

type Errors = Partial<Record<AccountField, string>>;

/**
 * New account (`POST /admin/users`): username, full name, clave, role and a temporary password
 * (with a generator). Local checks mirror the server's; the server's own messages (e.g. the
 * reserved `gw-` prefix, a taken username) are shown on the field they concern. On success the
 * temporary password is shown ONCE (`OneTimeSecret`).
 */
export function AdminNewUserPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [clave, setClave] = useState('');
  const [role, setRole] = useState<UserRole>('anesthesiologist');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The created account + its temporary password: shown once, then dropped. */
  const [created, setCreated] = useState<{ user: UserDTO; password: string } | null>(null);

  const validate = (): Errors => {
    const e: Errors = {};
    const u = usernameProblem(username);
    if (u) e.username = u;
    const n = maxLengthProblem(fullName, FULL_NAME_MAX);
    if (n) e.full_name = n;
    const c = maxLengthProblem(clave, CLAVE_MAX);
    if (c) e.clave = c;
    const p = passwordProblem(password);
    if (p) e.password = p;
    return e;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busy) return;
    setFormError(null);
    const local = validate();
    setErrors(local);
    if (Object.keys(local).length > 0) return;
    setBusy(true);
    try {
      const user = await adminApi.createUser({
        username: username.trim(),
        full_name: fullName.trim(),
        clave: clave.trim(),
        role,
        password,
      });
      setCreated({ user, password });
      setPassword('');
    } catch (e) {
      const fe = fieldErrors(e);
      setErrors(fe);
      if (Object.keys(fe).length === 0) setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setCreated(null);
    setUsername('');
    setFullName('');
    setClave('');
    setRole('anesthesiologist');
    setErrors({});
  };

  if (created) {
    return (
      <>
        <h1 className="large-title">Nuevo usuario</h1>
        <OneTimeSecret
          title="Cuenta creada"
          username={created.user.username}
          password={created.password}
          doneLabel={UI.done}
          onDone={() => navigate(paths.admin.users)}
        >
          <Link className="btn-plain" to={paths.admin.user(created.user.id)}>
            Abrir cuenta
          </Link>
          <button type="button" className="btn-plain" onClick={reset}>
            Crear otra
          </button>
        </OneTimeSecret>
      </>
    );
  }

  return (
    <>
      <p className="admin-crumb">
        <Link to={paths.admin.users}>‹ Usuarios</Link>
      </p>
      <h1 className="large-title">Nuevo usuario</h1>
      <form noValidate onSubmit={(e) => void submit(e)} aria-label="Nuevo usuario">
        {formError ? <InlineAlert>{formError}</InlineAlert> : null}
        <Section header="Cuenta" footer="Los nombres de usuario se guardan en minúsculas y deben ser únicos.">
          <TextRow
            label="Usuario"
            value={username}
            onChange={setUsername}
            noAutoCorrect
            noPasswordManager
            required
            error={errors.username}
            hint={USERNAME_RULE}
          />
          <TextRow label="Nombre completo" value={fullName} onChange={setFullName} error={errors.full_name} />
          <TextRow label="Clave" value={clave} onChange={setClave} noAutoCorrect error={errors.clave} />
          <div className="row">
            <SegmentedControl label="Rol" showLabel options={ROLE_OPTIONS} value={role} onChange={setRole} />
          </div>
          {errors.role ? (
            <div className="row__hint" role="alert">
              {errors.role}
            </div>
          ) : null}
        </Section>
        <Section header="Contraseña temporal" footer="De 8 a 128 caracteres. Deberá cambiarla en su primer inicio de sesión.">
          <PasswordField label="Contraseña" value={password} onChange={setPassword} error={errors.password} />
        </Section>
        <div className="admin-form-actions">
          <Link className="btn-plain" to={paths.admin.users}>
            {UI.cancel}
          </Link>
          <button type="submit" className="btn-primary btn-primary--compact" disabled={busy}>
            {busy ? 'Creando…' : 'Crear cuenta'}
          </button>
        </div>
      </form>
    </>
  );
}
