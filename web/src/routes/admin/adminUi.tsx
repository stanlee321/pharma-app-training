import { UI } from '../../lib/wording';
import type { ReactNode } from 'react';
import type { UserDTO } from '../../api/types';
import { ROLE_LABELS } from '../../api/types';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';

/** A spinner row for a loading card. */
export function LoadingRow({ label = UI.loading }: { label?: string }) {
  return (
    <div className="row state-row" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/** A failed load with Retry. */
export function LoadError({ title, error, onRetry }: { title: string; error: string | null; onRetry: () => void }) {
  return (
    <EmptyState
      icon="warning"
      title={title}
      description={error ?? undefined}
      action={
        <button type="button" className="btn-plain" onClick={onRetry}>
          {UI.retry}
        </button>
      }
    />
  );
}

/** An inline error / notice line (role=alert), e.g. a user-guard 409 under the form it concerns. */
export function InlineAlert({
  children,
  tone = 'error',
}: {
  children: ReactNode;
  tone?: 'error' | 'info' | 'success';
}) {
  return (
    <div className={`admin-alert admin-alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={tone === 'success' ? 'checkCircle' : 'warning'} size={18} />
      <div className="admin-alert__text">{children}</div>
    </div>
  );
}

/** Role pill. */
export function RoleBadge({ role }: { role: UserDTO['role'] }) {
  return <span className={`status-badge admin-badge--${role}`}>{ROLE_LABELS[role]}</span>;
}

/** Active / Inactive pill (+ "Must change password"). */
export function AccountBadges({ user }: { user: Pick<UserDTO, 'is_active' | 'must_change_password'> }) {
  return (
    <>
      {user.is_active ? (
        <span className="status-badge admin-badge--active">Activa</span>
      ) : (
        <span className="status-badge admin-badge--inactive">Inactiva</span>
      )}
      {user.must_change_password ? (
        <span className="status-badge admin-badge--pending">Debe cambiar la contraseña</span>
      ) : null}
    </>
  );
}
