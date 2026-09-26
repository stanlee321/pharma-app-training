import { useId, useState } from 'react';
import { generateTempPassword, PASSWORD_MANAGER_OFF } from '../../lib/accounts';

/**
 * Temporary-password row: masked input with Show/Hide and a "Generate" helper (a random
 * `generateTempPassword()`, revealed so the admin can check it). Same row styling as `TextRow`.
 */
export function PasswordField({
  label,
  value,
  onChange,
  error,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  hint?: string;
}) {
  const id = useId();
  const noteId = `${id}-note`;
  const [shown, setShown] = useState(false);
  return (
    <>
      <div className={`row password-row${error ? ' row--invalid' : ''}`}>
        <label className="row__label" htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          className="row__input"
          type={shown ? 'text' : 'password'}
          value={value}
          // Another user's credential: the browser must neither offer nor save it (only the
          // user's own Change password screen uses autoComplete="new-password").
          autoComplete="off"
          {...PASSWORD_MANAGER_OFF}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? noteId : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="password-row__actions">
          <button
            type="button"
            className="btn-plain"
            aria-label={shown ? 'Hide password' : 'Show password'}
            onClick={() => setShown((s) => !s)}
          >
            {shown ? 'Hide' : 'Show'}
          </button>
          <button
            type="button"
            className="btn-plain"
            aria-label="Generate a password"
            onClick={() => {
              onChange(generateTempPassword());
              setShown(true);
            }}
          >
            Generate
          </button>
        </span>
      </div>
      {error ? (
        <div className="row__hint" id={noteId} role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="row__hint row__hint--info" id={noteId}>
          {hint}
        </div>
      ) : null}
    </>
  );
}
