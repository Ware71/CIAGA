// Client-side "seen feed cards" tracking (per-device, localStorage).
// Used to prioritise unseen cards to the top of the social feed and on the
// home mini-feed, with an "all caught up" divider before already-seen cards.

const KEY = "ciaga_feed_seen_v1";
const MAX = 1500;

let cache: Set<string> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function load(): Set<string> {
  if (cache) return cache;
  if (typeof window === "undefined") {
    cache = new Set();
    return cache;
  }
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    cache = new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    cache = new Set();
  }
  return cache;
}

function flush() {
  if (typeof window === "undefined" || !cache) return;
  try {
    let arr = [...cache];
    if (arr.length > MAX) arr = arr.slice(arr.length - MAX);
    window.localStorage.setItem(KEY, JSON.stringify(arr));
    cache = new Set(arr);
  } catch {
    // ignore quota / serialization errors
  }
}

/** Snapshot of seen ids (copy — safe to keep for the session). */
export function getSeen(): Set<string> {
  return new Set(load());
}

export function isSeen(id: string): boolean {
  return load().has(id);
}

/** Mark ids as seen (debounced persist). Ignores live/unsaved ids. */
export function markSeen(ids: string[]): void {
  if (typeof window === "undefined" || !ids.length) return;
  const set = load();
  let changed = false;
  for (const id of ids) {
    if (id && !id.startsWith("live:") && !set.has(id)) {
      set.add(id);
      changed = true;
    }
  }
  if (!changed) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 400);
}
