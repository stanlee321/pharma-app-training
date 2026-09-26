import { fakeUser, InMemoryAuthApi, type AuthApi } from '../api/authApi';
import type { UserDTO } from '../api/types';
import { useAuthStore } from '../state/authStore';

/** Synthetic bearer token used by the mocked-fetch suites. */
export const TEST_TOKEN = 'test-token-0123456789';

/** A far-future expiry for signed-in test sessions. */
export const FUTURE_EXPIRY = '2999-01-01T00:00:00Z';

/** Put the auth store in a signed-in state (no network) as a synthetic account. */
export function signInAs(over: Partial<UserDTO> = {}, api: AuthApi = new InMemoryAuthApi()): UserDTO {
  const user = fakeUser(over);
  useAuthStore.setState({
    api,
    token: TEST_TOKEN,
    expiresAt: FUTURE_EXPIRY,
    user,
    notice: null,
    reauthenticating: false,
    expiringSoon: false,
    restoredDrafts: null,
  });
  return user;
}

/** Signed-out auth store. */
export function signOutState(api: AuthApi = new InMemoryAuthApi()): void {
  useAuthStore.setState({
    api,
    token: null,
    expiresAt: null,
    user: null,
    notice: null,
    reauthenticating: false,
    expiringSoon: false,
    restoredDrafts: null,
    serverUrl: '/api/v1',
  });
}
