"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";

type Hole = {
  id?: string;
  tee_box_id?: string;
  hole_number: number;
  par: number | null;
  yardage: number | null;
  handicap: number | null;
};

type TeeBox = {
  id: string;
  name: string;
  gender: string | null;
  yards: number | null;
  par: number | null;
  rating: number | null;
  slope: number | null;
  holes?: Hole[];
};

type Course = {
  id: string;
  name: string;
  osm_id: string;
  lat: number | null;
  lng: number | null;
  city: string | null;
  country: string | null;
};

type GenderFilter = "all" | "male" | "female";
type HolesFilter = "all" | "18" | "9";

function genderLabel(g: string | null | undefined) {
  const s = (g ?? "").toLowerCase();
  if (s === "male" || s === "men") return "Men";
  if (s === "female" || s === "women") return "Women";
  if (s === "unisex") return "Unisex";
  return null;
}

function normalizeGender(g: string | null | undefined): "male" | "female" | "unisex" {
  const s = (g ?? "").toLowerCase().trim();
  if (["male", "men", "m"].includes(s)) return "male";
  if (["female", "women", "w", "f", "ladies", "lady"].includes(s)) return "female";
  return "unisex";
}

function fmtNum(n: number | null | undefined, digits = 1) {
  if (!Number.isFinite(n as number)) return "—";
  const x = n as number;
  if (digits <= 0) return String(Math.round(x));
  return x.toFixed(digits);
}

function chip(text: string) {
  return (
    <span className="rounded-full border border-emerald-200/30 bg-[#0a341c]/50 px-2.5 py-1 text-[10px] uppercase tracking-wide text-emerald-100/80">
      {text}
    </span>
  );
}

// Prefer actual hole count; fallback to name hints for split tees.
function teeHolesCount(t: TeeBox): number {
  const holes = Array.isArray(t.holes) ? t.holes : [];
  if (holes.length > 0) return holes.length;

  const n = (t.name ?? "").toLowerCase();
  if (n.includes("(front 9)") || n.includes("(back 9)")) return 9;

  return 18;
}

