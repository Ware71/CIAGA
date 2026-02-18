"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CourseSearchBar } from "@/components/course/CourseSearchBar";
import { useLocationSearch } from "@/lib/useLocationSearch";
import MapLocationPicker from "@/components/map-location-picker";
import { MapPin, ArrowLeft, X } from "lucide-react";

type Course = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  distance_m: number;
  website: string | null;
  phone: string | null;
};

type OverrideMap = Record<string, { course_id: string; name: string }>;

function formatDistance(meters: number) {
  if (!Number.isFinite(meters)) return "";
  if (meters <= 0) return "";
  if (meters < 1000) return `${Math.round(meters)} m away`;
  return `${(meters / 1000).toFixed(1)} km away`;
}

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (courseId: string) => void;
};

export function CoursePickerModal({ open, onClose, onSelect }: Props) {
  const [mode, setMode] = useState<"nearby" | "world">("nearby");

  // ── Nearby state ──
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);
  const [nearbyCourses, setNearbyCourses] = useState<Course[]>([]);
  const [nearbyFilter, setNearbyFilter] = useState("");

  // ── Worldwide state ──
  const world = useLocationSearch();

  // ── Shared state ──
  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);

  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null);
  const nearbyLoadedRef = useRef(false);

  // ── Load nearby courses on open ──
  useEffect(() => {
    if (!open) {
      nearbyLoadedRef.current = false;
      return;
    }
    if (mode !== "nearby" || nearbyLoadedRef.current) return;

    let cancelled = false;
    nearbyLoadedRef.current = true;

    async function fetchNearby(lat: number, lng: number) {
      try {
        const res = await fetch(
          `/api/courses/nearby?lat=${lat}&lng=${lng}&radius=30000`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Failed to load courses");

        const items: Course[] = Array.isArray(data?.items) ? data.items : [];
        if (!cancelled) setNearbyCourses(items);
      } catch (e: any) {
        if (!cancelled) setNearbyError(e?.message ?? "Unknown error");
      } finally {
        if (!cancelled) setNearbyLoading(false);
      }
    }

    setNearbyLoading(true);
    setNearbyError(null);

    if (!navigator.geolocation) {
      setNearbyError("Geolocation not supported.");
      setNearbyLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        lastPosRef.current = { lat: latitude, lng: longitude };
        await fetchNearby(latitude, longitude);
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

    return () => {
      cancelled = true;
    };
  }, [open, mode]);

  // ── Courses currently displayed ──
  const displayCourses: Course[] = useMemo(() => {
    if (mode === "world" && world.step === "courses") return world.courses;
    if (mode === "nearby") return nearbyCourses;
    return [];
  }, [mode, world.step, world.courses, nearbyCourses]);

  // ── Overrides ──
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    async function loadOverrides() {
      if (!displayCourses.length) {
        setOverrides({});
        return;
      }

      try {
        const res = await fetch("/api/courses/overrides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ osm_ids: displayCourses.map((c) => c.id) }),
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
  }, [open, displayCourses]);

  // ── Filter (nearby only) ──
  const filteredCourses = useMemo(() => {
    if (mode === "world") return displayCourses;

    const q = nearbyFilter.trim().toLowerCase();
    if (!q) return displayCourses;

    return displayCourses.filter((c) => {
      const displayName = overrides[c.id]?.name ?? c.name;
      return (displayName ?? "").toLowerCase().includes(q);
    });
  }, [mode, displayCourses, nearbyFilter, overrides]);

  // ── Select → resolve → callback ──
  async function onSelectCourse(c: Course) {
    const ov = overrides[c.id];
    if (ov?.course_id) {
      onSelect(ov.course_id);
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
      if (!res.ok)
        throw new Error(data?.error ?? data?.reason ?? "Resolve failed");

      if (data?.course_id) onSelect(data.course_id);
    } catch (e: any) {
      console.error("Resolve error:", e?.message ?? e);
    } finally {
      setResolvingId(null);
    }
  }

  const loading =
    mode === "world"
      ? world.step === "search"
        ? world.locationLoading
        : world.coursesLoading
      : nearbyLoading;

  const error =
    mode === "world"
      ? world.locationError ?? world.coursesError
      : nearbyError;

  const showCourseList =
    (mode === "nearby" && !nearbyLoading && !nearbyError) ||
    (mode === "world" && world.step === "courses" && !world.coursesLoading);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#042713] text-slate-100 overflow-y-auto">
      <div className="mx-auto w-full max-w-sm px-4 pt-6 pb-8 space-y-4">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">
            Select Course
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 text-emerald-100/70 hover:text-emerald-100 hover:bg-emerald-900/30"
            aria-label="Close"
          >
            <X size={20} />
          </button>
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

        {/* Search / Filter */}
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-3">
          {mode === "world" ? (
            <>
              {world.step === "search" && (
                <>
                  <div className="flex items-center gap-2">
                    <div className="flex-1">
                      <CourseSearchBar
                        value={world.locationQuery}
                        onChange={world.setLocationQuery}
                        onSearch={world.searchLocations}
                        loading={world.locationLoading}
                        placeholder="Search a location or course name…"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setPinOpen(true)}
                      className="shrink-0 rounded-xl border border-emerald-200/30 bg-[#0a341c]/40 px-2.5 py-2 text-emerald-100 hover:bg-[#0a341c]/70"
                      aria-label="Pick location on map"
                      title="Pick location on map"
                    >
                      <MapPin size={16} />
                    </button>
                  </div>
                  <div className="mt-2 text-[10px] text-emerald-100/50">
                    Search for a city, address, or course name — then browse
                    nearby golf courses. Or tap the pin to pick on a map.
                  </div>
                </>
              )}

              {world.step === "locations" && (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <button
                      type="button"
                      onClick={world.backToSearch}
                      className="shrink-0 text-emerald-100/70 hover:text-emerald-100"
                      aria-label="Back to search"
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <div className="text-sm text-emerald-100/80 truncate">
                      Results for &ldquo;{world.locationQuery}&rdquo;
                    </div>
                  </div>

                  {world.locationResults.length === 0 && !world.locationLoading && (
                    <div className="text-sm text-emerald-100/60">
                      No locations found. Try a different search.
                    </div>
                  )}

                  <ul className="space-y-2 max-h-[400px] overflow-y-auto">
                    {world.locationResults.map((loc) => (
                      <li
                        key={loc.place_id}
                        className="rounded-xl border border-emerald-900/50 bg-[#0a341c]/40 p-3 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-sm text-emerald-50 truncate">
                            {loc.display_name}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 rounded-xl border-emerald-200/40 bg-[#0a341c]/60 text-emerald-100 hover:bg-[#0a341c]/80 text-xs"
                          onClick={() => world.selectLocation(loc)}
                        >
                          Search here
                        </Button>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-3 text-center">
                    <button
                      type="button"
                      onClick={() => setPinOpen(true)}
                      className="text-[11px] text-emerald-100/50 hover:text-emerald-100/80 underline underline-offset-2"
                    >
                      Or pick a location on the map
                    </button>
                  </div>
                </>
              )}

              {world.step === "courses" && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={world.backToLocations}
                    className="shrink-0 text-emerald-100/70 hover:text-emerald-100"
                    aria-label="Change location"
                  >
                    <ArrowLeft size={16} />
                  </button>
                  <div className="text-sm text-emerald-100/80 truncate flex-1">
                    Courses near{" "}
                    <span className="text-emerald-50 font-medium">
                      {world.selectedLocation?.display_name}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={world.backToSearch}
                    className="shrink-0 text-[11px] text-emerald-100/50 hover:text-emerald-100/80 underline underline-offset-2"
                  >
                    New search
                  </button>
                </div>
              )}
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

        {/* Loading */}
        {loading && (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
            {mode === "nearby"
              ? "Finding courses near you…"
              : world.step === "search" || world.step === "locations"
              ? "Searching locations…"
              : "Finding golf courses…"}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-2xl border border-red-900/40 bg-red-950/20 p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        {/* Empty state */}
        {showCourseList && filteredCourses.length === 0 && (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
            {mode === "world"
              ? "No golf courses found near this location. Try a different spot."
              : nearbyFilter.trim()
              ? "No matches found."
              : "No courses found within 30 km."}
          </div>
        )}

        {/* Course list */}
        {showCourseList && filteredCourses.length > 0 && (
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
                      <div className="font-medium text-emerald-50 truncate">
                        {displayName}
                      </div>
                      <div className="mt-1 text-[11px] text-emerald-200/70">
                        {formatDistance(c.distance_m)}
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 rounded-xl border-emerald-200/40 bg-[#0a341c]/60 text-emerald-100 hover:bg-[#0a341c]/80"
                      onClick={() => onSelectCourse(c)}
                      disabled={isResolving}
                    >
                      {isResolving ? "Loading…" : "Select"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <footer className="pt-2 text-center text-[10px] text-emerald-100/50">
          Powered by OpenStreetMap data.
        </footer>
      </div>

      {/* Map location picker */}
      {pinOpen && (
        <MapLocationPicker
          initial={null}
          fallbackCenter={lastPosRef.current}
          onClose={() => setPinOpen(false)}
          onClear={() => setPinOpen(false)}
          onConfirm={(pos) => {
            const lat = Math.max(-90, Math.min(90, pos.lat));
            const lng = Math.max(-180, Math.min(180, pos.lng));
            world.selectCoordinates(lat, lng);
            setPinOpen(false);
          }}
        />
      )}
    </div>
  );
}
