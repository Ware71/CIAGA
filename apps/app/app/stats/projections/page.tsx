// app/stats/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/BackButton";

import type { HiPoint } from "@/lib/stats/timeModel";
import {
  addDays,
  clamp,
  daysBetween,
  fitExpBestFloor,
  fmtDM,
  iso,
  round1,
  sampleCurve,
  solveExpTimeToTarget,
  findNextInterceptT,
  rSquared,
  residualSigma,
  trendVelocity,
  recentSlope,
} from "@/lib/stats/timeModel";

import type { FollowProfile } from "@/lib/stats/data";
import { getHandicapHistoryPoints, getFollowedProfiles } from "@/lib/stats/data";
import { formatHI } from "@/lib/rounds/handicapUtils";

import { Modal } from "@/components/stats/Modal";
import { Wheel } from "@/components/stats/Wheel";
import { ZoomPanChart } from "@/components/stats/ZoomPanChart";

type EtaStatus = "insufficient" | "reached" | "unreachable" | "unknown" | "estimated";

// -----------------------------
// Config (Time-only)
// -----------------------------
const TIME_FUTURE_DAYS = 60;
const RECENCY_DECAY = 0.006; // half-weight ≈ 116 days back (chart trend only)

const FLOOR_VELOCITY_THRESHOLD = 0.2; // HI/month — below this is negligible improvement
const INTERCEPT_MAX_DAYS_AHEAD = 3650; // 10y
const ME = "__me__";

type Lookback = "90d" | "180d" | "1y" | "all";
const LOOKBACK_DAYS: Record<Lookback, number> = { "90d": 90, "180d": 180, "1y": 365, all: Infinity };
const LOOKBACK_LABELS: Record<Lookback, string> = { "90d": "90d", "180d": "180d", "1y": "1yr", all: "All" };

