"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Course = {
  id: string; // OSM id: "way/12345"
  name: string;
  lat: number;
  lng: number;
  distance_m: number; // in worldwide mode we may fake/omit this
  website: string | null;
  phone: string | null;
  subtitle?: string;
};

type OverrideMap = Record<string, { course_id: string; name: string }>;

function formatDistance(meters: number) {
  if (!Number.isFinite(meters)) return "";
  if (meters <= 0) return "";
  if (meters < 1000) return `${Math.round(meters)} m away`;
  return `${(meters / 1000).toFixed(1)} km away`;
}

type Mode = "nearby" | "world";

export default function CoursesPage() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("nearby");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [courses, setCourses] = useState<Course[]>([]);

  const [query, setQuery] = useState("");
  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // store last known location so worldwide search can optionally compute distance (optional)
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);

  // -----------------------------
  // Nearby load (geolocation)
  // -----------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadNearby() {
      setLoading(true);
      setError(null);

      if (!navigator.geolocation) {
        setError("Geolocation not supported.");
        setLoading(false);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const { latitude, longitude } = pos.coords;
            lastPosRef.current = { lat: latitude, lng: longitude };

            const res = await fetch(
              `/api/courses/nearby?lat=${latitude}&lng=${longitude}&radius=15000`
            );
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error ?? "Failed to load courses");
            if (!cancelled) setCourses(data.items ?? []);
          } catch (e: any) {
            if (!cancelled) setError(e?.message ?? "Unknown error");
          } finally {
            if (!cancelled) setLoading(false);
          }
        },
        (geoErr) => {
          if (!cancelled) {
            setError(
              geoErr.code === geoErr.PERMISSION_DENIED
                ? "Location denied. Switch to Worldwide search."
                : geoErr.message
            );
            setLoading(false);
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    }

    if (mode === "nearby") loadNearby();
    return () => {
      cancelled = true;
    };
  }, [mode]);

  // -----------------------------
  // Worldwide search (OSM)
  // -----------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadWorld() {
      const q = query.trim();
      if (mode !== "world") return;

      // If no query, show nothing (or keep previous)
      if (!q) {
        setCourses([]);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        // Your search route should proxy to OSM/Nominatim and return items
        const res = await fetch(`/api/courses/search?q=${encodeURIComponent(q)}&limit=25`);
        const data = await res.json();

        if (!res.ok) throw new Error(data?.error ?? "Search failed");

        // Ensure shape: { items: Course[] }
        const items: Course[] = Array.isArray(data?.items) ? data.items : [];

        // Worldwide items may not have distance; normalize to 0
        const normalized = items.map((c) => ({
          ...c,
          distance_m: Number.isFinite(c.distance_m) ? c.distance_m : 0,
        }));

        if (!cancelled) setCourses(normalized);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadWorld();
    return () => {
      cancelled = true;
    };
  }, [mode, query]);

  // -----------------------------
  // Overrides for current results (so renamed courses show)
  // -----------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadOverrides() {
      if (!courses.length) {
        setOverrides({});
        return;
      }

      try {
        const res = await fetch("/api/courses/overrides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ osm_ids: courses.map((c) => c.id) }),
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
  }, [courses]);

  // -----------------------------
  // Filter local list (nearby mode mainly; world mode already filtered by query)
  // -----------------------------
  const filteredCourses = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (mode === "world") return courses; // already query-driven
    if (!q) return courses;

    return courses.filter((c) => {
      const displayName = overrides[c.id]?.name ?? c.name;
      return (displayName ?? "").toLowerCase().includes(q);
    });
  }, [courses, query, overrides, mode]);

  // -----------------------------
  // View → resolve → navigate
  // -----------------------------
  async function onView(c: Course) {
    const ov = overrides[c.id];
    if (ov?.course_id) {
      router.push(`/courses/${ov.course_id}`);
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

      if (data?.course_id) router.push(`/courses/${data.course_id}`);
    } catch (e: any) {
      console.error("Resolve error:", e?.message ?? e);
      setError(e?.message ?? "Resolve failed");
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-4">
        {/* Header */}
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
            <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Courses</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
              {mode === "nearby" ? "Nearby" : "Worldwide"}
            </div>
          </div>

          <div className="w-[60px]" />
        </header>

        {/* Mode toggle */}
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

        {/* Search */}
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === "nearby" ? "Filter nearby courses…" : "Search any course in the world…"}
            className="w-full bg-transparent outline-none text-sm placeholder:text-emerald-100/40"
            aria-label="Search courses"
          />
          {mode === "world" ? (
            <div className="mt-2 text-[10px] text-emerald-100/50">
              Tip: include a city/country for better matches (e.g. “St Andrews Scotland”).
            </div>
          ) : null}
        </div>

        {/* Body */}
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
              ? query.trim()
                ? "No matches found."
                : "Type a course name to search worldwide."
              : query.trim()
              ? "No matches found."
              : "No courses found within 15 km."}
          </div>
        )}

        <ul className="space-y-3">
          {filteredCourses.map((c) => {
            const displayName = overrides[c.id]?.name ?? c.name;
            const isResolving = resolvingId === c.id;

            return (
              <li
                key={c.id}
                className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium text-emerald-50 truncate">{displayName}</div>

                    {/* Show distance only in nearby mode (worldwide usually doesn't have it) */}
                    {mode === "nearby" ? (
                      <div className="mt-1 text-[11px] text-emerald-200/70">
                        {formatDistance(c.distance_m)}
                      </div>
                    ) : (
                      <div className="mt-1 text-[11px] text-emerald-200/60">
                        {c.lat && c.lng ? `${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}` : ""}
                      </div>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 rounded-xl border-emerald-200/40 bg-[#0a341c]/60 text-emerald-100 hover:bg-[#0a341c]/80"
                    onClick={() => onView(c)}
                    disabled={isResolving}
                  >
                    {isResolving ? "Loading…" : "View"}
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
