import { useId, type ReactNode } from 'react';

export interface SectionProps {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** iOS grouped-inset section: small grey header, white rounded card, optional footer. */
export function Section({ header, footer, children, className }: SectionProps) {
  const id = useId();
  return (
    <section className={`section${className ? ` ${className}` : ''}`} aria-labelledby={header ? id : undefined}>
      {header ? (
        <h2 className="section__header" id={id}>
          {header}
        </h2>
      ) : null}
      <div className="section__card">{children}</div>
      {footer ? <p className="section__footer">{footer}</p> : null}
    </section>
  );
}
