"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Coalesce a burst of realtime events into one refetch.
 *
 * Supabase `postgres_changes` fires once per row. A leaderboard recompute is a
 * bulk delete+insert, so subscribing with `event: "*"` and refetching per event
 * meant N full leaderboard fetches for an N-player field — during live play,
 * exactly when the connection is worst.
 *
 * Generalised from the 800ms debounce that was already inline in
 * GroupDetailClient's live-scores channel, so every channel uses one
 * implementation rather than some being debounced and some not.
 */
export function useDebouncedRefresh(fn: () => void | Promise<void>, delayMs = 800) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);

  // Keep the latest callback without re-creating the debouncer (which would
  // reset the pending timer on every render).
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return useCallback(
    () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void fnRef.current();
      }, delayMs);
    },
    [delayMs]
  );
}
