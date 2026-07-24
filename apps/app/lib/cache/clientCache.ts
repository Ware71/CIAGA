// Client-side stale-while-revalidate store.
//
// Generalises the old lib/home/homeDataCache.ts (module-level, home-only, and
// by then dead code — the streamed-promise branch in HomeClient meant it was
// written but never read). Every read-heavy page in the app has the same shape:
// mount -> requireViewerSession() -> fetch -> blank loading state, on every
// single visit. This lets them render what the user already saw, immediately,
// and go to the network only when the data is actually stale.
//
// Two layers:
//   - memory: survives navigation within a session, no serialisation cost
//   - localStorage: survives a PWA cold start, so the home screen can paint
//     handicap / last round / highlights before Postgres is even reached
//
// SECURITY: every key is namespaced by profile id and the whole store is wiped
// on any auth state change (wired up in lib/auth/viewerSession.ts). An
// authenticated snapshot must never be readable by the next user on a shared
// device — the same rule the July 2026 audit applied to the service worker
// cache, which is why next.config.mjs serves /api NetworkOnly.

const STORAGE_PREFIX = "ciaga.cache.v1:";

type Entry<T = unknown> = {
  /** Cached value. */
  d: T;
  /** Timestamp (ms) the value was stored. */
  t: number;
};

export type CacheOptions = {
  /**
   * Hard expiry (ms). Past this the entry is dropped and treated as a miss —
   * nothing is rendered from it.
   */
  ttl?: number;
  /**
   * Serve-then-revalidate window (ms). Inside it the entry is fresh and no
   * request is made; past it the value is still returned (so there's no blank
   * flash) but the caller revalidates in the background.
   *
   * Set 0 for anything live — a round in play, a leaderboard, odds — so it is
   * always refetched while still painting instantly from the last snapshot.
   */
  staleTime?: number;
  /** Persist to localStorage so the entry survives a cold start. Default true. */
  persist?: boolean;
};

const DEFAULT_TTL = 30 * 60_000;
const DEFAULT_STALE = 60_000;

const memory = new Map<string, Entry>();

/** Namespace scope. Set once the viewer is known; keys are inert until then. */
let scope: string | null = null;

export function setCacheScope(profileId: string | null): void {
  if (scope === profileId) return;
  // Switching identity — drop everything keyed to the previous one.
  if (scope !== null) clearClientCache();
  scope = profileId;
}

function scopedKey(key: string): string | null {
  return scope ? `${scope}:${key}` : null;
}

function readStorage<T>(fullKey: string): Entry<T> | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + fullKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Entry<T>;
    if (!parsed || typeof parsed.t !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStorage(fullKey: string, entry: Entry): void {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + fullKey, JSON.stringify(entry));
  } catch {
    // Quota or serialisation failure — memory still has it. Same tolerance as
    // lib/social/seen.ts.
  }
}

export type CacheHit<T> = { data: T; isStale: boolean; storedAt: number };

/**
 * Read a cached value. Returns null on a miss or past `ttl`; otherwise the
 * value plus whether the caller should revalidate.
 */
export function readCache<T>(key: string, opts: CacheOptions = {}): CacheHit<T> | null {
  const fullKey = scopedKey(key);
  if (!fullKey || typeof window === "undefined") return null;

  const ttl = opts.ttl ?? DEFAULT_TTL;
  const staleTime = opts.staleTime ?? DEFAULT_STALE;
  const persist = opts.persist ?? true;

  let entry = memory.get(fullKey) as Entry<T> | undefined;
  if (!entry && persist) {
    const stored = readStorage<T>(fullKey);
    if (stored) {
      entry = stored;
      memory.set(fullKey, stored);
    }
  }
  if (!entry) return null;

  const age = Date.now() - entry.t;
  if (age > ttl) {
    dropKey(fullKey);
    return null;
  }

  return { data: entry.d, isStale: age > staleTime, storedAt: entry.t };
}

export function writeCache<T>(key: string, data: T, opts: CacheOptions = {}): void {
  const fullKey = scopedKey(key);
  if (!fullKey || typeof window === "undefined") return;

  const entry: Entry<T> = { d: data, t: Date.now() };
  memory.set(fullKey, entry);
  if (opts.persist ?? true) writeStorage(fullKey, entry);
}

function dropKey(fullKey: string): void {
  memory.delete(fullKey);
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + fullKey);
  } catch {
    // ignore
  }
}

/**
 * Invalidate one key or every key starting with `prefix` — e.g.
 * invalidateCache("home") after a round is saved.
 */
export function invalidateCache(prefix: string): void {
  const scoped = scopedKey(prefix);
  if (!scoped || typeof window === "undefined") return;

  for (const k of [...memory.keys()]) {
    if (k === scoped || k.startsWith(`${scoped}:`)) dropKey(k);
  }
  try {
    const full = STORAGE_PREFIX + scoped;
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && (k === full || k.startsWith(`${full}:`))) window.localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}

/** In-flight requests, so concurrent callers for one key share a single fetch. */
const inflight = new Map<string, Promise<unknown>>();

export function dedupe<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = fetcher();
  inflight.set(key, promise);
  void promise.catch(() => {}).finally(() => inflight.delete(key));
  return promise;
}

/**
 * Stale-while-revalidate for procedural loaders — the `async function load()`
 * shape used across the client pages, where the response feeds bespoke
 * post-processing and a hook rewrite would be more churn than it's worth.
 *
 *   const data = await fetchWithCache(key, fetcher, { onFresh: apply });
 *   apply(data);
 *
 * Resolves immediately from cache when there is one (so the page paints without
 * a spinner), and calls `onFresh` later if a background revalidation returns
 * something newer. On a cold miss it just awaits the fetch.
 */
export async function fetchWithCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: CacheOptions & { onFresh?: (data: T) => void } = {}
): Promise<T> {
  const { onFresh, ...cacheOpts } = opts;
  const hit = readCache<T>(key, cacheOpts);

  if (hit && !hit.isStale) return hit.data;

  const scoped = scopedKey(key) ?? key;
  const revalidation = dedupe(scoped, fetcher).then((fresh) => {
    writeCache(key, fresh, cacheOpts);
    return fresh;
  });

  if (hit) {
    // Serve what we have; let the fresh copy land behind it.
    revalidation.then((fresh) => onFresh?.(fresh)).catch(() => {});
    return hit.data;
  }

  return revalidation;
}

/** Wipe everything. Called on sign-in/sign-out/user switch. */
export function clearClientCache(): void {
  inflight.clear();
  memory.clear();
  if (typeof window === "undefined") return;
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(STORAGE_PREFIX)) window.localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }
}
