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
function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}
function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// -----------------------------
// Types (schema-tolerant)
// -----------------------------
type CourseRow = { id: string; name: string | null };

type HRRRow = {
  round_id?: string | null;
  participant_id?: string | null;
  profile_id?: string | null;
  played_at?: string | null;

  adjusted_gross_score?: number | null;
  course_handicap_used?: number | null;

  tee_snapshot_id?: string | null;

  rounds?:
    | { course_id?: string | null; courses?: CourseRow | CourseRow[] | null }
    | { course_id?: string | null; courses?: CourseRow | CourseRow[] | null }[]
    | null;

  round_tee_snapshots?:
    | { id: string; name: string; source_tee_box_id: string | null; holes_count: number | null }
    | { id: string; name: string; source_tee_box_id: string | null; holes_count: number | null }[]
    | null;
};

type HoleScoreRow = {
  participant_id?: string | null;
  hole_number?: number | null;
  strokes?: number | null;
};

type HoleSnapRow = {
  round_tee_snapshot_id?: string | null;
  hole_number?: number | null;
  par?: number | null;
};

type ResultRow = {
  round_id: string;
  participant_id: string;
  profile_id: string | null;
  played_at: string | null;

  course_id: string;
  course_name: string;

  // group by tee BOX (so Front/Back snapshots still combine if same tee box id)
  tee_id: string; // tee_box_id
  tee_name: string | null;

  // per-round tee snapshot (for expected holes + par)
  tee_snapshot_id: string;

  // computed from strokes if complete, else null
  gross_score: number | null;

  // net from HRR (AGS - course handicap used)
  net_score: number | null;

  // par total for this round’s expected holes (from round_hole_snapshots)
  par_total: number | null;

  // “complete” = every expected hole has numeric strokes
  is_complete: boolean;
};

type RecordKey = {
  courseId: string;
  teeId: string;
};

