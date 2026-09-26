import { useState } from 'react';
import { Icon } from '../components/Icon';
import { formatDateTime } from '../lib/datetime';
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
  const at = formatDateTime(expiresAt).slice(-5);
  const saveAll = async () => {
    setState('saving');
    setState((await caseStore.getState().saveAllDirty()) ? 'saved' : 'failed');
  };
  return (
    <div className="banner banner--warning session-banner" role="alert">
      <Icon name="warning" size={18} />
      <span className="banner__text">
        Your session ends at {at}. Save your work, then sign in again.
        {state === 'saved' ? ' All changes saved.' : state === 'failed' ? ' Some changes could not be saved.' : ''}
      </span>
      <button type="button" className="btn-plain" onClick={() => void saveAll()} disabled={state === 'saving'}>
        {state === 'saving' ? 'Saving…' : 'Save now'}
      </button>
    </div>
  );
}
