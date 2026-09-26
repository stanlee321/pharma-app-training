import { describe, expect, it, vi } from 'vitest';
import type { CaseBackend } from '../api/backend';
import { BackendError } from '../api/backend';
import { cloneCase, newCase } from '../api/factory';
import { demoCase, InMemoryBackend } from '../api/inMemoryBackend';
import type { AnesthesiaCase, DocumentDTO } from '../api/types';
import { createCaseStore, SessionChangedError } from './caseStore';
import { exportErrorMessage } from './review';

/** A controllable promise, to observe optimistic state before the backend answers. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeBackend(over: Partial<CaseBackend> = {}): CaseBackend {
  const mem = new InMemoryBackend([]);
  return {
    list: () => mem.list(),
    load: (id) => mem.load(id),
    loadForAdmin: (id) => mem.load(id),
    create: (o) => mem.create(o),
    save: (c) => mem.save(c),
    delete: (id) => mem.delete(id),
    exportForm: async () => new Blob(['%PDF'], { type: 'application/pdf' }),
    finalize: (id) => mem.finalize(id),
    listDocuments: () => mem.listDocuments(),
    generateDocument: () => mem.generateDocument(),
    documentFile: () => mem.documentFile(),
    deleteDocument: () => mem.deleteDocument(),
    ...over,
  };
}

describe('case store', () => {
  it('createCase appends optimistically, then swaps in the server copy', async () => {
    const put = deferred<AnesthesiaCase>();
    const save = vi.fn(() => put.promise);
    const store = createCaseStore(fakeBackend({ save }));

    const c = store.getState().createCase('Dr. Demo');
    expect(store.getState().cases.map((x) => x.id)).toEqual([c.id]);
    expect(store.getState().meta[c.id]).toMatchObject({ loaded: true, pendingCreate: true, saving: true });
    expect(save).toHaveBeenCalledTimes(1);

    const server = cloneCase(c);
    server.patient.imc = 24.2; // a server derivation
    put.resolve(server);
    await vi.waitFor(() => expect(store.getState().meta[c.id]!.saving).toBe(false));
    expect(store.getState().getCase(c.id)!.patient.imc).toBe(24.2);
    expect(store.getState().meta[c.id]!.pendingCreate).toBe(false);
    expect(store.getState().isDirty(c.id)).toBe(false);
  });

  it('save keeps local edits made while the PUT was in flight', async () => {
    const put = deferred<AnesthesiaCase>();
    const backend = fakeBackend();
    const store = createCaseStore(backend);
    backend.save = vi.fn(async (x: AnesthesiaCase) => x);
    const c = store.getState().createCase('o');
    await vi.waitFor(() => expect(store.getState().meta[c.id]!.saving).toBe(false));

    backend.save = vi.fn(() => put.promise);
    store.getState().updateCase(c.id, (d) => {
      d.sala = 'Q1';
    });
    const p = store.getState().save(c.id);
    store.getState().updateCase(c.id, (d) => {
      d.sala = 'Q2'; // edited mid-flight
    });
    const echoed = cloneCase(store.getState().getCase(c.id)!);
    echoed.sala = 'Q1';
    put.resolve(echoed);
    expect(await p).toBe(true);
    expect(store.getState().getCase(c.id)!.sala).toBe('Q2');
    expect(store.getState().isDirty(c.id)).toBe(true);
  });

  it('save failure records the error and keeps the case', async () => {
    const store = createCaseStore(
      fakeBackend({ save: async () => Promise.reject(BackendError.http(500, 'boom')) }),
    );
    const c = store.getState().createCase('o');
    await vi.waitFor(() => expect(store.getState().meta[c.id]!.saveError).toContain('500'));
    expect(store.getState().cases).toHaveLength(1);
    expect(store.getState().isDirty(c.id)).toBe(true);
  });

  it('delete is optimistic and calls the backend', async () => {
    const del = deferred<void>();
    const deleteFn = vi.fn(() => del.promise);
    const store = createCaseStore(fakeBackend({ delete: deleteFn }));
    const c = store.getState().createCase('o');
    const done = store.getState().delete(c.id);
    expect(store.getState().cases).toHaveLength(0);
    expect(store.getState().meta[c.id]).toBeUndefined();
    await vi.waitFor(() => expect(deleteFn).toHaveBeenCalledWith(c.id));
    del.resolve();
    await done;
  });

  it('delete waits for the in-flight and queued PUTs of that case before sending DELETE', async () => {
    const order: string[] = [];
    const put = deferred<AnesthesiaCase>();
    const save = vi.fn((c: AnesthesiaCase) => {
      order.push(`PUT ${c.sala}`);
      return put.promise;
    });
    const deleteFn = vi.fn(async () => {
      order.push('DELETE');
    });
    const seed = newCase('o');
    const store = createCaseStore(fakeBackend({ load: async () => cloneCase(seed), save, delete: deleteFn }));
    await store.getState().load(seed.id);
    store.getState().updateCase(seed.id, (x) => {
      x.sala = 'A';
    });
    void store.getState().save(seed.id); // in flight
    store.getState().updateCase(seed.id, (x) => {
      x.sala = 'B';
    });
    void store.getState().save(seed.id); // queued follow-up

    const done = store.getState().delete(seed.id);
    await Promise.resolve();
    expect(deleteFn).not.toHaveBeenCalled(); // the PUT has not settled yet
    put.resolve(cloneCase(seed));
    await done;
    // The queued follow-up found the case deleted and sent nothing; DELETE came last.
    expect(order).toEqual(['PUT A', 'DELETE']);
  });

  it('a refresh racing a delete does not resurrect the case', async () => {
    const demo = demoCase();
    const listed = deferred<AnesthesiaCase[]>();
    const store = createCaseStore(fakeBackend({ list: () => listed.promise, delete: async () => {} }));
    const r = store.getState().refresh();
    store.getState().delete(demo.id);
    listed.resolve([demo]);
    await r;
    expect(store.getState().cases).toHaveLength(0);
  });

  it('refresh lists shells; load fetches the full aggregate; save refuses unloaded shells', async () => {
    const full = demoCase();
    full.pre_assessment.alergia = 'ninguna';
    const mem = new InMemoryBackend([full]);
    const shell = newCase(full.owner);
    shell.id = full.id;
    const save = vi.fn((c: AnesthesiaCase) => mem.save(c));
    const store = createCaseStore(
      fakeBackend({ list: async () => [shell], load: (id) => mem.load(id), save }),
    );

    await store.getState().refresh();
    expect(store.getState().listStatus).toBe('ready');
    expect(store.getState().meta[full.id]!.loaded).toBe(false);
    expect(store.getState().updateCase(full.id, (d) => void (d.sala = 'X'))).toBe(false);
    expect(await store.getState().save(full.id)).toBe(false);
    expect(save).not.toHaveBeenCalled();

    const loaded = await store.getState().load(full.id);
    expect(loaded?.pre_assessment.alergia).toBe('ninguna');
    expect(store.getState().meta[full.id]!.loaded).toBe(true);

    // A later refresh keeps the loaded local copy (with edits) instead of the shell.
    store.getState().updateCase(full.id, (d) => void (d.sala = 'Q9'));
    await store.getState().refresh();
    expect(store.getState().getCase(full.id)!.sala).toBe('Q9');
    expect(store.getState().getCase(full.id)!.pre_assessment.alergia).toBe('ninguna');

    expect(await store.getState().save(full.id)).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect((await mem.load(full.id)).sala).toBe('Q9');
  });

  it('refresh failure sets listError and keeps existing cases', async () => {
    const store = createCaseStore(
      fakeBackend({ list: async () => Promise.reject(new BackendError('network', 'offline')) }),
    );
    const c = store.getState().createCase('o');
    await store.getState().refresh();
    expect(store.getState().listStatus).toBe('error');
    expect(store.getState().listError).toBe('offline');
    expect(store.getState().getCase(c.id)).toBeDefined();
  });

  it('exportForm saves first, then exports', async () => {
    const order: string[] = [];
    const store = createCaseStore(
      fakeBackend({
        save: async (c) => {
          order.push('save');
          return c;
        },
        exportForm: async (_id, form) => {
          order.push(`export:${form}`);
          return new Blob(['%PDF']);
        },
      }),
    );
    const c = store.getState().createCase('o');
    await vi.waitFor(() => expect(store.getState().meta[c.id]!.saving).toBe(false));
    order.length = 0;
    const blob = await store.getState().exportForm(c.id, 'nota_postanestesica');
    expect(blob.size).toBe(4);
    expect(order).toEqual(['save', 'export:nota_postanestesica']);
  });

  it('serializes overlapping saves of one case: one follow-up PUT with the latest state', async () => {
    const puts: { body: AnesthesiaCase; d: ReturnType<typeof deferred<AnesthesiaCase>> }[] = [];
    const save = vi.fn((c: AnesthesiaCase) => {
      const d = deferred<AnesthesiaCase>();
      puts.push({ body: cloneCase(c), d });
      return d.promise;
    });
    const seed = newCase('o');
    const store = createCaseStore(fakeBackend({ load: async () => cloneCase(seed), save }));
    await store.getState().load(seed.id);
    // load() of an unknown id pushes the case; make it editable.
    store.getState().updateCase(seed.id, (d) => {
      d.sala = 'A';
    });

    const first = store.getState().save(seed.id);
    store.getState().updateCase(seed.id, (d) => {
      d.sala = 'B';
    });
    const second = store.getState().save(seed.id); // e.g. Hub save-on-leave
    const third = store.getState().save(seed.id); // coalesced into the same follow-up
    expect(save).toHaveBeenCalledTimes(1); // no overlapping PUT
    expect(second).toBe(third);

    puts[0]!.d.resolve(puts[0]!.body);
    expect(await first).toBe(true);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(puts[1]!.body.sala).toBe('B'); // the follow-up carries the latest local state
    puts[1]!.d.resolve(puts[1]!.body);
    expect(await second).toBe(true);
    expect(await third).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(store.getState().isDirty(seed.id)).toBe(false);
    expect(store.getState().getCase(seed.id)!.sala).toBe('B');
  });

  it('a save queued behind a PUT that already covered every edit sends nothing more', async () => {
    const d = deferred<AnesthesiaCase>();
    const save = vi.fn(() => d.promise);
    const seed = newCase('o');
    const store = createCaseStore(fakeBackend({ load: async () => cloneCase(seed), save }));
    await store.getState().load(seed.id);
    store.getState().updateCase(seed.id, (x) => {
      x.sala = 'A';
    });
    const first = store.getState().save(seed.id);
    const second = store.getState().save(seed.id);
    d.resolve(cloneCase(store.getState().getCase(seed.id)!));
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('a queued save still runs after the in-flight PUT fails', async () => {
    let n = 0;
    const save = vi.fn(async (c: AnesthesiaCase) => {
      n += 1;
      if (n === 1) throw new BackendError('network', 'offline');
      return c;
    });
    const seed = newCase('o');
    const store = createCaseStore(fakeBackend({ load: async () => cloneCase(seed), save }));
    await store.getState().load(seed.id);
    store.getState().updateCase(seed.id, (x) => {
      x.sala = 'A';
    });
    const first = store.getState().save(seed.id);
    const second = store.getState().save(seed.id);
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(store.getState().isDirty(seed.id)).toBe(false);
  });
});

describe('exportForm — failed pre-export save keeps its cause', () => {
  it.each([
    ['network', new BackendError('network', 'Failed to fetch'), /could not be reached/],
    ['http 500', BackendError.http(500, '{"detail":"boom"}'), /HTTP 500 — boom/],
  ])('%s', async (_name, err, expected) => {
    const c = newCase('Dr. Demo');
    const backend = new InMemoryBackend([c]);
    const store = createCaseStore(backend);
    await store.getState().load(c.id);
    store.getState().updateCase(c.id, (d) => {
      d.sala = 'Q1';
    });
    vi.spyOn(backend, 'save').mockRejectedValue(err);
    const thrown = await store.getState().exportForm(c.id, 'nota_postanestesica').catch((e: unknown) => e);
    expect((thrown as Error).cause).toBe(err);
    expect(exportErrorMessage(thrown)).toMatch(expected);
  });

  it('an admin load reads through loadForAdmin and keeps the copy view-only', async () => {
    const mem = new InMemoryBackend([]);
    const c = await mem.create('Dr. Demo');
    const load = vi.fn((id: string) => mem.load(id));
    const loadForAdmin = vi.fn((id: string) => mem.load(id));
    const save = vi.fn((x: AnesthesiaCase) => mem.save(x));
    const store = createCaseStore(fakeBackend({ load, loadForAdmin, save }));

    await store.getState().load(c.id, { access: 'admin' });
    expect(loadForAdmin).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
    expect(store.getState().meta[c.id]?.viewOnly).toBe(true);

    // Content edits and saves are refused (even for a draft).
    expect(store.getState().updateCase(c.id, (d) => void (d.sala = 'X'))).toBe(false);
    expect(await store.getState().save(c.id)).toBe(false);
    expect(save).not.toHaveBeenCalled();

    // Already loaded as admin → no second request; an owner-scope load re-reads via /cases.
    await store.getState().load(c.id, { access: 'admin' });
    expect(loadForAdmin).toHaveBeenCalledTimes(1);
    await store.getState().load(c.id);
    expect(load).toHaveBeenCalledTimes(1);
    expect(store.getState().meta[c.id]?.viewOnly).toBe(false);

    // forget drops local state without calling the backend.
    store.getState().forget(c.id);
    expect(store.getState().getCase(c.id)).toBeUndefined();
    expect(store.getState().meta[c.id]).toBeUndefined();
  });
});

describe('reset() drops responses still in flight for the previous session', () => {
  /** A synthetic case with a (fake) patient name, as the server would list it. */
  const synth = (name = 'Paciente Sintetico A') => {
    const c = newCase('Dr. A');
    c.patient.nombre = name;
    return c;
  };

  it('a list in flight when reset() runs never reaches the store', async () => {
    const list = deferred<AnesthesiaCase[]>();
    const store = createCaseStore(fakeBackend({ list: () => list.promise }));
    const p = store.getState().refresh();
    store.getState().reset();
    list.resolve([synth()]);
    await p;
    expect(store.getState().cases).toEqual([]);
    expect(store.getState().meta).toEqual({});
    expect(store.getState().listStatus).toBe('idle');
  });

  it('a failing list in flight does not set an error on the new session either', async () => {
    const list = deferred<AnesthesiaCase[]>();
    const store = createCaseStore(fakeBackend({ list: () => list.promise }));
    const p = store.getState().refresh();
    store.getState().reset();
    list.reject(new BackendError('network', 'Failed to fetch'));
    await p;
    expect(store.getState().listStatus).toBe('idle');
    expect(store.getState().listError).toBeNull();
  });

  it.each(['owner', 'admin'] as const)('a %s load in flight when reset() runs is dropped', async (access) => {
    const c = synth();
    const got = deferred<AnesthesiaCase>();
    const store = createCaseStore(fakeBackend({ load: () => got.promise, loadForAdmin: () => got.promise }));
    const p = store.getState().load(c.id, { access });
    store.getState().reset();
    got.resolve(c);
    expect(await p).toBeUndefined();
    expect(store.getState().cases).toEqual([]);
    expect(store.getState().meta).toEqual({});
  });

  it('a PUT in flight when reset() runs neither updates nor re-creates anything', async () => {
    const put = deferred<AnesthesiaCase>();
    const save = vi.fn(() => put.promise);
    const store = createCaseStore(fakeBackend({ save }));
    const c = store.getState().createCase('Dr. A');
    store.getState().updateCase(c.id, (d) => void (d.sala = 'Q2'));
    const queued = store.getState().save(c.id); // a follow-up queued behind the in-flight PUT
    store.getState().reset();
    put.resolve(cloneCase(c));
    expect(await queued).toBe(false);
    expect(save).toHaveBeenCalledTimes(1); // the queued follow-up never ran
    expect(store.getState().cases).toEqual([]);
    expect(store.getState().meta).toEqual({});
  });

  it('a delete waiting on a PUT never sends DELETE under the next session', async () => {
    const put = deferred<AnesthesiaCase>();
    const del = vi.fn(async () => {});
    const store = createCaseStore(fakeBackend({ save: () => put.promise, delete: del }));
    const c = store.getState().createCase('Dr. A');
    const p = store.getState().delete(c.id);
    store.getState().reset();
    put.resolve(cloneCase(c));
    await p;
    expect(del).not.toHaveBeenCalled();
    expect(store.getState().listError).toBeNull();
  });

  it('finalize / generateDocument / exportForm reject and cache nothing when the session changed', async () => {
    const c = synth();
    for (const run of [
      (st: ReturnType<typeof createCaseStore>) => st.getState().finalize(c.id),
      (st: ReturnType<typeof createCaseStore>) => st.getState().generateDocument(c.id, 'nota_postanestesica'),
      (st: ReturnType<typeof createCaseStore>) => st.getState().exportForm(c.id, 'nota_postanestesica'),
    ]) {
      const got = deferred<AnesthesiaCase>();
      const finalize = vi.fn(async () => c);
      const generateDocument = vi.fn();
      const exportForm = vi.fn();
      const store = createCaseStore(
        fakeBackend({ load: () => got.promise, finalize, generateDocument, exportForm }),
      );
      const p = run(store);
      store.getState().reset();
      got.resolve(cloneCase(c));
      await expect(p).rejects.toBeInstanceOf(SessionChangedError);
      expect(store.getState().cases).toEqual([]);
      expect(finalize).not.toHaveBeenCalled();
      expect(generateDocument).not.toHaveBeenCalled();
      expect(exportForm).not.toHaveBeenCalled();
    }
  });

  it('a finalize answered after reset() does not install the locked copy', async () => {
    const c = synth();
    const done = deferred<AnesthesiaCase>();
    const store = createCaseStore(fakeBackend({ load: async () => cloneCase(c), finalize: () => done.promise }));
    await store.getState().load(c.id);
    const p = store.getState().finalize(c.id);
    await vi.waitFor(() => expect(store.getState().meta[c.id]).toBeDefined());
    await Promise.resolve();
    store.getState().reset();
    done.resolve({ ...cloneCase(c), status: 'finalized' });
    await expect(p).rejects.toBeInstanceOf(SessionChangedError);
    expect(store.getState().cases).toEqual([]);
  });

  it('restoreDrafts across a reset installs nothing and hands the drafts back as kept', async () => {
    const c = synth();
    const got = deferred<AnesthesiaCase>();
    const save = vi.fn();
    const store = createCaseStore(fakeBackend({ load: () => got.promise, save }));
    const p = store.getState().restoreDrafts([{ case: cloneCase(c), savedAt: '2026-09-25T10:00:00Z', pendingCreate: false }]);
    store.getState().reset();
    got.resolve(cloneCase(c));
    const report = await p;
    expect(report.kept.map((d) => d.case.id)).toEqual([c.id]);
    expect(store.getState().cases).toEqual([]);
    expect(store.getState().draftConflicts).toEqual({});
    expect(save).not.toHaveBeenCalled();
  });
});

