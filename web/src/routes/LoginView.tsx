import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { DEFAULT_BASE_URL } from '../api/http';
import type { UserRole } from '../api/types';
import { Icon } from '../components/Icon';
import { TextRow } from '../components/FormRows';
import { landingPath, pathAllowedFor, useAuthStore } from '../state/authStore';
import { loginErrorMessage, noticeText } from '../state/authMessages';
import { paths } from './paths';
import './login.css';

/**
 * Sign-in (port of the Swift LoginView look: grouped card + pill button). Username + password
 * against `POST /auth/login`; the role comes from the account. The API base ("Server") lives in
 * a collapsed Advanced disclosure.
 */
export function LoginView() {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const notice = useAuthStore((s) => s.notice);
  const login = useAuthStore((s) => s.login);
  const storedServer = useAuthStore((s) => s.serverUrl);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState(storedServer);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Honour the remembered destination only when it belongs to this account's role.
  // `from` is pathname + search; only the pathname decides whether it is this role's area.
  const target = (u: { role: UserRole }) =>
    from && from.startsWith('/') && pathAllowedFor(u.role, from.split(/[?#]/)[0]!) ? from : landingPath(u);

  if (token && user && !busy) {
    return <Navigate to={user.must_change_password ? paths.changePassword : target(user)} replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!username.trim() || !password) {
      setError('Enter your username and password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const u = await login(username, password, server);
      setPassword('');
      navigate(u.must_change_password ? paths.changePassword : target(u), { replace: true });
    } catch (err) {
      setError(loginErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const noticeMsg = noticeText(notice);

  return (
    <div className="login">
      <form className="login__column" onSubmit={(e) => void onSubmit(e)} aria-labelledby="login-title" noValidate>
        <div className="login__brand">
          <span className="login__logo">
            <Icon name="crossCase" size={44} />
          </span>
          <h1 className="login__title" id="login-title">
            TivaTrainer
          </h1>
          <p className="login__subtitle">Sign in to continue</p>
        </div>

        {noticeMsg && !error ? (
          <div className="banner banner--warning" role="status">
            <Icon name="lock" size={18} />
            <span className="banner__text">{noticeMsg}</span>
          </div>
        ) : null}
        {error ? (
          <div className="banner" role="alert">
            <Icon name="warning" size={18} />
            <span className="banner__text">{error}</span>
          </div>
        ) : null}

        <div className="login__card">
          <TextRow
            label="Username"
            value={username}
            onChange={setUsername}
            placeholder="e.g. dra.perez"
            autoComplete="username"
            noAutoCorrect
          />
          <TextRow
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="Required"
            autoComplete="current-password"
          />
        </div>

        <details className="login__advanced">
          <summary>Advanced</summary>
          <div className="login__card">
            <TextRow
              label="Server"
              value={server}
              onChange={setServer}
              placeholder={DEFAULT_BASE_URL}
              // Not type="url": the default "/api/v1" is relative and would fail URL validation.
              inputMode="url"
              noAutoCorrect
              small
            />
          </div>
        </details>

        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Signing In…' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}