// -----------------------------
// Page
// -----------------------------
export default function StatsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [myPoints, setMyPoints] = useState<HiPoint[]>([]);
  const [followList, setFollowList] = useState<FollowProfile[]>([]);

  const [compareAId, setCompareAId] = useState<string>(ME);
  const [compareBId, setCompareBId] = useState<string>("");
  const [advancedCompare, setAdvancedCompare] = useState(false);

  const [aPoints, setAPoints] = useState<HiPoint[]>([]);
  const [bPoints, setBPoints] = useState<HiPoint[]>([]);
  const [aLoading, setALoading] = useState(false);
  const [bLoading, setBLoading] = useState(false);

  // Goal (wheel modal)
  const targetValues = useMemo(() => {
    const out: number[] = [];
    for (let i = -54; i <= 540; i++) out.push(Math.round(i) / 10);
    return out;
  }, []);
  const [target, setTarget] = useState<number>(18.0);
  const [goalWheelOpen, setGoalWheelOpen] = useState(false);

  const [lookback, setLookback] = useState<Lookback>("180d");

  // Projection date + compare-all modal
  const [projDateISO, setProjDateISO] = useState<string>(() => iso(addDays(new Date(), 30)));

  // Compare-all modals
  const [goalCompareOpen, setGoalCompareOpen] = useState(false);
  const [projCompareOpen, setProjCompareOpen] = useState(false);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setErr(null);

      try {
        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;

        const user = (authData.user as any) ?? null;
        if (!user) {
          if (!alive) return;
          setErr("You must be signed in to view stats.");
          setLoading(false);
          return;
        }

        const pid = await getMyProfileIdByAuthUserId(user.id);
        if (!alive) return;

        // My history
        const myPts = await getHandicapHistoryPoints(pid);
        if (!alive) return;
        setMyPoints(myPts);

        // Following list
        const profs = await getFollowedProfiles(pid);
        if (!alive) return;
        setFollowList(profs);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Failed to load stats");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!advancedCompare) setCompareAId(ME);
  }, [advancedCompare]);

  async function fetchPoints(profileId: string): Promise<HiPoint[]> {
    if (profileId === ME) return myPoints;
    return await getHandicapHistoryPoints(profileId);
  }

  useEffect(() => {
    let alive = true;

    (async () => {
      if (!compareAId) {
        setAPoints([]);
        return;
      }
      setALoading(true);
      try {
        const pts = await fetchPoints(compareAId);
        if (!alive) return;
        setAPoints(pts);
      } catch {
        if (!alive) return;
        setAPoints([]);
      } finally {
        if (!alive) return;
        setALoading(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareAId, myPoints]);

  useEffect(() => {
    let alive = true;

    (async () => {
      if (!compareBId) {
        setBPoints([]);
        return;
      }
      setBLoading(true);
      try {
        const pts = await fetchPoints(compareBId);
        if (!alive) return;
        setBPoints(pts);
      } catch {
        if (!alive) return;
        setBPoints([]);
      } finally {
        if (!alive) return;
        setBLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareBId, myPoints]);

  const compareActive = Boolean(compareBId);

  const allOptions: FollowProfile[] = useMemo(() => {
    return [{ id: ME, name: "You", avatar_url: null }, ...followList];
  }, [followList]);

  const nameOf = (id: string) => {
    if (id === ME) return "You";
    const p = followList.find((x) => x.id === id);
    return p?.name ?? id.slice(0, 8);
  };

  // Professional helper: target reach status
  function etaForTarget(fit: ReturnType<typeof fitExpBestFloor> | null, today: Date, targetHi: number) {
    if (!fit)
      return {
        status: "insufficient" as EtaStatus,
        days: null as number | null,
        dateISO: null as string | null,
        note: "Not enough data",
      };

    const tToday = daysBetween(fit.firstDate, today);
    const vToday = fit.predict(tToday);

    // already at/better than target
    if (Number.isFinite(vToday) && vToday <= targetHi) {
      return { status: "reached" as EtaStatus, days: 0, dateISO: iso(today), note: "Already at or below target" };
    }

    // unreachable due to asymptote
    if (targetHi <= fit.c) {
      return {
        status: "unreachable" as EtaStatus,
        days: null,
        dateISO: null,
        note: `Below model floor (≈ ${round1(fit.c)}). Choose a higher target.`,
      };
    }

    const tHit = solveExpTimeToTarget({ a: fit.a, b: fit.b, c: fit.c }, targetHi);
    if (tHit === null) {
      return { status: "unknown" as EtaStatus, days: null, dateISO: null, note: "Unable to estimate" };
    }

    const hitDate = addDays(fit.firstDate, tHit);
    const d = Math.ceil(daysBetween(today, hitDate));
    return { status: "estimated" as EtaStatus, days: Math.max(0, d), dateISO: iso(hitDate), note: "" };
  }

  // Projection by date
  function projectedOnDate(fit: ReturnType<typeof fitExpBestFloor> | null, dateISOstr: string) {
    if (!fit) return null;
    const d = new Date(dateISOstr);
    const t = daysBetween(fit.firstDate, d);
    const v = fit.predict(t);
    return Number.isFinite(v) ? round1(v) : null;
  }

  const computed = useMemo(() => {
    const today = new Date();
    const lookbackDays = LOOKBACK_DAYS[lookback];
    const lookbackCutoff = Number.isFinite(lookbackDays) ? addDays(today, -lookbackDays) : null;

    const filterByLookback = (pts: HiPoint[]) =>
      lookbackCutoff ? pts.filter((p) => new Date(p.date) >= lookbackCutoff!) : pts;

    const tOf = (p: HiPoint, _idx: number, fd: Date) => daysBetween(fd, new Date(p.date));

    // Full history (all data) — used for goal/projection/floor/intercept
    const aAllSorted = [...(compareAId ? aPoints : [])].sort((x, y) => x.date.localeCompare(y.date));
    const bAllSorted = [...(compareBId ? bPoints : [])].sort((x, y) => x.date.localeCompare(y.date));

    // Lookback-filtered — used for chart trend fit + trend metrics only
    const aSorted = filterByLookback(aAllSorted);
    const bSorted = filterByLookback(bAllSorted);

    const aN = aSorted.length;
    const bN = bSorted.length;
    const aAllN = aAllSorted.length;
    const bAllN = bAllSorted.length;

    const aLast = aAllN ? aAllSorted[aAllN - 1] : null;
    const bLast = bAllN ? bAllSorted[bAllN - 1] : null;

    // Chart trend fit: lookback-filtered + mild recency weight (shows recent form)
    const aFit = aN >= 4 ? fitExpBestFloor(aSorted, tOf, { weightDecayPerDay: RECENCY_DECAY }) : null;
    const bFit = bN >= 4 ? fitExpBestFloor(bSorted, tOf, { weightDecayPerDay: RECENCY_DECAY }) : null;

    // Full fit: all data, no weighting (stable long-term prediction)
    const aFitFull = aAllN >= 4 ? fitExpBestFloor(aAllSorted, tOf) : null;
    const bFitFull = bAllN >= 4 ? fitExpBestFloor(bAllSorted, tOf) : null;

    // Chart window anchored to full history (always show all actual dots)
    const allDates = [
      ...(aAllSorted.length ? [new Date(aAllSorted[0].date)] : []),
      ...(bAllSorted.length ? [new Date(bAllSorted[0].date)] : []),
    ];
    const earliestDate = allDates.length
      ? allDates.reduce((a, b) => (a < b ? a : b))
      : addDays(today, -180);
    const windowStart = earliestDate;
    const windowEnd = addDays(today, TIME_FUTURE_DAYS);
    const anchor = windowStart;

    const absStart = 0;
    const absEnd = daysBetween(anchor, windowEnd);
    const todayAbs = clamp(daysBetween(anchor, today), absStart, absEnd);

    // Chart dots use full history
    const aActual = aAllSorted
      .map((p) => ({ t: daysBetween(anchor, new Date(p.date)), v: p.hi }))
      .filter((p) => p.t >= absStart && p.t <= absEnd);

    const bActual = bAllSorted
      .map((p) => ({ t: daysBetween(anchor, new Date(p.date)), v: p.hi }))
      .filter((p) => p.t >= absStart && p.t <= absEnd);

    // Trend line uses recent fit (lookback window)
    const aPredictAbs = (tAbs: number) => {
      if (!aFit) return NaN;
      const date = addDays(anchor, tAbs);
      const mt = daysBetween(aFit.firstDate, date);
      return aFit.predict(mt);
    };
    const bPredictAbs = (tAbs: number) => {
      if (!bFit) return NaN;
      const date = addDays(anchor, tAbs);
      const mt = daysBetween(bFit.firstDate, date);
      return bFit.predict(mt);
    };

    // Full-fit predict functions for goal/projection/intercept
    const aPredictAbsFull = (tAbs: number) => {
      if (!aFitFull) return NaN;
      const date = addDays(anchor, tAbs);
      const mt = daysBetween(aFitFull.firstDate, date);
      return aFitFull.predict(mt);
    };
    const bPredictAbsFull = (tAbs: number) => {
      if (!bFitFull) return NaN;
      const date = addDays(anchor, tAbs);
      const mt = daysBetween(bFitFull.firstDate, date);
      return bFitFull.predict(mt);
    };

    const aTrend = aFit && aN >= 2 ? sampleCurve((tAbs) => aPredictAbs(tAbs), absStart, absEnd, 260) : undefined;
    const aProj = aFit && aN >= 2 ? sampleCurve((tAbs) => aPredictAbs(tAbs), todayAbs, absEnd, 140) : undefined;

    const bTrend = bFit && bN >= 2 ? sampleCurve((tAbs) => bPredictAbs(tAbs), absStart, absEnd, 260) : undefined;
    const bProj = bFit && bN >= 2 ? sampleCurve((tAbs) => bPredictAbs(tAbs), todayAbs, absEnd, 140) : undefined;

    // Confidence bands (±1σ) on projection — from chart trend fit
    const aSigma = aFit ? residualSigma(aSorted, aFit.predict, tOf) : null;
    const bSigma = bFit ? residualSigma(bSorted, bFit.predict, tOf) : null;

    const aProjBand =
      aFit && aN >= 2 && aSigma !== null
        ? {
            upper: sampleCurve((tAbs) => aPredictAbs(tAbs) - aSigma, todayAbs, absEnd, 80),
            lower: sampleCurve((tAbs) => aPredictAbs(tAbs) + aSigma, todayAbs, absEnd, 80),
          }
        : undefined;
    const bProjBand =
      bFit && bN >= 2 && bSigma !== null
        ? {
            upper: sampleCurve((tAbs) => bPredictAbs(tAbs) - bSigma, todayAbs, absEnd, 80),
            lower: sampleCurve((tAbs) => bPredictAbs(tAbs) + bSigma, todayAbs, absEnd, 80),
          }
        : undefined;

    // Trend metrics — from chart fit (recent form)
    const aR2 = aFit ? rSquared(aSorted, aFit.predict, tOf) : null;
    const bR2 = bFit ? rSquared(bSorted, bFit.predict, tOf) : null;

    const aVelocityPerMonth = aFit ? trendVelocity(aFit, daysBetween(aFit.firstDate, today)) * 30 : null;
    const bVelocityPerMonth = bFit ? trendVelocity(bFit, daysBetween(bFit.firstDate, today)) * 30 : null;

    const directionLabel = (slopePerMonth: number | null): "Improving" | "Plateauing" | "Worsening" | null => {
      if (slopePerMonth === null) return null;
      if (slopePerMonth < -0.05) return "Improving";
      if (slopePerMonth > 0.05) return "Worsening";
      return "Plateauing";
    };
    const aSlopePerMonth = recentSlope(aSorted, 60);
    const bSlopePerMonth = recentSlope(bSorted, 60);
    const aDirection = directionLabel(aSlopePerMonth !== null ? aSlopePerMonth * 30 : null);
    const bDirection = directionLabel(bSlopePerMonth !== null ? bSlopePerMonth * 30 : null);

    // Potential floor — from full fit, using velocity threshold
    const potentialFloor = (fit: ReturnType<typeof fitExpBestFloor> | null) => {
      if (!fit) return { value: null as number | null, etaISO: null as string | null, note: "Not enough data" };

      const tToday = daysBetween(fit.firstDate, today);
      const tSlow = fit.slowdownT(FLOOR_VELOCITY_THRESHOLD);

      if (tSlow === null || tSlow <= tToday) {
        // Already improving slower than threshold — currently near floor
        const floorValue = round1(Math.max(fit.predict(tToday), fit.c));
        return { value: floorValue, etaISO: null as string | null, note: "Near floor" };
      }

      const floorValue = round1(fit.predict(tSlow));
      const floorDate = addDays(fit.firstDate, tSlow);
      return { value: floorValue, etaISO: iso(floorDate), note: "" };
    };

    const aPF = potentialFloor(aFitFull);
    const bPF = potentialFloor(bFitFull);

    // Goal ETA + projected HI — from full fit
    const aTargetEta = etaForTarget(aFitFull, today, target);
    const bTargetEta = etaForTarget(bFitFull, today, target);

    const projA = projectedOnDate(aFitFull, projDateISO);
    const projB = compareBId ? projectedOnDate(bFitFull, projDateISO) : null;

    // Intercept — from full fit
    let nextInterceptLabel: string | null = null;
    let interceptMarker: { t: number; aV: number; bV: number } | undefined = undefined;

    if (compareAId && compareBId && aFitFull && bFitFull) {
      const searchStart = todayAbs;
      const searchEnd = todayAbs + INTERCEPT_MAX_DAYS_AHEAD;
      const tHit = findNextInterceptT(aPredictAbsFull, bPredictAbsFull, searchStart, searchEnd, 1600);

      if (tHit !== null) {
        const date = addDays(anchor, tHit);
        const daysFromToday = Math.round(daysBetween(today, date));
        const aVAt = aPredictAbsFull(tHit);
        const bVAt = bPredictAbsFull(tHit);
        const atHi = Number.isFinite(aVAt) && Number.isFinite(bVAt) ? `HI ${formatHI(aVAt)}` : "";
        nextInterceptLabel = `${iso(date)} (${daysFromToday >= 0 ? "in " : ""}${daysFromToday}d) ${atHi}`;

        if (tHit >= absStart && tHit <= absEnd) {
          if (Number.isFinite(aVAt) && Number.isFinite(bVAt)) interceptMarker = { t: tHit, aV: aVAt, bV: bVAt };
        }
      } else {
        nextInterceptLabel = `No crossing found in next ${INTERCEPT_MAX_DAYS_AHEAD} days`;
      }
    }

    return {
      windowLabel: `${iso(windowStart)} → ${iso(windowEnd)}`,
      names: { a: compareAId ? nameOf(compareAId) : "—", b: compareBId ? nameOf(compareBId) : "—" },
      counts: { aN, bN, aAllN, bAllN },
      last: { aLast, bLast },
      series: { aActual, aTrend, aProj, bActual, bTrend, bProj },
      bands: { aProjBand, bProjBand },
      interceptMarker,
      nextInterceptLabel,
      potentialFloor: { a: aPF, b: bPF },
      goalEta: { a: aTargetEta, b: bTargetEta },
      projByDate: { a: projA, b: projB },
      fits: { aFit, bFit },
      metrics: {
        aR2, bR2,
        aVelocityPerMonth, bVelocityPerMonth,
        aDirection, bDirection,
      },
    };
  }, [aPoints, bPoints, compareAId, compareBId, projDateISO, target, followList, myPoints, lookback]);

  // Compare-all datasets
  const [allCompareLoading, setAllCompareLoading] = useState(false);
  const [allGoalRows, setAllGoalRows] = useState<
    { id: string; name: string; hiNow: number | null; etaISO: string | null; days: number | null; status: string; note: string }[]
  >([]);
  const [allProjRows, setAllProjRows] = useState<{ id: string; name: string; hiNow: number | null; proj: number | null; note: string }[]>([]);

  const loadAllForGoal = async () => {
    setAllCompareLoading(true);
    try {
      const today = new Date();
      const pool = [{ id: ME, name: "You" }, ...followList.map((p) => ({ id: p.id, name: p.name ?? p.id.slice(0, 8) }))];

      const rows = await Promise.all(
        pool.map(async (p) => {
          const pts = p.id === ME ? myPoints : await fetchPoints(p.id);
          const sorted = [...pts].sort((a, b) => a.date.localeCompare(b.date));
          const n = sorted.length;
          const last = n ? sorted[n - 1].hi : null;
          const fit = n ? fitExpBestFloor(sorted, (pt, _i, fd) => daysBetween(fd, new Date(pt.date))) : null;
          const eta = etaForTarget(fit, today, target);
          return {
            id: p.id,
            name: p.name,
            hiNow: last !== null ? round1(last) : null,
            etaISO: eta.dateISO,
            days: eta.days,
            status: eta.status,
            note: eta.note,
          };
        })
      );

      const rank = (r: typeof rows[number]) => {
        if (r.status === "reached") return 0;
        if (r.status === "estimated") return 1;
        if (r.status === "unreachable") return 2;
        return 3;
      };

      rows.sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        if (ra !== rb) return ra - rb;
        const da = a.days ?? 1e9;
        const db = b.days ?? 1e9;
        return da - db;
      });

      setAllGoalRows(rows);
    } finally {
      setAllCompareLoading(false);
    }
  };

  const loadAllForProjection = async () => {
    setAllCompareLoading(true);
    try {
      const pool = [{ id: ME, name: "You" }, ...followList.map((p) => ({ id: p.id, name: p.name ?? p.id.slice(0, 8) }))];

      const rows = await Promise.all(
        pool.map(async (p) => {
          const pts = p.id === ME ? myPoints : await fetchPoints(p.id);
          const sorted = [...pts].sort((a, b) => a.date.localeCompare(b.date));
          const n = sorted.length;
          const last = n ? sorted[n - 1].hi : null;
          const fit = n ? fitExpBestFloor(sorted, (pt, _i, fd) => daysBetween(fd, new Date(pt.date))) : null;
          const proj = projectedOnDate(fit, projDateISO);
          return {
            id: p.id,
            name: p.name,
            hiNow: last !== null ? round1(last) : null,
            proj,
            note: fit ? "" : "Not enough data",
          };
        })
      );

      rows.sort((a, b) => {
        const va = a.proj ?? 1e9;
        const vb = b.proj ?? 1e9;
        if (va !== vb) return va - vb;
        return a.name.localeCompare(b.name);
      });

      setAllProjRows(rows);
    } finally {
      setAllCompareLoading(false);
    }
  };

  const timeXLabel = (tAbsDays: number) => {
    const lookbackDays = LOOKBACK_DAYS[lookback];
    const anchor = addDays(new Date(), -(Number.isFinite(lookbackDays) ? lookbackDays : 365));
    const d = addDays(anchor, tAbsDays);
    return fmtDM(d);
  };

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-6">
        {/* Header (centered, back is absolute so title stays centered) */}
        <header className="relative flex items-center justify-center">
          <BackButton
            className="absolute left-0 font-semibold"
            onClick={() => router.back()}
          />

          <div className="text-center">
            <div className="text-lg font-extrabold tracking-wide text-[#f5e6b0]">Stats</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70 font-semibold">Projections</div>
          </div>
        </header>

        {/* Main tile */}
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5 space-y-5">
          {/* Compare */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-emerald-50">Comparison</div>
                <div className="text-[11px] text-emerald-100/55 font-semibold">Optional</div>
              </div>

              {compareActive ? (
                <button
                  type="button"
                  onClick={() => {
                    setCompareBId("");
                    setAdvancedCompare(false);
                    setCompareAId(ME);
                  }}
                  className="text-[11px] font-bold text-emerald-100/80 hover:text-emerald-50"
                >
                  Clear
                </button>
              ) : null}
            </div>

            <div className="flex items-center gap-3">
              <div className="text-xs text-emerald-100/70 w-[70px] font-semibold">Compare</div>
              <select
                value={compareBId}
                onChange={(e) => setCompareBId(e.target.value)}
                className="h-10 flex-1 rounded-xl border border-emerald-900/70 bg-[#042713] px-3 text-sm font-semibold text-emerald-50 outline-none focus:border-[#f5e6b0]/70"
              >
                <option value="">None</option>
                {followList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name ?? p.id.slice(0, 8)}
                  </option>
                ))}
              </select>
              {bLoading ? <div className="text-[11px] text-emerald-100/60 font-semibold">Loading…</div> : null}
            </div>

            {compareActive ? (
              <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] text-emerald-100/70 font-semibold">Select any two players</div>
                  <button type="button" onClick={() => setAdvancedCompare((v) => !v)} className="text-[11px] font-bold text-[#f5e6b0]">
                    {advancedCompare ? "On" : "Off"}
                  </button>
                </div>

                {advancedCompare ? (
                  <div className="flex items-center gap-3">
                    <div className="text-xs text-emerald-100/70 w-[70px] font-semibold">Player A</div>
                    <select
                      value={compareAId}
                      onChange={(e) => setCompareAId(e.target.value)}
                      className="h-10 flex-1 rounded-xl border border-emerald-900/70 bg-[#042713] px-3 text-sm font-semibold text-emerald-50 outline-none focus:border-[#f5e6b0]/70"
                    >
                      {allOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name ?? p.id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                    {aLoading ? <div className="text-[11px] text-emerald-100/60 font-semibold">Loading…</div> : null}
                  </div>
                ) : (
                  <div className="text-[11px] text-emerald-100/60 font-semibold">Player A fixed to you</div>
                )}
              </div>
            ) : null}

            {/* Current HI */}
            {compareActive ? (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-3">
                  <div className="text-[11px] text-emerald-100/70 font-semibold">{computed.names.a}</div>
                  <div className="mt-1 text-sm font-extrabold text-emerald-50 tabular-nums">
                    HI {computed.last.aLast ? formatHI(computed.last.aLast.hi) : "—"}
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-3">
                  <div className="text-[11px] text-emerald-100/70 font-semibold">{computed.names.b}</div>
                  <div className="mt-1 text-sm font-extrabold text-emerald-50 tabular-nums">
                    HI {computed.last.bLast ? formatHI(computed.last.bLast.hi) : "—"}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-3">
                <div className="text-[11px] text-emerald-100/70 font-semibold">You</div>
                <div className="mt-1 text-sm font-extrabold text-emerald-50 tabular-nums">
                  HI {computed.last.aLast ? formatHI(computed.last.aLast.hi) : "—"}
                </div>
              </div>
            )}
          </div>

          {/* Chart */}
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-extrabold text-emerald-50">Trajectory</div>
                <div className="text-[11px] text-emerald-100/55 font-semibold">{computed.windowLabel}</div>
              </div>
              {compareActive && computed.nextInterceptLabel ? (
                <div className="text-[11px] font-bold text-[#f5e6b0] text-right leading-tight">{computed.nextInterceptLabel}</div>
              ) : null}
            </div>

            {/* Lookback selector */}
            <div className="flex items-center gap-1.5">
              {(["90d", "180d", "1y", "all"] as Lookback[]).map((lb) => (
                <button
                  key={lb}
                  type="button"
                  onClick={() => setLookback(lb)}
                  className={`h-7 px-3 rounded-full text-[11px] font-bold transition-colors ${
                    lookback === lb
                      ? "bg-emerald-700/80 text-emerald-50"
                      : "bg-[#042713] border border-emerald-900/70 text-emerald-100/60 hover:text-emerald-50"
                  }`}
                >
                  {LOOKBACK_LABELS[lb]}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="h-[340px] flex items-center justify-center text-sm font-semibold text-emerald-100/70 rounded-2xl border border-emerald-900/70 bg-[#042713]/55">
                Loading…
              </div>
            ) : err ? (
              <div className="h-[340px] flex items-center justify-center text-sm font-semibold text-red-300 rounded-2xl border border-emerald-900/70 bg-[#042713]/55">
                {err}
              </div>
            ) : computed.counts.aAllN < 2 ? (
              <div className="h-[340px] flex items-center justify-center text-sm font-semibold text-emerald-100/70 rounded-2xl border border-emerald-900/70 bg-[#042713]/55">
                Play a couple more rounds to unlock projections.
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between text-[11px] font-bold">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-200" />
                    <span className="text-emerald-50">{computed.names.a}</span>
                  </div>
                  {compareActive ? (
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#f5e6b0]" />
                      <span className="text-emerald-50">{computed.names.b}</span>
                    </div>
                  ) : null}
                </div>

                <ZoomPanChart
                  aActual={computed.series.aActual}
                  aTrend={computed.series.aTrend}
                  aProj={computed.series.aProj}
                  bActual={compareActive ? computed.series.bActual : undefined}
                  bTrend={compareActive ? computed.series.bTrend : undefined}
                  bProj={compareActive ? computed.series.bProj : undefined}
                  aProjBand={computed.bands.aProjBand}
                  bProjBand={compareActive ? computed.bands.bProjBand : undefined}
                  intercept={compareActive ? (computed.interceptMarker as any) : undefined}
                  height={960}
                  formatXLabel={timeXLabel}
                />

                {/* Trend metrics */}
                {(() => {
                  const { aVelocityPerMonth, bVelocityPerMonth, aDirection, bDirection, aR2, bR2 } = computed.metrics;

                  const dirColor = (d: string | null) =>
                    d === "Improving" ? "text-emerald-300" : d === "Worsening" ? "text-red-300" : "text-emerald-100/60";
                  const velColor = (v: number | null) =>
                    v === null ? "" : v < 0 ? "text-emerald-300" : "text-red-300";
                  const fmtVel = (v: number | null) => {
                    if (v === null) return null;
                    const abs = Math.abs(v);
                    const sign = v < 0 ? "−" : "+";
                    return `${sign}${abs.toFixed(2)} HI/mo`;
                  };

                  if (compareActive) {
                    return (
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        {[
                          { label: computed.names.a, vel: aVelocityPerMonth, dir: aDirection, r2: aR2 },
                          { label: computed.names.b, vel: bVelocityPerMonth, dir: bDirection, r2: bR2 },
                        ].map((m) => (
                          <div key={m.label} className="rounded-xl border border-emerald-900/50 bg-[#042713]/35 p-2.5 space-y-1.5">
                            <div className="text-[10px] text-emerald-100/55 font-bold">{m.label}</div>
                            {m.dir ? (
                              <div className={`text-[11px] font-extrabold ${dirColor(m.dir)}`}>{m.dir}</div>
                            ) : null}
                            {fmtVel(m.vel) ? (
                              <div className={`text-[11px] font-bold tabular-nums ${velColor(m.vel)}`}>{fmtVel(m.vel)}</div>
                            ) : null}
                            {m.r2 !== null ? (
                              <div className="text-[10px] text-emerald-100/45 font-semibold">R²={m.r2.toFixed(2)}</div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    );
                  }

                  return (
                    <div className="flex items-center gap-4 pt-1 px-1">
                      {aDirection ? (
                        <span className={`text-[11px] font-extrabold ${dirColor(aDirection)}`}>{aDirection}</span>
                      ) : null}
                      {fmtVel(aVelocityPerMonth) ? (
                        <span className={`text-[11px] font-bold tabular-nums ${velColor(aVelocityPerMonth)}`}>{fmtVel(aVelocityPerMonth)}</span>
                      ) : null}
                      {aR2 !== null ? (
                        <span className="text-[10px] text-emerald-100/45 font-semibold ml-auto">R²={aR2.toFixed(2)}</span>
                      ) : null}
                    </div>
                  );
                })()}
              </>
            )}
          </div>

          {/* Goal */}
          <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-extrabold text-emerald-50">Goal</div>
                <div className="text-[11px] text-emerald-100/55 font-semibold">Estimate when each player reaches a target HI</div>
              </div>
              <Button
                size="sm"
                className="h-9 px-3 bg-transparent border border-emerald-900/70 text-emerald-100 hover:bg-emerald-900/30 font-semibold"
                onClick={async () => {
                  setGoalCompareOpen(true);
                  await loadAllForGoal();
                }}
              >
                Compare all
              </Button>
            </div>

            {/* Input that opens wheel */}
            <div className="flex items-center gap-3">
              <div className="text-xs text-emerald-100/70 w-[70px] font-semibold">Target</div>
              <button
                type="button"
                onClick={() => setGoalWheelOpen(true)}
                className="h-10 flex-1 rounded-xl border border-emerald-900/70 bg-[#042713] px-3 text-left text-sm font-extrabold text-emerald-50 outline-none focus:border-[#f5e6b0]/70"
              >
                HI {target.toFixed(1)}
              </button>
            </div>

            {compareActive ? (
              <div className="grid grid-cols-2 gap-3">
                {[{ key: "a" as const, label: computed.names.a }, { key: "b" as const, label: computed.names.b }].map((p) => {
                  const eta = computed.goalEta[p.key];
                  return (
                    <div key={p.key} className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                      <div className="text-[11px] text-emerald-100/70 font-bold">{p.label}</div>
                      <div className="mt-2 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm text-emerald-50 font-semibold">ETA</div>
                          <div className="text-sm font-extrabold text-emerald-50 tabular-nums">{eta.dateISO ?? "—"}</div>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="text-sm text-emerald-50 font-semibold">Days</div>
                          <div className="text-sm font-extrabold text-emerald-50 tabular-nums">{eta.days !== null ? `${eta.days}` : "—"}</div>
                        </div>
                        {eta.note ? <div className="text-[10px] text-emerald-100/55 font-semibold">{eta.note}</div> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                <div className="text-[11px] text-emerald-100/70 font-bold">You</div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-sm text-emerald-50 font-semibold">ETA</div>
                  <div className="text-sm font-extrabold text-emerald-50 tabular-nums">{computed.goalEta.a.dateISO ?? "—"}</div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-sm text-emerald-50 font-semibold">Days</div>
                  <div className="text-sm font-extrabold text-emerald-50 tabular-nums">
                    {computed.goalEta.a.days !== null ? `${computed.goalEta.a.days}` : "—"}
                  </div>
                </div>
                {computed.goalEta.a.note ? <div className="mt-2 text-[10px] text-emerald-100/55 font-semibold">{computed.goalEta.a.note}</div> : null}
              </div>
            )}
          </div>

          {/* Projection by date */}
          <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-extrabold text-emerald-50">Projected HI</div>
                <div className="text-[11px] text-emerald-100/55 font-semibold">Estimate HI for a selected date</div>
              </div>
              <Button
                size="sm"
                className="h-9 px-3 bg-transparent border border-emerald-900/70 text-emerald-100 hover:bg-emerald-900/30 font-semibold"
                onClick={async () => {
                  setProjCompareOpen(true);
                  await loadAllForProjection();
                }}
              >
                Compare all
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-xs text-emerald-100/70 w-[70px] font-semibold">Date</div>
              <input
                type="date"
                value={projDateISO}
                onChange={(e) => setProjDateISO(e.target.value)}
                className="h-10 flex-1 rounded-xl border border-emerald-900/70 bg-[#042713] px-3 text-sm font-semibold text-emerald-50 outline-none focus:border-[#f5e6b0]/70"
              />
            </div>

            {compareActive ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                  <div className="text-[11px] text-emerald-100/70 font-bold">{computed.names.a}</div>
                  <div className="mt-1 text-base font-extrabold text-emerald-50 tabular-nums">
                    {computed.projByDate.a !== null ? `HI ${computed.projByDate.a}` : "—"}
                  </div>
                </div>
                <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                  <div className="text-[11px] text-emerald-100/70 font-bold">{computed.names.b}</div>
                  <div className="mt-1 text-base font-extrabold text-emerald-50 tabular-nums">
                    {computed.projByDate.b !== null ? `HI ${computed.projByDate.b}` : "—"}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                <div className="text-[11px] text-emerald-100/70 font-bold">You</div>
                <div className="mt-1 text-base font-extrabold text-emerald-50 tabular-nums">
                  {computed.projByDate.a !== null ? `HI ${computed.projByDate.a}` : "—"}
                </div>
              </div>
            )}
          </div>

          {/* Potential floor */}
          <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-4">
            <div className="text-sm font-extrabold text-emerald-50">Potential floor</div>
            <div className="mt-1 text-[11px] text-emerald-100/55 font-semibold">Est. HI when improvement &lt; {FLOOR_VELOCITY_THRESHOLD}/mo</div>

            {compareActive ? (
              <div className="mt-3 grid grid-cols-2 gap-3">
                {[{ key: "a" as const, label: computed.names.a }, { key: "b" as const, label: computed.names.b }].map((p) => {
                  const pf = computed.potentialFloor[p.key];
                  return (
                    <div key={p.key} className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                      <div className="text-[11px] text-emerald-100/70 font-bold">{p.label}</div>
                      <div className="mt-1 text-base font-extrabold text-emerald-50 tabular-nums">{pf.value ?? "—"}</div>
                      <div className="mt-1 text-[10px] text-emerald-100/55 font-semibold">
                        {pf.note ? pf.note : pf.etaISO ? `Approx. by ${pf.etaISO}` : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                <div className="text-[11px] text-emerald-100/70 font-bold">You</div>
                <div className="mt-1 text-base font-extrabold text-emerald-50 tabular-nums">{computed.potentialFloor.a.value ?? "—"}</div>
                <div className="mt-1 text-[10px] text-emerald-100/55 font-semibold">
                  {computed.potentialFloor.a.note
                    ? computed.potentialFloor.a.note
                    : computed.potentialFloor.a.etaISO
                    ? `Approx. by ${computed.potentialFloor.a.etaISO}`
                    : "—"}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="pt-1 text-[10px] text-emerald-100/50 text-center font-semibold">CIAGA · Projections (Time model)</div>
      </div>

      {/* Goal wheel modal */}
      <Modal title="Select target HI" open={goalWheelOpen} onClose={() => setGoalWheelOpen(false)}>
        <div className="text-[11px] text-emerald-100/60 font-semibold mb-3">Swipe the wheel to pick a handicap index.</div>
        <Wheel values={targetValues} value={target} onChange={setTarget} />
      </Modal>

      {/* Compare all — Goal */}
      <Modal title={`Goal · HI ${target.toFixed(1)}`} open={goalCompareOpen} onClose={() => setGoalCompareOpen(false)}>
        {allCompareLoading ? (
          <div className="text-sm font-semibold text-emerald-100/70">Loading…</div>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto overscroll-y-contain pr-1" style={{ WebkitOverflowScrolling: "touch" }}>
            {allGoalRows.map((r) => (
              <div key={r.id} className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-extrabold text-emerald-50">{r.name}</div>
                  <div className="text-[11px] font-bold text-emerald-100/70 tabular-nums">{r.hiNow !== null ? `HI ${formatHI(r.hiNow)}` : "—"}</div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-[11px] text-emerald-100/65 font-semibold">ETA</div>
                  <div className="text-[11px] font-extrabold text-emerald-50 tabular-nums">{r.etaISO ?? "—"}</div>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <div className="text-[11px] text-emerald-100/65 font-semibold">Days</div>
                  <div className="text-[11px] font-extrabold text-emerald-50 tabular-nums">{r.days !== null ? `${r.days}` : "—"}</div>
                </div>
                {r.note ? <div className="mt-1 text-[10px] text-emerald-100/55 font-semibold">{r.note}</div> : null}
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* Compare all — Projection */}
      <Modal title={`Projected HI · ${projDateISO}`} open={projCompareOpen} onClose={() => setProjCompareOpen(false)}>
        {allCompareLoading ? (
          <div className="text-sm font-semibold text-emerald-100/70">Loading…</div>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto overscroll-y-contain pr-1" style={{ WebkitOverflowScrolling: "touch" }}>
            {allProjRows.map((r) => (
              <div key={r.id} className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-extrabold text-emerald-50">{r.name}</div>
                  <div className="text-[11px] font-bold text-emerald-100/70 tabular-nums">{r.hiNow !== null ? `Now ${r.hiNow}` : "—"}</div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-[11px] text-emerald-100/65 font-semibold">Projected</div>
                  <div className="text-[11px] font-extrabold text-emerald-50 tabular-nums">{r.proj !== null ? `HI ${r.proj}` : "—"}</div>
                </div>
                {r.note ? <div className="mt-1 text-[10px] text-emerald-100/55 font-semibold">{r.note}</div> : null}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
