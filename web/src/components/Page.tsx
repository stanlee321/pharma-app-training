import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';
import { useInsideMain } from './pageContext';

export interface BackLinkProps {
  to: string;
  label: string;
}

/** iOS-style back button ("‹ Label"). */
export function BackLink({ to, label }: BackLinkProps) {
  return (
    <Link className="back-link" to={to} aria-label={`Volver a ${label}`}>
      <Icon name="chevronLeft" size={24} />
      <span>{label}</span>
    </Link>
  );
}

export interface PageProps {
  title: string;
  /** Back navigation shown top-left (ignored if `leading` is given). */
  back?: BackLinkProps;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Large bold title under the bar (default) vs a small centered inline title. */
  titleDisplay?: 'large' | 'inline';
  /** White ground (Login) instead of the grouped #F2F2F7 ground. */
  plain?: boolean;
  children: ReactNode;
  /** Pinned under the content (e.g. SaveBar). */
  footer?: ReactNode;
}

/** Screen scaffold: sticky nav bar (leading / inline title / trailing) + large title + body. */
export function Page({
  title,
  back,
  leading,
  trailing,
  titleDisplay = 'large',
  plain = false,
  children,
  footer,
}: PageProps) {
  const Body = useInsideMain() ? 'div' : 'main';
  const lead = leading ?? (back ? <BackLink {...back} /> : null);
  const hasBar = lead != null || trailing != null || titleDisplay === 'inline';
  return (
    <div className={`page${plain ? ' page--plain' : ''}`}>
      {hasBar ? (
        <header className="navbar">
          <div className="navbar__bar">
            <div className="navbar__leading">{lead}</div>
            {titleDisplay === 'inline' ? (
              <h1 className="navbar__inline-title">{title}</h1>
            ) : (
              <span aria-hidden="true" />
            )}
            <div className="navbar__trailing">{trailing}</div>
          </div>
        </header>
      ) : null}
      <Body className="page__inner">
        {titleDisplay === 'large' ? <h1 className="large-title">{title}</h1> : null}
        {children}
        {footer}
      </Body>
    </div>
  );
}
