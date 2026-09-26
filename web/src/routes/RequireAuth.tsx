import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { UserRole } from '../api/types';
import { landingPath, useAuthStore } from '../state/authStore';
import { paths } from './paths';
import { SessionExpiryBanner } from './SessionExpiryBanner';

export interface RequireAuthProps {
  children: ReactNode;
  /** Only this role may enter; the other role is sent to its own landing page. */
  role?: UserRole;
  /** Allow a user whose password change is pending (the change-password screen itself). */
  allowPendingPasswordChange?: boolean;
}

/**
 * Auth + role gate. Redirects are driven by the auth store's state, so a 401 anywhere (the HTTP
 * layer logs out) or a 403 "password change required" (it flags the user) re-routes at once:
 * - signed out → /login (remembering where the user was going);
 * - password change pending → /change-password;
 * - wrong role → that role's landing (/cases for anesthesiologists, /admin for admins).
 */
export function RequireAuth({ children, role, allowPendingPasswordChange = false }: RequireAuthProps) {
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();
  if (!token || !user) {
    // Remember the query too (e.g. the admin case filters); LoginView validates the path part.
    return <Navigate to={paths.login} replace state={{ from: location.pathname + location.search }} />;
  }
  if (user.must_change_password && !allowPendingPasswordChange) {
    return <Navigate to={paths.changePassword} replace />;
  }
  if (role && user.role !== role) return <Navigate to={landingPath(user)} replace />;
  return (
    <>
      <SessionExpiryBanner />
      {children}
    </>
  );
}

/** Catch-all: signed in → role landing; else → /login. */
export function LandingRedirect() {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  return <Navigate to={token && user ? landingPath(user) : paths.login} replace />;
}
