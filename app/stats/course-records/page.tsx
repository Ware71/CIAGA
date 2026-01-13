// src/app/stats/course-records/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Button } from "@/components/ui/button";

// -----------------------------
// Helpers
// -----------------------------
function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function round1(n: number) {
  return Math.round(n * 10) / 10;
}
function fmtDate(isoDate: string | null | undefined) {
  if (!isoDate) return "—";
  try {
    const d = new Date(isoDate);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}/${mm}/${yy}`;
  } catch {
    return isoDate;
  }
}
function safeNum(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// -----------------------------
// Types (schema-tolerant)
// -----------------------------
type CourseRow = { id: string; name: string | null };

type ResultRow = {
  round_id?: string | null;
  profile_id?: string | null;
  played_at?: string | null;

  course_id?: string | null;
  tee_id?: string | null;

  gross_score?: number | null;
  net_score?: number | null;

  // joins (if your FK relationships exist)
  courses?: CourseRow | CourseRow[] | null;
  tees?: { id: string; name: string | null } | { id: string; name: string | null }[] | null;

  // fallbacks if you already denormalized names
  course_name?: string | null;
  tee_name?: string | null;
};

type RecordKey = {
  courseId: string;
  teeId: string | null; // null = "Any tee"
};

type RecordSummary = {
  key: RecordKey;
  courseName: string;
  teeName: string;
  bestGross: { score: number; date: string | null } | null;
  bestNet: { score: number; date: string | null } | null;
  rounds: number;
};

type HoleScoreRow = {
  course_id?: string | null;
  tee_id?: string | null;
  profile_id?: string | null;
  played_at?: string | null;

  hole_no?: number | null;
  strokes?: number | null;

  // optional, if you store par
  par?: number | null;
};

type HoleMetaRow = {
  hole_no: number;
  par?: number | null;
};

// -----------------------------
// Assumed tables (adjust if needed)
// -----------------------------
//
// 1) Round results:
//    - preferred: "handicap_round_results" (you already have this table in your rebuild function)
//    - expected columns: profile_id, played_at, course_id, (tee_id optional), gross_score, net_score
//
// 2) Hole-by-hole scoring stream:
//    - "ciaga_scoring_record_stream" (you already reference this in SQL elsewhere)
//    - expected columns: profile_id, played_at, course_id, (tee_id optional), hole_no, strokes
//
// 3) Optional hole metadata table (if you have it):
//    - "course_holes" (or similar) with: course_id, (tee_id optional), hole_no, par
//
// This page will work even if (3) doesn’t exist; it will infer hole count from your data.

export default function CourseRecordsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [results, setResults] = useState<ResultRow[]>([]);
  const [courses, setCourses] = useState<{ courseId: string; courseName: string }[]>([]);

  // Selection for details
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [selectedTeeId, setSelectedTeeId] = useState<string>(""); // empty means "Any tee"

  // Eclectic
  const [ecLoading, setEcLoading] = useState(false);
  const [ecErr, setEcErr] = useState<string | null>(null);
  const [ecHoleMeta, setEcHoleMeta] = useState<HoleMetaRow[]>([]);
  const [ecBestByHole, setEcBestByHole] = useState<Record<number, { strokes: number; date: string | null }>>({});

  // -----------------------------
  // Load my results
  // -----------------------------
  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErr(null);

      try {
        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;

        const user = (authData.user as any) ?? null;
        if (!user) throw new Error("You must be signed in.");

        const pid = await getMyProfileIdByAuthUserId(user.id);

        // Try: handicap_round_results with optional joins.
        // If joins aren’t configured in Supabase, it still returns base fields.
        const { data, error } = await supabase
          .from("handicap_round_results")
          .select(
            `
            round_id,
            profile_id,
            played_at,
            course_id,
            tee_id,
            gross_score,
            net_score,
            course_name,
            tee_name,
            courses ( id, name ),
            tees ( id, name )
          `
          )
          .eq("profile_id", pid)
          .order("played_at", { ascending: false });

        if (error) throw error;

        const rows = ((data as any) ?? []) as ResultRow[];

        if (!alive) return;
        setResults(rows);

        // Build course list for selector
        const courseMap = new Map<string, string>();
        for (const r of rows) {
          const cid = r.course_id ?? "";
          if (!cid) continue;
          const cname =
            r.course_name ??
            (Array.isArray(r.courses) ? r.courses[0]?.name : r.courses?.name) ??
            cid.slice(0, 8);
          if (!courseMap.has(cid)) courseMap.set(cid, cname ?? cid.slice(0, 8));
        }
        const courseList = Array.from(courseMap.entries())
          .map(([courseId, courseName]) => ({ courseId, courseName }))
          .sort((a, b) => a.courseName.localeCompare(b.courseName));

        setCourses(courseList);

        // Default selection
        if (!selectedCourseId && courseList.length) setSelectedCourseId(courseList[0].courseId);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Failed to load course records.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------
  // Derived: records per course/tee
  // -----------------------------
  const records: RecordSummary[] = useMemo(() => {
    const byKey = new Map<string, { key: RecordKey; courseName: string; teeName: string; rows: ResultRow[] }>();

    const keyOf = (courseId: string, teeId: string | null) => `${courseId}::${teeId ?? "ANY"}`;

    for (const r of results) {
      const courseId = r.course_id ?? "";
      if (!courseId) continue;

      const teeId = r.tee_id ?? null;

      const courseName =
        r.course_name ??
        (Array.isArray(r.courses) ? r.courses[0]?.name : r.courses?.name) ??
        courseId.slice(0, 8);

      const teeName =
        r.tee_name ??
        (Array.isArray(r.tees) ? r.tees[0]?.name : r.tees?.name) ??
        (teeId ? teeId.slice(0, 8) : "Any tee");

      const k = keyOf(courseId, teeId);

      if (!byKey.has(k)) {
        byKey.set(k, { key: { courseId, teeId }, courseName: courseName ?? courseId.slice(0, 8), teeName: teeName ?? "Any tee", rows: [] });
      }
      byKey.get(k)!.rows.push(r);
    }

    const out: RecordSummary[] = [];

    for (const entry of byKey.values()) {
      const rows = entry.rows;

      // best gross (lower is better)
      let bestGross: RecordSummary["bestGross"] = null;
      let bestNet: RecordSummary["bestNet"] = null;

      for (const r of rows) {
        const g = safeNum(r.gross_score);
        const n = safeNum(r.net_score);

        if (g !== null) {
          if (!bestGross || g < bestGross.score) bestGross = { score: g, date: r.played_at ?? null };
        }
        if (n !== null) {
          if (!bestNet || n < bestNet.score) bestNet = { score: n, date: r.played_at ?? null };
        }
      }

      out.push({
        key: entry.key,
        courseName: entry.courseName,
        teeName: entry.teeName,
        bestGross,
        bestNet,
        rounds: rows.length,
      });
    }

    // Sort by course name then tee name
    out.sort((a, b) => {
      const c = a.courseName.localeCompare(b.courseName);
      if (c !== 0) return c;
      return a.teeName.localeCompare(b.teeName);
    });

    return out;
  }, [results]);

  // -----------------------------
  // Detail: selected record group (course + tee)
  // -----------------------------
  const selected = useMemo(() => {
    if (!selectedCourseId) return null;

    const teeId = selectedTeeId || null;

    // If tee is not selected, show an "Any tee" aggregate for that course
    // built from all tees (including null tee_id).
    const relevant = results.filter((r) => {
      if (r.course_id !== selectedCourseId) return false;
      if (!teeId) return true;
      return (r.tee_id ?? null) === teeId;
    });

    if (!relevant.length) return null;

    const courseName =
      relevant[0].course_name ??
      (Array.isArray(relevant[0].courses) ? relevant[0].courses[0]?.name : relevant[0].courses?.name) ??
      selectedCourseId.slice(0, 8);

    // tee label for header
    const teeName =
      teeId
        ? relevant.find((x) => (x.tee_id ?? null) === teeId)?.tee_name ??
          (Array.isArray(relevant[0].tees) ? relevant[0].tees[0]?.name : (relevant[0].tees as any)?.name) ??
          teeId.slice(0, 8)
        : "Any tee";

    let bestGross: { score: number; date: string | null } | null = null;
    let bestNet: { score: number; date: string | null } | null = null;

    for (const r of relevant) {
      const g = safeNum(r.gross_score);
      const n = safeNum(r.net_score);
      if (g !== null) {
        if (!bestGross || g < bestGross.score) bestGross = { score: g, date: r.played_at ?? null };
      }
      if (n !== null) {
        if (!bestNet || n < bestNet.score) bestNet = { score: n, date: r.played_at ?? null };
      }
    }

    // tees available for selector
    const teesMap = new Map<string, string>();
    for (const r of results) {
      if (r.course_id !== selectedCourseId) continue;
      const tid = r.tee_id ?? "";
      if (!tid) continue;

      const tname =
        r.tee_name ??
        (Array.isArray(r.tees) ? r.tees[0]?.name : r.tees?.name) ??
        tid.slice(0, 8);
      if (!teesMap.has(tid)) teesMap.set(tid, tname ?? tid.slice(0, 8));
    }
    const teeOptions = Array.from(teesMap.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { courseName, teeName, teeId, bestGross, bestNet, rounds: relevant.length, teeOptions };
  }, [results, selectedCourseId, selectedTeeId]);

  // -----------------------------
  // Eclectic loader (course + tee)
  // -----------------------------
  useEffect(() => {
    let alive = true;

    (async () => {
      setEcErr(null);
      setEcHoleMeta([]);
      setEcBestByHole({});

      if (!selectedCourseId) return;

      setEcLoading(true);
      try {
        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;

        const user = (authData.user as any) ?? null;
        if (!user) throw new Error("You must be signed in.");

        const pid = await getMyProfileIdByAuthUserId(user.id);

        const teeId = selectedTeeId || null;

        // 1) Pull hole meta if you have it (optional)
        // If you don’t have course_holes, this will fail gracefully and we infer from score data.
        let meta: HoleMetaRow[] = [];
        try {
          const mh = await supabase
            .from("course_holes")
            .select("hole_no, par")
            .eq("course_id", selectedCourseId)
            // if your meta is tee-specific, keep this; otherwise remove it
            .maybeSingle();

          // NOTE: the above maybeSingle is intentionally conservative; many schemas store holes as multiple rows.
          // We'll do a safer fetch next:
        } catch {
          // ignore
        }

        // Safer hole meta fetch for the common schema: many rows
        try {
          let q = supabase.from("course_holes").select("hole_no, par").eq("course_id", selectedCourseId);
          if (teeId) q = q.eq("tee_id", teeId);
          const { data: mData, error: mErr } = await q.order("hole_no", { ascending: true });
          if (!mErr && Array.isArray(mData) && mData.length) {
            meta = (mData as any[]).map((r) => ({ hole_no: Number(r.hole_no), par: safeNum(r.par) ?? null }));
          }
        } catch {
          // ignore
        }

        // 2) Pull hole-by-hole scores from the stream
        let sq = supabase
          .from("ciaga_scoring_record_stream")
          .select("hole_no, strokes, played_at, course_id, tee_id")
          .eq("profile_id", pid)
          .eq("course_id", selectedCourseId)
          .order("played_at", { ascending: false });

        if (teeId) sq = sq.eq("tee_id", teeId);

        const { data: sData, error: sErr } = await sq;
        if (sErr) throw sErr;

        const rows = ((sData as any) ?? []) as HoleScoreRow[];

        // Infer hole count if meta missing
        if (!meta.length) {
          const maxHole = rows.reduce((m, r) => Math.max(m, Number(r.hole_no ?? 0)), 0);
          const holeCount = maxHole >= 9 ? (maxHole >= 18 ? 18 : 9) : maxHole;
          meta = Array.from({ length: holeCount }, (_, i) => ({ hole_no: i + 1, par: null }));
        }

        // Build best per hole
        const best: Record<number, { strokes: number; date: string | null }> = {};
        for (const r of rows) {
          const h = safeNum(r.hole_no);
          const s = safeNum(r.strokes);
          if (h === null || s === null) continue;
          const hole = Math.round(h);
          if (!Number.isFinite(hole) || hole <= 0) continue;

          if (!best[hole] || s < best[hole].strokes) {
            best[hole] = { strokes: s, date: r.played_at ?? null };
          }
        }

        if (!alive) return;
        setEcHoleMeta(meta);
        setEcBestByHole(best);
      } catch (e: any) {
        if (!alive) return;
        setEcErr(e?.message ?? "Failed to load eclectic scoring.");
      } finally {
        if (!alive) return;
        setEcLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [selectedCourseId, selectedTeeId]);

  // -----------------------------
  // Eclectic computed
  // -----------------------------
  const eclectic = useMemo(() => {
    if (!ecHoleMeta.length) return null;

    let total = 0;
    let have = 0;
    let missing: number[] = [];

    for (const h of ecHoleMeta) {
      const b = ecBestByHole[h.hole_no];
      if (!b) {
        missing.push(h.hole_no);
        continue;
      }
      total += b.strokes;
      have += 1;
    }

    const complete = missing.length === 0;
    return {
      holes: ecHoleMeta.length,
      have,
      missing,
      total: have ? total : null,
      complete,
    };
  }, [ecHoleMeta, ecBestByHole]);

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-6">
        {/* Header */}
        <header className="relative flex items-center justify-center">
          <Button
            variant="ghost"
            size="sm"
            className="absolute left-0 px-2 text-emerald-100 hover:bg-emerald-900/30 font-semibold"
            onClick={() => router.back()}
          >
            ← Back
          </Button>

          <div className="text-center">
            <div className="text-lg font-extrabold tracking-wide text-[#f5e6b0]">Stats</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70 font-semibold">Course records</div>
          </div>
        </header>

        {loading ? (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-4 text-sm font-semibold text-emerald-100/70">
            Loading…
          </div>
        ) : err ? (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-4 text-sm font-semibold text-red-300">
            {err}
          </div>
        ) : (
          <>
            {/* Selector */}
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5 space-y-3">
              <div>
                <div className="text-sm font-extrabold text-emerald-50">Select course</div>
                <div className="text-[11px] text-emerald-100/55 font-semibold">Choose a course to view PBs and eclectic scoring</div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-xs text-emerald-100/70 w-[70px] font-semibold">Course</div>
                <select
                  value={selectedCourseId}
                  onChange={(e) => {
                    setSelectedCourseId(e.target.value);
                    setSelectedTeeId("");
                  }}
                  className="h-10 flex-1 rounded-xl border border-emerald-900/70 bg-[#042713] px-3 text-sm font-semibold text-emerald-50 outline-none focus:border-[#f5e6b0]/70"
                >
                  {courses.map((c) => (
                    <option key={c.courseId} value={c.courseId}>
                      {c.courseName}
                    </option>
                  ))}
                </select>
              </div>

              {/* Tee selector (only shows if we detect any tee_ids for that course) */}
              {selected?.teeOptions?.length ? (
                <div className="flex items-center gap-3">
                  <div className="text-xs text-emerald-100/70 w-[70px] font-semibold">Tee</div>
                  <select
                    value={selectedTeeId}
                    onChange={(e) => setSelectedTeeId(e.target.value)}
                    className="h-10 flex-1 rounded-xl border border-emerald-900/70 bg-[#042713] px-3 text-sm font-semibold text-emerald-50 outline-none focus:border-[#f5e6b0]/70"
                  >
                    <option value="">Any tee</option>
                    {selected.teeOptions.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
            </div>

            {/* Selected summary */}
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5 space-y-4">
              <div>
                <div className="text-sm font-extrabold text-emerald-50">{selected?.courseName ?? "—"}</div>
                <div className="text-[11px] text-emerald-100/55 font-semibold">
                  {selected?.teeName ? `Tee: ${selected.teeName}` : "—"} · {selected?.rounds ?? 0} rounds
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                  <div className="text-[11px] text-emerald-100/70 font-bold">Best gross</div>
                  <div className="mt-1 text-xl font-extrabold text-emerald-50 tabular-nums">
                    {selected?.bestGross ? `${selected.bestGross.score}` : "—"}
                  </div>
                  <div className="mt-1 text-[10px] text-emerald-100/55 font-semibold">
                    {selected?.bestGross?.date ? fmtDate(selected.bestGross.date) : "—"}
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                  <div className="text-[11px] text-emerald-100/70 font-bold">Best net</div>
                  <div className="mt-1 text-xl font-extrabold text-emerald-50 tabular-nums">
                    {selected?.bestNet ? `${selected.bestNet.score}` : "—"}
                  </div>
                  <div className="mt-1 text-[10px] text-emerald-100/55 font-semibold">
                    {selected?.bestNet?.date ? fmtDate(selected.bestNet.date) : "—"}
                  </div>
                </div>
              </div>
            </div>

            {/* Eclectic */}
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-extrabold text-emerald-50">Eclectic scoring</div>
                  <div className="text-[11px] text-emerald-100/55 font-semibold">
                    Best hole scores combined across your rounds on this course
                  </div>
                </div>
                {ecLoading ? (
                  <div className="text-[11px] font-bold text-emerald-100/70">Loading…</div>
                ) : null}
              </div>

              {ecErr ? (
                <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3 text-sm font-semibold text-red-300">
                  {ecErr}
                </div>
              ) : eclectic ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                      <div className="text-[11px] text-emerald-100/70 font-bold">Eclectic total</div>
                      <div className="mt-1 text-xl font-extrabold text-emerald-50 tabular-nums">
                        {eclectic.total !== null ? `${eclectic.total}` : "—"}
                      </div>
                      <div className="mt-1 text-[10px] text-emerald-100/55 font-semibold">
                        {eclectic.complete ? "Complete" : `Missing ${eclectic.missing.length} hole(s)`}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                      <div className="text-[11px] text-emerald-100/70 font-bold">Coverage</div>
                      <div className="mt-1 text-xl font-extrabold text-emerald-50 tabular-nums">
                        {eclectic.have}/{eclectic.holes}
                      </div>
                      <div className="mt-1 text-[10px] text-emerald-100/55 font-semibold">
                        {eclectic.complete ? "All holes found" : "Play more rounds here to complete"}
                      </div>
                    </div>
                  </div>

                  {!eclectic.complete ? (
                    <div className="text-[11px] text-emerald-100/65 font-semibold">
                      Missing holes:{" "}
                      <span className="text-[#f5e6b0] font-extrabold">
                        {eclectic.missing.slice(0, 18).join(", ")}
                        {eclectic.missing.length > 18 ? "…" : ""}
                      </span>
                    </div>
                  ) : null}

                  <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-3 max-h-[55vh] overflow-y-auto pr-1" style={{ WebkitOverflowScrolling: "touch" }}>
                    <div className="grid grid-cols-3 gap-2">
                      {ecHoleMeta.map((h) => {
                        const b = ecBestByHole[h.hole_no];
                        const has = Boolean(b);
                        return (
                          <div key={h.hole_no} className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                            <div className="flex items-center justify-between">
                              <div className="text-[11px] text-emerald-100/70 font-bold">Hole {h.hole_no}</div>
                              {typeof h.par === "number" ? (
                                <div className="text-[10px] font-extrabold text-emerald-100/70">Par {h.par}</div>
                              ) : null}
                            </div>
                            <div className="mt-2 text-base font-extrabold tabular-nums">
                              {has ? <span className="text-emerald-50">{b!.strokes}</span> : <span className="text-emerald-100/35">—</span>}
                            </div>
                            <div className="mt-1 text-[10px] text-emerald-100/55 font-semibold">{has ? fmtDate(b!.date) : "No data"}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-4 text-sm font-semibold text-emerald-100/70">
                  No hole-by-hole data yet for this course selection.
                </div>
              )}
            </div>

            {/* All course records list */}
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5 space-y-3">
              <div>
                <div className="text-sm font-extrabold text-emerald-50">All records</div>
                <div className="text-[11px] text-emerald-100/55 font-semibold">Best gross + net by course (and tee when available)</div>
              </div>

              <div className="space-y-2">
                {records.length ? (
                  records.map((r) => (
                    <button
                      key={`${r.key.courseId}::${r.key.teeId ?? "ANY"}`}
                      type="button"
                      onClick={() => {
                        setSelectedCourseId(r.key.courseId);
                        setSelectedTeeId(r.key.teeId ?? "");
                      }}
                      className="w-full text-left rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-3 hover:bg-[#042713]/55 transition"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-extrabold text-emerald-50 truncate">{r.courseName}</div>
                          <div className="text-[11px] text-emerald-100/60 font-semibold truncate">
                            {r.teeName} · {r.rounds} rounds
                          </div>
                        </div>

                        <div className="flex items-center gap-3 text-right">
                          <div>
                            <div className="text-[10px] text-emerald-100/55 font-bold">Gross</div>
                            <div className="text-sm font-extrabold text-emerald-50 tabular-nums">{r.bestGross ? r.bestGross.score : "—"}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-emerald-100/55 font-bold">Net</div>
                            <div className="text-sm font-extrabold text-emerald-50 tabular-nums">{r.bestNet ? r.bestNet.score : "—"}</div>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-4 text-sm font-semibold text-emerald-100/70">
                    No results found yet.
                  </div>
                )}
              </div>
            </div>

            <div className="pt-1 text-[10px] text-emerald-100/50 text-center font-semibold">CIAGA · Course records</div>
          </>
        )}
      </div>
    </div>
  );
}
