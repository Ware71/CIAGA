import { useCallback, useRef, useState } from "react";

export type LocationResult = {
  place_id: number;
  display_name: string;
  lat: number;
  lng: number;
  type: string | null;
  class: string | null;
  city: string | null;
  country: string | null;
};

export type NearbyCourse = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  distance_m: number;
  website: string | null;
  phone: string | null;
};

export type WorldStep = "search" | "locations" | "courses";

export function useLocationSearch() {
  const [step, setStep] = useState<WorldStep>("search");

  // Location search
  const [locationQuery, setLocationQuery] = useState("");
  const [locationResults, setLocationResults] = useState<LocationResult[]>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Selected location → nearby courses
  const [selectedLocation, setSelectedLocation] = useState<{
    lat: number;
    lng: number;
    display_name: string;
  } | null>(null);
  const [courses, setCourses] = useState<NearbyCourse[]>([]);
  const [coursesLoading, setCoursesLoading] = useState(false);
  const [coursesError, setCoursesError] = useState<string | null>(null);

  const reqSeq = useRef(0);

  const searchLocations = useCallback(async () => {
    const q = locationQuery.trim();
    if (!q) return;

    const seq = ++reqSeq.current;
    setLocationLoading(true);
    setLocationError(null);

    try {
      const res = await fetch(
        `/api/courses/location-search?q=${encodeURIComponent(q)}&limit=8`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Search failed");

      if (seq !== reqSeq.current) return;

      setLocationResults(data.items ?? []);
      setStep("locations");
    } catch (e: any) {
      if (seq !== reqSeq.current) return;
      setLocationError(e?.message ?? "Unknown error");
    } finally {
      if (seq === reqSeq.current) setLocationLoading(false);
    }
  }, [locationQuery]);

  const fetchNearbyCourses = useCallback(async (lat: number, lng: number) => {
    setCoursesLoading(true);
    setCoursesError(null);

    try {
      const res = await fetch(
        `/api/courses/nearby?lat=${lat}&lng=${lng}&radius=30000`,
        { cache: "no-store" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load courses");

      const items: NearbyCourse[] = Array.isArray(data?.items)
        ? data.items
        : [];
      setCourses(items);
      setStep("courses");
    } catch (e: any) {
      setCoursesError(e?.message ?? "Unknown error");
    } finally {
      setCoursesLoading(false);
    }
  }, []);

  const selectLocation = useCallback(
    (loc: LocationResult) => {
      setSelectedLocation({
        lat: loc.lat,
        lng: loc.lng,
        display_name: loc.display_name,
      });
      fetchNearbyCourses(loc.lat, loc.lng);
    },
    [fetchNearbyCourses]
  );

  const selectCoordinates = useCallback(
    (lat: number, lng: number) => {
      setSelectedLocation({
        lat,
        lng,
        display_name: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      });
      fetchNearbyCourses(lat, lng);
    },
    [fetchNearbyCourses]
  );

  const backToLocations = useCallback(() => {
    setCourses([]);
    setCoursesError(null);
    setSelectedLocation(null);
    setStep("locations");
  }, []);

  const backToSearch = useCallback(() => {
    setLocationResults([]);
    setLocationError(null);
    setSelectedLocation(null);
    setCourses([]);
    setCoursesError(null);
    setStep("search");
  }, []);

  const clear = useCallback(() => {
    setLocationQuery("");
    setLocationResults([]);
    setLocationError(null);
    setSelectedLocation(null);
    setCourses([]);
    setCoursesError(null);
    setStep("search");
  }, []);

  return {
    step,

    // Location search
    locationQuery,
    setLocationQuery,
    locationResults,
    locationLoading,
    locationError,
    searchLocations,

    // Selected location + courses
    selectedLocation,
    courses,
    coursesLoading,
    coursesError,

    // Actions
    selectLocation,
    selectCoordinates,
    backToLocations,
    backToSearch,
    clear,
  };
}
