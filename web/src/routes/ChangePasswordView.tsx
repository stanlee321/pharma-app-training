import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { TextRow } from '../components/FormRows';
import { changePasswordErrorMessage, newPasswordProblem } from '../state/authMessages';
import { displayName, landingPath, useAuthStore } from '../state/authStore';
import { paths } from './paths';
import './login.css';

/**
 * Change password — forced while `must_change_password` is set (the only screen such an account
 * can reach, besides signing out) and voluntary from the user menu. The backend revokes the
 * current token on success, so the store logs in again with the new password automatically.
 * Rendered inside `RequireAuth allowPendingPasswordChange`.
 */
export function ChangePasswordView() {
  const user = useAuthStore((s) => s.user);
  const changePassword = useAuthStore((s) => s.changePassword);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return null; // guarded by RequireAuth
  const forced = user.must_change_password;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!current) {
      setError('Enter your current password.');
      return;
    }
    const problem = newPasswordProblem(current, next, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      const u = useAuthStore.getState().user;
      navigate(u ? landingPath(u) : paths.login, { replace: true });
    } catch (err) {
      // A failed automatic re-login already signed out (→ /login with a notice).
      setError(changePasswordErrorMessage(err));
      setBusy(false);
    }
  };

  const onSignOut = () => {
    logout();
    navigate(paths.login, { replace: true });
  };

  return (
    <div className="login">
      <form
        className="login__column"
        onSubmit={(e) => void onSubmit(e)}
        aria-labelledby="change-password-title"
        noValidate
      >
        <div className="login__brand">
          <span className="login__logo">
            <Icon name="lock" size={40} />
          </span>
          <h1 className="login__title" id="change-password-title">
            Change password
          </h1>
          <p className="login__subtitle">
            {forced
              ? `Welcome, ${displayName(user)}. Choose a new password to continue.`
              : `Signed in as ${user.username}.`}
          </p>
        </div>

        {error ? (
          <div className="banner" role="alert">
            <Icon name="warning" size={18} />
            <span className="banner__text">{error}</span>
          </div>
        ) : null}

        <div className="login__card">
          <TextRow
            label={forced ? 'Temporary password' : 'Current password'}
            type="password"
            value={current}
            onChange={setCurrent}
            placeholder="Required"
            autoComplete="current-password"
          />
          <TextRow
            label="New password"
            type="password"
            value={next}
            onChange={setNext}
            placeholder="8–128 characters"
            autoComplete="new-password"
          />
          <TextRow
            label="Confirm new password"
            type="password"
            value={confirm}
            onChange={setConfirm}
            placeholder="Repeat it"
            autoComplete="new-password"
          />
        </div>
        <p className="login__hint">You will stay signed in with the new password.</p>

        <div className="login__actions">
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? 'Changing…' : 'Change password'}
          </button>
          {forced ? (
            <button type="button" className="btn-plain" onClick={onSignOut}>
              Sign Out
            </button>
          ) : (
            <button type="button" className="btn-plain" onClick={() => navigate(landingPath(user))}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
