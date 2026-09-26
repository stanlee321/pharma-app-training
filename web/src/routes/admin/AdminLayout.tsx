import { NavLink, Outlet } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { InsideMainContext } from '../../components/pageContext';
import { paths } from '../paths';
import { UserMenu } from '../UserMenu';
import './admin.css';

const NAV = [
  { to: paths.admin.dashboard, label: 'Dashboard', end: true },
  { to: paths.admin.cases, label: 'Cases', end: false },
  { to: paths.admin.users, label: 'Users', end: false },
  { to: paths.admin.documents, label: 'Documents', end: false },
] as const;

/**
 * Admin shell (`/admin/**`, admins only): top bar with the brand, the section nav
 * (Dashboard · Cases · Users · Documents) and the account menu; pages render in the outlet,
 * max-width ~1100px. Same visual language as the clinical screens, desktop-friendly, and the nav
 * wraps under the bar on a phone.
 */
export function AdminLayout() {
  return (
    <div className="admin">
      <header className="admin-bar">
        <div className="admin-bar__inner">
          <span className="admin-bar__brand">
            <span className="admin-bar__logo" aria-hidden="true">
              <Icon name="crossCase" size={20} />
            </span>
            TivaTrainer <span className="admin-bar__tag">Admin</span>
          </span>
          <nav className="admin-nav" aria-label="Admin">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => `admin-nav__link${isActive ? ' admin-nav__link--active' : ''}`}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="admin-bar__account">
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="admin__main">
        <InsideMainContext.Provider value={true}>
          <Outlet />
        </InsideMainContext.Provider>
      </main>
    </div>
  );
}
