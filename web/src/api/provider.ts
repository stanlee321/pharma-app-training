import { InMemoryAuthApi, RestAuthApi, type AuthApi } from './authApi';
import type { CaseBackend } from './backend';
import { InMemoryBackend } from './inMemoryBackend';
import { InMemoryPatientApi, RestPatientApi, type PatientApi } from './patientApi';
import { RestBackend } from './restBackend';

/** Offline mode: one in-memory case backend shared with the in-memory patients (their cases). */
let offlineCases: InMemoryBackend | null = null;
const offline = () => (offlineCases ??= new InMemoryBackend());

/**
 * Selects the persistence backend behind the case store (Swift `CaseStoreProvider`), and the
 * matching auth and patients APIs. REST is the default; set VITE_USE_INMEMORY=1 to run with no server (any
 * username + password then signs in as a fake anesthesiologist).
 */
export const CaseStoreProvider = {
  useREST: import.meta.env.VITE_USE_INMEMORY !== '1',
  makeBackend(): CaseBackend {
    return CaseStoreProvider.useREST ? new RestBackend() : offline();
  },
  makePatientApi(): PatientApi {
    return CaseStoreProvider.useREST ? new RestPatientApi() : new InMemoryPatientApi(offline());
  },
  makeAuthApi(): AuthApi {
    return CaseStoreProvider.useREST ? new RestAuthApi() : new InMemoryAuthApi();
  },
};
