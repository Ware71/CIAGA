"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  readCache,
  writeCache,
  invalidateCache,
  dedupe,
  type CacheOptions,
} from "@/lib/cache/clientCache";

export type UseCachedDataResult<T> = {
  /** Cached value on the first render if there is one, then the live value. */
  data: T | null;
  /** True only when there is nothing to show yet — i.e. a real cold miss. */
  isLoading: boolean;
  /** Showing a cached value while a background revalidation runs. */
  isValidating: boolean;
  error: string | null;
  /** Force a revalidation (ignores the stale window). */
  refresh: () => Promise<void>;
};

/**
 * Stale-while-revalidate data hook.
 *
 * Replaces the `useEffect` -> `requireViewerSession()` -> `fetch` -> `setLoading(true)`
 * block repeated across the client pages. Cached data is returned on the FIRST
 * render (no blank flash, no spinner), then revalidated in the background only
 * when it's older than `staleTime`.
 *
 * Pass `key: null` to hold off entirely — e.g. until the viewer is known.
 */
export function useCachedData<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts: CacheOptions & {
    /** Revalidate when the tab is refocused / comes back online. Default true. */
    revalidateOnFocus?: boolean;
  } = {}
): UseCachedDataResult<T> {
  const { revalidateOnFocus = true, ...cacheOpts } = opts;

  // Seed synchronously so the first paint already has the previous snapshot.
  const [data, setData] = useState<T | null>(() =>
    key ? (readCache<T>(key, cacheOpts)?.data ?? null) : null
  );
  const [error, setError] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  // Keep the latest fetcher without making it a dependency — callers pass an
  // inline closure, which would otherwise re-run this on every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const optsRef = useRef(cacheOpts);
  optsRef.current = cacheOpts;

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const revalidate = useCallback(async (cacheKey: string) => {
    if (mountedRef.current) setIsValidating(true);
    try {
      const fresh = await dedupe(cacheKey, () => fetcherRef.current());
      writeCache(cacheKey, fresh, optsRef.current);
      if (mountedRef.current) {
        setData(fresh);
        setError(null);
      }
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    } finally {
      if (mountedRef.current) setIsValidating(false);
    }
  }, []);

  // Initial read + revalidate when stale.
  useEffect(() => {
    if (!key) return;
    const hit = readCache<T>(key, optsRef.current);
    if (hit) setData(hit.data);
    if (!hit || hit.isStale) void revalidate(key);
  }, [key, revalidate]);

  // Refocus / reconnect: only worth a request if it's actually gone stale.
  useEffect(() => {
    if (!key || !revalidateOnFocus) return;

    const maybeRevalidate = () => {
      if (document.visibilityState !== "visible") return;
      const hit = readCache<T>(key, optsRef.current);
      if (!hit || hit.isStale) void revalidate(key);
    };

    document.addEventListener("visibilitychange", maybeRevalidate);
    window.addEventListener("online", maybeRevalidate);
    return () => {
      document.removeEventListener("visibilitychange", maybeRevalidate);
      window.removeEventListener("online", maybeRevalidate);
    };
  }, [key, revalidateOnFocus, revalidate]);

  const refresh = useCallback(async () => {
    if (!key) return;
    invalidateCache(key);
    await revalidate(key);
  }, [key, revalidate]);

  return {
    data,
    isLoading: data === null && error === null,
    isValidating,
    error,
    refresh,
  };
}
