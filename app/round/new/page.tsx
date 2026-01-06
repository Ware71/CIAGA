"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";

import { useCourseSearch, type CourseSearchItem } from "@/lib/useCourseSearch";
import { CourseSearchBar } from "@/components/course/CourseSearchBar";

type Course = {
  id: string; // OSM id
  name: string;
  lat: number;
  lng: number;

  distance_m: number;
  website: string | null;
  phone: string | null;
  subtitle?: string;

  city?: string | null;
  county?: string | null;
  country?: string | null;
  postcode?: string | null;
};

type OverrideMap = Record<string, { course_id: string; name: string }>;

function formatDistance(meters: number) {
  if (!Number.isFinite(meters)) return "";
  if (meters <= 0) return "";
  if (meters < 1000) return `${Math.round(meters)} m away`;
  return `${(meters / 1000).toFixed(1)} km away`;
}

function worldItemToCourse(x: CourseSearchItem): Course {
  return {
    id: x.id,
    name: x.name,
    lat: x.lat,
    lng: x.lng,
    distance_m: Number.isFinite(x.distance_m) ? (x.distance_m as number) : 0,
    website: null,
    phone: null,
    subtitle: x.subtitle ?? undefined,
    city: x.city ?? null,
    county: x.county ?? null,
    country: x.country ?? null,
    postcode: x.postcode ?? null,
  };
}

type Mode = "nearby" | "world";

