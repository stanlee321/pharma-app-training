/**
 * Screen-facing case store — TS port of Swift `MockCaseStore` (Services/CaseStore.swift).
 *
 * Semantics kept from Swift:
 * - `cases` is a synchronously-readable snapshot the screens bind to.
 * - `createCase` is optimistic: append a local case now, PUT it in the background, then swap in
 *   the server-derived copy (matched by id).
 * - `delete` is optimistic: drop locally, then tell the backend.
 * - `refresh()` pulls the list (summary *shells*).
 * - `save(id)` is a full-aggregate PUT; the index is re-resolved after the await.
 * - `exportForm` = save, then POST export.
 *
 * Hardening beyond Swift (the list returns shells only, so a naive save could wipe a case):
 * - `load(id)` fetches the full aggregate; `updateCase`/`save` refuse to act on an unloaded shell.
 * - Each local edit bumps a revision; a save response only replaces local state if no edit
 *   happened while the request was in flight (otherwise the newer local edits are kept dirty).
 * - `refresh()` keeps loaded/pending-create cases' local copies and never resurrects a case
 *   deleted this session.
 * - Saves are serialized per case: a `save(id)` requested while a PUT for that case is in
 *   flight does not start a second, overlapping PUT (the server could apply them out of order).
 *   It marks a follow-up instead; exactly one more PUT runs with the latest local state once the
 *   in-flight one settles, and every caller waiting on it gets that PUT's result.
 *
 * Lifecycle (draft → finalized):
 * - A finalized case is locked: `updateCase` and `save` refuse it (the UI is read-only too).
 * - A PUT answered 409 (finalized elsewhere) sets a readable `meta.notice` and reloads the locked
 *   server copy, dropping the edits that can no longer be saved.
 * - `finalize(id)` saves pending edits first, then `POST /cases/{id}/finalize`; on 409 the case is
 *   reloaded and the error re-thrown for the screen to explain.
 * - `generateDocument` saves a dirty draft first so the stored PDF shows what is on screen.
 *
 * Session isolation: `reset()` (sign-out / account change) bumps a session epoch. Every async
 * action captures the epoch before its first await and, if it changed meanwhile, drops its result
 * (no `set`, no `patchMeta`, no follow-up request), so a response that was in flight for the
 * previous account can never land in the next account's store.
 *
 * Session drafts: `dirtyDrafts()` / `restoreDrafts()` let the auth store keep unsaved edits across
 * an involuntary sign-out (token expiry, 401) and give them back to the same user. A restored
 * draft is never re-PUT blindly: the server copy is read first, and the draft is saved only if
 * the case still exists, is a draft and has the same `updated_at` the draft was based on.
 * Otherwise it is dropped (deleted on the server) or parked in `draftConflicts` next to the
 * loaded server copy, for the user to re-apply or discard on the case screen.
 */
import { createStore, useStore, type StoreApi } from 'zustand';
import { BackendError, errorMessage, type CaseBackend } from '../api/backend';
import { caseTitle, cloneCase, newCase } from '../api/factory';
import { CaseStoreProvider } from '../api/provider';
import type { AnesthesiaCase, DocumentDTO, FormId } from '../api/types';

/** Per-case bookkeeping. */
export interface CaseMeta {
  /** The full aggregate (not a list shell) is in `cases`. */
  loaded: boolean;
  /** Created locally; the first PUT has not succeeded yet. */
  pendingCreate: boolean;
  /** Local edit counter; `savedRev` is the revision last confirmed by the server. */
  rev: number;
  savedRev: number;
  saving: boolean;
  saveError: string | null;
  savedAt: number | null;
  loading: boolean;
  loadError: string | null;
  /** One-shot message for the screen (e.g. a 409 lock conflict); cleared by `clearNotice`. */
  notice: string | null;
  /**
   * Loaded through the admin route (`GET /admin/cases/{id}`): an admin may only read case content,
   * so `updateCase` and `save` refuse it whatever its status.
   */
  viewOnly: boolean;
}

/** How a case is read: as its owner (`GET /cases/{id}`) or as an admin (`GET /admin/cases/{id}`). */
export type CaseLoadAccess = 'owner' | 'admin';

/** How a store action that may need to load the case reads it (see `exportForm`). */
export interface ActionOpts {
  access?: CaseLoadAccess;
}

