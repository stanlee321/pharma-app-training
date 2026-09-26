import { UI } from '../lib/wording';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ROLE_LABELS } from '../api/types';
import { Icon } from '../components/Icon';
import { displayName, useAuthStore } from '../state/authStore';
import { paths } from './paths';
import './userMenu.css';

/**
 * Account menu for the top bar (both roles): who is signed in, their role, Change password and
 * Sign Out. A disclosure (button + panel), closed by Escape or a click outside.
 */
export function UserMenu() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const name = displayName(user);

  const onSignOut = () => {
    setOpen(false);
    logout();
    navigate(paths.login, { replace: true });
  };

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="toolbar-pill user-menu__button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Cuenta: ${name}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="person" size={18} />
        <span className="user-menu__name">{name}</span>
      </button>
      {open ? (
        <div className="user-menu__panel" id={panelId}>
          <div className="user-menu__who">
            <span className="user-menu__full">{name}</span>
            <span className="user-menu__meta">
              {user.username} · {ROLE_LABELS[user.role]}
            </span>
          </div>
          <Link className="user-menu__item" to={paths.changePassword} onClick={() => setOpen(false)}>
            <Icon name="lock" size={18} /> {UI.changePassword}
          </Link>
          <button type="button" className="user-menu__item user-menu__item--danger" onClick={onSignOut}>
            {UI.signOut}
          </button>
        </div>
      ) : null}
    </div>
  );
}
