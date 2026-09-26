import { InMemoryAuthApi, RestAuthApi, type AuthApi } from './authApi';
import type { CaseBackend } from './backend';
import { InMemoryBackend } from './inMemoryBackend';
import { RestBackend } from './restBackend';

/**
 * Selects the persistence backend behind the case store (Swift `CaseStoreProvider`), and the
 * matching auth API. REST is the default; set VITE_USE_INMEMORY=1 to run with no server (any
 * username + password then signs in as a fake anesthesiologist).
 */
export const CaseStoreProvider = {
  useREST: import.meta.env.VITE_USE_INMEMORY !== '1',
  makeBackend(): CaseBackend {
    return CaseStoreProvider.useREST ? new RestBackend() : new InMemoryBackend();
  },
  makeAuthApi(): AuthApi {
    return CaseStoreProvider.useREST ? new RestAuthApi() : new InMemoryAuthApi();
  },
};
