import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** Port of SwiftUI ContentUnavailableView: icon, bold title, grey description. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: IconName;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state" role="status">
      <span className="empty-state__icon">
        <Icon name={icon} size={48} />
      </span>
      <p className="empty-state__title">{title}</p>
      {description ? <p className="empty-state__desc">{description}</p> : null}
      {action}
    </div>
  );
}
