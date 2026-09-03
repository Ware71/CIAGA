// Client-side "hidden feed cards" tracking (per-device, localStorage).
//
// "Hide this post" is the smallest useful moderation control: it lets someone
// deal with a post they don't want to see without waiting on an admin, and
// without the heavier consequences of blocking a member of their own society.
//
// Deliberately per-device rather than a table. It needs no migration, no
// fan-out change and no RLS, and getting it wrong costs a card reappearing on
// another phone. If it turns out people want it to follow them around, this
// becomes a `feed_item_hides` table with the same shape behind it.
//
// Modelled on lib/social/seen.ts — same cache/flush pattern, same failure
// posture (a full or unavailable localStorage degrades to "nothing hidden").

const KEY = "ciaga_feed_hidden_v1";
const MAX = 500;

let cache: Set<string> | null = null;

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

/** Snapshot of hidden ids (copy — safe to keep for the session). */
export function getHidden(): Set<string> {
  return new Set(load());
}

export function hideFeedItem(id: string): void {
  if (typeof window === "undefined" || !id) return;
  const set = load();
  if (set.has(id)) return;
  set.add(id);
  // Persist immediately: unlike seen-marking this is a deliberate act, and it
  // must survive the user closing the tab straight afterwards.
  flush();
}

export function unhideFeedItem(id: string): void {
  if (typeof window === "undefined" || !id) return;
  const set = load();
  if (!set.delete(id)) return;
  flush();
}
