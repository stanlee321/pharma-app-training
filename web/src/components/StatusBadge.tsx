import { STATUS_LABELS, type CaseStatus } from '../api/types';
import { Icon } from './Icon';

/** Case lifecycle pill: grey "Draft" / green "Finalized" with a lock. */
export function StatusBadge({ status }: { status: CaseStatus }) {
  return (
    <span className={`status-badge status-badge--${status}`} data-status={status}>
      {status === 'finalized' ? <Icon name="lock" size={12} /> : null}
      {STATUS_LABELS[status]}
    </span>
  );
}
