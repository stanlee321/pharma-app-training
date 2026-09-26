import { purgeExpiredDrafts } from './lib/storage';
import { startSessionTimer, useAuthStore } from './state/authStore';

/**
 * App start-up, before the first render:
 * 1. sweep every user's expired session drafts (PHI never outlives `DRAFT_TTL_MS`, even for an
 *    account that never signs in on this browser again);
 * 2. arm the restored session's expiry timer;
 * 3. re-read the account (role / active / pending password change).
 */
export function bootApp(): Promise<void> {
  purgeExpiredDrafts();
  startSessionTimer();
  return useAuthStore.getState().refreshMe();
}