export default function NewRoundCoursePickerPage() {
  const router = useRouter();

  // Shared "worldwide" search state (press-to-search)
  const {
    mode,
    setMode,
    queryInput,
    setQueryInput,
    runSearch,
    clearSearch,
    results: worldResults,
    loading: worldLoading,
    error: worldError,
    setNear,
  } = useCourseSearch({ initialMode: "nearby", limit: 25 });

  // Nearby mode: separate list + filter input (still live filtering)
  const [nearbyLoading, setNearbyLoading] = useState(true);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [nearbyCourses, setNearbyCourses] = useState<Course[]>([]);
  const [nearbyFilter, setNearbyFilter] = useState("");

  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);

  // -----------------------------
  // Auth gate (round flow should be authed)
  // -----------------------------
  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) router.replace("/auth");
    })();
  }, [router]);

  // -----------------------------
  // Nearby load (geolocation)
  // -----------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadNearby() {
      setNearbyLoading(true);
      setNearbyError(null);

      if (!navigator.geolocation) {
        setNearbyError("Geolocation not supported.");
        setNearbyLoading(false);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const { latitude, longitude } = pos.coords;
            lastPosRef.current = { lat: latitude, lng: longitude };

            // feed into worldwide ordering when available
            setNear(latitude, longitude);

            const res = await fetch(
              `/api/courses/nearby?lat=${latitude}&lng=${longitude}&radius=10000`,
              { cache: "no-store" }
            );
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? "Failed to load courses");

            const items: Course[] = Array.isArray(data?.items) ? data.items : [];

            const normalized = items.map((c: any) => ({
              ...c,
              city: c.city ?? null,
              county: c.county ?? null,
              country: c.country ?? null,
              postcode: c.postcode ?? null,
            }));

            if (!cancelled) setNearbyCourses(normalized);
          } catch (e: any) {
            if (!cancelled) setNearbyError(e?.message ?? "Unknown error");
          } finally {
            if (!cancelled) setNearbyLoading(false);
          }
        },
        (geoErr) => {
          if (!cancelled) {
            setNearbyError(
              geoErr.code === geoErr.PERMISSION_DENIED
                ? "Location denied. Switch to Worldwide search."
                : geoErr.message
            );
            setNearbyLoading(false);
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    }

    if (mode === "nearby") loadNearby();
    return () => {
      cancelled = true;
    };
  }, [mode, setNear]);

  // -----------------------------
  // Courses currently displayed (world or nearby)
  // -----------------------------
  const baseCourses: Course[] = useMemo(() => {
    if (mode === "world") return (worldResults ?? []).map(worldItemToCourse);
    return nearbyCourses;
  }, [mode, worldResults, nearbyCourses]);

  // -----------------------------
  // Overrides for current results
  // -----------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadOverrides() {
      if (!baseCourses.length) {
        setOverrides({});
        return;
      }

      try {
        const res = await fetch("/api/courses/overrides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ osm_ids: baseCourses.map((c) => c.id) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Failed to load overrides");

        if (!cancelled) setOverrides(data.map ?? {});
      } catch {
        if (!cancelled) setOverrides({});
      }
    }

    loadOverrides();
    return () => {
      cancelled = true;
    };
  }, [baseCourses]);

  // -----------------------------
  // Filter local list (nearby mode only)
  // -----------------------------
  const filteredCourses = useMemo(() => {
    if (mode === "world") return baseCourses;

    const q = nearbyFilter.trim().toLowerCase();
    if (!q) return baseCourses;

    return baseCourses.filter((c) => {
      const displayName = overrides[c.id]?.name ?? c.name;
      return (displayName ?? "").toLowerCase().includes(q);
    });
  }, [mode, baseCourses, nearbyFilter, overrides]);

  // -----------------------------
  // Select → resolve → navigate to round tee picker
  // -----------------------------
  async function onSelect(c: Course) {
    const ov = overrides[c.id];
    if (ov?.course_id) {
      router.push(`/round/new/${ov.course_id}`);
      return;
    }

    try {
      setResolvingId(c.id);

      const res = await fetch("/api/courses/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          osm_id: c.id,
          name: c.name,
          lat: c.lat,
          lng: c.lng,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? data?.reason ?? "Resolve failed");

      if (data?.course_id) router.push(`/round/new/${data.course_id}`);
      else throw new Error("Resolve did not return course_id");
    } catch (e: any) {
      console.error("Resolve error:", e?.message ?? e);
      // show in whichever error region is active
      if (mode === "nearby") setNearbyError(e?.message ?? "Resolve failed");
    } finally {
      setResolvingId(null);
    }
  }

  const loading = mode === "world" ? worldLoading : nearbyLoading;
  const error = mode === "world" ? worldError : nearbyError;

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-4">
        <header className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="px-2 text-emerald-100 hover:bg-emerald-900/30"
            onClick={() => router.back()}
          >
            ← Back
          </Button>

          <div className="text-center flex-1">
            <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">New round</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
              {mode === "nearby" ? "Nearby" : "Worldwide"}
            </div>
          </div>

          <div className="w-[60px]" />
        </header>

        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-2 flex gap-2">
          <button
            type="button"
            onClick={() => setMode("nearby")}
            className={[
              "flex-1 rounded-xl px-3 py-2 text-xs font-medium",
              mode === "nearby"
                ? "bg-emerald-900/40 border border-emerald-200/30"
                : "hover:bg-emerald-900/20",
            ].join(" ")}
          >
            Nearby
          </button>
          <button
            type="button"
            onClick={() => setMode("world")}
            className={[
              "flex-1 rounded-xl px-3 py-2 text-xs font-medium",
              mode === "world"
                ? "bg-emerald-900/40 border border-emerald-200/30"
                : "hover:bg-emerald-900/20",
            ].join(" ")}
          >
            Worldwide
          </button>
        </div>

        {/* Search / Filter */}
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-3">
          {mode === "world" ? (
            <>
              <CourseSearchBar
                value={queryInput}
                onChange={setQueryInput}
                onSearch={runSearch}
                loading={worldLoading}
                placeholder="Search any course in the world…"
                showClear
                onClear={clearSearch}
              />
              <div className="mt-2 text-[10px] text-emerald-100/50">
                Tip: include a city/country for better matches (e.g. “St Andrews Scotland”).
              </div>
            </>
          ) : (
            <input
              value={nearbyFilter}
              onChange={(e) => setNearbyFilter(e.target.value)}
              placeholder="Filter nearby courses…"
              className="w-full bg-transparent outline-none text-sm placeholder:text-emerald-100/40"
              aria-label="Filter nearby courses"
            />
          )}
        </div>

        {loading && (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
            {mode === "nearby" ? "Finding courses near you…" : "Searching…"}
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-900/40 bg-red-950/20 p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        {!loading && !error && filteredCourses.length === 0 && (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
            {mode === "world"
              ? queryInput.trim()
                ? "No matches found."
                : "Type a course name and press Search."
              : nearbyFilter.trim()
              ? "No matches found."
              : "No courses found within 15 km."}
          </div>
        )}

        <ul className="space-y-3">
          {filteredCourses.map((c) => {
            const displayName = overrides[c.id]?.name ?? c.name;
            const isResolving = resolvingId === c.id;

            return (
              <li key={c.id} className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-emerald-50 truncate">{displayName}</div>

                    {mode === "nearby" ? (
                      <div className="mt-1 text-[11px] text-emerald-200/70">{formatDistance(c.distance_m)}</div>
                    ) : (
                      <div className="mt-1 text-[11px] text-emerald-200/60">
                        {c.subtitle ?? (c.lat && c.lng ? `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}` : "")}
                      </div>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 rounded-xl border-emerald-200/40 bg-[#0a341c]/60 text-emerald-100 hover:bg-[#0a341c]/80"
                    onClick={() => onSelect(c)}
                    disabled={isResolving}
                  >
                    {isResolving ? "Loading…" : "Select"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>

        <footer className="pt-2 text-center text-[10px] text-emerald-100/50">
          Powered by OpenStreetMap data.
        </footer>
      </div>
    </div>
  );
}
