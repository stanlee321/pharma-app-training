/**
 * Patients ("historias clínicas") store: the searchable list, per-patient detail (with the
 * patient's cases) and create / edit. Patients are shared hospital-wide (plan:
 * docs/wiki/plans/patients-historias.md).
 *
 * Session isolation (same rule as the case store): `reset()` (sign-out / account change) bumps a
 * session epoch; every async action captures it before its first await and drops its result if
 * it changed meanwhile, so the previous account's responses never land in the next session.
 * A list search also drops a response that a newer search has overtaken.
 */
import { createStore, useStore, type StoreApi } from 'zustand';
import { errorMessage } from '../api/backend';
import { existingPatientId, type PatientApi } from '../api/patientApi';
import { CaseStoreProvider } from '../api/provider';
import type { PatientCreate, PatientDTO, PatientDetailDTO, PatientUpdate } from '../api/types';
import { caseStore, SessionChangedError } from './caseStore';

/** Page size of the patient list (a longer result asks to refine the search). */
export const PATIENT_PAGE_SIZE = 100;

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PatientListState {
  /** The search the items answer. */
  q: string;
  items: PatientDTO[];
  total: number;
  status: LoadStatus;
  error: string | null;
}

export interface PatientDetailState {
  data: PatientDetailDTO | null;
  status: LoadStatus;
  error: string | null;
}

/** Outcome of a create / edit: done, or the registro belongs to another patient (409). */
export type PatientWriteResult =
  | { kind: 'saved'; patient: PatientDTO }
  | { kind: 'exists'; patientId: string };

export interface PatientStoreState {
  api: PatientApi;
  list: PatientListState;
  details: Record<string, PatientDetailState>;

  setApi(api: PatientApi): void;
  /** Clear everything (sign-out / account change). */
  reset(): void;
  /** Load the list for `q` (name or registro). */
  search(q: string): Promise<void>;
  /** (Re)load one patient with their cases. */
  loadPatient(id: string): Promise<PatientDetailDTO | null>;
  /** POST /patients. Throws on errors other than the duplicate-registro 409. */
  createPatient(req: PatientCreate): Promise<PatientWriteResult>;
  /** PATCH /patients/{id}. Throws on errors other than the duplicate-registro 409. */
  updatePatient(id: string, patch: PatientUpdate): Promise<PatientWriteResult>;
}

const emptyList = (): PatientListState => ({ q: '', items: [], total: 0, status: 'idle', error: null });

export function createPatientStore(initialApi: PatientApi): StoreApi<PatientStoreState> {
  let epoch = 0;
  let searchSeq = 0;

  return createStore<PatientStoreState>()((set, get) => {
    const patchDetail = (id: string, over: Partial<PatientDetailState>) =>
      set((s) => ({
        details: { ...s.details, [id]: { ...(s.details[id] ?? { data: null, status: 'idle', error: null }), ...over } },
      }));

    /** Keep list rows / a loaded detail in step with a patient the server just returned. */
    const absorb = (p: PatientDTO) =>
      set((s) => {
        const items = s.list.items.map((x) => (x.id === p.id ? { ...p, cases_count: x.cases_count } : x));
        const d = s.details[p.id];
        const details = d?.data
          ? { ...s.details, [p.id]: { ...d, data: { ...d.data, ...p, cases: d.data.cases, cases_count: d.data.cases_count } } }
          : s.details;
        return { list: { ...s.list, items }, details };
      });

    return {
      api: initialApi,
      list: emptyList(),
      details: {},

      setApi(api) {
        set({ api });
      },

      reset() {
        epoch++;
        searchSeq++;
        set({ list: emptyList(), details: {} });
      },

      async search(q) {
        const ep = epoch;
        const seq = ++searchSeq;
        set((s) => ({ list: { ...s.list, status: 'loading', error: null } }));
        try {
          const page = await get().api.list(q, PATIENT_PAGE_SIZE, 0);
          if (ep !== epoch || seq !== searchSeq) return;
          set({ list: { q, items: page.items, total: page.total, status: 'ready', error: null } });
        } catch (e) {
          if (ep !== epoch || seq !== searchSeq) return;
          set((s) => ({ list: { ...s.list, status: 'error', error: errorMessage(e) } }));
        }
      },

      async loadPatient(id) {
        const ep = epoch;
        patchDetail(id, { status: 'loading', error: null });
        try {
          const data = await get().api.get(id);
          if (ep !== epoch) return null;
          patchDetail(id, { data, status: 'ready', error: null });
          return data;
        } catch (e) {
          if (ep === epoch) patchDetail(id, { status: 'error', error: errorMessage(e) });
          return null;
        }
      },

      async createPatient(req) {
        const ep = epoch;
        try {
          const patient = await get().api.create(req);
          if (ep !== epoch) throw new SessionChangedError();
          return { kind: 'saved', patient };
        } catch (e) {
          if (ep !== epoch) throw new SessionChangedError();
          const existing = existingPatientId(e);
          if (existing) return { kind: 'exists', patientId: existing };
          throw e;
        }
      },

      async updatePatient(id, patch) {
        const ep = epoch;
        try {
          const patient = await get().api.update(id, patch);
          if (ep !== epoch) throw new SessionChangedError();
          absorb(patient);
          // The server re-copied the identity into this patient's drafts.
          caseStore.getState().invalidatePatient(id);
          return { kind: 'saved', patient };
        } catch (e) {
          if (ep !== epoch) throw new SessionChangedError();
          const existing = existingPatientId(e);
          if (existing) return { kind: 'exists', patientId: existing };
          throw e;
        }
      },
    };
  });
}

/** The app-wide patient store (REST by default; in-memory with VITE_USE_INMEMORY=1). */
export const patientStore = createPatientStore(CaseStoreProvider.makePatientApi());

export function usePatientStore<T>(selector: (s: PatientStoreState) => T): T {
  return useStore(patientStore, selector);
}
