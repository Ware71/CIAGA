// src/app/stats/course-records/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/BackButton";
import { safeNum, one, chunk } from "@/lib/stats/helpers";

// -----------------------------
// Helpers (page-specific)
// -----------------------------
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

function teeTag(teeName: string | null | undefined): "front9" | "back9" | "full" {
  const t = (teeName ?? "").toLowerCase();
  if (t.includes("(front 9)") || t.includes("front 9")) return "front9";
  if (t.includes("(back 9)") || t.includes("back 9")) return "back9";
  return "full";
}

function canonicalHoleNumber(holeNumber: number, teeName: string | null | undefined): number {
  const tag = teeTag(teeName);
  if (tag === "back9") return holeNumber + 9; // 1..9 -> 10..18
  return holeNumber; // front9 and full
}

// -----------------------------
// Types
// -----------------------------
type RecordRow = {
  round_id: string;
  participant_id: string;
  profile_id: string | null;
  played_at: string | null;

  course_id: string;
  course_name: string;

  tee_box_id: string;
  tee_name: string | null;

  tee_snapshot_id: string;

  par_total: number | null;
  holes_count: number | null;

  is_complete: boolean;

  gross_score: number | null;
  net_score: number | null;
};

type ResultRow = {
  round_id: string;
  participant_id: string;
  profile_id: string | null;
  played_at: string | null;

  course_id: string;
  course_name: string;

  // group by tee BOX (so Front/Back snapshots still combine if same tee box)
  tee_id: string; // tee_box_id
  tee_name: string | null;

  tee_snapshot_id: string;

  gross_score: number | null;
  net_score: number | null;

  par_total: number | null;
  is_complete: boolean;
};

type RecordKey = { courseId: string; teeId: string };

type RecordSummary = {
  key: RecordKey;
  courseName: string;
  teeName: string;

  parTotal: number | null;
  rounds: number;

  bestGross: { score: number; date: string | null } | null;
  bestNet: { score: number; date: string | null } | null;
};

// hole_scoring_source row (minimal)
type HoleScoringRow = {
  profile_id: string | null;
  course_id: string | null;
  tee_box_id: string | null;
  tee_name: string | null;
  hole_number: number | null;
  par: number | null;
  strokes: number | null;
  played_at: string | null;
};

