import { describe, expect, it } from 'vitest';
import { BackendError } from '../api/backend';
import type { PatientApi } from '../api/patientApi';
import type { PatientDTO, PatientPage } from '../api/types';
import { fakePatient } from '../test/restHarness';
import { SessionChangedError } from './caseStore';
import { createPatientStore } from './patientStore';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const page = (items: PatientDTO[]): PatientPage => ({ items, total: items.length, limit: 100, offset: 0 });

/** A patients API whose calls hang until the test answers them. */
function pendingApi() {
  const lists: { q: string; d: ReturnType<typeof deferred<PatientPage>> }[] = [];
  const creates: ReturnType<typeof deferred<PatientDTO>>[] = [];
  const api: PatientApi = {
    list: (q) => {
      const d = deferred<PatientPage>();
      lists.push({ q, d });
      return d.promise;
    },
    get: () => new Promise(() => {}),
    create: () => {
      const d = deferred<PatientDTO>();
      creates.push(d);
      return d.promise;
    },
    update: () => new Promise(() => {}),
  };
  return { api, lists, creates };
}

describe('patientStore', () => {
  it('drops a list answer that arrives after a sign-out (session epoch)', async () => {
    const { api, lists } = pendingApi();
    const store = createPatientStore(api);
    const p = store.getState().search('');
    store.getState().reset(); // signed out while the list was in flight
    lists[0]!.d.resolve(page([fakePatient({ nombre: 'Paciente de la sesión anterior' })]));
    await p;
    expect(store.getState().list).toMatchObject({ items: [], status: 'idle' });
  });

  it('keeps only the latest search when answers arrive out of order', async () => {
    const { api, lists } = pendingApi();
    const store = createPatientStore(api);
    const first = store.getState().search('an');
    const second = store.getState().search('ana');
    lists[1]!.d.resolve(page([fakePatient({ nombre: 'Ana' })]));
    lists[0]!.d.resolve(page([fakePatient({ nombre: 'Andrés' }), fakePatient({ nombre: 'Ana' })]));
    await Promise.all([first, second]);
    expect(store.getState().list.q).toBe('ana');
    expect(store.getState().list.items.map((x) => x.nombre)).toEqual(['Ana']);
  });

  it('a 409 "patient exists" is a result carrying the existing id; a create across a sign-out throws', async () => {
    const { api, creates } = pendingApi();
    const store = createPatientStore(api);
    const dup = store.getState().createPatient({ nombre: 'X', registro: 'R', sexo: '', grupo_sanguineo: '', rh: '' });
    creates[0]!.reject(BackendError.http(409, JSON.stringify({ detail: 'patient exists', patient_id: 'p-1' })));
    await expect(dup).resolves.toEqual({ kind: 'exists', patientId: 'p-1' });

    const late = store.getState().createPatient({ nombre: 'Y', registro: 'S', sexo: '', grupo_sanguineo: '', rh: '' });
    store.getState().reset();
    creates[1]!.resolve(fakePatient());
    await expect(late).rejects.toBeInstanceOf(SessionChangedError);
  });
});
