"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import { CoursePickerModal } from "./CoursePickerModal";

type Hole = {
  hole_number: number;
  par: number | null;
  yardage: number | null;
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
  city: string | null;
  country: string | null;
};

type GenderFilter = "all" | "male" | "female";
type HolesFilter = "all" | "18" | "9";

function normalizeGender(g: string | null | undefined): "male" | "female" | "unisex" {
  const s = (g ?? "").toLowerCase().trim();
  if (["male", "men", "m"].includes(s)) return "male";
  if (["female", "women", "w", "f", "ladies", "lady"].includes(s)) return "female";
  return "unisex";
}

function teeHolesCount(t: TeeBox): number {
  const holes = Array.isArray(t.holes) ? t.holes : [];
  if (holes.length > 0) return holes.length;
  const n = (t.name ?? "").toLowerCase();
  if (n.includes("(front 9)") || n.includes("(back 9)")) return 9;
  return 18;
}

function fmtNum(n: number | null | undefined, digits = 1) {
  if (!Number.isFinite(n as number)) return "—";
  const x = n as number;
  if (digits <= 0) return String(Math.round(x));
  return x.toFixed(digits);
}

type Props = {
  roundId: string;
  courseId: string | null;
  pendingTeeBoxId: string | null;
  isOwner: boolean;
  isEditable: boolean;
  onUpdate: () => void;
};

