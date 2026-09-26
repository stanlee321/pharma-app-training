import { UI } from '../../lib/wording';
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
  doneLabel = UI.done,
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
        Contraseña temporal de <strong>{username}</strong>. Entréguela en privado; deberá cambiarla la primera vez que
        inicie sesión.
      </p>
      <div className="secret-card__value-row">
        <label className="visually-hidden" htmlFor={valueId}>
          Contraseña temporal
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
          {copied === 'ok' ? 'Copiada' : 'Copiar'}
        </button>
      </div>
      {copied === 'failed' ? (
        <p className="secret-card__warn" role="alert">
          No se pudo copiar automáticamente: seleccione la contraseña y cópiela a mano.
        </p>
      ) : null}
      <p className="secret-card__warn">
        <Icon name="warning" size={16} /> Solo se muestra una vez. Al salir de esta pantalla ya no podrá verse de nuevo
        (restablezca la contraseña para emitir otra).
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
