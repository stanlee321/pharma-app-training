/**
 * Guarded localStorage access. Storage can be missing or throw (private mode, blocked site
 * data, SSR/tests), so every call is wrapped and failures degrade to "no value".
 */
export const StorageKeys = {
  /** Backend API base, editable under Login → Advanced → "Server" (same key as iOS). */
  baseUrl: 'backend_base_url',
  /** Signed-in session `{token, expires_at, user}` so a reload keeps the login (MVP: JWT in localStorage). */
  session: 'auth_session_v1',
  /**
   * Unsaved case edits kept across an involuntary sign-out (token expiry / 401), per user id,
   * restored at that user's next login. Holds case data, so it is short-lived (see authStore).
   */
  drafts: (userId: string) => `case_drafts_v1:${userId}`,
} as const;

function store(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readString(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeString(key: string, value: string): void {
  try {
    store()?.setItem(key, value);
  } catch {
    /* storage unavailable: keep in-memory state only */
  }
}

export function removeKey(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function readJSON<T>(key: string): T | null {
  const raw = readString(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJSON(key: string, value: unknown): void {
  writeString(key, JSON.stringify(value));
}

// ---- Session drafts (PHI: unsaved case edits kept across an involuntary sign-out) -------------

/** Drafts older than this are dropped instead of restored (they hold patient data). */
export const DRAFT_TTL_MS = 24 * 3600_000;

const DRAFTS_PREFIX = 'case_drafts_v1:';

/**
 * One stored draft. `saved_at` is per case, so merging new drafts into a stored set never
 * extends an older entry's lifetime. `case` is the full local aggregate (with the server's
 * `updated_at` it was based on); `pending_create` = never confirmed by the server.
 */
export interface DraftEntry<C = unknown> {
  saved_at: string;
  pending_create: boolean;
  case: C;
}

export interface StoredDrafts<C = unknown> {
  v: 2;
  entries: DraftEntry<C>[];
}

const isFresh = (savedAt: unknown, now: number): boolean => {
  const t = typeof savedAt === 'string' ? Date.parse(savedAt) : NaN;
  const age = now - t;
  return age >= 0 && age <= DRAFT_TTL_MS;
};

/**
 * Parse a stored drafts value: the v2 shape, or the legacy v1 `{saved_at, cases}` (read as
 * entries sharing that timestamp). Null when the value is not a drafts object at all.
 */
function parseDrafts(raw: unknown): DraftEntry[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as { v?: unknown; entries?: unknown; saved_at?: unknown; cases?: unknown };
  if (o.v === 2 && Array.isArray(o.entries)) {
    return o.entries.filter(
      (e): e is DraftEntry =>
        !!e && typeof e === 'object' && typeof (e as DraftEntry).saved_at === 'string' && !!(e as DraftEntry).case,
    );
  }
  if (typeof o.saved_at === 'string' && Array.isArray(o.cases)) {
    return o.cases.filter(Boolean).map((c) => ({ saved_at: o.saved_at as string, pending_create: false, case: c }));
  }
  return null;
}

/** `userId`'s stored drafts that are still within the TTL (expired entries are left for the sweep). */
export function readDrafts<C>(userId: string, now = Date.now()): DraftEntry<C>[] {
  const entries = parseDrafts(readJSON<unknown>(StorageKeys.drafts(userId))) ?? [];
  return entries.filter((e) => isFresh(e.saved_at, now)) as DraftEntry<C>[];
}

/** Replace `userId`'s stored drafts (an empty list removes the key). */
export function writeDrafts<C>(userId: string, entries: DraftEntry<C>[]): void {
  if (entries.length === 0) removeKey(StorageKeys.drafts(userId));
  else writeJSON(StorageKeys.drafts(userId), { v: 2, entries } satisfies StoredDrafts<C>);
}

/** Every localStorage key (guarded; [] when storage is unavailable). */
function allKeys(): string[] {
  try {
    const s = store();
    if (!s) return [];
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k != null) keys.push(k);
    }
    return keys;
  } catch {
    return [];
  }
}

/**
 * Sweep EVERY user's stored drafts (`case_drafts_v1:*`), not only the signed-in user's: remove
 * unparsable values and entries older than `DRAFT_TTL_MS`, and the key once nothing is left. A
 * departed user's patient data on a shared workstation therefore never outlives the TTL. Run at
 * app boot and on every login and logout. Returns how many keys were removed.
 */
export function purgeExpiredDrafts(now = Date.now()): number {
  let removed = 0;
  for (const key of allKeys()) {
    if (!key.startsWith(DRAFTS_PREFIX)) continue;
    const entries = parseDrafts(readJSON<unknown>(key));
    const fresh = entries?.filter((e) => isFresh(e.saved_at, now)) ?? [];
    if (fresh.length === 0) {
      removeKey(key);
      removed++;
    } else if (entries && fresh.length !== entries.length) {
      writeJSON(key, { v: 2, entries: fresh } satisfies StoredDrafts);
    }
  }
  return removed;
}