export function CourseAndTeeSection({
  roundId,
  courseId,
  pendingTeeBoxId,
  isOwner,
  isEditable,
  onUpdate,
}: Props) {
  const [detecting, setDetecting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [course, setCourse] = useState<Course | null>(null);
  const [teeBoxes, setTeeBoxes] = useState<TeeBox[]>([]);
  const [selectedTee, setSelectedTee] = useState<TeeBox | null>(null);

  const [showTeeSelector, setShowTeeSelector] = useState(false);
  const [genderFilter, setGenderFilter] = useState<GenderFilter>("all");
  const [holesFilter, setHolesFilter] = useState<HolesFilter>("all");
  const [pickerOpen, setPickerOpen] = useState(false);

  // Load course and tee data when courseId changes
  useEffect(() => {
    if (!courseId) {
      setCourse(null);
      setTeeBoxes([]);
      setSelectedTee(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(`/api/courses/detail?course_id=${encodeURIComponent(courseId)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Failed to load course");

        if (!cancelled) {
          setCourse(data.course ?? null);
          setTeeBoxes(Array.isArray(data.tee_boxes) ? data.tee_boxes : []);

          // Find selected tee
          if (pendingTeeBoxId && data.tee_boxes) {
            const tee = data.tee_boxes.find((t: TeeBox) => t.id === pendingTeeBoxId);
            setSelectedTee(tee ?? null);
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load course");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [courseId, pendingTeeBoxId]);

  // Auto-detect nearest course on mount
  useEffect(() => {
    if (!courseId && isOwner && isEditable && !detecting) {
      autoDetectNearestCourse();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function autoDetectNearestCourse() {
    setDetecting(true);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 5000,
          maximumAge: 60000,
        });
      });

      const res = await fetch(
        `/api/courses/nearby?lat=${position.coords.latitude}&lng=${position.coords.longitude}&radius=15000`
      );
      const data = await res.json();

      if (data.items?.[0]) {
        const nearest = data.items[0];

        // Resolve OSM ID to database course_id
        const resolveRes = await fetch("/api/courses/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ osm_id: nearest.id }),
        });
        const resolved = await resolveRes.json();

        if (resolved.course_id) {
          await updateCourse(resolved.course_id, null);
          onUpdate();
        }
      }
    } catch (e) {
      // Silently fail - user can manually select
      console.warn("Auto-detect nearest course failed:", e);
    } finally {
      setDetecting(false);
    }
  }

  async function updateCourse(newCourseId: string | null, newTeeId: string | null) {
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/rounds/set-course", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          round_id: roundId,
          course_id: newCourseId,
          pending_tee_box_id: newTeeId,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Failed to update course");

      onUpdate();
    } catch (e: any) {
      setError(e?.message || "Failed to update course");
      throw e;
    }
  }

  async function selectTee(teeId: string) {
    try {
      await updateCourse(courseId, teeId);
      setShowTeeSelector(false);
    } catch (e) {
      // Error already set by updateCourse
    }
  }

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

    if (genderFilter !== "all") {
      arr = arr.filter((t) => {
        const g = normalizeGender(t.gender);
        if (genderFilter === "male") return g === "male" || g === "unisex";
        if (genderFilter === "female") return g === "female" || g === "unisex";
        return true;
      });
    }

    if (holesFilter !== "all") {
      const want = holesFilter === "18" ? 18 : 9;
      arr = arr.filter((t) => teeHolesCount(t) === want);
    }

    return arr;
  }, [sortedTees, genderFilter, holesFilter]);

  const courseSubtitle = useMemo(() => {
    const bits = [course?.city, course?.country].filter(Boolean);
    return bits.join(" · ");
  }, [course?.city, course?.country]);

  const canEdit = isOwner && isEditable;

  const pickerModal = (
    <CoursePickerModal
      open={pickerOpen}
      onClose={() => setPickerOpen(false)}
      onSelect={async (selectedCourseId) => {
        setPickerOpen(false);
        await updateCourse(selectedCourseId, null);
      }}
    />
  );

  // State A: No course selected
  if (!courseId) {
    return (
      <>
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
          <div className="text-sm font-semibold text-emerald-50">Course & Tee</div>
          <div className="text-[11px] text-emerald-100/70 mt-1">Choose where you're playing</div>

          {error && (
            <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/20 p-2 text-xs text-red-200">
              {error}
            </div>
          )}

          <div className="mt-3 text-center py-4">
            <div className="text-2xl mb-2">🏌️</div>
            <div className="text-sm text-emerald-100/70 mb-3">No course selected yet</div>

            {detecting ? (
              <div className="text-xs text-emerald-100/60">Detecting nearest course...</div>
            ) : canEdit ? (
              <Button
                size="sm"
                className="rounded-xl bg-emerald-700/80 hover:bg-emerald-700"
                onClick={() => setPickerOpen(true)}
              >
                Choose Course
              </Button>
            ) : (
              <div className="text-xs text-emerald-100/50">Owner must select course</div>
            )}
          </div>
        </div>
        {pickerModal}
      </>
    );
  }

  // State B & C: Course selected
  return (
    <>
    <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
      <div className="text-sm font-semibold text-emerald-50">Course & Tee</div>

      {loading ? (
        <div className="mt-3 text-xs text-emerald-100/60">Loading course details...</div>
      ) : error ? (
        <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/20 p-2 text-xs text-red-200">
          {error}
        </div>
      ) : course ? (
        <>
          <div className="mt-3">
            <div className="text-base font-semibold text-emerald-50">{course.name}</div>
            {courseSubtitle && (
              <div className="text-[11px] text-emerald-200/70 mt-0.5">{courseSubtitle}</div>
            )}
          </div>

          {selectedTee ? (
            // State C: Tee selected
            <>
              <div className="mt-2 pt-2 border-t border-emerald-900/40">
                <div className="text-sm text-emerald-50">{selectedTee.name}</div>
                <div className="mt-1 text-xs text-emerald-100/70">
                  Par {fmtNum(selectedTee.par, 0)} · {fmtNum(selectedTee.yards, 0)} yds
                  {selectedTee.rating && selectedTee.slope && (
                    <span> · Rating {fmtNum(selectedTee.rating)} · Slope {fmtNum(selectedTee.slope, 0)}</span>
                  )}
                </div>
              </div>

              {canEdit && (
                <div className="mt-3 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 rounded-xl border-emerald-900/70 bg-[#042713]/60 hover:bg-emerald-900/20"
                    onClick={() => setPickerOpen(true)}
                  >
                    Change Course
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 rounded-xl border-emerald-900/70 bg-[#042713]/60 hover:bg-emerald-900/20"
                    onClick={() => setShowTeeSelector(!showTeeSelector)}
                  >
                    {showTeeSelector ? "Hide Tees" : "Change Tee"}
                  </Button>
                </div>
              )}
            </>
          ) : (
            // State B: No tee selected
            <>
              <div className="mt-2 text-xs text-emerald-100/60">No tee selected</div>
              {canEdit && (
                <Button
                  size="sm"
                  className="mt-2 rounded-xl bg-emerald-700/80 hover:bg-emerald-700"
                  onClick={() => setShowTeeSelector(true)}
                >
                  Select Tee
                </Button>
              )}
            </>
          )}

          {/* Inline tee selector */}
          {showTeeSelector && canEdit && (
            <div className="mt-4 pt-4 border-t border-emerald-900/40 space-y-3">
              {/* Filters */}
              <div className="flex gap-2">
                <div className="flex-1 flex gap-1 p-1 rounded-xl border border-emerald-900/70 bg-[#042713]/60">
                  <button
                    type="button"
                    onClick={() => setGenderFilter("all")}
                    className={[
                      "flex-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-colors",
                      genderFilter === "all"
                        ? "bg-emerald-900/40 text-emerald-50"
                        : "text-emerald-100/60 hover:bg-emerald-900/20",
                    ].join(" ")}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setGenderFilter("male")}
                    className={[
                      "flex-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-colors",
                      genderFilter === "male"
                        ? "bg-emerald-900/40 text-emerald-50"
                        : "text-emerald-100/60 hover:bg-emerald-900/20",
                    ].join(" ")}
                  >
                    Men
                  </button>
                  <button
                    type="button"
                    onClick={() => setGenderFilter("female")}
                    className={[
                      "flex-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-colors",
                      genderFilter === "female"
                        ? "bg-emerald-900/40 text-emerald-50"
                        : "text-emerald-100/60 hover:bg-emerald-900/20",
                    ].join(" ")}
                  >
                    Women
                  </button>
                </div>

                <div className="flex-1 flex gap-1 p-1 rounded-xl border border-emerald-900/70 bg-[#042713]/60">
                  <button
                    type="button"
                    onClick={() => setHolesFilter("all")}
                    className={[
                      "flex-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-colors",
                      holesFilter === "all"
                        ? "bg-emerald-900/40 text-emerald-50"
                        : "text-emerald-100/60 hover:bg-emerald-900/20",
                    ].join(" ")}
                  >
                    All
                  </button>
                  <button
                    type="button"
                    onClick={() => setHolesFilter("18")}
                    className={[
                      "flex-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-colors",
                      holesFilter === "18"
                        ? "bg-emerald-900/40 text-emerald-50"
                        : "text-emerald-100/60 hover:bg-emerald-900/20",
                    ].join(" ")}
                  >
                    18
                  </button>
                  <button
                    type="button"
                    onClick={() => setHolesFilter("9")}
                    className={[
                      "flex-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-colors",
                      holesFilter === "9"
                        ? "bg-emerald-900/40 text-emerald-50"
                        : "text-emerald-100/60 hover:bg-emerald-900/20",
                    ].join(" ")}
                  >
                    9
                  </button>
                </div>
              </div>

              {/* Tee list */}
              <div className="max-h-[300px] overflow-y-auto space-y-2">
                {filteredTees.length === 0 ? (
                  <div className="text-center py-4 text-xs text-emerald-100/60">
                    No tees match the selected filters
                  </div>
                ) : (
                  filteredTees.map((tee) => (
                    <button
                      key={tee.id}
                      type="button"
                      onClick={() => selectTee(tee.id)}
                      className="w-full text-left rounded-xl border border-emerald-900/70 bg-[#042713]/60 p-3 hover:bg-emerald-900/20 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-emerald-50">{tee.name}</div>
                          <div className="text-xs text-emerald-100/70 mt-0.5">
                            Par {fmtNum(tee.par, 0)} · {fmtNum(tee.yards, 0)} yds
                            {tee.rating && tee.slope && (
                              <span className="ml-2">
                                {fmtNum(tee.rating)}/{fmtNum(tee.slope, 0)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-[10px] text-emerald-100/50">Select ▸</div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
    {pickerModal}
    </>
  );
}