/** Thrown by an action whose session ended (sign-out / account change) while it was running. */
export class SessionChangedError extends Error {
  constructor() {
    super('The session changed while this request was running; its result was dropped.');
    this.name = 'SessionChangedError';
  }
}

export type ListStatus = 'idle' | 'loading' | 'ready' | 'error';

/** A session draft handed to / taken from the store (see authStore's stash/restore). */
export interface SessionDraft {
  case: AnesthesiaCase;
  /** When this case's draft was first stored (ISO); never extended by a later merge. */
  savedAt: string;
  /** The server never confirmed the case (its first PUT had not succeeded). */
  pendingCreate: boolean;
}

/**
 * A restored draft that was NOT applied because the server copy moved on since the draft was
 * taken (`changed`: another device/tab saved, or an admin reopened it) or the case is now locked
 * (`finalized`). The server copy is what the screens show; the case screen offers to re-apply
 * (draft cases only) or discard.
 */
export interface DraftConflict {
  draft: AnesthesiaCase;
  savedAt: string;
  reason: 'changed' | 'finalized';
}

/** What happened to each restored draft (for the "restored unsaved changes" notice). */
export interface DraftRestoreReport {
  /** Re-applied and saved to the server. */
  saved: number;
  /** Titles of cases whose server copy changed or was finalized: not applied, review on the case. */
  conflicts: string[];
  /** Titles of cases deleted on the server: the draft was dropped. */
  deleted: string[];
  /** Titles of cases re-applied locally whose save failed (they stay unsaved on screen). */
  unsaved: string[];
  /** Drafts that could not be checked (server unreachable): to be kept for the next sign-in. */
  kept: SessionDraft[];
}

export interface CaseStoreState {
  backend: CaseBackend;
  cases: AnesthesiaCase[];
  meta: Record<string, CaseMeta>;
  listStatus: ListStatus;
  listError: string | null;
  /** Restored drafts held back because the server copy changed (see `DraftConflict`). */
  draftConflicts: Record<string, DraftConflict>;

  setBackend(backend: CaseBackend): void;
  /** Clear all local state (e.g. on sign-out / tenant change). */
  reset(): void;

  indexOf(id: string): number;
  getCase(id: string): AnesthesiaCase | undefined;
  isDirty(id: string): boolean;
  /** The (local copy of the) case is finalized, i.e. locked. */
  isFinalized(id: string): boolean;
  clearNotice(id: string): void;

  createCase(owner: string): AnesthesiaCase;
  /**
   * Apply a local edit. `recipe` receives a deep copy it may mutate and/or return a replacement.
   * No-op (returns false) for an unknown id or an unloaded list shell.
   */
  updateCase(id: string, recipe: (draft: AnesthesiaCase) => AnesthesiaCase | void): boolean;
  /**
   * Optimistic delete: drops the case locally at once, then waits for any in-flight / queued
   * PUT of that case to settle before sending DELETE (so a late PUT cannot re-create it).
   */
  delete(id: string): Promise<void>;
  refresh(): Promise<void>;
  /**
   * Fetch the full aggregate (no-op if already loaded unless `force`). A forced reload keeps
   * unsaved local edits unless `discard` (used after a 409: they can no longer be saved).
   */
  load(
    id: string,
    opts?: { force?: boolean; discard?: boolean; access?: CaseLoadAccess },
  ): Promise<AnesthesiaCase | undefined>;
  /** Drop a case from local state without calling the backend (e.g. an admin deleted it). */
  forget(id: string): void;
  /** Full-aggregate PUT. Resolves true on success. */
  save(id: string): Promise<boolean>;
  /**
   * Save, then render one filled form PDF server-side. Throws on failure. `access` (default: the
   * cached copy's, else owner) decides how an unloaded case is read, so an admin caller never
   * caches an editable copy.
   */
  exportForm(id: string, formId: string, opts?: ActionOpts): Promise<Blob>;
  /** Save pending edits, then lock the case (the server stores the 4 forms). Throws on failure. */
  finalize(id: string, opts?: ActionOpts): Promise<AnesthesiaCase>;
  /** Render + store one form (a dirty draft is saved first). Throws on failure. */
  generateDocument(id: string, formId: FormId, opts?: ActionOpts): Promise<DocumentDTO>;
  /** Save every dirty, loaded case; resolves true if all saves succeeded. */
  saveAllDirty(): Promise<boolean>;
  /**
   * Unsaved work to keep across an involuntary sign-out: loaded cases with edits the server has
   * not confirmed (stamped `savedAt = now`) plus unresolved draft conflicts (original `savedAt`).
   */
  dirtyDrafts(now?: string): SessionDraft[];
  /**
   * Give stored drafts back after sign-in. For each: GET the server copy first. 404 → dropped
   * (unless never created: then it is created); finalized or a different `updated_at` → the server
   * copy is loaded and the draft parked in `draftConflicts`; unchanged → restored as a dirty local
   * copy and saved. Unreachable server → returned in `kept`.
   */
  restoreDrafts(drafts: SessionDraft[]): Promise<DraftRestoreReport>;
  /** Replace the server copy with the parked draft and save it (drafts only). Returns false if not possible. */
  reapplyDraft(id: string): boolean;
  /** Forget a parked draft. */
  discardDraft(id: string): void;
}