// -----------------------------
// Page
// -----------------------------
export default function CourseRecordsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [results, setResults] = useState<ResultRow[]>([]);
  const [courses, setCourses] = useState<{ courseId: string; courseName: string }[]>([]);

  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [selectedTeeId, setSelectedTeeId] = useState<string>(""); // tee_box_id (required)

  // Sorting for “All records”
  const [sortMetric, setSortMetric] = useState<"gross" | "net">("gross");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Eclectic
  const [ecLoading, setEcLoading] = useState(false);
  const [ecErr, setEcErr] = useState<string | null>(null);
  const [ecHoleNos, setEcHoleNos] = useState<number[]>([]);
  const [ecParByHole, setEcParByHole] = useState<Record<number, number | null>>({});
  const [ecBestByHole, setEcBestByHole] = useState<Record<number, { strokes: number; date: string | null }>>({});

  // -----------------------------
  // Load my results from v_course_record_rounds
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

        const { data, error } = await supabase
          .from("v_course_record_rounds")
          .select(
            `
            round_id,
            participant_id,
            profile_id,
            played_at,
            course_id,
            course_name,
            tee_box_id,
            tee_name,
            tee_snapshot_id,
            par_total,
            holes_count,
            is_complete,
            gross_score,
            net_score
          `
          )
          .eq("profile_id", pid)
          .order("played_at", { ascending: false });

        if (error) throw error;

        const raw = ((data as any) ?? []) as RecordRow[];

        const normalized: ResultRow[] = raw
          .map((r) => {
            const roundId = String(r.round_id ?? "");
            const participantId = String(r.participant_id ?? "");
            const courseId = String(r.course_id ?? "");
            const teeBoxId = String(r.tee_box_id ?? "");
            const teeSnapshotId = String(r.tee_snapshot_id ?? "");

            if (!roundId || !participantId || !courseId || !teeBoxId || !teeSnapshotId) return null;

            return {
              round_id: roundId,
              participant_id: participantId,
              profile_id: (r.profile_id ?? null) as string | null,
              played_at: (r.played_at ?? null) as string | null,

              course_id: courseId,
              course_name: String(r.course_name ?? courseId.slice(0, 8)),

              tee_id: teeBoxId,
              tee_name: (r.tee_name ?? null) as string | null,

              tee_snapshot_id: teeSnapshotId,

              gross_score: safeNum(r.gross_score),
              net_score: safeNum(r.net_score),

              par_total: safeNum(r.par_total),
              is_complete: Boolean(r.is_complete),
            };
          })
          .filter(Boolean) as ResultRow[];

        if (!alive) return;
        setResults(normalized);

        // Courses
        const courseMap = new Map<string, string>();
        for (const r of normalized) courseMap.set(r.course_id, r.course_name ?? r.course_id.slice(0, 8));
        const courseList = Array.from(courseMap.entries())
          .map(([courseId, courseName]) => ({ courseId, courseName }))
          .sort((a, b) => a.courseName.localeCompare(b.courseName));
        setCourses(courseList);

        // Default course + tee
        const defaultCourseId = selectedCourseId || courseList[0]?.courseId || "";
        if (defaultCourseId && !selectedCourseId) setSelectedCourseId(defaultCourseId);

        const firstTeeForCourse = normalized.find((x) => x.course_id === defaultCourseId)?.tee_id ?? "";
        if (!selectedTeeId && firstTeeForCourse) setSelectedTeeId(firstTeeForCourse);
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

  // Tee options (no "Any tee")
  const teeOptionsForCourse = useMemo(() => {
    if (!selectedCourseId) return [];
    const map = new Map<string, string>();
    for (const r of results) {
      if (r.course_id !== selectedCourseId) continue;
      map.set(r.tee_id, r.tee_name ?? r.tee_id.slice(0, 8));
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [results, selectedCourseId]);

  useEffect(() => {
    if (!selectedCourseId) return;
    if (!teeOptionsForCourse.length) return;
    const stillValid = teeOptionsForCourse.some((t) => t.id === selectedTeeId);
    if (!stillValid) setSelectedTeeId(teeOptionsForCourse[0].id);
  }, [selectedCourseId, teeOptionsForCourse, selectedTeeId]);

  // Records per course+tee
  const records: RecordSummary[] = useMemo(() => {
    const byKey = new Map<string, { key: RecordKey; courseName: string; teeName: string; rows: ResultRow[] }>();
    const keyOf = (courseId: string, teeId: string) => `${courseId}::${teeId}`;

    for (const r of results) {
      const courseId = r.course_id;
      const teeId = r.tee_id;
      const k = keyOf(courseId, teeId);
      if (!byKey.has(k)) {
        byKey.set(k, {
          key: { courseId, teeId },
          courseName: r.course_name ?? courseId.slice(0, 8),
          teeName: r.tee_name ?? teeId.slice(0, 8),
          rows: [],
        });
      }
      byKey.get(k)!.rows.push(r);
    }

    const out: RecordSummary[] = [];
    for (const entry of byKey.values()) {
      let bestGross: RecordSummary["bestGross"] = null;
      let bestNet: RecordSummary["bestNet"] = null;

      // par: choose the most common non-null par_total across rows
      const parCounts = new Map<number, number>();
      for (const r of entry.rows) {
        if (typeof r.par_total === "number") parCounts.set(r.par_total, (parCounts.get(r.par_total) ?? 0) + 1);
      }
      let parTotal: number | null = null;
      if (parCounts.size) {
        let best = { par: 0, count: -1 };
        for (const [p, c] of parCounts.entries()) {
          if (c > best.count) best = { par: p, count: c };
        }
        parTotal = best.par;
      }

      for (const r of entry.rows) {
        // Best Gross = complete-only
        const g = safeNum(r.gross_score);
        if (r.is_complete && g != null) {
          if (!bestGross || g < bestGross.score) bestGross = { score: g, date: r.played_at ?? null };
        }

        // Best Net
        const n = safeNum(r.net_score);
        if (n != null) {
          if (!bestNet || n < bestNet.score) bestNet = { score: n, date: r.played_at ?? null };
        }
      }

      out.push({
        key: entry.key,
        courseName: entry.courseName,
        teeName: entry.teeName,
        parTotal,
        rounds: entry.rows.length,
        bestGross,
        bestNet,
      });
    }

    return out;
  }, [results]);

  // Sorting by “score to par”
  const sortedRecords = useMemo(() => {
    const arr = [...records];

    const scoreToPar = (r: RecordSummary) => {
      const par = r.parTotal;
      const score = sortMetric === "gross" ? r.bestGross?.score ?? null : r.bestNet?.score ?? null;

      if (score == null) return null;
      if (par == null) return score;

      return score - par;
    };

    arr.sort((a, b) => {
      const av = scoreToPar(a);
      const bv = scoreToPar(b);

      const aNull = av == null;
      const bNull = bv == null;
      if (aNull && bNull) return a.courseName.localeCompare(b.courseName) || a.teeName.localeCompare(b.teeName);
      if (aNull) return 1;
      if (bNull) return -1;

      const diff = (av as number) - (bv as number);
      if (diff !== 0) return sortDir === "asc" ? diff : -diff;

      const as = sortMetric === "gross" ? a.bestGross?.score ?? 99999 : a.bestNet?.score ?? 99999;
      const bs = sortMetric === "gross" ? b.bestGross?.score ?? 99999 : b.bestNet?.score ?? 99999;
      const d2 = as - bs;
      if (d2 !== 0) return sortDir === "asc" ? d2 : -d2;

      return a.courseName.localeCompare(b.courseName) || a.teeName.localeCompare(b.teeName);
    });

    return arr;
  }, [records, sortMetric, sortDir]);

  // Selected group summary
  const selected = useMemo(() => {
    if (!selectedCourseId || !selectedTeeId) return null;

    const relevant = results.filter((r) => r.course_id === selectedCourseId && r.tee_id === selectedTeeId);
    if (!relevant.length) return null;

    const courseName = relevant[0].course_name ?? selectedCourseId.slice(0, 8);
    const teeName = relevant[0].tee_name ?? selectedTeeId.slice(0, 8);

    let bestGross: { score: number; date: string | null } | null = null;
    let bestNet: { score: number; date: string | null } | null = null;

    for (const r of relevant) {
      const g = safeNum(r.gross_score);
      const n = safeNum(r.net_score);

      if (r.is_complete && g != null) {
        if (!bestGross || g < bestGross.score) bestGross = { score: g, date: r.played_at ?? null };
      }
      if (n != null) {
        if (!bestNet || n < bestNet.score) bestNet = { score: n, date: r.played_at ?? null };
      }
    }

    // par: most common
    const parCounts = new Map<number, number>();
    for (const r of relevant) if (typeof r.par_total === "number") parCounts.set(r.par_total, (parCounts.get(r.par_total) ?? 0) + 1);
    let parTotal: number | null = null;
    if (parCounts.size) {
      let best = { par: 0, count: -1 };
      for (const [p, c] of parCounts.entries()) if (c > best.count) best = { par: p, count: c };
      parTotal = best.par;
    }

    return {
      courseName,
      teeName,
      rounds: relevant.length,
      bestGross,
      bestNet,
      parTotal,
    };
  }, [results, selectedCourseId, selectedTeeId]);

  // -----------------------------
  // Eclectic loader (course+tee) using hole_scoring_source
  // - uses tee_name tags to normalize front/back holes
  // -----------------------------
  useEffect(() => {
    let alive = true;

    (async () => {
      setEcErr(null);
      setEcHoleNos([]);
      setEcParByHole({});
      setEcBestByHole({});

      if (!selectedCourseId || !selectedTeeId) return;

      setEcLoading(true);
      try {
        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;

        const user = (authData.user as any) ?? null;
        if (!user) throw new Error("You must be signed in.");

        const pid = await getMyProfileIdByAuthUserId(user.id);

        // Pull ALL hole rows for this course + tee box for this profile
        // (You can add a limit/window later if needed)
        const all: HoleScoringRow[] = [];
        let from = 0;
        const pageSize = 1000;

        while (true) {
          const { data, error } = await supabase
            .from("hole_scoring_source")
            .select("profile_id, course_id, tee_box_id, tee_name, hole_number, par, strokes, played_at")
            .eq("profile_id", pid)
            .eq("course_id", selectedCourseId)
            .eq("tee_box_id", selectedTeeId)
            .order("played_at", { ascending: false })
            .range(from, from + pageSize - 1);

          if (error) throw error;

          const rows = ((data as any) ?? []) as HoleScoringRow[];
          all.push(...rows);

          if (rows.length < pageSize) break;
          from += pageSize;

          // safety break to avoid runaway in pathological cases
          if (from > 20000) break;
        }

        // Build eclectic best by canonical hole number
        const best: Record<number, { strokes: number; date: string | null }> = {};
        const parByHole: Record<number, number | null> = {};
        const holeSet = new Set<number>();

        for (const row of all) {
          const hn = safeNum(row.hole_number);
          const st = safeNum(row.strokes);
          if (hn == null || st == null) continue;

          const hole = Math.round(hn);
          if (!Number.isFinite(hole) || hole <= 0) continue;

          const canon = canonicalHoleNumber(hole, row.tee_name);

          holeSet.add(canon);

          const p = safeNum(row.par);
          if (parByHole[canon] == null && p != null) parByHole[canon] = p;

          if (!best[canon] || st < best[canon].strokes) {
            best[canon] = { strokes: st, date: row.played_at ?? null };
          }
        }

        const holeNos = Array.from(holeSet).sort((a, b) => a - b);

        if (!alive) return;
        setEcHoleNos(holeNos);
        setEcParByHole(parByHole);
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

  const eclectic = useMemo(() => {
    if (!ecHoleNos.length) return null;
    let total = 0;
    let have = 0;
    const missing: number[] = [];

    for (const hole of ecHoleNos) {
      const b = ecBestByHole[hole];
      if (!b) {
        missing.push(hole);
        continue;
      }
      total += b.strokes;
      have += 1;
    }

    return {
      holes: ecHoleNos.length,
      have,
      missing,
      total: have ? total : null,
      complete: missing.length === 0,
    };
  }, [ecHoleNos, ecBestByHole]);

  // -----------------------------
  // UI
  // -----------------------------
  return (
    <div className="min-h-screen bg-[color:var(--ciaga-ground)] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-6">
        <header className="relative flex items-center justify-center">
          <BackButton
            className="absolute left-0 font-semibold"
            onClick={() => router.back()}
          />

          <div className="text-center">
            <div className="text-lg font-extrabold tracking-wide text-[color:var(--sec-accent)]">Stats</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--sec-muted)] font-semibold">Course records</div>
          </div>
        </header>

        {loading ? (
          <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_55%,transparent)] p-4 text-sm font-semibold text-[color:var(--sec-muted)]">Loading…</div>
        ) : err ? (
          <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_55%,transparent)] p-4 text-sm font-semibold text-[color:var(--sec-bad)]">{err}</div>
        ) : (
          <>
            {/* Selector */}
            <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] p-5 space-y-3">
              <div>
                <div className="text-sm font-extrabold text-[color:var(--sec-text)]">Select course</div>
                <div className="text-[11px] text-[color:var(--sec-muted)] font-semibold">Choose a course + tee</div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-xs text-[color:var(--sec-muted)] w-[70px] font-semibold">Course</div>
                <select
                  value={selectedCourseId}
                  onChange={(e) => setSelectedCourseId(e.target.value)}
                  className="h-10 flex-1 rounded-xl border border-[color:var(--sec-hair)] bg-[color:var(--ciaga-ground)] px-3 text-sm font-semibold text-[color:var(--sec-text)] outline-none focus:border-[color:color-mix(in_srgb,var(--sec-accent)_70%,transparent)]"
                >
                  {courses.map((c) => (
                    <option key={c.courseId} value={c.courseId}>
                      {c.courseName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-xs text-[color:var(--sec-muted)] w-[70px] font-semibold">Tee</div>
                <select
                  value={selectedTeeId}
                  onChange={(e) => setSelectedTeeId(e.target.value)}
                  className="h-10 flex-1 rounded-xl border border-[color:var(--sec-hair)] bg-[color:var(--ciaga-ground)] px-3 text-sm font-semibold text-[color:var(--sec-text)] outline-none focus:border-[color:color-mix(in_srgb,var(--sec-accent)_70%,transparent)]"
                >
                  {teeOptionsForCourse.length ? (
                    teeOptionsForCourse.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))
                  ) : (
                    <option value="">No tees</option>
                  )}
                </select>
              </div>
            </div>

            {/* Selected summary */}
            <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] p-5 space-y-4">
              <div>
                <div className="text-sm font-extrabold text-[color:var(--sec-text)]">{selected?.courseName ?? "—"}</div>
                <div className="text-[11px] text-[color:var(--sec-muted)] font-semibold">
                  Tee: {selected?.teeName ?? "—"} · Par {selected?.parTotal ?? "—"} · {selected?.rounds ?? 0} rounds
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_55%,transparent)] p-3">
                  <div className="text-[11px] text-[color:var(--sec-muted)] font-bold">Best gross (complete only)</div>
                  <div className="mt-1 text-xl font-extrabold text-[color:var(--sec-text)] tabular-nums">{selected?.bestGross ? `${selected.bestGross.score}` : "—"}</div>
                  <div className="mt-1 text-[10px] text-[color:var(--sec-muted)] font-semibold">{selected?.bestGross?.date ? fmtDate(selected.bestGross.date) : "—"}</div>
                </div>

                <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_55%,transparent)] p-3">
                  <div className="text-[11px] text-[color:var(--sec-muted)] font-bold">Best net (AGS−CH)</div>
                  <div className="mt-1 text-xl font-extrabold text-[color:var(--sec-text)] tabular-nums">{selected?.bestNet ? `${selected.bestNet.score}` : "—"}</div>
                  <div className="mt-1 text-[10px] text-[color:var(--sec-muted)] font-semibold">{selected?.bestNet?.date ? fmtDate(selected.bestNet.date) : "—"}</div>
                </div>
              </div>
            </div>

            {/* Eclectic */}
            <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-extrabold text-[color:var(--sec-text)]">Eclectic scoring</div>
                  <div className="text-[11px] text-[color:var(--sec-muted)] font-semibold">
                    Best hole scores combined across your rounds on this course + tee (front/back 9 mapped by tee name tags)
                  </div>
                </div>
                {ecLoading ? <div className="text-[11px] font-bold text-[color:var(--sec-muted)]">Loading…</div> : null}
              </div>

              {ecErr ? (
                <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_55%,transparent)] p-3 text-sm font-semibold text-[color:var(--sec-bad)]">{ecErr}</div>
              ) : eclectic ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_55%,transparent)] p-3">
                      <div className="text-[11px] text-[color:var(--sec-muted)] font-bold">Eclectic total</div>
                      <div className="mt-1 text-xl font-extrabold text-[color:var(--sec-text)] tabular-nums">{eclectic.total !== null ? `${eclectic.total}` : "—"}</div>
                      <div className="mt-1 text-[10px] text-[color:var(--sec-muted)] font-semibold">{eclectic.complete ? "Complete" : `Missing ${eclectic.missing.length} hole(s)`}</div>
                    </div>

                    <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_55%,transparent)] p-3">
                      <div className="text-[11px] text-[color:var(--sec-muted)] font-bold">Coverage</div>
                      <div className="mt-1 text-xl font-extrabold text-[color:var(--sec-text)] tabular-nums">
                        {eclectic.have}/{eclectic.holes}
                      </div>
                      <div className="mt-1 text-[10px] text-[color:var(--sec-muted)] font-semibold">{eclectic.complete ? "All holes found" : "Play more rounds here to complete"}</div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_45%,transparent)] p-3 max-h-[55vh] overflow-y-auto overscroll-y-contain pr-1" style={{ WebkitOverflowScrolling: "touch" }}>
                    <div className="grid grid-cols-3 gap-2">
                      {ecHoleNos.map((hole) => {
                        const b = ecBestByHole[hole];
                        const has = Boolean(b);
                        const par = ecParByHole[hole];
                        return (
                          <div key={hole} className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_55%,transparent)] p-3">
                            <div className="flex items-center justify-between">
                              <div className="text-[11px] text-[color:var(--sec-muted)] font-bold">Hole {hole}</div>
                              {typeof par === "number" ? <div className="text-[10px] font-extrabold text-[color:var(--sec-muted)]">Par {par}</div> : null}
                            </div>
                            <div className="mt-2 text-base font-extrabold tabular-nums">
                              {has ? <span className="text-[color:var(--sec-text)]">{b!.strokes}</span> : <span className="text-[color:var(--sec-muted)]">—</span>}
                            </div>
                            <div className="mt-1 text-[10px] text-[color:var(--sec-muted)] font-semibold">{has ? fmtDate(b!.date) : "No data"}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_55%,transparent)] p-4 text-sm font-semibold text-[color:var(--sec-muted)]">No hole-by-hole data yet for this selection.</div>
              )}
            </div>

            {/* All records */}
            <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-extrabold text-[color:var(--sec-text)]">All records</div>
                  <div className="text-[11px] text-[color:var(--sec-muted)] font-semibold">Sorted by score-to-par (lower is better)</div>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSortMetric("gross")}
                      className={`px-3 py-1 rounded-xl border text-[11px] font-extrabold ${
                        sortMetric === "gross" ? "bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)] border-[color:var(--sec-accent)]" : "bg-[color:color-mix(in_srgb,var(--ciaga-ground)_40%,transparent)] text-[color:var(--sec-muted)] border-[color:var(--sec-hair)]"
                      }`}
                    >
                      Gross
                    </button>
                    <button
                      type="button"
                      onClick={() => setSortMetric("net")}
                      className={`px-3 py-1 rounded-xl border text-[11px] font-extrabold ${
                        sortMetric === "net" ? "bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)] border-[color:var(--sec-accent)]" : "bg-[color:color-mix(in_srgb,var(--ciaga-ground)_40%,transparent)] text-[color:var(--sec-muted)] border-[color:var(--sec-hair)]"
                      }`}
                    >
                      Net
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSortDir("asc")}
                      className={`px-3 py-1 rounded-xl border text-[11px] font-extrabold ${
                        sortDir === "asc" ? "bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)] border-[color:var(--sec-accent)]" : "bg-[color:color-mix(in_srgb,var(--ciaga-ground)_40%,transparent)] text-[color:var(--sec-muted)] border-[color:var(--sec-hair)]"
                      }`}
                    >
                      Best → Worst
                    </button>
                    <button
                      type="button"
                      onClick={() => setSortDir("desc")}
                      className={`px-3 py-1 rounded-xl border text-[11px] font-extrabold ${
                        sortDir === "desc" ? "bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)] border-[color:var(--sec-accent)]" : "bg-[color:color-mix(in_srgb,var(--ciaga-ground)_40%,transparent)] text-[color:var(--sec-muted)] border-[color:var(--sec-hair)]"
                      }`}
                    >
                      Worst → Best
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {sortedRecords.length ? (
                  sortedRecords.map((r) => (
                    <button
                      key={`${r.key.courseId}::${r.key.teeId}`}
                      type="button"
                      onClick={() => {
                        setSelectedCourseId(r.key.courseId);
                        setSelectedTeeId(r.key.teeId);
                      }}
                      className="w-full text-left rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_45%,transparent)] p-3 hover:bg-[color:color-mix(in_srgb,var(--ciaga-ground)_55%,transparent)] transition"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-extrabold text-[color:var(--sec-text)] truncate">{r.courseName}</div>
                          <div className="text-[11px] text-[color:var(--sec-muted)] font-semibold truncate">
                            {r.teeName} · Par {r.parTotal ?? "—"} · {r.rounds} rounds
                          </div>
                        </div>

                        <div className="flex items-center gap-3 text-right">
                          <div>
                            <div className="text-[10px] text-[color:var(--sec-muted)] font-bold">Gross</div>
                            <div className="text-sm font-extrabold text-[color:var(--sec-text)] tabular-nums">{r.bestGross ? r.bestGross.score : "—"}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-[color:var(--sec-muted)] font-bold">Net</div>
                            <div className="text-sm font-extrabold text-[color:var(--sec-text)] tabular-nums">{r.bestNet ? r.bestNet.score : "—"}</div>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_55%,transparent)] p-4 text-sm font-semibold text-[color:var(--sec-muted)]">No results found yet.</div>
                )}
              </div>
            </div>

            <div className="pt-1 text-[10px] text-[color:var(--sec-muted)] text-center font-semibold">CIAGA · Course records</div>
          </>
        )}
      </div>
    </div>
  );
}