export default function RoundNewTeePage() {
  const router = useRouter();
  const params = useParams<{ course_id: string }>();
  const courseId = params.course_id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [course, setCourse] = useState<Course | null>(null);
  const [teeBoxes, setTeeBoxes] = useState<TeeBox[]>([]);
  const [openTeeId, setOpenTeeId] = useState<string | null>(null);

  const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");
  const [holesFilter, setHolesFilter] = useState<HolesFilter>("all");

  const [busyTeeId, setBusyTeeId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        router.replace("/auth");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/courses/detail?course_id=${encodeURIComponent(courseId)}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Failed to load course");

        if (!cancelled) {
          setCourse(data.course ?? null);
          setTeeBoxes(Array.isArray(data.tee_boxes) ? data.tee_boxes : []);
          setOpenTeeId(null);
          setGenderFilter("all");
          setHolesFilter("all");
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, courseId]);

  const courseSubtitle = useMemo(() => {
    const bits = [course?.city, course?.country].filter(Boolean);
    return bits.join(" · ");
  }, [course?.city, course?.country]);

  // Safety sort: highest rating first, then slope, then yards (desc)
  const sortedTees = useMemo(() => {
    const arr = [...teeBoxes];
    arr.sort((a, b) => {
      const ar = a.rating ?? -1;
      const br = b.rating ?? -1;
      if (br !== ar) return br - ar;

      const as = a.slope ?? -1;
      const bs = b.slope ?? -1;
      if (bs !== as) return bs - as;

      const ay = a.yards ?? -1;
      const by = b.yards ?? -1;
      return by - ay;
    });
    return arr;
  }, [teeBoxes]);

  const filteredTees = useMemo(() => {
    let arr = sortedTees;

    // gender filter
    if (genderFilter !== "all") {
      arr = arr.filter((t) => {
        const g = normalizeGender(t.gender);
        if (genderFilter === "male") return g === "male" || g === "unisex";
        if (genderFilter === "female") return g === "female" || g === "unisex";
        return true;
      });
    }

    // holes filter
    if (holesFilter !== "all") {
      const want = holesFilter === "18" ? 18 : 9;
      arr = arr.filter((t) => teeHolesCount(t) === want);
    }

    return arr;
  }, [sortedTees, genderFilter, holesFilter]);

  async function createRoundAndGoSetup(teeBoxId: string) {
    setError(null);
    setBusyTeeId(teeBoxId);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Not authenticated.");

      const res = await fetch("/api/rounds/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          course_id: courseId,
          pending_tee_box_id: teeBoxId,
          name: null,
          visibility: "private",
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Create round failed (${res.status})`);

      const roundId = json.round_id as string;
      router.push(`/round/${roundId}/setup`);
    } catch (e: any) {
      setError(e?.message || "Failed to create round");
      setBusyTeeId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-4">
        <header className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="px-2 text-emerald-100 hover:bg-emerald-900/30"
            onClick={() => router.back()}
            disabled={!!busyTeeId}
          >
            ← Back
          </Button>

          <div className="text-center flex-1 min-w-0">
            <div className="text-lg font-semibold tracking-wide text-[#f5e6b0] truncate">
              {course?.name ?? "Select tee"}
            </div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">Choose tee</div>
          </div>

          <div className="w-[60px]" />
        </header>

        {loading ? (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
            Loading course…
          </div>
        ) : null}

        {error ? (
          <div className="rounded-2xl border border-red-900/40 bg-red-950/20 p-4 text-sm text-red-200">{error}</div>
        ) : null}

        {!loading && course ? (
          <>
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
              <div className="text-sm font-semibold text-emerald-50">{course.name}</div>
              {courseSubtitle ? <div className="mt-1 text-[11px] text-emerald-200/70">{courseSubtitle}</div> : null}
              <div className="mt-2 text-[10px] text-emerald-100/50 truncate">Source: {course.osm_id}</div>
            </div>

            {/* Gender toggle */}
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-2 flex gap-2">
              <button
                type="button"
                onClick={() => setGenderFilter("all")}
                className={[
                  "flex-1 rounded-xl px-3 py-2 text-xs font-medium",
                  genderFilter === "all"
                    ? "bg-emerald-900/40 border border-emerald-200/30"
                    : "hover:bg-emerald-900/20",
                ].join(" ")}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setGenderFilter("male")}
                className={[
                  "flex-1 rounded-xl px-3 py-2 text-xs font-medium",
                  genderFilter === "male"
                    ? "bg-emerald-900/40 border border-emerald-200/30"
                    : "hover:bg-emerald-900/20",
                ].join(" ")}
              >
                Men
              </button>
              <button
                type="button"
                onClick={() => setGenderFilter("female")}
                className={[
                  "flex-1 rounded-xl px-3 py-2 text-xs font-medium",
                  genderFilter === "female"
                    ? "bg-emerald-900/40 border border-emerald-200/30"
                    : "hover:bg-emerald-900/20",
                ].join(" ")}
              >
                Women
              </button>
            </div>

            {/* Holes toggle */}
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-2 flex gap-2">
              <button
                type="button"
                onClick={() => setHolesFilter("all")}
                className={[
                  "flex-1 rounded-xl px-3 py-2 text-xs font-medium",
                  holesFilter === "all"
                    ? "bg-emerald-900/40 border border-emerald-200/30"
                    : "hover:bg-emerald-900/20",
                ].join(" ")}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setHolesFilter("18")}
                className={[
                  "flex-1 rounded-xl px-3 py-2 text-xs font-medium",
                  holesFilter === "18"
                    ? "bg-emerald-900/40 border border-emerald-200/30"
                    : "hover:bg-emerald-900/20",
                ].join(" ")}
              >
                18 holes
              </button>
              <button
                type="button"
                onClick={() => setHolesFilter("9")}
                className={[
                  "flex-1 rounded-xl px-3 py-2 text-xs font-medium",
                  holesFilter === "9"
                    ? "bg-emerald-900/40 border border-emerald-200/30"
                    : "hover:bg-emerald-900/20",
                ].join(" ")}
              >
                9 holes
              </button>
            </div>

            {/* Tee list */}
            {filteredTees.length === 0 ? (
              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
                No tee boxes match this filter.
              </div>
            ) : (
              <ul className="space-y-3">
                {filteredTees.map((t) => {
                  const g = genderLabel(t.gender);
                  const isOpen = openTeeId === t.id;

                  const holes = Array.isArray(t.holes) ? t.holes : [];
                  const holesCount = holes.length || teeHolesCount(t);

                  const busy = busyTeeId === t.id;

                  return (
                    <li
                      key={t.id}
                      className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 overflow-hidden"
                    >
                      {/* Tee header */}
                      <button
                        type="button"
                        className="w-full text-left p-4 hover:bg-emerald-900/20 transition-colors disabled:opacity-60"
                        onClick={() => setOpenTeeId((prev) => (prev === t.id ? null : t.id))}
                        disabled={!!busyTeeId}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 w-full">
                            <div className="font-medium text-emerald-50 truncate">
                              {t.name}
                              {g ? <span className="text-emerald-200/70">{` · ${g}`}</span> : null}
                            </div>

                            <div className="mt-2 flex flex-wrap gap-2">
                              {chip(`Par ${t.par ?? "—"}`)}
                              {chip(`${t.yards ?? "—"} yds`)}
                              {chip(`Rating ${fmtNum(t.rating, 1)}`)}
                              {chip(`Slope ${t.slope ?? "—"}`)}
                              {chip(`${holesCount} holes`)}
                            </div>

                            {/* Action: positioned where "Start now" was (right side / 2nd slot) */}
                            <div className="mt-3 grid grid-cols-2 gap-2">
                              <div /> {/* empty left slot to keep position */}
                              <Button
                                className="rounded-xl border border-emerald-200/30 bg-[#042713] text-emerald-50 hover:bg-[#0a341c]/50 disabled:opacity-60"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  createRoundAndGoSetup(t.id);
                                }}
                                disabled={!!busyTeeId}
                              >
                                {busy ? "Creating…" : "Select tee"}
                              </Button>
                            </div>
                          </div>

                          <div className="shrink-0 text-emerald-100/70 text-sm pt-1">{isOpen ? "▾" : "▸"}</div>
                        </div>
                      </button>

                      {/* Expanded holes */}
                      {isOpen ? (
                        <div className="border-t border-emerald-900/60 px-4 pb-4">
                          {holes.length === 0 ? (
                            <div className="pt-3 text-sm text-emerald-100/70">
                              No hole-by-hole data saved for this tee yet.
                            </div>
                          ) : (
                            <div className="pt-3">
                              <div className="grid grid-cols-4 gap-2 text-[10px] uppercase tracking-[0.18em] text-emerald-200/70 px-1">
                                <div>Hole</div>
                                <div className="text-center">Par</div>
                                <div className="text-center">Yds</div>
                                <div className="text-center">HCP</div>
                              </div>

                              <div className="mt-2 space-y-2">
                                {holes
                                  .slice()
                                  .sort((a, b) => (a.hole_number ?? 0) - (b.hole_number ?? 0))
                                  .map((h) => (
                                    <div
                                      key={h.id ?? `${t.id}-${h.hole_number}`}
                                      className="grid grid-cols-4 gap-2 items-center rounded-xl border border-emerald-900/60 bg-[#0a341c]/40 px-3 py-2 text-sm"
                                    >
                                      <div className="font-medium text-emerald-50">{h.hole_number}</div>
                                      <div className="text-center text-emerald-100/80">{h.par ?? "—"}</div>
                                      <div className="text-center text-emerald-100/80">{h.yardage ?? "—"}</div>
                                      <div className="text-center text-emerald-100/80">{h.handicap ?? "—"}</div>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="pt-2 text-center text-[10px] text-emerald-100/50">
              Select a tee to create a round, then add players before starting.
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
