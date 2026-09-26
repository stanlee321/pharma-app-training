import { UI } from '../lib/wording';
import { useState } from 'react';
import { Icon } from '../components/Icon';
import { formatTime } from '../lib/datetime';
import { useAuthStore } from '../state/authStore';
import { caseStore } from '../state/caseStore';

/**
 * Shown on every signed-in page once the token has under 5 minutes left: the session ends at
 * `expiresAt` (no refresh tokens), so the user can save now. Unsaved edits are also kept as a
 * draft on expiry and restored at the same user's next login.
 */
export function SessionExpiryBanner() {
  const soon = useAuthStore((s) => s.expiringSoon);
  const expiresAt = useAuthStore((s) => s.expiresAt);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  if (!soon) return null;
  const at = formatTime(expiresAt);
  const saveAll = async () => {
    setState('saving');
    setState((await caseStore.getState().saveAllDirty()) ? 'saved' : 'failed');
  };
  return (
    <div className="banner banner--warning session-banner" role="alert">
      <Icon name="warning" size={18} />
      <span className="banner__text">
        Su sesión termina a las {at}. Guarde su trabajo y vuelva a iniciar sesión.
        {state === 'saved' ? ' Todos los cambios se guardaron.' : state === 'failed' ? ' Algunos cambios no se pudieron guardar.' : ''}
      </span>
      <button type="button" className="btn-plain" onClick={() => void saveAll()} disabled={state === 'saving'}>
        {state === 'saving' ? UI.saving : 'Guardar ahora'}
      </button>
    </div>
  );
}