const freshMeta = (over: Partial<CaseMeta> = {}): CaseMeta => ({
  loaded: false,
  pendingCreate: false,
  rev: 0,
  savedRev: 0,
  saving: false,
  saveError: null,
  savedAt: null,
  loading: false,
  loadError: null,
  notice: null,
  viewOnly: false,
  ...over,
});

/** Readable text for a 409 on a case write. */
function conflictNotice(detail: string | null): string {
  if (detail === 'case is finalized') {
    return 'This case has been finalized, so it is now read-only. Unsaved changes could not be saved; the locked version was reloaded.';
  }
  return `The server refused the change (${detail ?? 'conflict'}). The case was reloaded.`;
}

const isConflict = (e: unknown): e is BackendError => e instanceof BackendError && e.status === 409;

export function createCaseStore(initialBackend: CaseBackend): StoreApi<CaseStoreState> {
  /** Ids deleted this session — never resurrected by a racing refresh. */
  const tombstones = new Set<string>();
  /** Per-case save serialization: the PUT in flight, and the single queued follow-up. */
  const inflight = new Map<string, Promise<boolean>>();
  const queued = new Map<string, Promise<boolean>>();
  /** The raw error of each case's last failed PUT, so export can surface its real cause. */
  const lastSaveError = new Map<string, unknown>();
  /** Session epoch, bumped by `reset()`: results of requests started in an older epoch are dropped. */
  let epoch = 0;

  return createStore<CaseStoreState>()((set, get) => {
    const patchMeta = (id: string, over: Partial<CaseMeta>) =>
      set((s) => ({ meta: { ...s.meta, [id]: { ...(s.meta[id] ?? freshMeta()), ...over } } }));

    const replaceCase = (c: AnesthesiaCase) =>
      set((s) => {
        const i = s.cases.findIndex((x) => x.id === c.id);
        if (i < 0) return {};
        const cases = s.cases.slice();
        cases[i] = c;
        return { cases };
      });

    /** One full-aggregate PUT (never called concurrently for the same id). */
    const putOnce = async (id: string): Promise<boolean> => {
      const c0 = get().getCase(id);
      const m0 = get().meta[id];
      if (!c0 || !m0) return false;
      if (!m0.loaded) {
        patchMeta(id, { saveError: 'Case not loaded yet — refusing to overwrite it.' });
        return false;
      }
      if (c0.status === 'finalized') {
        patchMeta(id, { saveError: 'This case is finalized and read-only.' });
        return false;
      }
      if (m0.viewOnly) {
        patchMeta(id, { saveError: 'This case is open read-only.' });
        return false;
      }
      const rev = m0.rev;
      const ep = epoch;
      patchMeta(id, { saving: true, saveError: null });
      let saved: AnesthesiaCase;
      try {
        saved = await get().backend.save(c0);
      } catch (e) {
        if (ep !== epoch) return false; // signed out meanwhile: this session's store is gone
        lastSaveError.set(id, e);
        if (!get().meta[id]) return false;
        if (isConflict(e)) {
          // Locked elsewhere: these edits can never land. Explain, then show the server copy.
          patchMeta(id, { saving: false, saveError: null, notice: conflictNotice(e.detail) });
          await get().load(id, { force: true, discard: true, access: accessOf(id) });
          return false;
        }
        patchMeta(id, { saving: false, saveError: errorMessage(e) });
        return false;
      }
      if (ep !== epoch) return false;
      lastSaveError.delete(id);
      // Re-resolve after the await: the case may have been deleted or edited meanwhile.
      const m = get().meta[id];
      if (!m || get().indexOf(id) < 0) return true;
      if (m.rev === rev) {
        replaceCase(saved);
        patchMeta(id, {
          saving: false,
          saveError: null,
          pendingCreate: false,
          savedRev: rev,
          savedAt: Date.now(),
        });
      } else {
        // Newer local edits exist: keep them (still dirty), just record the server ack — and the
        // server-owned lifecycle fields, so `updated_at` matches the server's (refresh / drafts).
        set((s) => ({
          cases: s.cases.map((c) =>
            c.id === id
              ? { ...c, status: saved.status, updated_at: saved.updated_at, finalized_at: saved.finalized_at, user_id: saved.user_id }
              : c,
          ),
        }));
        patchMeta(id, { saving: false, saveError: null, pendingCreate: false, savedAt: Date.now() });
      }
      return true;
    };

    /** The access the cached copy of `id` was read with (owner when unknown). */
    const accessOf = (id: string): CaseLoadAccess => (get().meta[id]?.viewOnly ? 'admin' : 'owner');

    /**
     * Make sure `id` is loaded under `access` (explicit, else the cached copy's): an unloaded case,
     * or one cached under the other access mode, is (re)read. Throws if the session changed.
     */
    const ensureLoaded = async (id: string, ep: number, access?: CaseLoadAccess) => {
      const want = access ?? accessOf(id);
      const m = get().meta[id];
      if (!m?.loaded || m.viewOnly !== (want === 'admin')) await get().load(id, { access: want });
      if (ep !== epoch) throw new SessionChangedError();
    };

    /** Start one PUT for `id` and register it as the in-flight save. */
    const start = (id: string): Promise<boolean> => {
      const p = putOnce(id).finally(() => {
        if (inflight.get(id) === p) inflight.delete(id);
      });
      inflight.set(id, p);
      return p;
    };

    return {
      backend: initialBackend,
      cases: [],
      meta: {},
      listStatus: 'idle',
      listError: null,
      draftConflicts: {},

      setBackend(backend) {
        set({ backend });
      },

      reset() {
        epoch++;
        tombstones.clear();
        inflight.clear();
        queued.clear();
        lastSaveError.clear();
        set({ cases: [], meta: {}, listStatus: 'idle', listError: null, draftConflicts: {} });
      },

      indexOf(id) {
        return get().cases.findIndex((c) => c.id === id);
      },

      getCase(id) {
        return get().cases.find((c) => c.id === id);
      },

      isDirty(id) {
        const m = get().meta[id];
        return !!m && m.rev !== m.savedRev;
      },

      isFinalized(id) {
        return get().getCase(id)?.status === 'finalized';
      },

      clearNotice(id) {
        if (get().meta[id]?.notice) patchMeta(id, { notice: null });
      },

      createCase(owner) {
        const c = newCase(owner);
        set((s) => ({
          cases: [...s.cases, c],
          meta: { ...s.meta, [c.id]: freshMeta({ loaded: true, pendingCreate: true, rev: 1 }) },
        }));
        void get().save(c.id);
        return c;
      },

      updateCase(id, recipe) {
        const { cases, meta } = get();
        const i = cases.findIndex((c) => c.id === id);
        const m = meta[id];
        if (i < 0 || !m?.loaded) return false;
        if (cases[i]!.status === 'finalized') return false; // locked
        if (m.viewOnly) return false; // an admin's read-only copy
        const draft = cloneCase(cases[i]!);
        const next = recipe(draft) ?? draft;
        next.id = id; // the id is client-owned and immutable
        const updated = cases.slice();
        updated[i] = next;
        set({ cases: updated, meta: { ...meta, [id]: { ...m, rev: m.rev + 1 } } });
        return true;
      },

      async delete(id) {
        const ep = epoch;
        tombstones.add(id);
        // Captured before the local removal: the save(s) that must land before the DELETE.
        const pending = [inflight.get(id), queued.get(id)].filter((p): p is Promise<boolean> => !!p);
        set((s) => {
          const meta = { ...s.meta };
          delete meta[id];
          const draftConflicts = { ...s.draftConflicts };
          delete draftConflicts[id];
          return { cases: s.cases.filter((c) => c.id !== id), meta, draftConflicts };
        });
        // A queued follow-up finds the case gone and sends nothing; the in-flight PUT completes.
        await Promise.all(pending.map((p) => p.catch(() => false)));
        // Signed out meanwhile: never send the previous account's DELETE under a new session.
        if (ep !== epoch) return;
        try {
          await get().backend.delete(id);
        } catch (e) {
          if (ep !== epoch) return;
          // Not deleted (e.g. 409 finalized): let the next refresh show it again.
          tombstones.delete(id);
          set({ listError: `Delete failed: ${errorMessage(e)}` });
          void get().refresh();
        }
      },

      async refresh() {
        const ep = epoch;
        set({ listStatus: 'loading' });
        let list: AnesthesiaCase[];
        try {
          list = await get().backend.list();
        } catch (e) {
          if (ep === epoch) set({ listStatus: 'error', listError: errorMessage(e) });
          return;
        }
        if (ep !== epoch) return; // another account's list: drop it
        set((s) => {
          const local = new Map(s.cases.map((c) => [c.id, c]));
          const seen = new Set<string>();
          const cases: AnesthesiaCase[] = [];
          const meta: Record<string, CaseMeta> = {};
          for (const shell of list) {
            if (tombstones.has(shell.id)) continue;
            seen.add(shell.id);
            const m = s.meta[shell.id];
            const mine = local.get(shell.id);
            const dirty = !!m && m.rev !== m.savedRev;
            // Keep a loaded copy unless the server's lifecycle moved on and nothing is unsaved
            // (e.g. finalized in another tab, reopened by an admin) → reload it on next open.
            if (m?.loaded && mine && (dirty || (shell.status === mine.status && shell.updated_at === mine.updated_at))) {
              cases.push(mine); // keep the full local aggregate (and any unsaved edits)
              meta[shell.id] = { ...m, pendingCreate: false };
            } else {
              cases.push(shell);
              meta[shell.id] = m ? { ...m, loaded: false } : freshMeta();
            }
          }
          // Keep optimistic creates the server doesn't list yet.
          for (const c of s.cases) {
            const m = s.meta[c.id];
            if (!seen.has(c.id) && m?.pendingCreate) {
              cases.push(c);
              meta[c.id] = m;
            }
          }
          return { cases, meta, listStatus: 'ready', listError: null };
        });
      },

      forget(id) {
        set((s) => {
          if (!s.meta[id] && s.indexOf(id) < 0) return {};
          const meta = { ...s.meta };
          delete meta[id];
          const draftConflicts = { ...s.draftConflicts };
          delete draftConflicts[id];
          return { cases: s.cases.filter((c) => c.id !== id), meta, draftConflicts };
        });
      },

      async load(id, opts = {}) {
        const existing = get().getCase(id);
        const m0 = get().meta[id];
        const viewOnly = opts.access === 'admin';
        // A copy loaded under another access mode is re-read (never serve an owner copy as the
        // admin's, or the reverse).
        const sameAccess = !!m0 && m0.viewOnly === viewOnly;
        if (existing && m0?.loaded && sameAccess && !opts.force) return existing;
        // An optimistic create not yet on the server: the local copy is authoritative.
        if (existing && m0?.pendingCreate) return existing;
        const ep = epoch;
        patchMeta(id, { loading: true, loadError: null });
        let full: AnesthesiaCase;
        try {
          full = viewOnly ? await get().backend.loadForAdmin(id) : await get().backend.load(id);
        } catch (e) {
          if (ep === epoch) patchMeta(id, { loading: false, loadError: errorMessage(e) });
          return undefined;
        }
        if (ep !== epoch || tombstones.has(id)) return undefined;
        const m = get().meta[id] ?? freshMeta();
        // Never clobber unsaved local edits of an already-loaded case with a forced reload.
        if (m.loaded && m.rev !== m.savedRev && !opts.discard) {
          patchMeta(id, { loading: false });
          return get().getCase(id);
        }
        set((s) => {
          const i = s.cases.findIndex((c) => c.id === id);
          const cases = s.cases.slice();
          if (i >= 0) cases[i] = full;
          else cases.push(full);
          return {
            cases,
            meta: {
              ...s.meta,
              [id]: {
                ...m,
                loaded: true,
                loading: false,
                loadError: null,
                pendingCreate: false,
                savedRev: m.rev,
                viewOnly,
              },
            },
          };
        });
        return full;
      },

      save(id) {
        const running = inflight.get(id);
        if (running) {
          let next = queued.get(id);
          if (!next) {
            const ep = epoch;
            next = running
              .catch(() => false)
              .then(() => {
                if (ep !== epoch) return false; // reset() already cleared the queue
                queued.delete(id);
                const m = get().meta[id];
                // Nothing changed since the in-flight PUT succeeded → no second request.
                if (m && m.rev === m.savedRev && !m.pendingCreate && !m.saveError) return true;
                return start(id);
              });
            queued.set(id, next);
          }
          return next;
        }
        return start(id);
      },

      async exportForm(id, formId, opts = {}) {
        const ep = epoch;
        await ensureLoaded(id, ep, opts.access);
        // An admin's read-only copy is never saved (and never dirty): export what the server has.
        if (!get().meta[id]?.viewOnly) {
          const ok = await get().save(id);
          if (ep !== epoch) throw new SessionChangedError();
          if (!ok) {
            const why = get().meta[id]?.saveError ?? 'unknown error';
            throw new Error(`Could not save the case before export: ${why}`, { cause: lastSaveError.get(id) });
          }
        }
        const pdf = await get().backend.exportForm(id, formId);
        if (ep !== epoch) throw new SessionChangedError();
        return pdf;
      },

      async finalize(id, opts = {}) {
        const ep = epoch;
        await ensureLoaded(id, ep, opts.access);
        const m0 = get().meta[id];
        if (!m0?.loaded) throw new Error(`Could not load the case: ${m0?.loadError ?? 'unknown error'}`);
        if (get().isDirty(id) || m0.pendingCreate || inflight.has(id)) {
          const ok = await get().save(id);
          if (ep !== epoch) throw new SessionChangedError();
          if (!ok) {
            const why = get().meta[id]?.notice ?? get().meta[id]?.saveError ?? 'unknown error';
            throw new Error(`Could not save the case before finalizing: ${why}`, { cause: lastSaveError.get(id) });
          }
        }
        let locked: AnesthesiaCase;
        try {
          locked = await get().backend.finalize(id);
        } catch (e) {
          if (ep !== epoch) throw new SessionChangedError();
          // 409: already finalized, or edited while rendering → show the server's current copy.
          if (isConflict(e)) await get().load(id, { force: true, access: accessOf(id) });
          throw e;
        }
        if (ep !== epoch) throw new SessionChangedError();
        if (tombstones.has(id)) return locked;
        set((s) => {
          const i = s.cases.findIndex((c) => c.id === id);
          const cases = s.cases.slice();
          if (i >= 0) cases[i] = locked;
          else cases.push(locked);
          const m = s.meta[id] ?? freshMeta();
          return {
            cases,
            meta: { ...s.meta, [id]: { ...m, loaded: true, pendingCreate: false, savedRev: m.rev, saveError: null } },
          };
        });
        return locked;
      },

      async generateDocument(id, formId, opts = {}) {
        const ep = epoch;
        await ensureLoaded(id, ep, opts.access);
        const m = get().meta[id];
        if (!m?.viewOnly && !get().isFinalized(id) && (get().isDirty(id) || m?.pendingCreate || inflight.has(id))) {
          const ok = await get().save(id);
          if (ep !== epoch) throw new SessionChangedError();
          if (!ok) {
            const why = get().meta[id]?.notice ?? get().meta[id]?.saveError ?? 'unknown error';
            throw new Error(`Could not save the case before generating the form: ${why}`, {
              cause: lastSaveError.get(id),
            });
          }
        }
        const doc = await get().backend.generateDocument(id, formId);
        if (ep !== epoch) throw new SessionChangedError();
        return doc;
      },

      async saveAllDirty() {
        const ids = get()
          .cases.map((c) => c.id)
          .filter((id) => get().meta[id]?.loaded && (get().isDirty(id) || get().meta[id]?.pendingCreate));
        const results = await Promise.all(ids.map((id) => get().save(id)));
        return results.every(Boolean);
      },

      dirtyDrafts(now = new Date().toISOString()) {
        const { cases, meta, draftConflicts } = get();
        const out: SessionDraft[] = cases
          .filter((c) => {
            const m = meta[c.id];
            return !!m?.loaded && c.status !== 'finalized' && (m.rev !== m.savedRev || m.pendingCreate);
          })
          .map((c) => ({ case: cloneCase(c), savedAt: now, pendingCreate: !!meta[c.id]?.pendingCreate }));
        const ids = new Set(out.map((d) => d.case.id));
        for (const [id, conf] of Object.entries(draftConflicts)) {
          if (!ids.has(id)) out.push({ case: cloneCase(conf.draft), savedAt: conf.savedAt, pendingCreate: false });
        }
        return out;
      },

      async restoreDrafts(drafts) {
        const ep = epoch;
        const report: DraftRestoreReport = { saved: 0, conflicts: [], deleted: [], unsaved: [], kept: [] };
        const toSave: string[] = [];
        const titles = new Map<string, string>();
        /** Put `c` in the store as a loaded copy; `dirty` = unsaved (rev ≠ savedRev). */
        const install = (c: AnesthesiaCase, dirty: boolean, pendingCreate = false) =>
          set((s) => {
            const cases = s.cases.slice();
            const i = cases.findIndex((x) => x.id === c.id);
            if (i >= 0) cases[i] = c;
            else cases.push(c);
            const meta = { ...s.meta, [c.id]: freshMeta({ loaded: true, rev: dirty ? 1 : 0, savedRev: 0, pendingCreate }) };
            return { cases, meta };
          });

        await Promise.all(
          drafts.map(async (d) => {
            const draft = d?.case;
            if (!draft || typeof draft.id !== 'string' || draft.status === 'finalized') return;
            let server: AnesthesiaCase | null;
            try {
              server = await get().backend.load(draft.id);
            } catch (e) {
              if (e instanceof BackendError && e.status === 404) {
                if (!d.pendingCreate) {
                  report.deleted.push(caseTitle(draft)); // deleted on the server: never re-create it
                  return;
                }
                server = null; // never reached the server: create it now
              } else {
                report.kept.push(d); // cannot tell what the server has: keep it, touch nothing
                return;
              }
            }
            // Signed out meanwhile: keep the draft for later, install nothing in this store.
            if (ep !== epoch) {
              report.kept.push(d);
              return;
            }
            if (tombstones.has(draft.id)) return;
            if (server && (server.status === 'finalized' || server.updated_at !== draft.updated_at)) {
              install(server, false);
              set((s) => ({
                draftConflicts: {
                  ...s.draftConflicts,
                  [draft.id]: {
                    draft: cloneCase(draft),
                    savedAt: d.savedAt,
                    reason: server.status === 'finalized' ? 'finalized' : 'changed',
                  },
                },
              }));
              report.conflicts.push(caseTitle(server));
              return;
            }
            install(cloneCase(draft), true, server === null);
            toSave.push(draft.id);
            titles.set(draft.id, caseTitle(draft));
          }),
        );
        if (ep !== epoch) return report;
        const results = await Promise.all(toSave.map(async (id) => [id, await get().save(id)] as const));
        for (const [id, ok] of results) {
          if (ok) report.saved++;
          else report.unsaved.push(titles.get(id) ?? id);
        }
        return report;
      },

      reapplyDraft(id) {
        const conf = get().draftConflicts[id];
        const cur = get().getCase(id);
        const m = get().meta[id];
        if (!conf || !cur || !m?.loaded || cur.status === 'finalized') return false;
        // The draft's content on top of the server's current lifecycle fields.
        const c: AnesthesiaCase = {
          ...cloneCase(conf.draft),
          id,
          status: cur.status,
          updated_at: cur.updated_at,
          finalized_at: cur.finalized_at,
          user_id: cur.user_id,
        };
        set((s) => {
          const draftConflicts = { ...s.draftConflicts };
          delete draftConflicts[id];
          return {
            cases: s.cases.map((x) => (x.id === id ? c : x)),
            meta: { ...s.meta, [id]: { ...m, rev: m.rev + 1 } },
            draftConflicts,
          };
        });
        void get().save(id);
        return true;
      },

      discardDraft(id) {
        if (!get().draftConflicts[id]) return;
        set((s) => {
          const draftConflicts = { ...s.draftConflicts };
          delete draftConflicts[id];
          return { draftConflicts };
        });
      },
    };

  });
}

/** The app-wide store, backed by the provider-selected backend (REST by default). */
export const caseStore = createCaseStore(CaseStoreProvider.makeBackend());

/** React hook over the app-wide case store. */
export function useCaseStore<T>(selector: (s: CaseStoreState) => T): T {
  return useStore(caseStore, selector);
}