/** A stored-document row (the in-memory backend cannot render forms). */
const stubDocument = async () => ({ id: 'dddddddd-0000-4000-8000-000000000001' }) as DocumentDTO;

describe('store actions keep an admin copy view-only', () => {
  it.each([
    ['generateDocument', (st: ReturnType<typeof createCaseStore>, id: string) =>
      st.getState().generateDocument(id, 'nota_postanestesica', { access: 'admin' })],
    ['exportForm', (st: ReturnType<typeof createCaseStore>, id: string) =>
      st.getState().exportForm(id, 'nota_postanestesica', { access: 'admin' })],
  ])('%s with admin access reads via loadForAdmin, never saves, never caches an editable copy', async (_n, run) => {
    const mem = new InMemoryBackend([]);
    const c = await mem.create('Dr. Demo');
    const load = vi.fn((id: string) => mem.load(id));
    const loadForAdmin = vi.fn((id: string) => mem.load(id));
    const save = vi.fn((x: AnesthesiaCase) => mem.save(x));
    const store = createCaseStore(fakeBackend({ load, loadForAdmin, save, generateDocument: stubDocument }));
    await run(store, c.id);
    expect(loadForAdmin).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(store.getState().meta[c.id]?.viewOnly).toBe(true);
    expect(store.getState().updateCase(c.id, (d) => void (d.sala = 'X'))).toBe(false);
  });

  it('without an explicit access, an action keeps the access of the cached copy', async () => {
    const mem = new InMemoryBackend([]);
    const c = await mem.create('Dr. Demo');
    const load = vi.fn((id: string) => mem.load(id));
    const loadForAdmin = vi.fn((id: string) => mem.load(id));
    const store = createCaseStore(fakeBackend({ load, loadForAdmin, generateDocument: stubDocument }));
    await store.getState().load(c.id, { access: 'admin' });
    await store.getState().generateDocument(c.id, 'nota_postanestesica');
    await store.getState().exportForm(c.id, 'nota_postanestesica');
    expect(load).not.toHaveBeenCalled();
    expect(store.getState().meta[c.id]?.viewOnly).toBe(true);
  });

  it('an owner copy loaded for an action stays editable (owner is the default)', async () => {
    const mem = new InMemoryBackend([]);
    const c = await mem.create('Dr. Demo');
    const load = vi.fn((id: string) => mem.load(id));
    const loadForAdmin = vi.fn((id: string) => mem.load(id));
    const store = createCaseStore(fakeBackend({ load, loadForAdmin, generateDocument: stubDocument }));
    await store.getState().generateDocument(c.id, 'nota_postanestesica');
    expect(load).toHaveBeenCalledTimes(1);
    expect(loadForAdmin).not.toHaveBeenCalled();
    expect(store.getState().meta[c.id]?.viewOnly).toBe(false);
  });
});
