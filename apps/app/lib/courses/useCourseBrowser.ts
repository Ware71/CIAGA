"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requireViewerSession } from "@/lib/auth/requireViewerSession";
import {
  MIN_GLOBAL_QUERY,
  NEARBY_RADIUS_M,
  SEARCH_DEBOUNCE_MS,
} from "./constants";
import { dedupe, rankHits } from "./rank";
import type { CourseHit, LatLng } from "./types";

/**
 * All four course sources behind one hook.
 *
 * Three of them are loaded once and held: your favourites, the courses you have
 * played, and a single sweep of what is around you. Those are cheap to filter
 * in memory, which is what lets the search feel instant — typing narrows what
 * is already on the client before any request goes out. Only the fourth, the
 * global name search, costs a round trip, and it is debounced and merged in
 * underneath.
 *
 * The list is deliberately flat and unsectioned; `rankHits` carries the
 * ordering that headings would otherwise have to.
 */

type Json = Record<string, any>;

function toNum(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

async function authedFetch(path: string): Promise<Json | null> {
  const session = await requireViewerSession();
  if (!session) return null;
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? `Request failed (${res.status})`);
  return json;
}

export type CourseBrowserTab = "nearby" | "favourites" | "played";

export function useCourseBrowser({ enabled = true }: { enabled?: boolean } = {}) {
  const [position, setPosition] = useState<LatLng | null>(null);
  const [positionError, setPositionError] = useState<string | null>(null);

  const [nearby, setNearby] = useState<CourseHit[]>([]);
  const [favourites, setFavourites] = useState<CourseHit[]>([]);
  const [played, setPlayed] = useState<CourseHit[]>([]);

  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [localLoading, setLocalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [globalHits, setGlobalHits] = useState<CourseHit[]>([]);
  const [globalLoading, setGlobalLoading] = useState(false);

  // Drops responses that come back out of order — a fast typist can easily
  // have three searches in flight and the last one to land is not the newest.
  const searchSeq = useRef(0);
  const loadedRef = useRef(false);

  /** Favourites and played history — one call each, both cheap. */
  const loadLocal = useCallback(async () => {
    setLocalLoading(true);
    try {
      const [favJson, playedJson] = await Promise.all([
        authedFetch("/api/courses/favourites"),
        authedFetch("/api/courses/played"),
      ]);

      const favIds = new Set<string>();
      const favs: CourseHit[] = ((favJson?.items ?? []) as Json[]).map((r) => {
        if (r.course_id) favIds.add(r.course_id);
        return {
          courseId: r.course_id ?? null,
          osmId: r.osm_id ?? null,
          name: r.name ?? "Unknown course",
          city: r.city ?? null,
          country: r.country ?? null,
          lat: toNum(r.lat),
          lng: toNum(r.lng),
          distanceM: null,
          roundsPlayed: null,
          lastPlayedAt: null,
          isFavourite: true,
          sources: ["favourite"],
        };
      });

      const plays: CourseHit[] = ((playedJson?.items ?? []) as Json[]).map((r) => ({
        courseId: r.course_id ?? null,
        osmId: r.osm_id ?? null,
        name: r.course_name ?? "Unknown course",
        city: r.city ?? null,
        country: r.country ?? null,
        lat: toNum(r.lat),
        lng: toNum(r.lng),
        distanceM: null,
        roundsPlayed: typeof r.rounds_played === "number" ? r.rounds_played : Number(r.rounds_played) || null,
        lastPlayedAt: r.last_played_at ?? null,
        isFavourite: r.course_id ? favIds.has(r.course_id) : false,
        sources: ["played"],
      }));

      setFavourites(favs);
      setPlayed(plays);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load your courses");
    } finally {
      setLocalLoading(false);
    }
  }, []);

  /**
   * One Overpass sweep at the shared radius, sorted by distance by the endpoint.
   * There is no second "wider area" request — the list just scrolls further.
   */
  const loadNearby = useCallback(async (pos: LatLng) => {
    setNearbyLoading(true);
    try {
      const res = await fetch(
        `/api/courses/nearby?lat=${pos.lat}&lng=${pos.lng}&radius=${NEARBY_RADIUS_M}`,
        { cache: "no-store" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? "Couldn't load nearby courses");

      const items: CourseHit[] = ((json?.items ?? []) as Json[]).map((r) => ({
        courseId: null,
        osmId: r.id ?? null,
        name: r.name ?? "Unknown course",
        city: null,
        country: null,
        lat: toNum(r.lat),
        lng: toNum(r.lng),
        distanceM: toNum(r.distance_m),
        roundsPlayed: null,
        lastPlayedAt: null,
        isFavourite: false,
        sources: ["nearby"],
      }));
      setNearby(items);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't load nearby courses");
    } finally {
      setNearbyLoading(false);
    }
  }, []);

  /** Ask for a position once, then load everything that depends on it. */
  useEffect(() => {
    if (!enabled || loadedRef.current) return;
    loadedRef.current = true;

    void loadLocal();

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setPositionError("Location isn't available on this device.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        setPosition(pos);
        void loadNearby(pos);
      },
      () => setPositionError("Location denied — search by name instead."),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }, [enabled, loadLocal, loadNearby]);

  /** Re-centre on a dropped pin or a chosen place. */
  const searchAt = useCallback(
    (pos: LatLng) => {
      setPosition(pos);
      setPositionError(null);
      void loadNearby(pos);
    },
    [loadNearby]
  );

  /** The global half: DB name search merged with Nominatim, ranked server-side. */
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_GLOBAL_QUERY) {
      setGlobalHits([]);
      setGlobalLoading(false);
      return;
    }

    const seq = ++searchSeq.current;
    setGlobalLoading(true);

    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: "25" });
        if (position) {
          params.set("nearLat", String(position.lat));
          params.set("nearLng", String(position.lng));
        }
        const res = await fetch(`/api/courses/search?${params}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (seq !== searchSeq.current) return;
        if (!res.ok) throw new Error(json?.error ?? "Search failed");

        setGlobalHits(
          ((json?.items ?? []) as Json[]).map((r) => ({
            courseId: null,
            osmId: r.id ?? null,
            name: r.name ?? "Unknown course",
            city: r.city ?? null,
            country: r.country ?? null,
            lat: toNum(r.lat),
            lng: toNum(r.lng),
            distanceM: toNum(r.distance_m),
            roundsPlayed: null,
            lastPlayedAt: null,
            isFavourite: false,
            sources: ["worldwide"],
          }))
        );
      } catch {
        if (seq === searchSeq.current) setGlobalHits([]);
      } finally {
        if (seq === searchSeq.current) setGlobalLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, position]);

  /**
   * Flip the star across every list, and write the resolved uuid back while we
   * are there.
   *
   * Matching on courseId alone is not enough: a nearby or worldwide hit has no
   * uuid until the moment it is starred, so the row the user actually tapped
   * would be the one row the update failed to find. The OSM id is what links
   * the pre-resolve row to its post-resolve identity.
   */
  const applyFavourite = useCallback(
    (match: { courseId: string; osmId: string | null }, on: boolean) => {
      const hits = (h: CourseHit) =>
        (h.courseId !== null && h.courseId === match.courseId) ||
        (!!match.osmId && h.osmId === match.osmId);

      const stamp = (list: CourseHit[]) =>
        list.map((h) =>
          hits(h) ? { ...h, courseId: h.courseId ?? match.courseId, isFavourite: on } : h
        );

      setNearby(stamp);
      setPlayed(stamp);
      setGlobalHits(stamp);
      setFavourites((prev) => (on ? prev : prev.filter((h) => !hits(h))));
    },
    []
  );

  const toggleFavourite = useCallback(
    async (hit: CourseHit, courseId: string) => {
      const next = !hit.isFavourite;
      const match = { courseId, osmId: hit.osmId };
      applyFavourite(match, next); // optimistic
      try {
        const session = await requireViewerSession();
        if (!session) throw new Error("Not signed in");
        const res = await fetch(
          next
            ? "/api/courses/favourites"
            : `/api/courses/favourites?course_id=${encodeURIComponent(courseId)}`,
          {
            method: next ? "POST" : "DELETE",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.accessToken}`,
            },
            body: next ? JSON.stringify({ course_id: courseId }) : undefined,
          }
        );
        if (!res.ok) throw new Error("Couldn't save that");
        // Re-read so a newly starred course joins the Favourites tab with the
        // name and city the row it came from may not have carried.
        await loadLocal();
      } catch (e: any) {
        applyFavourite(match, !next); // roll back
        setError(e?.message ?? "Couldn't save that");
      }
    },
    [applyFavourite, loadLocal]
  );

  /** Per-tab browse lists, ranked but unfiltered by query. */
  const tabHits = useMemo(() => {
    const byTab: Record<CourseBrowserTab, CourseHit[]> = {
      nearby: dedupe([...nearby, ...favourites, ...played]).filter((h) =>
        h.sources.includes("nearby")
      ),
      favourites: dedupe([...favourites, ...played, ...nearby]).filter((h) => h.isFavourite),
      played: dedupe([...played, ...favourites, ...nearby]).filter((h) =>
        h.sources.includes("played")
      ),
    };
    return {
      nearby: rankHits(byTab.nearby, ""),
      favourites: rankHits(byTab.favourites, ""),
      played: rankHits(byTab.played, ""),
    };
  }, [nearby, favourites, played]);

  /** The blended search list — local sources first, global merged underneath. */
  const searchHits = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return rankHits(dedupe([...favourites, ...played, ...nearby, ...globalHits]), q);
  }, [query, favourites, played, nearby, globalHits]);

  return {
    // state
    query,
    setQuery,
    position,
    positionError,
    error,
    setError,
    // data
    tabHits,
    searchHits,
    searching: query.trim().length > 0,
    // loading
    nearbyLoading,
    localLoading,
    globalLoading,
    // actions
    searchAt,
    toggleFavourite,
    reloadLocal: loadLocal,
  };
}
