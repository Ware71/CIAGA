// /app/history/HistoryClient.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/BackButton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatHI, strokesReceivedOnHole } from "@/lib/rounds/handicapUtils";

type ProfileRow = {
  id: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

type HandicapHistoryRow = { as_of_date: string; handicap_index: number };

type RoundRow = {
  id: string;
  name: string | null;
  status: "draft" | "scheduled" | "starting" | "live" | "finished" | string;
  started_at: string | null;
  created_at: string | null;
  course_id: string | null;
  courses?: { name: string | null }[] | { name: string | null } | null;
};

type TeeSnap = { id: string; name: string | null };

type ParticipantRow = {
  id: string;
  round_id: string;
  tee_snapshot_id: string | null;
  rounds?: RoundRow[] | RoundRow | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function isFinishedStatus(s: string | null | undefined) {
  const v = (s ?? "").toLowerCase();
  return v === "finished" || v === "completed" || v === "ended";
}

function parseDateMs(iso: string | null) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function shortDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function monthKey(iso: string | null) {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long" });
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toNumberMaybe(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// WHS "used differentials" count table
function usedDifferentialsCount(n: number) {
  if (n <= 0) return 0;
  if (n <= 2) return 0;
  if (n <= 5) return 1;
  if (n <= 8) return 2;
  if (n <= 11) return 3;
  if (n <= 14) return 4;
  if (n <= 16) return 5;
  if (n <= 18) return 6;
  if (n === 19) return 7;
  return 8;
}

const PAGE_SIZE = 25;

export default function RoundsHistoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const profileFromQuery = (searchParams.get("profile") || "").trim() || null;

  const [loading, setLoading] = useState(true);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileRow, setProfileRow] = useState<ProfileRow | null>(null);

  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [participantIdByRoundId, setParticipantIdByRoundId] = useState<Record<string, string>>({});
  const [teeNameByRoundId, setTeeNameByRoundId] = useState<Record<string, string>>({});
  const [myTotalByRoundId, setMyTotalByRoundId] = useState<Record<string, number>>({});

  const [agsByRoundId, setAgsByRoundId] = useState<Record<string, number>>({});
  const [netByRoundId, setNetByRoundId] = useState<Record<string, number>>({});
  const [scoreDiffByRoundId, setScoreDiffByRoundId] = useState<Record<string, number>>({});
  const [hiUsedByRoundId, setHiUsedByRoundId] = useState<Record<string, number>>({});
  const [hiAfterByRoundId, setHiAfterByRoundId] = useState<Record<string, number>>({});

  const [error, setError] = useState<string | null>(null);

  const [loadedCount, setLoadedCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const allRoundsRef = useRef<RoundRow[]>([]);
  const pidMapRef = useRef<Record<string, string>>({});
  const teeSnapIdByRoundRef = useRef<Record<string, string>>({});
  const agsMapRef = useRef<Record<string, number>>({});
  const courseHcpByPidRef = useRef<Record<string, number>>({});
  const loadedCountRef = useRef(0);

  const fetchProfilePublic = async (id: string) => {
    const { data, error: e } = await supabase.rpc("get_profiles_public", { ids: [id] });
    if (e) throw e;
    const rows = ((data as any) ?? []) as ProfileRow[];
    return rows[0] ?? null;
  };

  // Fetches tee names, score totals, and WHS penalties for a slice of rounds.
  // Reads lookup maps from refs (populated upfront) and merges results into state.
  const loadSupplemental = useCallback(async (slice: RoundRow[]) => {
    if (!slice.length) return;

    const pidMap = pidMapRef.current;
    const teeSnapIdByRound = teeSnapIdByRoundRef.current;
    const courseHcpByPid = courseHcpByPidRef.current;
    const agsMap = agsMapRef.current;

    // 1) Tee names for this slice only
    const sliceTeeSnapIds = Array.from(
      new Set(slice.map((r) => teeSnapIdByRound[r.id]).filter(Boolean) as string[])
    );
    const teeNameMap: Record<string, string> = {};

    if (sliceTeeSnapIds.length) {
      const teeSnaps: TeeSnap[] = [];
      for (const ids of chunk(sliceTeeSnapIds, 150)) {
        const { data: tees } = await supabase.from("round_tee_snapshots").select("id,name").in("id", ids);
        teeSnaps.push(...((tees ?? []) as TeeSnap[]));
      }
      const byId: Record<string, string> = {};
      for (const t of teeSnaps) byId[t.id] = t.name?.trim() || "—";
      for (const r of slice) {
        const tid = teeSnapIdByRound[r.id];
        if (tid) teeNameMap[r.id] = byId[tid] ?? "—";
      }
    }

    // 2) Score totals for this slice's participant pairs
    const slicePairs = slice
      .filter((r) => pidMap[r.id])
      .map((r) => ({ roundId: r.id, participantId: pidMap[r.id] }));

    const totalsByParticipant: Record<string, number> = {};
    const countsByParticipant: Record<string, number> = {};
    const sliceParticipantIds = slicePairs.map((p) => p.participantId);

    if (slicePairs.length) {
      for (const batch of chunk(slicePairs, 25)) {
        const orExpr = batch
          .map((p) => `and(round_id.eq.${p.roundId},participant_id.eq.${p.participantId})`)
          .join(",");
        const { data: scores } = await supabase
          .from("round_current_scores")
          .select("round_id, participant_id, strokes")
          .or(orExpr);
        for (const row of (scores ?? []) as any[]) {
          const p = row.participant_id as string;
          const n = toNumberMaybe(row.strokes);
          if (n == null) continue;
          totalsByParticipant[p] = (totalsByParticipant[p] ?? 0) + n;
          countsByParticipant[p] = (countsByParticipant[p] ?? 0) + 1;
        }
      }
    }

    // 3) WHS penalties (PU/NS holes) for this slice
    if (sliceParticipantIds.length) {
      const teeSnapByPid: Record<string, string> = {};
      for (const r of slice) {
        const tsid = teeSnapIdByRound[r.id];
        const pid2 = pidMap[r.id];
        if (tsid && pid2) teeSnapByPid[pid2] = tsid;
      }

      const holeDataByTeeSnap: Record<string, Record<number, { par: number; si: number | null }>> = {};
      for (const ids of chunk(sliceTeeSnapIds, 50)) {
        const { data: hs } = await supabase
          .from("round_hole_snapshots")
          .select("round_tee_snapshot_id, hole_number, par, stroke_index")
          .in("round_tee_snapshot_id", ids);
        for (const row of (hs ?? []) as any[]) {
          const tid = row.round_tee_snapshot_id as string;
          if (!holeDataByTeeSnap[tid]) holeDataByTeeSnap[tid] = {};
          holeDataByTeeSnap[tid][row.hole_number as number] = {
            par: row.par as number,
            si: row.stroke_index ?? null,
          };
        }
      }

      const acceptablePids = new Set<string>(
        slice.filter((r) => agsMap[r.id] != null && pidMap[r.id]).map((r) => pidMap[r.id])
      );

      for (const ids of chunk(sliceParticipantIds, 150)) {
        const { data: hs } = await supabase
          .from("round_hole_states")
          .select("participant_id, hole_number, status")
          .in("participant_id", ids)
          .in("status", ["picked_up", "not_started"]);

        for (const row of (hs ?? []) as any[]) {
          const participantId = row.participant_id as string;
          const holeNumber = row.hole_number as number;
          const status = row.status as string;

          if (status === "not_started" && !acceptablePids.has(participantId)) continue;

          const teeSnapId = teeSnapByPid[participantId];
          if (!teeSnapId) continue;

          const holeData = holeDataByTeeSnap[teeSnapId]?.[holeNumber];
          if (!holeData?.par) continue;

          const courseHcp = courseHcpByPid[participantId] ?? 0;
          const holeCount = Object.keys(holeDataByTeeSnap[teeSnapId]).length || 18;
          const penalty =
            holeData.par + 2 + strokesReceivedOnHole(courseHcp, holeData.si, holeCount);

          totalsByParticipant[participantId] = (totalsByParticipant[participantId] ?? 0) + penalty;
          countsByParticipant[participantId] = (countsByParticipant[participantId] ?? 0) + 1;
        }
      }
    }

    const totalByRound: Record<string, number> = {};
    for (const r of slice) {
      const participantId = pidMap[r.id];
      if (!participantId) continue;
      const count = countsByParticipant[participantId] ?? 0;
      if (count > 0) totalByRound[r.id] = totalsByParticipant[participantId] ?? 0;
    }

    const netMap: Record<string, number> = {};
    for (const r of slice) {
      const participantId = pidMap[r.id];
      if (!participantId) continue;
      const gross = totalByRound[r.id] ?? agsMap[r.id];
      const ch = courseHcpByPid[participantId];
      if (gross != null && ch != null) netMap[r.id] = gross - ch;
    }

    setTeeNameByRoundId((prev) => ({ ...prev, ...teeNameMap }));
    setMyTotalByRoundId((prev) => ({ ...prev, ...totalByRound }));
    setNetByRoundId((prev) => ({ ...prev, ...netMap }));
  }, []); // stable: reads from refs, writes to stable state setters

  const loadMore = useCallback(async () => {
    const allRounds = allRoundsRef.current;
    const currentLoaded = loadedCountRef.current;
    const nextSlice = allRounds.slice(currentLoaded, currentLoaded + PAGE_SIZE);
    if (!nextSlice.length) return;

    setLoadingMore(true);
    try {
      await loadSupplemental(nextSlice);
      const newCount = Math.min(currentLoaded + PAGE_SIZE, allRounds.length);
      loadedCountRef.current = newCount;
      setLoadedCount(newCount);
    } finally {
      setLoadingMore(false);
    }
  }, [loadSupplemental]);

  useEffect(() => {
    let cancelled = false;

    async function resolveProfileId(): Promise<string | null> {
      if (profileFromQuery) return profileFromQuery;
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !authData?.user) return null;
      const pid = await getMyProfileIdByAuthUserId(authData.user.id);
      return pid ?? null;
    }

    async function load() {
      setLoading(true);
      setError(null);
      setLoadedCount(0);
      loadedCountRef.current = 0;

      try {
        const pid = await resolveProfileId();

        if (!pid) {
          if (!profileFromQuery) {
            setError("You must be signed in to view your round history.");
          } else {
            setError("Could not load this player's history.");
          }
          setLoading(false);
          return;
        }

        if (!cancelled) setProfileId(pid);

        try {
          const p = await fetchProfilePublic(pid);
          if (!cancelled) setProfileRow(p);
        } catch (e) {
          if (!cancelled) setProfileRow(null);
        }

        // 1) All participant rows + round info
        const { data, error: qErr } = await supabase
          .from("round_participants")
          .select(
            `
              id,
              round_id,
              tee_snapshot_id,
              rounds:rounds!round_id (
                id,
                name,
                status,
                started_at,
                created_at,
                course_id,
                courses:courses ( name )
              )
            `
          )
          .eq("profile_id", pid);

        if (qErr) throw qErr;

        const rows = (data ?? []) as ParticipantRow[];

        const extractedAll: RoundRow[] = rows.map((r) => one(r.rounds)).filter(Boolean) as RoundRow[];
        const extracted = extractedAll.filter((r) => isFinishedStatus(r.status));

        const pidMap: Record<string, string> = {};
        const teeSnapIdByRound: Record<string, string> = {};

        for (const pr of rows) {
          const round = one(pr.rounds);
          if (!round) continue;
          if (!isFinishedStatus(round.status)) continue;
          pidMap[round.id] = pr.id;
          if (pr.tee_snapshot_id) teeSnapIdByRound[round.id] = pr.tee_snapshot_id;
        }

        extracted.sort((a, b) => {
          const ad = parseDateMs(a.started_at ?? a.created_at);
          const bd = parseDateMs(b.started_at ?? b.created_at);
          return bd - ad;
        });

        if (cancelled) return;

        allRoundsRef.current = extracted;
        pidMapRef.current = pidMap;
        teeSnapIdByRoundRef.current = teeSnapIdByRound;

        setRounds(extracted);
        setParticipantIdByRoundId(pidMap);

        // 2) handicap_round_results for ALL participants upfront (drives counting-set decoration)
        const participantIds = Array.from(new Set(Object.values(pidMap).filter(Boolean)));
        const agsMap: Record<string, number> = {};
        const sdMap: Record<string, number> = {};
        const hiUsedMap: Record<string, number> = {};
        const courseHcpByPid: Record<string, number> = {};

        if (participantIds.length) {
          for (const ids of chunk(participantIds, 150)) {
            const { data: hrr, error: hErr } = await supabase
              .from("handicap_round_results")
              .select(
                "round_id, participant_id, adjusted_gross_score, score_differential, handicap_index_used, course_handicap_used"
              )
              .in("participant_id", ids);

            if (hErr) continue;
            for (const row of (hrr ?? []) as any[]) {
              const rid = row.round_id as string;
              const pid2 = row.participant_id as string;
              const ags = toNumberMaybe(row.adjusted_gross_score);
              const sd = toNumberMaybe(row.score_differential);
              const hiUsed = toNumberMaybe(row.handicap_index_used);
              const chcp = toNumberMaybe(row.course_handicap_used);
              if (ags != null) agsMap[rid] = ags;
              if (sd != null) sdMap[rid] = sd;
              if (hiUsed != null) hiUsedMap[rid] = hiUsed;
              if (chcp != null) courseHcpByPid[pid2] = chcp;
            }
          }
        }

        if (!cancelled) {
          setAgsByRoundId(agsMap);
          setScoreDiffByRoundId(sdMap);
          setHiUsedByRoundId(hiUsedMap);
        }

        agsMapRef.current = agsMap;
        courseHcpByPidRef.current = courseHcpByPid;

        // 3) Full handicap index history for "HI after" tooltip
        const { data: hist, error: hErr2 } = await supabase
          .from("handicap_index_history")
          .select("as_of_date, handicap_index")
          .eq("profile_id", pid)
          .not("handicap_index", "is", null)
          .order("as_of_date", { ascending: true });

        if (hErr2) throw hErr2;

        const histRows = ((hist ?? []) as any[])
          .map((r) => ({
            as_of_date: String(r.as_of_date),
            handicap_index: Number(r.handicap_index),
          }))
          .filter((r) => r.as_of_date && Number.isFinite(r.handicap_index)) as HandicapHistoryRow[];

        function hiAsOfInclusive(dateIso: string | null): number | null {
          if (!dateIso || !histRows.length) return null;
          const target = new Date(dateIso).getTime();
          if (!Number.isFinite(target)) return null;

          let lo = 0;
          let hi = histRows.length - 1;
          let bestIdx = -1;

          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const t = new Date(histRows[mid].as_of_date).getTime();
            if (!Number.isFinite(t)) { lo = mid + 1; continue; }
            if (t <= target) { bestIdx = mid; lo = mid + 1; } else { hi = mid - 1; }
          }

          return bestIdx >= 0 ? histRows[bestIdx].handicap_index : null;
        }

        const hiAfterMap: Record<string, number> = {};
        for (const r of extracted) {
          const dateIso = r.started_at ?? r.created_at;
          const after = hiAsOfInclusive(dateIso);
          if (after != null) hiAfterMap[r.id] = after;
        }

        if (!cancelled) setHiAfterByRoundId(hiAfterMap);

        // 4) Supplemental data for first page only (tee names, scores, WHS penalties)
        if (!cancelled && extracted.length) {
          const firstSlice = extracted.slice(0, PAGE_SIZE);
          await loadSupplemental(firstSlice);
          if (!cancelled) {
            const initialLoaded = Math.min(PAGE_SIZE, extracted.length);
            loadedCountRef.current = initialLoaded;
            setLoadedCount(initialLoaded);
          }
        }

        if (!cancelled) setLoading(false);
      } catch (e: any) {
        console.warn("History load error:", e);
        if (!cancelled) {
          setError(e?.message ? String(e.message) : "Could not load round history.");
          setLoading(false);
        }
      }
    }

    load();

    return () => { cancelled = true; };
  }, [profileFromQuery, loadSupplemental]);

  // Counting / cutoff uses ALL rounds + ALL score diffs (loaded upfront)
  const scoringRoundsNewestFirst = useMemo(() => {
    return rounds
      .map((r) => {
        const sd = scoreDiffByRoundId[r.id];
        return typeof sd === "number" ? { roundId: r.id, sd } : null;
      })
      .filter(Boolean) as { roundId: string; sd: number }[];
  }, [rounds, scoreDiffByRoundId]);

  const window20 = useMemo(() => scoringRoundsNewestFirst.slice(0, 20), [scoringRoundsNewestFirst]);
  const usedCount = useMemo(() => usedDifferentialsCount(window20.length), [window20.length]);

  const countingSet = useMemo(() => {
    if (usedCount <= 0) return new Set<string>();
    const sortedBySd = [...window20].sort((a, b) => a.sd - b.sd);
    return new Set(sortedBySd.slice(0, usedCount).map((x) => x.roundId));
  }, [window20, usedCount]);

  const cutoffRoundId = useMemo(() => {
    if (!window20.length) return null;
    return window20[window20.length - 1].roundId;
  }, [window20]);

  // Full counts from all rounds (for tab labels)
  const acceptableRounds = useMemo(
    () => rounds.filter((r) => typeof scoreDiffByRoundId[r.id] === "number"),
    [rounds, scoreDiffByRoundId]
  );
  const nonAcceptableRounds = useMemo(
    () => rounds.filter((r) => typeof scoreDiffByRoundId[r.id] !== "number"),
    [rounds, scoreDiffByRoundId]
  );

  // Displayed rounds = loaded pages only
  const displayedRounds = useMemo(() => rounds.slice(0, loadedCount), [rounds, loadedCount]);

  const displayedAcceptableGrouped = useMemo(() => {
    const m = new Map<string, RoundRow[]>();
    for (const r of displayedRounds) {
      if (typeof scoreDiffByRoundId[r.id] !== "number") continue;
      const k = monthKey(r.started_at ?? r.created_at);
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    }
    return Array.from(m.entries());
  }, [displayedRounds, scoreDiffByRoundId]);

  const displayedNonAcceptableGrouped = useMemo(() => {
    const m = new Map<string, RoundRow[]>();
    for (const r of displayedRounds) {
      if (typeof scoreDiffByRoundId[r.id] === "number") continue;
      const k = monthKey(r.started_at ?? r.created_at);
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    }
    return Array.from(m.entries());
  }, [displayedRounds, scoreDiffByRoundId]);

  function renderRoundRow(r: RoundRow, showCountingDecorations: boolean) {
    const course = one(r.courses)?.name ?? "Unknown course";
    const played = shortDate(r.started_at ?? r.created_at);
    const titleText = r.name?.trim() ? r.name.trim() : course;
    const teeName = teeNameByRoundId[r.id] ?? "—";

    const href = { pathname: `/round/${r.id}`, query: { from: "history" } } as const;

    const ags = agsByRoundId[r.id];
    const total = myTotalByRoundId[r.id];
    const displayScore = total ?? ags;
    const scoreText = typeof displayScore === "number" ? String(displayScore) : "—";

    const net = netByRoundId[r.id];
    const netText = typeof net === "number" ? `Net: ${net}` : "";

    const sd = scoreDiffByRoundId[r.id];
    const hiUsed = hiUsedByRoundId[r.id];
    const hiAfter = hiAfterByRoundId[r.id];

    const isExceptional =
      typeof hiUsed === "number" && typeof sd === "number" && sd <= hiUsed - 7;

    const isCounting = showCountingDecorations && countingSet.has(r.id);
    const isCutoff = showCountingDecorations && cutoffRoundId === r.id;

    return (
      <Link
        key={r.id}
        href={href}
        className={[
          "block p-3 sm:p-4 hover:bg-emerald-900/15 transition-colors",
          isCounting ? "rounded-2xl ring-2 ring-[#f5e6b0]/80" : "",
          isCutoff ? "border-b-6 border-b-[#f5e6b0]" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        title={typeof hiAfter === "number" ? `HI after: ${formatHI(hiAfter)}` : undefined}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] sm:text-[12px] font-semibold text-emerald-50 truncate">
              {titleText}
            </div>
            <div className="text-[9px] sm:text-[10px] text-emerald-100/70 truncate">
              {teeName} &middot; {played}
            </div>
          </div>

          <div className="shrink-0 grid grid-cols-2 gap-1 items-center">
            <div className="text-right">
              <div className="text-[12px] font-extrabold tabular-nums text-emerald-50 leading-none">
                {typeof hiUsed === "number" ? `HI ${formatHI(hiUsed)}` : "—"}
              </div>
              <div className="mt-0.5 text-[9px] tabular-nums text-emerald-100/60">
                <span className="inline-flex items-center gap-0.5 justify-end">
                  {typeof sd === "number" ? `SD ${sd.toFixed(1)}` : ""}
                  {isExceptional && (
                    <span className="text-[#f5e6b0]/80" title="Exceptional round">&#10024;</span>
                  )}
                </span>
              </div>
            </div>

            <div className="text-right">
              <div className="text-[14px] font-extrabold tabular-nums text-[#f5e6b0] leading-none">
                {scoreText}
              </div>
              <div className="mt-0.5 text-[9px] text-emerald-100/60">{netText || " "}</div>
            </div>
          </div>
        </div>
      </Link>
    );
  }

  const title = useMemo(() => {
    if (loading) return "Round history";
    if (error) return "Round history";
    return rounds.length ? `Round history (${rounds.length})` : "Round history";
  }, [loading, error, rounds.length]);

  const hasMore = loadedCount < rounds.length;

  return (
    <div className="h-screen bg-[#042713] text-slate-100 px-1.5 sm:px-2 pt-4">
      <div className="mx-auto w-full max-w-3xl h-full flex flex-col">
        <header className="sticky top-0 z-20 bg-[#042713] pb-3">
          <div className="flex items-center justify-between gap-2 px-1">
            <BackButton onClick={() => router.replace("/")} />

            <div className="text-center flex-1 min-w-0 px-2">
              <div className="text-[15px] sm:text-base font-semibold tracking-wide text-[#f5e6b0] truncate">{title}</div>
              <div className="text-[10px] uppercase tracking-[0.14em] text-emerald-200/70 truncate">
                {window20.length >= 3 && usedCount > 0
                  ? `${usedCount} of ${window20.length} counting`
                  : "Finished rounds"}
              </div>
            </div>

            <div className="w-[64px]" />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-y-contain pb-[env(safe-area-inset-bottom)]">
          {loading && (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
              Loading…
            </div>
          )}

          {!loading && error && (
            <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-4">
              <p className="text-sm text-red-100">{error}</p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  className="border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-50 hover:bg-emerald-900/20"
                  onClick={() => window.location.reload()}
                >
                  Retry
                </Button>

                {!profileFromQuery && (
                  <Button
                    variant="outline"
                    className="border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-50 hover:bg-emerald-900/20"
                    onClick={async () => {
                      await supabase.auth.signOut();
                      window.location.href = "/login";
                    }}
                  >
                    Sign out
                  </Button>
                )}
              </div>
            </div>
          )}

          {!loading && !error && rounds.length === 0 && (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-6 space-y-2">
              <div className="text-sm font-semibold text-emerald-50">No finished rounds yet</div>
              <p className="text-[12px] text-emerald-100/70">Finish a round and it will show up here.</p>
              <Button asChild variant="ghost" size="sm" className="mt-2 px-2 text-emerald-100 hover:bg-emerald-900/20">
                <Link href="/round">Go to rounds</Link>
              </Button>
            </div>
          )}

          {!loading && !error && rounds.length > 0 && (
            <Tabs defaultValue="acceptable" className="space-y-3">
              <TabsList className="w-full bg-emerald-900/30 border border-emerald-900/70 rounded-xl p-1">
                <TabsTrigger
                  value="acceptable"
                  className="flex-1 text-[11px] font-semibold rounded-lg data-[state=active]:bg-[#f5e6b0] data-[state=active]:text-[#042713] text-emerald-100/80 data-[state=active]:shadow-none border-none"
                >
                  Acceptable ({acceptableRounds.length})
                </TabsTrigger>
                <TabsTrigger
                  value="non-acceptable"
                  className="flex-1 text-[11px] font-semibold rounded-lg data-[state=active]:bg-[#f5e6b0] data-[state=active]:text-[#042713] text-emerald-100/80 data-[state=active]:shadow-none border-none"
                >
                  Non-Acceptable ({nonAcceptableRounds.length})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="acceptable">
                {acceptableRounds.length === 0 ? (
                  <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/70">
                    No acceptable rounds yet.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {displayedAcceptableGrouped.map(([month, list]) => (
                      <section key={month} className="space-y-2">
                        <div className="flex items-center justify-between px-1">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70">{month}</div>
                          <div className="text-[11px] text-emerald-100/60">{list.length}</div>
                        </div>
                        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 overflow-hidden">
                          <div className="p-2 space-y-2">
                            {list.map((r) => renderRoundRow(r, true))}
                          </div>
                        </div>
                      </section>
                    ))}

                    {hasMore && (
                      <button
                        onClick={loadMore}
                        disabled={loadingMore}
                        className="w-full rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 py-3 text-[12px] text-emerald-100/70 hover:bg-emerald-900/20 transition-colors disabled:opacity-50"
                      >
                        {loadingMore ? "Loading…" : `Load more · ${rounds.length - loadedCount} remaining`}
                      </button>
                    )}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="non-acceptable">
                {nonAcceptableRounds.length === 0 ? (
                  <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/70">
                    No non-acceptable rounds.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {displayedNonAcceptableGrouped.map(([month, list]) => (
                      <section key={month} className="space-y-2">
                        <div className="flex items-center justify-between px-1">
                          <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70">{month}</div>
                          <div className="text-[11px] text-emerald-100/60">{list.length}</div>
                        </div>
                        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 overflow-hidden">
                          <div className="p-2 space-y-2">
                            {list.map((r) => renderRoundRow(r, false))}
                          </div>
                        </div>
                      </section>
                    ))}

                    {hasMore && (
                      <button
                        onClick={loadMore}
                        disabled={loadingMore}
                        className="w-full rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 py-3 text-[12px] text-emerald-100/70 hover:bg-emerald-900/20 transition-colors disabled:opacity-50"
                      >
                        {loadingMore ? "Loading…" : `Load more · ${rounds.length - loadedCount} remaining`}
                      </button>
                    )}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}

          {!loading && !error && profileId && (
            <p className="text-[10px] text-emerald-100/40 px-1 mt-4">Profile: {profileId}</p>
          )}
        </div>
      </div>
    </div>
  );
}
