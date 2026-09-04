"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/BackButton";
import { NumberField } from "@/components/ui/NumberField";

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
  gender: string | null; // "male" | "female" | "unisex" | null
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
    <span className="rounded-full border border-[color:var(--sec-line)] bg-[color:color-mix(in_srgb,var(--sec-surface)_50%,transparent)] px-2.5 py-1 text-[10px] uppercase tracking-wide text-[color:var(--sec-muted)]">
      {text}
    </span>
  );
}

function deepCopy<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

// Prefer actual hole count; fallback to name hints for split tees.
function teeHolesCount(t: TeeBox): number {
  const holes = Array.isArray(t.holes) ? t.holes : [];
  if (holes.length > 0) return holes.length;

  const n = (t.name ?? "").toLowerCase();
  if (n.includes("(front 9)") || n.includes("(back 9)")) return 9;

  // default assumption if unknown
  return 18;
}

export default function CourseDetailPage() {
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

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [draftCourseName, setDraftCourseName] = useState("");
  const [draftTees, setDraftTees] = useState<TeeBox[]>([]);

  // Add tee (only in edit mode)
  const [showAddTee, setShowAddTee] = useState(false);
  const [addingTee, setAddingTee] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [newTee, setNewTee] = useState({
    name: "",
    gender: "unisex" as "male" | "female" | "unisex",
    par: "" as string,
    yards: "" as string,
    rating: "" as string,
    slope: "" as string,
  });

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/courses/detail?course_id=${encodeURIComponent(courseId)}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load course");

      setCourse(data.course ?? null);
      setTeeBoxes(Array.isArray(data.tee_boxes) ? data.tee_boxes : []);
      setOpenTeeId(null);
      setGenderFilter("all");
      setHolesFilter("all");
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
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
    }

    if (courseId) load();
    return () => {
      cancelled = true;
    };
  }, [courseId]);

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
    // gender filter
    let arr = sortedTees;
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

  const filteredDraftTees = useMemo(() => {
    let arr = [...draftTees];

    // optional: keep edit list consistent with filters
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
  }, [draftTees, genderFilter, holesFilter]);

  const courseSubtitle = useMemo(() => {
    const bits = [course?.city, course?.country].filter(Boolean);
    return bits.join(" · ");
  }, [course?.city, course?.country]);

  function enterEditMode() {
    if (!course) return;
    setEditError(null);
    setEditMode(true);
    setDraftCourseName(course.name ?? "");

    const draft = deepCopy(teeBoxes);

    // If a tee has no holes, create an editable 18-hole grid
    for (const t of draft) {
      const holes = Array.isArray(t.holes) ? t.holes : [];
      if (holes.length === 0) {
        t.holes = Array.from({ length: 18 }, (_, i) => ({
          id: undefined,
          hole_number: i + 1,
          par: null,
          yardage: null,
          handicap: null,
        }));
      } else {
        t.holes = holes
          .slice()
          .sort((a, b) => (a.hole_number ?? 0) - (b.hole_number ?? 0))
          .map((h) => ({
            id: h.id,
            tee_box_id: h.tee_box_id,
            hole_number: h.hole_number,
            par: h.par ?? null,
            yardage: h.yardage ?? null,
            handicap: h.handicap ?? null,
          }));
      }
    }

    setDraftTees(draft);
    if (draft[0]?.id) setOpenTeeId(draft[0].id);

    // enable add tee section in edit mode
    setShowAddTee(false);
    setAddErr(null);
    setNewTee({ name: "", gender: "unisex", par: "", yards: "", rating: "", slope: "" });
  }

  function exitEditModeDiscard() {
    setEditError(null);
    setEditMode(false);
    setSaving(false);
    setDraftCourseName("");
    setDraftTees([]);

    setShowAddTee(false);
    setAddErr(null);
    setAddingTee(false);
    setNewTee({ name: "", gender: "unisex", par: "", yards: "", rating: "", slope: "" });
  }

  function updateDraftTee(teeId: string, patch: Partial<TeeBox>) {
    setDraftTees((prev) => prev.map((t) => (t.id === teeId ? { ...t, ...patch } : t)));
  }

  function updateDraftHole(teeId: string, holeNumber: number, patch: Partial<Hole>) {
    setDraftTees((prev) =>
      prev.map((t) => {
        if (t.id !== teeId) return t;
        const holes = Array.isArray(t.holes) ? t.holes : [];
        const nextHoles = holes.map((h) => (h.hole_number === holeNumber ? { ...h, ...patch } : h));
        return { ...t, holes: nextHoles };
      })
    );
  }

  async function saveEdits() {
    if (!course) return;
    setEditError(null);
    setSaving(true);

    try {
      const payload = {
        course_id: course.id,
        course_name: draftCourseName.trim(),
        tee_boxes: draftTees.map((t) => ({
          id: t.id,
          name: t.name,
          gender: t.gender,
          yards: t.yards,
          par: t.par,
          rating: t.rating,
          slope: t.slope,
          holes: (t.holes ?? []).map((h) => ({
            id: h.id ?? null,
            hole_number: h.hole_number,
            par: h.par,
            yardage: h.yardage,
            handicap: h.handicap,
          })),
        })),
      };

      const res = await fetch("/api/courses/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to save");

      setEditMode(false);
      setDraftCourseName("");
      setDraftTees([]);

      setShowAddTee(false);
      setAddErr(null);

      await reload();
    } catch (e: any) {
      setEditError(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTeeBox(teeId: string) {
    if (!course) return;

    const ok = window.confirm("Delete this tee box? This will also delete its hole-by-hole data.");
    if (!ok) return;

    setEditError(null);
    setSaving(true);

    try {
      const res = await fetch(
        `/api/courses/tee-boxes/${encodeURIComponent(teeId)}?course_id=${encodeURIComponent(course.id)}`,
        { method: "DELETE" }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to delete tee box");

      await reload();

      // Leave edit mode to avoid stale drafts
      if (editMode) {
        setEditMode(false);
        setDraftCourseName("");
        setDraftTees([]);
      }
    } catch (e: any) {
      setEditError(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function addTeeBox() {
    if (!course) return;
    setAddErr(null);

    const name = newTee.name.trim();
    if (!name) {
      setAddErr("Please enter a tee name.");
      return;
    }

    setAddingTee(true);
    try {
      const res = await fetch("/api/courses/tee-boxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_id: course.id,
          name,
          gender: newTee.gender,
          par: newTee.par.trim() ? Number(newTee.par) : null,
          yards: newTee.yards.trim() ? Number(newTee.yards) : null,
          rating: newTee.rating.trim() ? Number(newTee.rating) : null,
          slope: newTee.slope.trim() ? Number(newTee.slope) : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to add tee box");

      // Reload, then re-enter edit mode so the new tee appears in draft
      await reload();
      enterEditMode();

      // Open the newly added tee if returned
      if (data?.tee_box?.id) setOpenTeeId(data.tee_box.id);

      // Keep form open for multiple adds, but clear name
      setNewTee((p) => ({ ...p, name: "" }));
    } catch (e: any) {
      setAddErr(e?.message ?? "Unknown error");
    } finally {
      setAddingTee(false);
    }
  }

  const visibleTees = editMode ? filteredDraftTees : filteredTees;

  return (
    <div className="min-h-screen bg-[color:var(--ciaga-ground)] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-4">
        {/* Header */}
        <header className="flex items-center justify-between">
          <BackButton
            onClick={() => router.back()}
            disabled={saving || addingTee}
          />

          <div className="text-center flex-1 min-w-0">
            <div className="text-lg font-semibold tracking-wide text-[color:var(--sec-accent)] truncate">
              {course?.name ?? "Course"}
            </div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--sec-muted)]">
              Tee Boxes
            </div>
          </div>

          {/* Top-right edit/save */}
          <Button
            variant="ghost"
            size="sm"
            className="px-2 text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)]"
            onClick={() => {
              if (!course) return;
              if (!editMode) enterEditMode();
              else saveEdits();
            }}
            disabled={!course || loading || saving || addingTee}
          >
            {editMode ? (saving ? "Saving…" : "Save") : "Edit"}
          </Button>
        </header>

        {loading && (
          <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] p-4 text-sm text-[color:var(--sec-muted)]">
            Loading course…
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-900/40 bg-red-950/20 p-4 text-sm text-red-200">
            {error}
          </div>
        )}

        {editError && (
          <div className="rounded-2xl border border-red-900/40 bg-red-950/20 p-4 text-sm text-red-200">
            {editError}
          </div>
        )}

        {!loading && !error && course && (
          <>
            {/* Course card */}
            <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] p-4">
              {!editMode ? (
                <div className="text-sm font-semibold text-[color:var(--sec-text)]">{course.name}</div>
              ) : (
                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--sec-muted)]">
                    Course name
                  </div>
                  <input
                    className="w-full rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-3 py-2 text-sm text-[color:var(--sec-text)] outline-none focus:border-[color:var(--sec-line)]"
                    value={draftCourseName}
                    onChange={(e) => setDraftCourseName(e.target.value)}
                    placeholder="Course name"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-2 text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)]"
                    onClick={exitEditModeDiscard}
                    disabled={saving || addingTee}
                  >
                    Cancel
                  </Button>
                </div>
              )}

              {courseSubtitle ? (
                <div className="mt-1 text-[11px] text-[color:var(--sec-muted)]">{courseSubtitle}</div>
              ) : null}

              <div className="mt-2 text-[10px] text-[color:var(--sec-muted)] truncate">
                Source: {course.osm_id}
              </div>
            </div>

            {/* Add tee box (only in edit mode) */}
            {editMode ? (
              <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-medium text-[color:var(--sec-text)]">Add tee box</div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[color:var(--sec-text)] hover:bg-[color:var(--sec-surface-2)]"
                    onClick={() => {
                      setAddErr(null);
                      setShowAddTee((v) => !v);
                    }}
                    disabled={addingTee || saving}
                  >
                    {showAddTee ? "Close" : "+ Add"}
                  </Button>
                </div>

                {showAddTee ? (
                  <div className="mt-3 space-y-3">
                    {addErr ? (
                      <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-3 text-xs text-red-200">
                        {addErr}
                      </div>
                    ) : null}

                    <input
                      className="w-full rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-3 py-2 text-sm text-[color:var(--sec-text)] outline-none focus:border-[color:var(--sec-line)]"
                      placeholder="Tee name (e.g. Blue)"
                      value={newTee.name}
                      onChange={(e) => setNewTee((p) => ({ ...p, name: e.target.value }))}
                    />

                    <div className="grid grid-cols-2 gap-2">
                      <select
                        className="rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-3 py-2 text-sm text-[color:var(--sec-text)] outline-none focus:border-[color:var(--sec-line)]"
                        value={newTee.gender}
                        onChange={(e) => setNewTee((p) => ({ ...p, gender: e.target.value as any }))}
                      >
                        <option value="unisex">Unisex</option>
                        <option value="male">Men</option>
                        <option value="female">Women</option>
                      </select>

                      <input
                        className="rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-3 py-2 text-sm text-[color:var(--sec-text)] outline-none focus:border-[color:var(--sec-line)]"
                        placeholder="Par"
                        inputMode="numeric"
                        value={newTee.par}
                        onChange={(e) => setNewTee((p) => ({ ...p, par: e.target.value }))}
                      />

                      <input
                        className="rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-3 py-2 text-sm text-[color:var(--sec-text)] outline-none focus:border-[color:var(--sec-line)]"
                        placeholder="Yards"
                        inputMode="numeric"
                        value={newTee.yards}
                        onChange={(e) => setNewTee((p) => ({ ...p, yards: e.target.value }))}
                      />

                      <input
                        className="rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-3 py-2 text-sm text-[color:var(--sec-text)] outline-none focus:border-[color:var(--sec-line)]"
                        placeholder="Rating"
                        inputMode="decimal"
                        value={newTee.rating}
                        onChange={(e) => setNewTee((p) => ({ ...p, rating: e.target.value }))}
                      />

                      <input
                        className="rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-3 py-2 text-sm text-[color:var(--sec-text)] outline-none focus:border-[color:var(--sec-line)]"
                        placeholder="Slope"
                        inputMode="numeric"
                        value={newTee.slope}
                        onChange={(e) => setNewTee((p) => ({ ...p, slope: e.target.value }))}
                      />

                      <Button
                        className="col-span-2 bg-[color:var(--sec-primary)] hover:bg-[color:var(--sec-primary-hover)] text-[color:var(--sec-text)]"
                        disabled={addingTee || !newTee.name.trim()}
                        onClick={addTeeBox}
                      >
                        {addingTee ? "Saving…" : "Save tee box"}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Gender toggle */}
            <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] p-2 flex gap-2">
              <button
                type="button"
                onClick={() => setGenderFilter("all")}
                className={[
                  "flex-1 rounded-xl px-3 py-2 text-xs font-medium",
                  genderFilter === "all"
                    ? "bg-[color:var(--sec-surface)] border border-[color:var(--sec-line)]"
                    : "hover:bg-[color:var(--sec-surface-2)]",
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
                    ? "bg-[color:var(--sec-surface)] border border-[color:var(--sec-line)]"
                    : "hover:bg-[color:var(--sec-surface-2)]",
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
                    ? "bg-[color:var(--sec-surface)] border border-[color:var(--sec-line)]"
                    : "hover:bg-[color:var(--sec-surface-2)]",
                ].join(" ")}
              >
                Women
              </button>
            </div>

            {/* Holes toggle (NEW) */}
            <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] p-2 flex gap-2">
              <button
                type="button"
                onClick={() => setHolesFilter("all")}
                className={[
                  "flex-1 rounded-xl px-3 py-2 text-xs font-medium",
                  holesFilter === "all"
                    ? "bg-[color:var(--sec-surface)] border border-[color:var(--sec-line)]"
                    : "hover:bg-[color:var(--sec-surface-2)]",
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
                    ? "bg-[color:var(--sec-surface)] border border-[color:var(--sec-line)]"
                    : "hover:bg-[color:var(--sec-surface-2)]",
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
                    ? "bg-[color:var(--sec-surface)] border border-[color:var(--sec-line)]"
                    : "hover:bg-[color:var(--sec-surface-2)]",
                ].join(" ")}
              >
                9 holes
              </button>
            </div>

            {/* Tee list */}
            {visibleTees.length === 0 ? (
              <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] p-4 text-sm text-[color:var(--sec-muted)]">
                No tee boxes match this filter.
              </div>
            ) : (
              <ul className="space-y-3">
                {visibleTees.map((t) => {
                  const g = genderLabel(t.gender);
                  const isOpen = openTeeId === t.id;

                  const holes = Array.isArray(t.holes) ? t.holes : [];
                  const holesCount = holes.length;

                  return (
                    <li
                      key={t.id}
                      className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_80%,transparent)] overflow-hidden"
                    >
                      {/* Tee header */}
                      <button
                        type="button"
                        className="w-full text-left p-4 hover:bg-[color:var(--sec-surface-2)] transition-colors"
                        onClick={() => setOpenTeeId((prev) => (prev === t.id ? null : t.id))}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 w-full">
                            {!editMode ? (
                              <>
                                <div className="font-medium text-[color:var(--sec-text)] truncate">
                                  {t.name}
                                  {g ? (
                                    <span className="text-[color:var(--sec-muted)]">{` · ${g}`}</span>
                                  ) : null}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {chip(`Par ${t.par ?? "—"}`)}
                                  {chip(`${t.yards ?? "—"} yds`)}
                                  {chip(`Rating ${fmtNum(t.rating, 1)}`)}
                                  {chip(`Slope ${t.slope ?? "—"}`)}
                                  {holesCount ? chip(`${holesCount} holes`) : chip(`${teeHolesCount(t)} holes`)}
                                </div>
                              </>
                            ) : (
                              <>
                                <div className="grid grid-cols-2 gap-2">
                                  <input
                                    className="col-span-2 rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-3 py-2 text-sm text-[color:var(--sec-text)] outline-none focus:border-[color:var(--sec-line)]"
                                    value={t.name ?? ""}
                                    onChange={(e) => updateDraftTee(t.id, { name: e.target.value })}
                                    placeholder="Tee name"
                                    onClick={(e) => e.stopPropagation()}
                                  />

                                  <select
                                    className="rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-3 py-2 text-sm text-[color:var(--sec-text)] outline-none focus:border-[color:var(--sec-line)]"
                                    value={t.gender ?? "unisex"}
                                    onChange={(e) => updateDraftTee(t.id, { gender: e.target.value })}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <option value="unisex">Unisex</option>
                                    <option value="male">Men</option>
                                    <option value="female">Women</option>
                                  </select>

                                  <NumberField
                                    className="rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-3 py-2 text-sm text-[color:var(--sec-text)] outline-none focus:border-[color:var(--sec-line)]"
                                    value={t.par}
                                    onValueChange={(v) => updateDraftTee(t.id, { par: v })}
                                    placeholder="Par"
                                    onClick={(e) => e.stopPropagation()}
                                  />

                                  <NumberField
                                    className="rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-3 py-2 text-sm text-[color:var(--sec-text)] outline-none focus:border-[color:var(--sec-line)]"
                                    value={t.yards}
                                    onValueChange={(v) => updateDraftTee(t.id, { yards: v })}
                                    placeholder="Yards"
                                    onClick={(e) => e.stopPropagation()}
                                  />

                                  <NumberField
                                    className="rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-3 py-2 text-sm text-[color:var(--sec-text)] outline-none focus:border-[color:var(--sec-line)]"
                                    value={t.rating}
                                    onValueChange={(v) => updateDraftTee(t.id, { rating: v })}
                                    placeholder="Rating"
                                    allowDecimal
                                    onClick={(e) => e.stopPropagation()}
                                  />

                                  <NumberField
                                    className="rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-3 py-2 text-sm text-[color:var(--sec-text)] outline-none focus:border-[color:var(--sec-line)]"
                                    value={t.slope}
                                    onValueChange={(v) => updateDraftTee(t.id, { slope: v })}
                                    placeholder="Slope"
                                    onClick={(e) => e.stopPropagation()}
                                  />
                                </div>

                                <div className="mt-2 flex items-center justify-between">
                                  <div className="text-[10px] text-[color:var(--sec-muted)]">
                                    Tap to expand and edit holes.
                                  </div>

                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="px-2 text-red-200 hover:bg-red-900/20"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      deleteTeeBox(t.id);
                                    }}
                                    disabled={saving || addingTee}
                                  >
                                    Delete tee
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>

                          <div className="shrink-0 text-[color:var(--sec-muted)] text-sm pt-1">
                            {isOpen ? "▾" : "▸"}
                          </div>
                        </div>
                      </button>

                      {/* Expanded holes */}
                      {isOpen ? (
                        <div className="border-t border-[color:var(--sec-hair)] px-4 pb-4">
                          {!editMode ? (
                            holesCount === 0 ? (
                              <div className="pt-3 text-sm text-[color:var(--sec-muted)]">
                                No hole-by-hole data saved for this tee yet.
                              </div>
                            ) : (
                              <div className="pt-3">
                                <div className="grid grid-cols-4 gap-2 text-[10px] uppercase tracking-[0.18em] text-[color:var(--sec-muted)] px-1">
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
                                        className="grid grid-cols-4 gap-2 items-center rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-3 py-2 text-sm"
                                      >
                                        <div className="font-medium text-[color:var(--sec-text)]">{h.hole_number}</div>
                                        <div className="text-center text-[color:var(--sec-muted)]">{h.par ?? "—"}</div>
                                        <div className="text-center text-[color:var(--sec-muted)]">
                                          {h.yardage ?? "—"}
                                        </div>
                                        <div className="text-center text-[color:var(--sec-muted)]">
                                          {h.handicap ?? "—"}
                                        </div>
                                      </div>
                                    ))}
                                </div>
                              </div>
                            )
                          ) : (
                            <div className="pt-3">
                              <div className="grid grid-cols-4 gap-2 text-[10px] uppercase tracking-[0.18em] text-[color:var(--sec-muted)] px-1">
                                <div>Hole</div>
                                <div className="text-center">Par</div>
                                <div className="text-center">Yds</div>
                                <div className="text-center">HCP</div>
                              </div>

                              <div className="mt-2 space-y-2">
                                {(t.holes ?? [])
                                  .slice()
                                  .sort((a, b) => a.hole_number - b.hole_number)
                                  .map((h) => (
                                    <div
                                      key={h.id ?? `${t.id}-${h.hole_number}`}
                                      className="grid grid-cols-4 gap-2 items-center rounded-xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-3 py-2 text-sm"
                                    >
                                      <div className="font-medium text-[color:var(--sec-text)]">{h.hole_number}</div>

                                      <NumberField
                                        className="rounded-lg border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-2 py-1 text-center text-[color:var(--sec-text)] outline-none focus:border-[color:var(--sec-line)]"
                                        value={h.par}
                                        placeholder="—"
                                        onValueChange={(v) =>
                                          updateDraftHole(t.id, h.hole_number, { par: v })
                                        }
                                      />

                                      <NumberField
                                        className="rounded-lg border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-2 py-1 text-center text-[color:var(--sec-text)] outline-none focus:border-[color:var(--sec-line)]"
                                        value={h.yardage}
                                        placeholder="—"
                                        onValueChange={(v) =>
                                          updateDraftHole(t.id, h.hole_number, { yardage: v })
                                        }
                                      />

                                      <NumberField
                                        className="rounded-lg border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] px-2 py-1 text-center text-[color:var(--sec-text)] outline-none focus:border-[color:var(--sec-line)]"
                                        value={h.handicap}
                                        placeholder="—"
                                        onValueChange={(v) =>
                                          updateDraftHole(t.id, h.hole_number, { handicap: v })
                                        }
                                      />
                                    </div>
                                  ))}
                              </div>

                              <div className="mt-3 text-[10px] text-[color:var(--sec-muted)]">
                                Tip: leaving a hole blank will not create/update it.
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

            <div className="pt-2 text-center text-[10px] text-[color:var(--sec-muted)]">
              Tee data is cached in Supabase after first view.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
