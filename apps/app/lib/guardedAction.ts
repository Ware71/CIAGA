const inFlight = new Set<string>();

/**
 * Run an async action at most once at a time for a given key.
 *
 * For action buttons that can't hold their own `busy` state — inline handlers,
 * and anything rendered inside a `.map()` where a hook can't be called. A
 * double-tap on a slow connection otherwise fires the handler twice; for
 * anything non-idempotent (creating rounds, charges, entries) that means
 * duplicates.
 *
 * Where a component *can* hold state, prefer `<Button pending={…}>` — it also
 * gives the user feedback, which this deliberately can't.
 */
export async function runGuarded(key: string, fn: () => Promise<void>): Promise<void> {
  if (inFlight.has(key)) return;
  inFlight.add(key);
  try {
    await fn();
  } finally {
    inFlight.delete(key);
  }
}
