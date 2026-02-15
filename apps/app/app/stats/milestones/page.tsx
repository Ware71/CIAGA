// src/app/stats/milestones/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Button } from "@/components/ui/button";

// -----------------------------
// Helpers
// -----------------------------
function round1(n: number) {
  return Math.round(n * 10) / 10;
}
function rms(a: number, b: number) {
  return Math.sqrt((a * a + b * b) / 2);
}
function safeNum(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function parseYMD(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.getTime();
}
function monthsAgo(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.getTime();
}
function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function fmtSigned(n: number) {
  const s = round1(n);
  if (s > 0) return `+${s}`;
  if (s === 0) return "E";
  return `${s}`;
}
function mean(xs: number[]) {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function stdev(xs: number[]) {
  if (xs.length < 2) return null;
  const m = mean(xs)!;
  const v = mean(xs.map((x) => (x - m) * (x - m)))!;
  return Math.sqrt(v);
}

function normalizeTeeName(teeName: string | null) {
  const raw = (teeName ?? "").trim();
  if (!raw) return { base: "Tee", nine: "full" as const };

  if (/\(front 9\)/i.test(raw))
    return { base: raw.replace(/\s*\(front 9\)\s*/i, "").trim(), nine: "front" as const };
  if (/\(back 9\)/i.test(raw))
    return { base: raw.replace(/\s*\(back 9\)\s*/i, "").trim(), nine: "back" as const };
  return { base: raw, nine: "full" as const };
}

// White(front9) hole2 == White hole2
// White(back9) hole9 == White hole18
function normalizeHoleNumberForNine(teeName: string | null, holeNumber: number | null) {
  const hn = holeNumber == null ? null : Math.round(holeNumber);
  if (!hn) return null;

  const { nine } = normalizeTeeName(teeName);

  if (nine === "front") return hn;
  if (nine === "back") {
    if (hn >= 1 && hn <= 9) return hn + 9;
    return hn;
  }
  return hn;
}

function rangeToText(r: { start: number; end: number } | null) {
  if (!r) return "—";
  const a = new Date(r.start);
  const b = new Date(r.end);
  if (a.toDateString() === b.toDateString()) return fmtDate(a);
  return `${fmtDate(a)} → ${fmtDate(b)}`;
}

function goRound(router: any, roundId: string | null | undefined) {
  if (!roundId) return;
  router.push(`/round/${roundId}`);
}

// -----------------------------
// Data fetch
// -----------------------------
async function fetchAllHoleScoringSource(profileId: string) {
  const pageSize = 1000;
  let from = 0;
  const out: any[] = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("hole_scoring_source")
      .select(
        "profile_id, round_id, played_at, course_id, course_name, tee_box_id, tee_name, hole_number, par, strokes, to_par, net_strokes, net_to_par"
      )
      .eq("profile_id", profileId)
      .order("played_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const chunk = (data ?? []) as any[];
    out.push(...chunk);

    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

// -----------------------------
// Types
// -----------------------------
type HoleRow = {
  profile_id: string | null;
  round_id: string | null;
  played_at: string | null;

  course_id: string | null;
  course_name: string | null;

  tee_box_id: string | null;
  tee_name: string | null;

  hole_number: number | null;
  par: number | null;

  strokes: number | null;
  to_par: number | null;

  net_strokes?: number | null;
  net_to_par?: number | null;
};

type Option = { id: string; name: string };
type TimePreset = "all" | "12m" | "6m" | "30d" | "40r" | "20r" | "10r" | "5r";

type RoundAgg = {
  round_id: string;
  played_at: string | null;

  course_id: string | null;
  course_name: string | null;

  tee_box_id: string | null;
  tee_name: string | null;
  tee_base: string;

  holes_scored: number;
  unique_holes_scored: number;
  is_9_hole: boolean;

  gross_total: number | null;
  net_total: number | null;

  gross_to_par: number | null;
  net_to_par: number | null;

  // 18-eq versions (ALWAYS used for averages/SD/comparisons)
  gross_to_par_18eq: number | null;
  net_to_par_18eq: number | null;

  // Milestone counts (gross only)
  birdies: number;
  eagles: number;
  albatrosses: number;
  holes_in_one: number;
};

function aggregateRounds(rows: HoleRow[]): RoundAgg[] {
  const byRound = new Map<string, HoleRow[]>();

  for (const r of rows) {
    if (!r.round_id) continue;
    if (!byRound.has(r.round_id)) byRound.set(r.round_id, []);
    byRound.get(r.round_id)!.push(r);
  }

  const out: RoundAgg[] = [];

  for (const [roundId, hs] of byRound.entries()) {
    const played_at = hs.find((x) => x.played_at)?.played_at ?? null;

    const course_id = hs.find((x) => x.course_id)?.course_id ?? null;
    const course_name = hs.find((x) => x.course_name)?.course_name ?? null;

    const tee_box_id = hs.find((x) => x.tee_box_id)?.tee_box_id ?? null;
    const tee_name = hs.find((x) => x.tee_name)?.tee_name ?? null;
    const tee_base = normalizeTeeName(tee_name).base;

    const normHoles = hs
      .map((h) => normalizeHoleNumberForNine(h.tee_name, safeNum(h.hole_number)))
      .filter((x): x is number => !!x && Number.isFinite(x));

    const unique = Array.from(new Set(normHoles));
    const unique_holes_scored = unique.length;
    const maxNorm = unique.length ? Math.max(...unique) : 0;

    const teeNine = normalizeTeeName(tee_name).nine;
    const is_9_hole = teeNine !== "full" || (maxNorm <= 9 && unique_holes_scored <= 9);

    const strokes = hs.map((h) => safeNum(h.strokes)).filter((x): x is number => x != null);
    const netStrokes = hs.map((h) => safeNum(h.net_strokes)).filter((x): x is number => x != null);

    const toPar = hs.map((h) => safeNum(h.to_par)).filter((x): x is number => x != null);
    const netToPar = hs.map((h) => safeNum(h.net_to_par)).filter((x): x is number => x != null);

    const holes_scored = strokes.length;

    const gross_total = strokes.length ? strokes.reduce((a, b) => a + b, 0) : null;
    const net_total = netStrokes.length ? netStrokes.reduce((a, b) => a + b, 0) : null;

    const gross_to_par = toPar.length ? toPar.reduce((a, b) => a + b, 0) : null;
    const net_to_par = netToPar.length ? netToPar.reduce((a, b) => a + b, 0) : null;

    // ALWAYS scale to 18-eq for “comparisons” stats (avg/SD/stretches/etc)
    const denom = unique_holes_scored > 0 ? unique_holes_scored : holes_scored > 0 ? holes_scored : 0;
    const scale = denom > 0 ? 18 / denom : 1;

    const gross_to_par_18eq =
      typeof gross_to_par === "number" && Number.isFinite(scale) ? gross_to_par * scale : null;
    const net_to_par_18eq =
      typeof net_to_par === "number" && Number.isFinite(scale) ? net_to_par * scale : null;

    // Milestone counts (gross only)
    let birdies = 0;
    let eagles = 0;
    let albatrosses = 0;
    let holes_in_one = 0;

    for (const h of hs) {
      const par = safeNum(h.par);
      const st = safeNum(h.strokes);
      if (par == null || st == null) continue;

      const diff = st - par;

      if (st === 1) holes_in_one += 1;

      if (diff === -1) birdies += 1;
      if (diff === -2) eagles += 1;
      if (diff <= -3) albatrosses += 1;
    }

    out.push({
      round_id: roundId,
      played_at,
      course_id,
      course_name,
      tee_box_id,
      tee_name,
      tee_base,
      holes_scored,
      unique_holes_scored,
      is_9_hole,
      gross_total,
      net_total,
      gross_to_par,
      net_to_par,
      gross_to_par_18eq,
      net_to_par_18eq,
      birdies,
      eagles,
      albatrosses,
      holes_in_one,
    });
  }

  out.sort((a, b) => (parseYMD(b.played_at) ?? 0) - (parseYMD(a.played_at) ?? 0));
  return out;
}

function computeStreaks(datesDesc: number[], gapDays: number) {
  const datesAsc = datesDesc.slice().sort((a, b) => a - b);
  if (!datesAsc.length) {
    return {
      longest: 0,
      current: 0,
      longestRange: null as { start: number; end: number } | null,
      currentRange: null as { start: number; end: number } | null,
    };
  }

  const msGap = gapDays * 24 * 60 * 60 * 1000;

  let longest = 1;
  let longestStart = datesAsc[0];
  let longestEnd = datesAsc[0];

  let runStart = datesAsc[0];
  let runLen = 1;

  for (let i = 1; i < datesAsc.length; i++) {
    const prev = datesAsc[i - 1];
    const cur = datesAsc[i];
    if (cur - prev <= msGap) {
      runLen += 1;
    } else {
      if (runLen > longest) {
        longest = runLen;
        longestStart = runStart;
        longestEnd = prev;
      }
      runStart = cur;
      runLen = 1;
    }
  }

  const last = datesAsc[datesAsc.length - 1];
  if (runLen > longest) {
    longest = runLen;
    longestStart = runStart;
    longestEnd = last;
  }

  let current = 1;
  let currentStart = last;
  for (let i = datesAsc.length - 1; i >= 1; i--) {
    const cur = datesAsc[i];
    const prev = datesAsc[i - 1];
    if (cur - prev <= msGap) {
      current += 1;
      currentStart = prev;
    } else {
      break;
    }
  }

  return {
    longest,
    current,
    longestRange: { start: longestStart, end: longestEnd },
    currentRange: { start: currentStart, end: last },
  };
}

function windowBestStretch(roundsAsc: RoundAgg[], windowSize: number, metric: "gross" | "net") {
  if (roundsAsc.length < windowSize) return null;

  const key = metric === "net" ? "net_to_par_18eq" : "gross_to_par_18eq";

  const usable = roundsAsc.filter((r) => typeof (r as any)[key] === "number") as any[];
  if (usable.length < windowSize) return null;

  let bestAvg = Infinity;
  let bestI = 0;

  for (let i = 0; i <= usable.length - windowSize; i++) {
    const slice = usable.slice(i, i + windowSize);
    const avg = mean(slice.map((x: any) => x[key]))!;
    if (avg < bestAvg) {
      bestAvg = avg;
      bestI = i;
    }
  }

  const slice = usable.slice(bestI, bestI + windowSize);
  return {
    avg: bestAvg,
    start: slice[0].played_at,
    end: slice[slice.length - 1].played_at,
  };
}

// -----------------------------
// Page
// -----------------------------
export default function MilestonesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [preset, setPreset] = useState<TimePreset>("6m");
  const [rows, setRows] = useState<HoleRow[]>([]);

  const [courseId, setCourseId] = useState<string>("");
  const [teeBoxId, setTeeBoxId] = useState<string>("");

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [streakGapDays, setStreakGapDays] = useState<7 | 10 | 14 | 21 | 30>(14);

  // Consistency info modal
  const [showConsistencyHelp, setShowConsistencyHelp] = useState(false);

  // -----------------------------
  // Load data
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

        const data = await fetchAllHoleScoringSource(pid);
        const got = ((data as any) ?? []) as HoleRow[];

        if (!alive) return;
        setRows(got);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Failed to load milestones.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const courseOptions: Option[] = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      if (!r.course_id) continue;
      m.set(r.course_id, r.course_name ?? r.course_id.slice(0, 8));
    }
    return Array.from(m.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const teeOptions: Option[] = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) {
      if (courseId && r.course_id !== courseId) continue;
      if (!r.tee_box_id) continue;
      const disp = normalizeTeeName(r.tee_name ?? r.tee_box_id.slice(0, 8)).base;
      m.set(r.tee_box_id, disp);
    }
    return Array.from(m.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, courseId]);

  useEffect(() => {
    if (!teeBoxId) return;
    const ok = teeOptions.some((t) => t.id === teeBoxId);
    if (!ok) setTeeBoxId("");
  }, [courseId, teeOptions, teeBoxId]);

  // Apply time preset (hole-level)
  const timeFiltered = useMemo(() => {
    if (!rows.length) return [];

    if (preset === "30d" || preset === "6m" || preset === "12m") {
      const minTs = preset === "30d" ? daysAgo(30) : preset === "6m" ? monthsAgo(6) : monthsAgo(12);
      return rows.filter((r) => {
        const ts = parseYMD(r.played_at);
        if (ts == null) return false;
        return ts >= minTs;
      });
    }

    if (preset === "5r" || preset === "10r" || preset === "20r" || preset === "40r") {
      const limitRounds = preset === "5r" ? 5 : preset === "10r" ? 10 : preset === "20r" ? 20 : 40;

      const roundOrder: string[] = [];
      const seen = new Set<string>();

      for (const r of rows) {
        if (!r.round_id) continue;
        if (seen.has(r.round_id)) continue;
        seen.add(r.round_id);
        roundOrder.push(r.round_id);
        if (roundOrder.length >= limitRounds) break;
      }

      const allowed = new Set(roundOrder);
      return rows.filter((r) => !!r.round_id && allowed.has(r.round_id));
    }

    return rows;
  }, [rows, preset]);

  // Apply course/tee filters
  const filteredHoles = useMemo(() => {
    return timeFiltered.filter((r) => {
      if (courseId && r.course_id !== courseId) return false;
      if (teeBoxId && r.tee_box_id !== teeBoxId) return false;
      return true;
    });
  }, [timeFiltered, courseId, teeBoxId]);

  // Aggregate rounds
  const roundsAggDesc = useMemo(() => {
    return aggregateRounds(filteredHoles);
  }, [filteredHoles]);

  const roundsAggAsc = useMemo(() => {
    return roundsAggDesc.slice().sort((a, b) => (parseYMD(a.played_at) ?? 0) - (parseYMD(a.played_at) ?? 0));
  }, [roundsAggDesc]);

  const presetLabel = (p: TimePreset) => {
    if (p === "all") return "All time";
    if (p === "12m") return "Last 12 months";
    if (p === "6m") return "Last 6 months";
    if (p === "30d") return "Last 30 days";
    if (p === "40r") return "Last 40 rounds";
    if (p === "20r") return "Last 20 rounds";
    if (p === "10r") return "Last 10 rounds";
    return "Last 5 rounds";
  };

  // -----------------------------
  // Computations
  // -----------------------------
  const summary = useMemo(() => {
    const n = roundsAggDesc.length;
    if (!n) return null;

    const grossVals = roundsAggDesc
      .map((r) => r.gross_to_par_18eq)
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x));

    const netVals = roundsAggDesc
      .map((r) => r.net_to_par_18eq)
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x));

    const grossAvg = mean(grossVals);
    const netAvg = mean(netVals);

    const grossSd = stdev(grossVals);
    const netSd = stdev(netVals);

    const n9 = roundsAggDesc.filter((r) => r.is_9_hole).length;
    const n18 = roundsAggDesc.filter((r) => !r.is_9_hole).length;

    // Totals (gross only)
    const totalBirdies = roundsAggDesc.reduce((acc, r) => acc + (r.birdies || 0), 0);
    const totalEagles = roundsAggDesc.reduce((acc, r) => acc + (r.eagles || 0), 0);
    const totalAlbatrosses = roundsAggDesc.reduce((acc, r) => acc + (r.albatrosses || 0), 0);
    const totalHIO = roundsAggDesc.reduce((acc, r) => acc + (r.holes_in_one || 0), 0);

    return {
      rounds: n,
      rounds9: n9,
      rounds18: n18,
      grossAvg,
      netAvg,
      grossSd,
      netSd,
      totalBirdies,
      totalEagles,
      totalAlbatrosses,
      totalHIO,
    };
  }, [roundsAggDesc]);

    const consistency = useMemo(() => {
        if (!summary) return null;
        const g = summary.grossSd ?? null;
        const n = summary.netSd ?? null;

        if (g == null && n == null) return null;

        // RMS of gross + net SD (stays in the same “strokes” scale)
        if (g != null && n != null) return round1(rms(g, n));

        // If one side missing, fall back to the available one
        return round1((g ?? n) as number);
    }, [summary]);



  const streaks = useMemo(() => {
    const dates = roundsAggDesc
      .map((r) => parseYMD(r.played_at))
      .filter((x): x is number => x != null)
      .sort((a, b) => b - a);
    return computeStreaks(dates, streakGapDays);
  }, [roundsAggDesc, streakGapDays]);

  const bestWorst = useMemo(() => {
    const nine = roundsAggDesc.filter((r) => r.is_9_hole);
    const eighteen = roundsAggDesc.filter((r) => !r.is_9_hole);

    const pick = (xs: RoundAgg[], key: "gross_to_par" | "net_to_par", dir: "best" | "worst") => {
      const usable = xs.filter((r) => typeof (r as any)[key] === "number") as any[];
      if (!usable.length) return null as RoundAgg | null;
      return usable.reduce((acc: any, cur: any) => {
        if (!acc) return cur;
        if (dir === "best") return cur[key] < acc[key] ? cur : acc;
        return cur[key] > acc[key] ? cur : acc;
      }, null);
    };

    return {
      best9Gross: pick(nine, "gross_to_par", "best"),
      worst9Gross: pick(nine, "gross_to_par", "worst"),
      best18Gross: pick(eighteen, "gross_to_par", "best"),
      worst18Gross: pick(eighteen, "gross_to_par", "worst"),

      best9Net: pick(nine, "net_to_par", "best"),
      worst9Net: pick(nine, "net_to_par", "worst"),
      best18Net: pick(eighteen, "net_to_par", "best"),
      worst18Net: pick(eighteen, "net_to_par", "worst"),
    };
  }, [roundsAggDesc]);

  const stretches = useMemo(() => {
    return {
      gross3: windowBestStretch(roundsAggAsc, 3, "gross"),
      gross5: windowBestStretch(roundsAggAsc, 5, "gross"),
      net3: windowBestStretch(roundsAggAsc, 3, "net"),
      net5: windowBestStretch(roundsAggAsc, 5, "net"),
    };
  }, [roundsAggAsc]);

  const firsts = useMemo(() => {
    const asc = roundsAggAsc;

    const firstRound = asc.length ? asc[0] : null;

    const firstBirdieRound = asc.find((r) => r.birdies >= 1) ?? null;
    const firstEagleRound = asc.find((r) => r.eagles >= 1) ?? null;
    const firstAlbatrossRound = asc.find((r) => r.albatrosses >= 1) ?? null;
    const firstHioRound = asc.find((r) => r.holes_in_one >= 1) ?? null;

    const first3Birdies = asc.find((r) => r.birdies >= 3) ?? null;
    const first5Birdies = asc.find((r) => r.birdies >= 5) ?? null;

    // Running totals milestones
    let birdieTotal = 0;
    let eagleTotal = 0;

    let hit100Birdies: RoundAgg | null = null;
    let hit25Eagles: RoundAgg | null = null;

    for (const r of asc) {
      birdieTotal += r.birdies;
      eagleTotal += r.eagles;

      if (!hit100Birdies && birdieTotal >= 100) hit100Birdies = r;
      if (!hit25Eagles && eagleTotal >= 25) hit25Eagles = r;
    }

    return {
      firstRound,

      firstBirdieRound,
      firstEagleRound,
      firstAlbatrossRound,
      firstHioRound,

      first3Birdies,
      first5Birdies,

      hit100Birdies,
      hit25Eagles,
    };
  }, [roundsAggAsc]);

  const goals = useMemo(() => {
    const rounds = roundsAggDesc.length;

    const parOrBetter18eq = roundsAggDesc.filter(
      (r) => typeof r.gross_to_par_18eq === "number" && (r.gross_to_par_18eq as number) <= 0
    ).length;

    const break100 = roundsAggDesc.filter(
      (r) => !r.is_9_hole && typeof r.gross_total === "number" && (r.gross_total as number) < 100
    ).length;
    const break90 = roundsAggDesc.filter(
      (r) => !r.is_9_hole && typeof r.gross_total === "number" && (r.gross_total as number) < 90
    ).length;
    const break80 = roundsAggDesc.filter(
      (r) => !r.is_9_hole && typeof r.gross_total === "number" && (r.gross_total as number) < 80
    ).length;

    const birdieRounds = roundsAggDesc.filter((r) => r.birdies >= 1).length;
    const eagleRounds = roundsAggDesc.filter((r) => r.eagles >= 1).length;
    const hioRounds = roundsAggDesc.filter((r) => r.holes_in_one >= 1).length;

    return {
      rounds,
      parOrBetter18eq,
      break100,
      break90,
      break80,
      birdieRounds,
      eagleRounds,
      hioRounds,
    };
  }, [roundsAggDesc]);

  // -----------------------------
  // UI
  // -----------------------------
  function MilestoneRow(props: {
    title: string;
    subtitle?: string;
    value: React.ReactNode;
    right?: React.ReactNode;
    onClick?: () => void;
  }) {
    const { title, subtitle, value, right, onClick } = props;

    return (
      <div
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick}
        onKeyDown={(e) => {
          if (!onClick) return;
          if (e.key === "Enter" || e.key === " ") onClick();
        }}
        className={[
          "rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-3",
          onClick ? "cursor-pointer hover:bg-[#042713]/60" : "",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-extrabold text-emerald-50 truncate">{title}</div>
            {subtitle ? (
              <div className="mt-0.5 text-[12px] text-emerald-100/70 font-semibold leading-snug break-words">
                {subtitle}
              </div>
            ) : null}
          </div>
          {right ? <div className="shrink-0 text-[11px] text-emerald-100/70 font-semibold">{right}</div> : null}
        </div>

        <div className="mt-2">
          <div className="text-[11px] text-emerald-100/70 font-bold">Result</div>
          <div className="text-lg font-extrabold tabular-nums text-[#f5e6b0]">{value}</div>
        </div>
      </div>
    );
  }

  const filtersSummary = [
    presetLabel(preset),
    courseId ? courseOptions.find((c) => c.id === courseId)?.name ?? "Course" : "All courses",
    teeBoxId ? teeOptions.find((t) => t.id === teeBoxId)?.name ?? "Tee" : "All tees",
  ].join(" · ");

  return (
    <div className="h-screen bg-[#042713] text-slate-100 px-1.5 sm:px-2 pt-4">
      <div className="mx-auto w-full max-w-3xl h-full flex flex-col">
        <header className="sticky top-0 z-20 bg-[#042713] pb-3">
          <div className="flex items-center justify-between gap-2 px-1">
            <Button
              variant="ghost"
              size="sm"
              className="px-2 text-emerald-100 hover:bg-emerald-900/30"
              onClick={() => router.back()}
            >
              ← Back
            </Button>

            <div className="text-center flex-1 min-w-0 px-2">
              <div className="text-[15px] sm:text-base font-semibold tracking-wide text-[#f5e6b0] truncate">
                Streaks & milestones
              </div>
              <div className="text-[11px] sm:text-[10px] uppercase tracking-[0.14em] text-emerald-200/70 truncate">
                {presetLabel(preset)}
              </div>
            </div>

            <div className="w-[64px]" />
          </div>

          {/* Filters */}
          <div className="mt-3 px-1">
            <div
              role="button"
              tabIndex={0}
              onClick={() => setFiltersOpen((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setFiltersOpen((v) => !v);
              }}
              className={[
                "rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70",
                "p-2 select-none cursor-pointer",
              ].join(" ")}
              aria-expanded={filtersOpen}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">Filters</div>
                  <div className="mt-1 text-[12px] text-emerald-50/90 font-extrabold leading-tight">{filtersSummary}</div>
                </div>

                <div className="shrink-0 text-[12px] font-extrabold text-[#f5e6b0] pt-[2px]">
                  {filtersOpen ? "▲" : "▼"}
                </div>
              </div>

              {filtersOpen ? (
                <div className="mt-3 space-y-2">
                  {/* Time range */}
                  <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/40 p-2">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold mb-2">
                      Time range
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreset("all");
                        }}
                        className={[
                          "rounded-2xl px-3 py-2 text-[13px] font-extrabold border w-full",
                          preset === "all"
                            ? "bg-[#042713]/70 border-[#f5e6b0]/60 text-[#f5e6b0]"
                            : "bg-[#042713]/30 border-emerald-900/70 text-emerald-50/90 hover:bg-emerald-900/20",
                        ].join(" ")}
                      >
                        All time
                      </button>
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-2">
                      {([
                        ["12m", "Last 12 months"],
                        ["6m", "Last 6 months"],
                        ["30d", "Last 30 days"],
                      ] as const).map(([id, label]) => {
                        const active = preset === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreset(id);
                            }}
                            className={[
                              "rounded-2xl px-3 py-2 text-[13px] font-extrabold border leading-tight",
                              active
                                ? "bg-[#042713]/70 border-[#f5e6b0]/60 text-[#f5e6b0]"
                                : "bg-[#042713]/30 border-emerald-900/70 text-emerald-50/90 hover:bg-emerald-900/20",
                            ].join(" ")}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {([
                        ["40r", "Last 40 rounds"],
                        ["20r", "Last 20 rounds"],
                        ["10r", "Last 10 rounds"],
                        ["5r", "Last 5 rounds"],
                      ] as const).map(([id, label]) => {
                        const active = preset === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreset(id);
                            }}
                            className={[
                              "rounded-2xl px-3 py-2 text-[13px] font-extrabold border leading-tight",
                              active
                                ? "bg-[#042713]/70 border-[#f5e6b0]/60 text-[#f5e6b0]"
                                : "bg-[#042713]/30 border-emerald-900/70 text-emerald-50/90 hover:bg-emerald-900/20",
                            ].join(" ")}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Course + tee */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/40 p-2 col-span-2">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">Course</div>
                      <select
                        value={courseId}
                        onChange={(e) => setCourseId(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 w-full rounded-xl bg-[#042713]/70 border border-emerald-900/70 px-2 py-2 text-[13px] text-emerald-50"
                      >
                        <option value="">All</option>
                        {courseOptions.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/40 p-2 col-span-2 sm:col-span-1">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">Tee</div>
                      <select
                        value={teeBoxId}
                        onChange={(e) => setTeeBoxId(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 w-full rounded-xl bg-[#042713]/70 border border-emerald-900/70 px-2 py-2 text-[13px] text-emerald-50"
                      >
                        <option value="">All tees</option>
                        {teeOptions.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Streak gap */}
                    <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/40 p-2 col-span-2 sm:col-span-1">
                      <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">
                        Streak gap
                      </div>
                      <div className="mt-2 grid grid-cols-5 gap-2">
                        {[7, 10, 14, 21, 30].map((d) => {
                          const active = streakGapDays === d;
                          return (
                            <button
                              key={d}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setStreakGapDays(d as any);
                              }}
                              className={[
                                "rounded-2xl px-2 py-2 text-[13px] font-extrabold border",
                                active
                                  ? "bg-[#042713]/70 border-[#f5e6b0]/60 text-[#f5e6b0]"
                                  : "bg-[#042713]/30 border-emerald-900/70 text-emerald-50/90 hover:bg-emerald-900/20",
                              ].join(" ")}
                            >
                              {d}d
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-y-contain pb-[env(safe-area-inset-bottom)]">
          {loading ? (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
              Loading…
            </div>
          ) : err ? (
            <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-4">
              <p className="text-sm text-red-100">{err}</p>
              <div className="mt-3">
                <Button
                  variant="outline"
                  className="border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-50 hover:bg-emerald-900/20"
                  onClick={() => window.location.reload()}
                >
                  Retry
                </Button>
              </div>
            </div>
          ) : !roundsAggDesc.length ? (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-6 space-y-2">
              <div className="text-sm font-semibold text-emerald-50">No milestone data found</div>
              <p className="text-[12px] text-emerald-100/70">Try a different time preset or clear course/tee filters.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Summary */}
              {summary ? (
                <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
                  <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">Summary</div>

                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <div className="text-[11px] text-emerald-100/70 font-bold">Rounds</div>
                      <div className="text-lg font-extrabold tabular-nums text-emerald-50">{summary.rounds}</div>
                      <div className="text-[11px] text-emerald-100/60 font-semibold">
                        {summary.rounds18}×18 · {summary.rounds9}×9
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-emerald-100/70 font-bold">Avg to par (18-eq)</div>
                      <div className="text-[12px] text-emerald-100/70 font-semibold">
                        Gross: {summary.grossAvg == null ? "—" : fmtSigned(summary.grossAvg)}
                      </div>
                      <div className="text-[12px] text-emerald-100/70 font-semibold">
                        Net: {summary.netAvg == null ? "—" : fmtSigned(summary.netAvg)}
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <div className="text-[11px] text-emerald-100/70 font-bold">Consistency</div>

                        <button
                          type="button"
                          onClick={() => setShowConsistencyHelp(true)}
                          className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-emerald-900/70 bg-[#042713]/40 text-emerald-50/90 text-[12px] font-extrabold hover:bg-emerald-900/20"
                          title="What does this mean?"
                          aria-label="What does consistency mean?"
                        >
                          i
                        </button>
                      </div>

                      <div className="text-lg font-extrabold tabular-nums text-[#f5e6b0]">
                        {consistency == null ? "—" : consistency}
                      </div>

                      <div className="text-[11px] text-emerald-100/60 font-semibold">
                        Gross SD: {summary.grossSd == null ? "—" : round1(summary.grossSd)} · Net SD:{" "}
                        {summary.netSd == null ? "—" : round1(summary.netSd)}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-emerald-100/70 font-bold">Totals (gross)</div>
                      <div className="text-[12px] text-emerald-100/70 font-semibold">
                        Birdies: <span className="text-emerald-50 font-extrabold tabular-nums">{summary.totalBirdies}</span>
                      </div>
                      <div className="text-[12px] text-emerald-100/70 font-semibold">
                        Eagles: <span className="text-emerald-50 font-extrabold tabular-nums">{summary.totalEagles}</span>
                      </div>
                      <div className="text-[12px] text-emerald-100/70 font-semibold">
                        Albatrosses:{" "}
                        <span className="text-emerald-50 font-extrabold tabular-nums">{summary.totalAlbatrosses}</span>
                      </div>
                      <div className="text-[12px] text-emerald-100/70 font-semibold">
                        Hole-in-ones:{" "}
                        <span className="text-emerald-50 font-extrabold tabular-nums">{summary.totalHIO}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Streaks */}
              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
                <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">Streaks</div>
                <div className="mt-1 text-[12px] text-emerald-100/70 font-semibold">
                  A streak continues if the next round is within{" "}
                  <span className="font-extrabold text-emerald-50">{streakGapDays}</span> days.
                </div>

                <div className="mt-3 space-y-2">
                  <MilestoneRow title="Current streak" subtitle={rangeToText(streaks.currentRange)} value={`${streaks.current} rounds`} />
                  <MilestoneRow title="Longest streak" subtitle={rangeToText(streaks.longestRange)} value={`${streaks.longest} rounds`} />
                </div>
              </div>

              {/* Best & worst (raw; separate 9/18) */}
              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
                <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">Best & worst</div>
                <div className="mt-1 text-[12px] text-emerald-100/70 font-semibold">
                  Best/worst shown on raw to-par (not 18-eq). 9-hole and 18-hole are separate.
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/60 font-bold">18 holes</div>
                    <MilestoneRow
                      title="Best gross (18)"
                      subtitle={bestWorst.best18Gross ? `${bestWorst.best18Gross.course_name ?? "Course"} · ${bestWorst.best18Gross.tee_base}` : "—"}
                      value={bestWorst.best18Gross?.gross_to_par == null ? "—" : fmtSigned(bestWorst.best18Gross.gross_to_par)}
                      right={bestWorst.best18Gross?.played_at ? fmtDate(new Date(bestWorst.best18Gross.played_at)) : "—"}
                      onClick={() => goRound(router, bestWorst.best18Gross?.round_id)}
                    />
                    <MilestoneRow
                      title="Worst gross (18)"
                      subtitle={bestWorst.worst18Gross ? `${bestWorst.worst18Gross.course_name ?? "Course"} · ${bestWorst.worst18Gross.tee_base}` : "—"}
                      value={bestWorst.worst18Gross?.gross_to_par == null ? "—" : fmtSigned(bestWorst.worst18Gross.gross_to_par)}
                      right={bestWorst.worst18Gross?.played_at ? fmtDate(new Date(bestWorst.worst18Gross.played_at)) : "—"}
                      onClick={() => goRound(router, bestWorst.worst18Gross?.round_id)}
                    />

                    <MilestoneRow
                      title="Best net (18)"
                      subtitle={bestWorst.best18Net ? `${bestWorst.best18Net.course_name ?? "Course"} · ${bestWorst.best18Net.tee_base}` : "—"}
                      value={bestWorst.best18Net?.net_to_par == null ? "—" : fmtSigned(bestWorst.best18Net.net_to_par)}
                      right={bestWorst.best18Net?.played_at ? fmtDate(new Date(bestWorst.best18Net.played_at)) : "—"}
                      onClick={() => goRound(router, bestWorst.best18Net?.round_id)}
                    />
                    <MilestoneRow
                      title="Worst net (18)"
                      subtitle={bestWorst.worst18Net ? `${bestWorst.worst18Net.course_name ?? "Course"} · ${bestWorst.worst18Net.tee_base}` : "—"}
                      value={bestWorst.worst18Net?.net_to_par == null ? "—" : fmtSigned(bestWorst.worst18Net.net_to_par)}
                      right={bestWorst.worst18Net?.played_at ? fmtDate(new Date(bestWorst.worst18Net.played_at)) : "—"}
                      onClick={() => goRound(router, bestWorst.worst18Net?.round_id)}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/60 font-bold">9 holes</div>
                    <MilestoneRow
                      title="Best gross (9)"
                      subtitle={bestWorst.best9Gross ? `${bestWorst.best9Gross.course_name ?? "Course"} · ${bestWorst.best9Gross.tee_base}` : "—"}
                      value={bestWorst.best9Gross?.gross_to_par == null ? "—" : fmtSigned(bestWorst.best9Gross.gross_to_par)}
                      right={bestWorst.best9Gross?.played_at ? fmtDate(new Date(bestWorst.best9Gross.played_at)) : "—"}
                      onClick={() => goRound(router, bestWorst.best9Gross?.round_id)}
                    />
                    <MilestoneRow
                      title="Worst gross (9)"
                      subtitle={bestWorst.worst9Gross ? `${bestWorst.worst9Gross.course_name ?? "Course"} · ${bestWorst.worst9Gross.tee_base}` : "—"}
                      value={bestWorst.worst9Gross?.gross_to_par == null ? "—" : fmtSigned(bestWorst.worst9Gross.gross_to_par)}
                      right={bestWorst.worst9Gross?.played_at ? fmtDate(new Date(bestWorst.worst9Gross.played_at)) : "—"}
                      onClick={() => goRound(router, bestWorst.worst9Gross?.round_id)}
                    />

                    <MilestoneRow
                      title="Best net (9)"
                      subtitle={bestWorst.best9Net ? `${bestWorst.best9Net.course_name ?? "Course"} · ${bestWorst.best9Net.tee_base}` : "—"}
                      value={bestWorst.best9Net?.net_to_par == null ? "—" : fmtSigned(bestWorst.best9Net.net_to_par)}
                      right={bestWorst.best9Net?.played_at ? fmtDate(new Date(bestWorst.best9Net.played_at)) : "—"}
                      onClick={() => goRound(router, bestWorst.best9Net?.round_id)}
                    />
                    <MilestoneRow
                      title="Worst net (9)"
                      subtitle={bestWorst.worst9Net ? `${bestWorst.worst9Net.course_name ?? "Course"} · ${bestWorst.worst9Net.tee_base}` : "—"}
                      value={bestWorst.worst9Net?.net_to_par == null ? "—" : fmtSigned(bestWorst.worst9Net.net_to_par)}
                      right={bestWorst.worst9Net?.played_at ? fmtDate(new Date(bestWorst.worst9Net.played_at)) : "—"}
                      onClick={() => goRound(router, bestWorst.worst9Net?.round_id)}
                    />
                  </div>
                </div>
              </div>

              {/* Best stretches (18-eq comparisons) */}
              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
                <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">Best stretches</div>
                <div className="mt-1 text-[12px] text-emerald-100/70 font-semibold">
                  These use 18-equivalent to-par so 9-hole rounds compare fairly.
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/60 font-bold">Gross</div>
                    <MilestoneRow
                      title="Best 3-round stretch"
                      subtitle={
                        stretches.gross3
                          ? `${stretches.gross3.start ? fmtDate(new Date(stretches.gross3.start)) : "—"} → ${
                              stretches.gross3.end ? fmtDate(new Date(stretches.gross3.end)) : "—"
                            }`
                          : "—"
                      }
                      value={stretches.gross3 ? fmtSigned(stretches.gross3.avg) : "—"}
                    />
                    <MilestoneRow
                      title="Best 5-round stretch"
                      subtitle={
                        stretches.gross5
                          ? `${stretches.gross5.start ? fmtDate(new Date(stretches.gross5.start)) : "—"} → ${
                              stretches.gross5.end ? fmtDate(new Date(stretches.gross5.end)) : "—"
                            }`
                          : "—"
                      }
                      value={stretches.gross5 ? fmtSigned(stretches.gross5.avg) : "—"}
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/60 font-bold">Net</div>
                    <MilestoneRow
                      title="Best 3-round stretch"
                      subtitle={
                        stretches.net3
                          ? `${stretches.net3.start ? fmtDate(new Date(stretches.net3.start)) : "—"} → ${
                              stretches.net3.end ? fmtDate(new Date(stretches.net3.end)) : "—"
                            }`
                          : "—"
                      }
                      value={stretches.net3 ? fmtSigned(stretches.net3.avg) : "—"}
                    />
                    <MilestoneRow
                      title="Best 5-round stretch"
                      subtitle={
                        stretches.net5
                          ? `${stretches.net5.start ? fmtDate(new Date(stretches.net5.start)) : "—"} → ${
                              stretches.net5.end ? fmtDate(new Date(stretches.net5.end)) : "—"
                            }`
                          : "—"
                      }
                      value={stretches.net5 ? fmtSigned(stretches.net5.avg) : "—"}
                    />
                  </div>
                </div>
              </div>

              {/* Firsts */}
              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
                <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">Firsts</div>
                <div className="mt-1 text-[12px] text-emerald-100/70 font-semibold">
                  A few “first time” highlights (gross events).
                </div>

                <div className="mt-3 space-y-2">
                  <MilestoneRow
                    title="First round recorded"
                    value={firsts.firstRound?.played_at ? fmtDate(new Date(firsts.firstRound.played_at)) : "—"}
                    onClick={() => goRound(router, firsts.firstRound?.round_id)}
                  />

                  <MilestoneRow
                    title="First birdie"
                    subtitle="Any round with 1+ birdies"
                    value={firsts.firstBirdieRound?.played_at ? fmtDate(new Date(firsts.firstBirdieRound.played_at)) : "—"}
                    onClick={() => goRound(router, firsts.firstBirdieRound?.round_id)}
                  />
                  <MilestoneRow
                    title="First eagle"
                    subtitle="Any round with 1+ eagles"
                    value={firsts.firstEagleRound?.played_at ? fmtDate(new Date(firsts.firstEagleRound.played_at)) : "—"}
                    onClick={() => goRound(router, firsts.firstEagleRound?.round_id)}
                  />
                  <MilestoneRow
                    title="First albatross"
                    subtitle="Any round with 1+ albatrosses"
                    value={firsts.firstAlbatrossRound?.played_at ? fmtDate(new Date(firsts.firstAlbatrossRound.played_at)) : "—"}
                    onClick={() => goRound(router, firsts.firstAlbatrossRound?.round_id)}
                  />
                  <MilestoneRow
                    title="First hole-in-one"
                    subtitle="Any round with a hole-in-one"
                    value={firsts.firstHioRound?.played_at ? fmtDate(new Date(firsts.firstHioRound.played_at)) : "—"}
                    onClick={() => goRound(router, firsts.firstHioRound?.round_id)}
                  />

                  <div className="pt-2 text-[11px] uppercase tracking-[0.14em] text-emerald-100/60 font-bold">
                    Round milestones
                  </div>

                  <MilestoneRow
                    title="First 3+ birdies in a round"
                    value={firsts.first3Birdies?.played_at ? fmtDate(new Date(firsts.first3Birdies.played_at)) : "—"}
                    onClick={() => goRound(router, firsts.first3Birdies?.round_id)}
                  />
                  <MilestoneRow
                    title="First 5+ birdies in a round"
                    value={firsts.first5Birdies?.played_at ? fmtDate(new Date(firsts.first5Birdies.played_at)) : "—"}
                    onClick={() => goRound(router, firsts.first5Birdies?.round_id)}
                  />

                  <div className="pt-2 text-[11px] uppercase tracking-[0.14em] text-emerald-100/60 font-bold">
                    Career totals milestones
                  </div>

                  <MilestoneRow
                    title="Reached 100 birdies"
                    subtitle="Cumulative (gross)"
                    value={firsts.hit100Birdies?.played_at ? fmtDate(new Date(firsts.hit100Birdies.played_at)) : "—"}
                    onClick={() => goRound(router, firsts.hit100Birdies?.round_id)}
                  />
                  <MilestoneRow
                    title="Reached 25 eagles"
                    subtitle="Cumulative (gross)"
                    value={firsts.hit25Eagles?.played_at ? fmtDate(new Date(firsts.hit25Eagles.played_at)) : "—"}
                    onClick={() => goRound(router, firsts.hit25Eagles?.round_id)}
                  />
                </div>
              </div>

              {/* Goals (gross) */}
              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
                <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 font-bold">Goals</div>
                <div className="mt-1 text-[12px] text-emerald-100/70 font-semibold">
                  Counts in this range (gross).
                </div>

                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/40 p-3">
                    <div className="text-[11px] text-emerald-100/70 font-bold">Rounds</div>
                    <div className="text-lg font-extrabold tabular-nums text-emerald-50">{goals.rounds}</div>
                  </div>

                  <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/40 p-3">
                    <div className="text-[11px] text-emerald-100/70 font-bold">Par or better</div>
                    <div className="text-lg font-extrabold tabular-nums text-[#f5e6b0]">{goals.parOrBetter18eq}</div>
                    <div className="text-[11px] text-emerald-100/60 font-semibold">18-eq</div>
                  </div>

                  <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/40 p-3">
                    <div className="text-[11px] text-emerald-100/70 font-bold">Break 100</div>
                    <div className="text-lg font-extrabold tabular-nums text-emerald-50">{goals.break100}</div>
                    <div className="text-[11px] text-emerald-100/60 font-semibold">18 holes</div>
                  </div>

                  <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/40 p-3">
                    <div className="text-[11px] text-emerald-100/70 font-bold">Break 90</div>
                    <div className="text-lg font-extrabold tabular-nums text-emerald-50">{goals.break90}</div>
                    <div className="text-[11px] text-emerald-100/60 font-semibold">18 holes</div>
                  </div>

                  <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/40 p-3">
                    <div className="text-[11px] text-emerald-100/70 font-bold">Break 80</div>
                    <div className="text-lg font-extrabold tabular-nums text-emerald-50">{goals.break80}</div>
                    <div className="text-[11px] text-emerald-100/60 font-semibold">18 holes</div>
                  </div>

                  <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/40 p-3">
                    <div className="text-[11px] text-emerald-100/70 font-bold">Birdie rounds</div>
                    <div className="text-lg font-extrabold tabular-nums text-emerald-50">{goals.birdieRounds}</div>
                    <div className="text-[11px] text-emerald-100/60 font-semibold">1+ birdies</div>
                  </div>

                  <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/40 p-3">
                    <div className="text-[11px] text-emerald-100/70 font-bold">Eagle rounds</div>
                    <div className="text-lg font-extrabold tabular-nums text-emerald-50">{goals.eagleRounds}</div>
                    <div className="text-[11px] text-emerald-100/60 font-semibold">1+ eagles</div>
                  </div>

                  <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/40 p-3">
                    <div className="text-[11px] text-emerald-100/70 font-bold">HOI rounds</div>
                    <div className="text-lg font-extrabold tabular-nums text-emerald-50">{goals.hioRounds}</div>
                    <div className="text-[11px] text-emerald-100/60 font-semibold">1+ HOI</div>
                  </div>
                </div>
              </div>

              <div className="h-4" />
            </div>
          )}
        </div>

        {/* Consistency info modal */}
        {showConsistencyHelp ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center px-4"
            role="dialog"
            aria-modal="true"
            onClick={() => setShowConsistencyHelp(false)}
          >
            <div className="absolute inset-0 bg-black/60" />

            <div
              className="relative w-full max-w-sm rounded-2xl border border-emerald-900/70 bg-[#0b3b21] p-4 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-extrabold text-emerald-50">Consistency guide</div>
                  <div className="mt-1 text-[12px] text-emerald-100/70 font-semibold">
                    Lower = steadier round-to-round scores.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowConsistencyHelp(false)}
                  className="rounded-xl border border-emerald-900/70 bg-[#042713]/40 px-3 py-1 text-[12px] font-extrabold text-emerald-50 hover:bg-emerald-900/20"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="mt-3 space-y-2 text-[13px] font-semibold text-emerald-50">
                <div>
                  <span className="text-[#f5e6b0] font-extrabold">0–2</span>: extremely steady (rare)
                </div>
                <div>
                  <span className="text-[#f5e6b0] font-extrabold">2–4</span>: very consistent
                </div>
                <div>
                  <span className="text-[#f5e6b0] font-extrabold">4–6</span>: pretty normal / solid consistency
                </div>
                <div>
                  <span className="text-[#f5e6b0] font-extrabold">6–8</span>: variable (good days + blowups)
                </div>
                <div>
                  <span className="text-[#f5e6b0] font-extrabold">8+</span>: very streaky / high volatility
                </div>
              </div>

              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setShowConsistencyHelp(false)}
                  className="w-full rounded-2xl border border-[#f5e6b0]/60 bg-[#042713]/70 px-3 py-2 text-[13px] font-extrabold text-[#f5e6b0] hover:bg-emerald-900/20"
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
