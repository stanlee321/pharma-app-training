import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

/**
 * Encounter Hub row (Swift `hubRow`): icon + title in selection blue while the section is empty,
 * effect green + trailing check-circle once it has data.
 */
export function SectionLinkRow({
  to,
  title,
  icon,
  filled,
}: {
  to: string;
  title: string;
  icon: IconName;
  filled: boolean;
}) {
  return (
    <Link to={to} className={`row link-row${filled ? ' link-row--filled' : ''}`}>
      <span className="link-row__icon">
        <Icon name={icon} />
      </span>
      <span className="link-row__title">{title}</span>
      {filled ? (
        <span className="link-row__check">
          <Icon name="checkCircle" size={16} title="Completed" />
        </span>
      ) : null}
      <span className="link-row__chevron">
        <Icon name="chevronRight" size={16} />
      </span>
    </Link>
  );
}
