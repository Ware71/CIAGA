import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type CourseSearchMode = "nearby" | "world";

export type CourseSearchItem = {
  id: string;
  name: string;
  lat: number;
  lng: number;

  // Optional fields your API may return
  subtitle?: string | null;
  city?: string | null;
  county?: string | null;
  country?: string | null;
  postcode?: string | null;

  distance_m?: number;
};

type SearchApiResponse = {
  items?: any[];
  error?: string;
};

function normalizeItem(raw: any): CourseSearchItem {
  return {
    id: String(raw?.id ?? ""),
    name: String(raw?.name ?? ""),
    lat: Number(raw?.lat ?? 0),
    lng: Number(raw?.lng ?? 0),

    subtitle: raw?.subtitle ?? null,
    city: raw?.city ?? null,
    county: raw?.county ?? null,
    country: raw?.country ?? null,
    postcode: raw?.postcode ?? null,

    distance_m: Number.isFinite(raw?.distance_m) ? Number(raw.distance_m) : 0,
  };
}

function safeItems(data: any): CourseSearchItem[] {
  const arr = (data?.items ?? []) as any[];
  if (!Array.isArray(arr)) return [];
  return arr.map(normalizeItem).filter((x) => x.id && x.name);
}

export function useCourseSearch(opts?: {
  initialMode?: CourseSearchMode;
  limit?: number;
}) {
  const initialMode = opts?.initialMode ?? "world";
  const limit = opts?.limit ?? 25;

  const [mode, setMode] = useState<CourseSearchMode>(initialMode);

  // user types here
  const [queryInput, setQueryInput] = useState("");
  // only searches when this changes (Search button / Enter)
  const [submittedQuery, setSubmittedQuery] = useState("");

  const [results, setResults] = useState<CourseSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // optional: bias results by user location if your API supports it
  const nearRef = useRef<{ lat: number; lng: number } | null>(null);

  // Prevent out-of-order responses from overwriting newer searches
  const requestSeq = useRef(0);

  const canSearch = useMemo(() => queryInput.trim().length > 0, [queryInput]);

  const runSearch = useCallback(() => {
    setSubmittedQuery(queryInput.trim());
  }, [queryInput]);

  const clearSearch = useCallback(() => {
    setQueryInput("");
    setSubmittedQuery("");
    setResults([]);
    setError(null);
    setLoading(false);
  }, []);

  const setNear = useCallback((lat: number, lng: number) => {
    nearRef.current = { lat, lng };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function doWorldSearch() {
      if (mode !== "world") return;

      const q = submittedQuery.trim();
      if (!q) {
        setResults([]);
        setError(null);
        setLoading(false);
        return;
      }

      const seq = ++requestSeq.current;

      setLoading(true);
      setError(null);

      try {
        const near = nearRef.current;
        const nearQS = near ? `&nearLat=${near.lat}&nearLng=${near.lng}` : "";
        const url = `/api/courses/search?q=${encodeURIComponent(
          q
        )}&limit=${limit}${nearQS}`;

        const res = await fetch(url, { cache: "no-store" });
        const data: SearchApiResponse = await res.json();

        if (!res.ok) {
          throw new Error(data?.error ?? "Search failed");
        }

        // Ignore older responses
        if (cancelled || seq !== requestSeq.current) return;

        const items = safeItems(data);
        setResults(items);
      } catch (e: any) {
        if (cancelled || seq !== requestSeq.current) return;
        setError(e?.message ?? "Unknown error");
        setResults([]);
      } finally {
        if (cancelled || seq !== requestSeq.current) return;
        setLoading(false);
      }
    }

    doWorldSearch();

    return () => {
      cancelled = true;
    };
  }, [mode, submittedQuery, limit]);

  return {
    // mode
    mode,
    setMode,

    // query + triggers
    queryInput,
    setQueryInput,
    submittedQuery,
    canSearch,
    runSearch,
    clearSearch,

    // location bias (optional)
    setNear,

    // output
    results,
    loading,
    error,
  };
}
