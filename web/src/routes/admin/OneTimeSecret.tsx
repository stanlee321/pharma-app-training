import { useId, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon';

/**
 * Shows a temporary password ONCE (after create / reset). The value lives only in the React
 * state of the page that received it: never in the URL, storage, a store or a log. Leaving the
 * page or pressing Done drops it; the server cannot show it again.
 */
export function OneTimeSecret({
  title,
  username,
  password,
  onDone,
  doneLabel = 'Done',
  children,
}: {
  title: string;
  username: string;
  password: string;
  onDone: () => void;
  doneLabel?: string;
  /** Extra actions next to Done. */
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle');
  const valueId = useId();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied('ok');
    } catch {
      setCopied('failed');
    }
  };

  return (
    <section className="secret-card" aria-labelledby={`${valueId}-title`} role="region">
      <h2 className="secret-card__title" id={`${valueId}-title`}>
        <Icon name="checkCircle" size={20} />
        {title}
      </h2>
      <p className="secret-card__text">
        Temporary password for <strong>{username}</strong>. Give it to them privately; they must change it the first
        time they sign in.
      </p>
      <div className="secret-card__value-row">
        <label className="visually-hidden" htmlFor={valueId}>
          Temporary password
        </label>
        <input
          id={valueId}
          className="secret-card__value"
          readOnly
          value={password}
          autoComplete="off"
          spellCheck={false}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" className="btn-plain" onClick={() => void copy()}>
          {copied === 'ok' ? 'Copied' : 'Copy'}
        </button>
      </div>
      {copied === 'failed' ? (
        <p className="secret-card__warn" role="alert">
          Couldn’t copy automatically — select the password and copy it by hand.
        </p>
      ) : null}
      <p className="secret-card__warn">
        <Icon name="warning" size={16} /> It is shown only once. After you leave this screen it can’t be displayed again
        (reset the password to issue a new one).
      </p>
      <div className="secret-card__actions">
        {children}
        <button type="button" className="btn-primary btn-primary--compact" onClick={onDone}>
          {doneLabel}
        </button>
      </div>
    </section>
  );
}