type RecordSummary = {
  key: RecordKey;
  courseName: string;
  teeName: string;

  parTotal: number | null;
  rounds: number;

  bestGross: { score: number; date: string | null } | null; // complete-only
  bestNet: { score: number; date: string | null } | null;   // from HRR net (can be incomplete)
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
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc"); // asc = best->worst (lower to-par is better)

  // Eclectic
  const [ecLoading, setEcLoading] = useState(false);
  const [ecErr, setEcErr] = useState<string | null>(null);
  const [ecHoleNos, setEcHoleNos] = useState<number[]>([]);
  const [ecParByHole, setEcParByHole] = useState<Record<number, number | null>>({});
  const [ecBestByHole, setEcBestByHole] = useState<Record<number, { strokes: number; date: string | null }>>({});

  // -----------------------------
  // Load my results
  // - pulls HRR + joins to rounds + tee snapshots
  // - computes expected holes + par from round_hole_snapshots
  // - computes completeness + gross from round_current_scores
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
          .from("handicap_round_results")
          .select(
            `
            round_id,
            participant_id,
            profile_id,
            played_at,
            tee_snapshot_id,
            adjusted_gross_score,
            course_handicap_used,
            rounds!handicap_round_results_round_id_fkey (
              course_id,
              courses ( id, name )
            ),
            round_tee_snapshots!handicap_round_results_tee_snapshot_id_fkey (
              id,
              name,
              source_tee_box_id,
              holes_count
            )
          `
          )
          .eq("profile_id", pid)
          .order("played_at", { ascending: false });

        if (error) throw error;

        const raw = ((data as any) ?? []) as HRRRow[];

        // Build base rows (still missing computed completeness/gross/par)
        const base = raw
          .map((r) => {
            const rid = String(r.round_id ?? "");
            const partid = String(r.participant_id ?? "");
            if (!rid || !partid) return null;

            const rounds = one(r.rounds);
            const courseId = String(rounds?.course_id ?? "");
            if (!courseId) return null;

            const course = one(rounds?.courses);
            const courseName = String(course?.name ?? courseId.slice(0, 8));

            const teeSnap = one(r.round_tee_snapshots);
            const teeSnapshotId = String(r.tee_snapshot_id ?? teeSnap?.id ?? "");
            if (!teeSnapshotId) return null;

            const teeBoxId = String(teeSnap?.source_tee_box_id ?? "");
            if (!teeBoxId) return null;

            const teeName = (teeSnap?.name ?? null) as string | null;

            const ags = safeNum(r.adjusted_gross_score);
            const ch = safeNum(r.course_handicap_used);
            const net = ags != null && ch != null ? ags - ch : null;

            return {
              round_id: rid,
              participant_id: partid,
              profile_id: (r.profile_id ?? null) as string | null,
              played_at: (r.played_at ?? null) as string | null,
              course_id: courseId,
              course_name: courseName,
              tee_id: teeBoxId,
              tee_name: teeName,
              tee_snapshot_id: teeSnapshotId,
              net_score: net,
            };
          })
          .filter(Boolean) as Array<
          Omit<ResultRow, "gross_score" | "par_total" | "is_complete">
        >;

        const participantIds = Array.from(new Set(base.map((r) => r.participant_id)));
        const teeSnapshotIds = Array.from(new Set(base.map((r) => r.tee_snapshot_id)));

        // Expected holes + par per tee_snapshot_id
        const expectedHolesBySnap: Record<string, number[]> = {};
        const parBySnapHole: Record<string, Record<number, number | null>> = {};
        const parTotalBySnap: Record<string, number | null> = {};

        if (teeSnapshotIds.length) {
          const snapRows: HoleSnapRow[] = [];
          for (const batch of chunk(teeSnapshotIds, 150)) {
            const { data: hsData, error: hsErr } = await supabase
              .from("round_hole_snapshots")
              .select("round_tee_snapshot_id, hole_number, par")
              .in("round_tee_snapshot_id", batch);

            if (hsErr) throw hsErr;
            snapRows.push(...(((hsData as any) ?? []) as HoleSnapRow[]));
          }

          for (const row of snapRows) {
            const sid = String(row.round_tee_snapshot_id ?? "");
            const hn = safeNum(row.hole_number);
            if (!sid || hn == null) continue;

            const hole = Math.round(hn);
            if (!Number.isFinite(hole) || hole <= 0) continue;

            if (!expectedHolesBySnap[sid]) expectedHolesBySnap[sid] = [];
            expectedHolesBySnap[sid].push(hole);

            if (!parBySnapHole[sid]) parBySnapHole[sid] = {};
            parBySnapHole[sid][hole] = safeNum(row.par);
          }

          for (const sid of Object.keys(expectedHolesBySnap)) {
            const holes = Array.from(new Set(expectedHolesBySnap[sid])).sort((a, b) => a - b);
            expectedHolesBySnap[sid] = holes;

            // par total = sum of pars for expected holes IF all pars exist, else null
            const pmap = parBySnapHole[sid] ?? {};
            let ok = true;
            let sum = 0;
            for (const h of holes) {
              const p = pmap[h];
              if (p == null) {
                ok = false;
                break;
              }
              sum += p;
            }
            parTotalBySnap[sid] = ok ? sum : null;
          }
        }

        // Pull hole scores for all participants (numeric strokes only)
        const scoredHolesByParticipant: Record<string, Set<number>> = {};
        const strokesByParticipantHole: Record<string, Record<number, number>> = {};

        if (participantIds.length) {
          for (const batch of chunk(participantIds, 150)) {
            const { data: sData, error: sErr } = await supabase
              .from("round_current_scores")
              .select("participant_id, hole_number, strokes")
              .in("participant_id", batch);

            if (sErr) throw sErr;

            for (const row of ((sData ?? []) as any[]) as HoleScoreRow[]) {
              const pid2 = String(row.participant_id ?? "");
              const hn = safeNum(row.hole_number);
              const st = safeNum(row.strokes);
              if (!pid2 || hn == null || st == null) continue;

              const hole = Math.round(hn);
              if (!Number.isFinite(hole) || hole <= 0) continue;

              if (!scoredHolesByParticipant[pid2]) scoredHolesByParticipant[pid2] = new Set<number>();
              scoredHolesByParticipant[pid2].add(hole);

              if (!strokesByParticipantHole[pid2]) strokesByParticipantHole[pid2] = {};
              strokesByParticipantHole[pid2][hole] = st;
            }
          }
        }

        // Final normalize: compute is_complete + gross_score (sum strokes) + par_total
        const normalized: ResultRow[] = base.map((r) => {
          const expected = expectedHolesBySnap[r.tee_snapshot_id] ?? null;
          const scored = scoredHolesByParticipant[r.participant_id] ?? new Set<number>();
          const strokesMap = strokesByParticipantHole[r.participant_id] ?? {};

          // If expected holes missing, treat as not complete
          const isComplete = expected ? expected.every((h) => scored.has(h)) : false;

          // Gross = sum strokes for expected holes (only if complete)
          let gross: number | null = null;
          if (isComplete && expected) {
            let sum = 0;
            for (const h of expected) sum += safeNum(strokesMap[h]) ?? 0;
            // Guard: if somehow sum is 0, treat as null (prevents “0” best gross spam)
            gross = sum > 0 ? sum : null;
          }

          const parTotal = parTotalBySnap[r.tee_snapshot_id] ?? null;

          return {
            ...r,
            gross_score: gross,
            par_total: parTotal,
            is_complete: isComplete,
          };
        });

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
        // Best Gross = computed gross sum, complete-only (already null if incomplete)
        const g = safeNum(r.gross_score);
        if (r.is_complete && g != null) {
          if (!bestGross || g < bestGross.score) bestGross = { score: g, date: r.played_at ?? null };
        }

        // Best Net = AGS-CH (may exist even if incomplete)
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

      // nulls go bottom always
      if (score == null) return null;

      // if par missing, fall back to the score itself (still sortable)
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

      // tie-break by raw score
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

    const teeSnapshotIds = Array.from(new Set(relevant.map((r) => r.tee_snapshot_id).filter(Boolean)));

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
      teeSnapshotIds,
      bestGross,
      bestNet,
      parTotal,
    };
  }, [results, selectedCourseId, selectedTeeId]);

  // -----------------------------
  // Eclectic loader (course+tee)
  // Uses union of hole_numbers from round_hole_snapshots over snapshots in this group
  // -----------------------------
  useEffect(() => {
    let alive = true;

    (async () => {
      setEcErr(null);
      setEcHoleNos([]);
      setEcParByHole({});
      setEcBestByHole({});

      if (!selected?.teeSnapshotIds?.length) return;

      setEcLoading(true);
      try {
        const relevant = results.filter((r) => r.course_id === selectedCourseId && r.tee_id === selectedTeeId);
        const participantIds = Array.from(new Set(relevant.map((r) => r.participant_id).filter(Boolean)));
        if (!participantIds.length) {
          if (!alive) return;
          setEcLoading(false);
          return;
        }

        const playedAtByParticipant: Record<string, string | null> = {};
        for (const r of relevant) playedAtByParticipant[r.participant_id] = r.played_at ?? null;

        // hole meta
        const holeSet = new Set<number>();
        const parByHole: Record<number, number | null> = {};

        for (const batch of chunk(selected.teeSnapshotIds, 150)) {
          const { data: hsData, error: hsErr } = await supabase
            .from("round_hole_snapshots")
            .select("round_tee_snapshot_id, hole_number, par")
            .in("round_tee_snapshot_id", batch);

          if (hsErr) throw hsErr;

          for (const row of ((hsData ?? []) as any[]) as HoleSnapRow[]) {
            const hn = safeNum(row.hole_number);
            if (hn == null) continue;
            const hole = Math.round(hn);
            if (!Number.isFinite(hole) || hole <= 0) continue;
            holeSet.add(hole);

            const p = safeNum(row.par);
            if (parByHole[hole] == null && p != null) parByHole[hole] = p;
          }
        }

        const holeNos = Array.from(holeSet).sort((a, b) => a - b);

        // scores
        const allRows: HoleScoreRow[] = [];
        for (const batch of chunk(participantIds, 150)) {
          const { data: sData, error: sErr } = await supabase
            .from("round_current_scores")
            .select("participant_id, hole_number, strokes")
            .in("participant_id", batch);

          if (sErr) throw sErr;
          allRows.push(...(((sData as any) ?? []) as HoleScoreRow[]));
        }

        const best: Record<number, { strokes: number; date: string | null }> = {};
        for (const r of allRows) {
          const pid = String(r.participant_id ?? "");
          const h = safeNum(r.hole_number);
          const s = safeNum(r.strokes);
          if (!pid || h == null || s == null) continue;

          const hole = Math.round(h);
          if (!Number.isFinite(hole) || hole <= 0) continue;

          if (!best[hole] || s < best[hole].strokes) {
            best[hole] = { strokes: s, date: playedAtByParticipant[pid] ?? null };
          }
        }

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
  }, [selectedCourseId, selectedTeeId, results, selected?.teeSnapshotIds]);

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
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-6">
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
          <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-4 text-sm font-semibold text-emerald-100/70">Loading…</div>
        ) : err ? (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-4 text-sm font-semibold text-red-300">{err}</div>
        ) : (
          <>
            {/* Selector */}
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5 space-y-3">
              <div>
                <div className="text-sm font-extrabold text-emerald-50">Select course</div>
                <div className="text-[11px] text-emerald-100/55 font-semibold">Choose a course + tee</div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-xs text-emerald-100/70 w-[70px] font-semibold">Course</div>
                <select
                  value={selectedCourseId}
                  onChange={(e) => setSelectedCourseId(e.target.value)}
                  className="h-10 flex-1 rounded-xl border border-emerald-900/70 bg-[#042713] px-3 text-sm font-semibold text-emerald-50 outline-none focus:border-[#f5e6b0]/70"
                >
                  {courses.map((c) => (
                    <option key={c.courseId} value={c.courseId}>
                      {c.courseName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-xs text-emerald-100/70 w-[70px] font-semibold">Tee</div>
                <select
                  value={selectedTeeId}
                  onChange={(e) => setSelectedTeeId(e.target.value)}
                  className="h-10 flex-1 rounded-xl border border-emerald-900/70 bg-[#042713] px-3 text-sm font-semibold text-emerald-50 outline-none focus:border-[#f5e6b0]/70"
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
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5 space-y-4">
              <div>
                <div className="text-sm font-extrabold text-emerald-50">{selected?.courseName ?? "—"}</div>
                <div className="text-[11px] text-emerald-100/55 font-semibold">
                  Tee: {selected?.teeName ?? "—"} · Par {selected?.parTotal ?? "—"} · {selected?.rounds ?? 0} rounds
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                  <div className="text-[11px] text-emerald-100/70 font-bold">Best gross (complete only)</div>
                  <div className="mt-1 text-xl font-extrabold text-emerald-50 tabular-nums">{selected?.bestGross ? `${selected.bestGross.score}` : "—"}</div>
                  <div className="mt-1 text-[10px] text-emerald-100/55 font-semibold">{selected?.bestGross?.date ? fmtDate(selected.bestGross.date) : "—"}</div>
                </div>

                <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                  <div className="text-[11px] text-emerald-100/70 font-bold">Best net (AGS−CH)</div>
                  <div className="mt-1 text-xl font-extrabold text-emerald-50 tabular-nums">{selected?.bestNet ? `${selected.bestNet.score}` : "—"}</div>
                  <div className="mt-1 text-[10px] text-emerald-100/55 font-semibold">{selected?.bestNet?.date ? fmtDate(selected.bestNet.date) : "—"}</div>
                </div>
              </div>
            </div>

            {/* Eclectic */}
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-extrabold text-emerald-50">Eclectic scoring</div>
                  <div className="text-[11px] text-emerald-100/55 font-semibold">Best hole scores combined across your rounds on this course + tee</div>
                </div>
                {ecLoading ? <div className="text-[11px] font-bold text-emerald-100/70">Loading…</div> : null}
              </div>

              {ecErr ? (
                <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3 text-sm font-semibold text-red-300">{ecErr}</div>
              ) : eclectic ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                      <div className="text-[11px] text-emerald-100/70 font-bold">Eclectic total</div>
                      <div className="mt-1 text-xl font-extrabold text-emerald-50 tabular-nums">{eclectic.total !== null ? `${eclectic.total}` : "—"}</div>
                      <div className="mt-1 text-[10px] text-emerald-100/55 font-semibold">{eclectic.complete ? "Complete" : `Missing ${eclectic.missing.length} hole(s)`}</div>
                    </div>

                    <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                      <div className="text-[11px] text-emerald-100/70 font-bold">Coverage</div>
                      <div className="mt-1 text-xl font-extrabold text-emerald-50 tabular-nums">
                        {eclectic.have}/{eclectic.holes}
                      </div>
                      <div className="mt-1 text-[10px] text-emerald-100/55 font-semibold">{eclectic.complete ? "All holes found" : "Play more rounds here to complete"}</div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-3 max-h-[55vh] overflow-y-auto pr-1" style={{ WebkitOverflowScrolling: "touch" }}>
                    <div className="grid grid-cols-3 gap-2">
                      {ecHoleNos.map((hole) => {
                        const b = ecBestByHole[hole];
                        const has = Boolean(b);
                        const par = ecParByHole[hole];
                        return (
                          <div key={hole} className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                            <div className="flex items-center justify-between">
                              <div className="text-[11px] text-emerald-100/70 font-bold">Hole {hole}</div>
                              {typeof par === "number" ? <div className="text-[10px] font-extrabold text-emerald-100/70">Par {par}</div> : null}
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
                <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-4 text-sm font-semibold text-emerald-100/70">No hole-by-hole data yet for this selection.</div>
              )}
            </div>

            {/* All records */}
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-extrabold text-emerald-50">All records</div>
                  <div className="text-[11px] text-emerald-100/55 font-semibold">Sorted by score-to-par (lower is better)</div>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSortMetric("gross")}
                      className={`px-3 py-1 rounded-xl border text-[11px] font-extrabold ${
                        sortMetric === "gross" ? "bg-[#f5e6b0] text-[#042713] border-[#f5e6b0]" : "bg-[#042713]/40 text-emerald-100/80 border-emerald-900/70"
                      }`}
                    >
                      Gross
                    </button>
                    <button
                      type="button"
                      onClick={() => setSortMetric("net")}
                      className={`px-3 py-1 rounded-xl border text-[11px] font-extrabold ${
                        sortMetric === "net" ? "bg-[#f5e6b0] text-[#042713] border-[#f5e6b0]" : "bg-[#042713]/40 text-emerald-100/80 border-emerald-900/70"
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
                        sortDir === "asc" ? "bg-[#f5e6b0] text-[#042713] border-[#f5e6b0]" : "bg-[#042713]/40 text-emerald-100/80 border-emerald-900/70"
                      }`}
                    >
                      Best → Worst
                    </button>
                    <button
                      type="button"
                      onClick={() => setSortDir("desc")}
                      className={`px-3 py-1 rounded-xl border text-[11px] font-extrabold ${
                        sortDir === "desc" ? "bg-[#f5e6b0] text-[#042713] border-[#f5e6b0]" : "bg-[#042713]/40 text-emerald-100/80 border-emerald-900/70"
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
                      className="w-full text-left rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-3 hover:bg-[#042713]/55 transition"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-extrabold text-emerald-50 truncate">{r.courseName}</div>
                          <div className="text-[11px] text-emerald-100/60 font-semibold truncate">
                            {r.teeName} · Par {r.parTotal ?? "—"} · {r.rounds} rounds
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
                  <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-4 text-sm font-semibold text-emerald-100/70">No results found yet.</div>
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
