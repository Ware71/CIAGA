// app/stats/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Button } from "@/components/ui/button";

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
} from "@/lib/stats/timeModel";

import type { FollowProfile } from "@/lib/stats/data";
import { getHandicapHistoryPoints, getFollowedProfiles } from "@/lib/stats/data";

import { Modal } from "@/components/stats/Modal";
import { Wheel } from "@/components/stats/Wheel";
import { ZoomPanChart } from "@/components/stats/ZoomPanChart";

type EtaStatus = "insufficient" | "reached" | "unreachable" | "unknown" | "estimated";

// -----------------------------
// Config (Time-only)
// -----------------------------
const TIME_LOOKBACK_DAYS = 180;
const TIME_FUTURE_DAYS = 60;

const EPS_VIS = 1.0;
const INTERCEPT_MAX_DAYS_AHEAD = 3650; // 10y
const ME = "__me__";

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
    for (let i = 0; i <= 540; i++) out.push(i / 10);
    return out;
  }, []);
  const [target, setTarget] = useState<number>(18.0);
  const [goalWheelOpen, setGoalWheelOpen] = useState(false);

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

    const aSorted = [...(compareAId ? aPoints : [])].sort((x, y) => x.date.localeCompare(y.date));
    const bSorted = [...(compareBId ? bPoints : [])].sort((x, y) => x.date.localeCompare(y.date));

    const aN = aSorted.length;
    const bN = bSorted.length;

    const aLast = aN ? aSorted[aN - 1] : null;
    const bLast = bN ? bSorted[bN - 1] : null;

    const aFit = aN ? fitExpBestFloor(aSorted, (p, _idx, fd) => daysBetween(fd, new Date(p.date))) : null;
    const bFit = bN ? fitExpBestFloor(bSorted, (p, _idx, fd) => daysBetween(fd, new Date(p.date))) : null;

    const windowStart = addDays(today, -TIME_LOOKBACK_DAYS);
    const windowEnd = addDays(today, TIME_FUTURE_DAYS);
    const anchor = windowStart;

    const absStart = 0;
    const absEnd = daysBetween(anchor, windowEnd);
    const todayAbs = clamp(daysBetween(anchor, today), absStart, absEnd);

    const aActual = aSorted
      .map((p) => ({ t: daysBetween(anchor, new Date(p.date)), v: p.hi }))
      .filter((p) => p.t >= absStart && p.t <= absEnd);

    const bActual = bSorted
      .map((p) => ({ t: daysBetween(anchor, new Date(p.date)), v: p.hi }))
      .filter((p) => p.t >= absStart && p.t <= absEnd);

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

    const aTrend = aFit && aN >= 2 ? sampleCurve((tAbs) => aPredictAbs(tAbs), absStart, absEnd, 260) : undefined;
    const aProj = aFit && aN >= 2 ? sampleCurve((tAbs) => aPredictAbs(tAbs), todayAbs, absEnd, 140) : undefined;

    const bTrend = bFit && bN >= 2 ? sampleCurve((tAbs) => bPredictAbs(tAbs), absStart, absEnd, 260) : undefined;
    const bProj = bFit && bN >= 2 ? sampleCurve((tAbs) => bPredictAbs(tAbs), todayAbs, absEnd, 140) : undefined;

    // Potential floor (visual threshold)
    const potentialFloor = (fit: ReturnType<typeof fitExpBestFloor> | null) => {
      if (!fit) return { value: null as number | null, etaISO: null as string | null, note: "Not enough data" };
      const pf = round1(fit.c + EPS_VIS);
      const tTo = fit.practicalFloorT(EPS_VIS);
      const etaISO = tTo !== null ? iso(addDays(fit.firstDate, tTo)) : null;
      return { value: pf, etaISO, note: "" };
    };

    const aPF = potentialFloor(aFit);
    const bPF = potentialFloor(bFit);

    const aTargetEta = etaForTarget(aFit, today, target);
    const bTargetEta = etaForTarget(bFit, today, target);

    const projA = projectedOnDate(aFit, projDateISO);
    const projB = compareBId ? projectedOnDate(bFit, projDateISO) : null;

    // Intercept (optional)
    let nextInterceptLabel: string | null = null;
    let interceptMarker: { t: number; aV: number; bV: number } | undefined = undefined;

    if (compareAId && compareBId && aFit && bFit) {
      const searchStart = todayAbs;
      const searchEnd = todayAbs + INTERCEPT_MAX_DAYS_AHEAD;
      const tHit = findNextInterceptT(aPredictAbs, bPredictAbs, searchStart, searchEnd, 1600);

      if (tHit !== null) {
        const date = addDays(anchor, tHit);
        const daysFromToday = Math.round(daysBetween(today, date));
        const aVAt = aPredictAbs(tHit);
        const bVAt = bPredictAbs(tHit);
        const atHi = Number.isFinite(aVAt) && Number.isFinite(bVAt) ? `HI ${round1(aVAt)}` : "";
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
      counts: { aN, bN },
      last: { aLast, bLast },
      series: { aActual, aTrend, aProj, bActual, bTrend, bProj },
      interceptMarker,
      nextInterceptLabel,
      potentialFloor: { a: aPF, b: bPF },
      goalEta: { a: aTargetEta, b: bTargetEta },
      projByDate: { a: projA, b: projB },
      fits: { aFit, bFit },
    };
  }, [aPoints, bPoints, compareAId, compareBId, projDateISO, target, followList, myPoints]);

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

      const rows: {
        id: string;
        name: string;
        hiNow: number | null;
        etaISO: string | null;
        days: number | null;
        status: string;
        note: string;
      }[] = [];

      const pool = [{ id: ME, name: "You" }, ...followList.map((p) => ({ id: p.id, name: p.name ?? p.id.slice(0, 8) }))];

      for (const p of pool) {
        const pts = p.id === ME ? myPoints : await fetchPoints(p.id);
        const sorted = [...pts].sort((a, b) => a.date.localeCompare(b.date));
        const n = sorted.length;
        const last = n ? sorted[n - 1].hi : null;
        const fit = n ? fitExpBestFloor(sorted, (pt, _i, fd) => daysBetween(fd, new Date(pt.date))) : null;
        const eta = etaForTarget(fit, today, target);
        rows.push({
          id: p.id,
          name: p.name,
          hiNow: last !== null ? round1(last) : null,
          etaISO: eta.dateISO,
          days: eta.days,
          status: eta.status,
          note: eta.note,
        });
      }

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
      const rows: { id: string; name: string; hiNow: number | null; proj: number | null; note: string }[] = [];

      for (const p of pool) {
        const pts = p.id === ME ? myPoints : await fetchPoints(p.id);
        const sorted = [...pts].sort((a, b) => a.date.localeCompare(b.date));
        const n = sorted.length;
        const last = n ? sorted[n - 1].hi : null;
        const fit = n ? fitExpBestFloor(sorted, (pt, _i, fd) => daysBetween(fd, new Date(pt.date))) : null;
        const proj = projectedOnDate(fit, projDateISO);
        rows.push({
          id: p.id,
          name: p.name,
          hiNow: last !== null ? round1(last) : null,
          proj,
          note: fit ? "" : "Not enough data",
        });
      }

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
    const anchor = addDays(new Date(), -TIME_LOOKBACK_DAYS);
    const d = addDays(anchor, tAbsDays);
    return fmtDM(d);
  };

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-6">
        {/* Header (centered, back is absolute so title stays centered) */}
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
                    HI {computed.last.aLast ? round1(computed.last.aLast.hi) : "—"}
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-3">
                  <div className="text-[11px] text-emerald-100/70 font-semibold">{computed.names.b}</div>
                  <div className="mt-1 text-sm font-extrabold text-emerald-50 tabular-nums">
                    HI {computed.last.bLast ? round1(computed.last.bLast.hi) : "—"}
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-3">
                <div className="text-[11px] text-emerald-100/70 font-semibold">You</div>
                <div className="mt-1 text-sm font-extrabold text-emerald-50 tabular-nums">
                  HI {computed.last.aLast ? round1(computed.last.aLast.hi) : "—"}
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

            {loading ? (
              <div className="h-[340px] flex items-center justify-center text-sm font-semibold text-emerald-100/70 rounded-2xl border border-emerald-900/70 bg-[#042713]/55">
                Loading…
              </div>
            ) : err ? (
              <div className="h-[340px] flex items-center justify-center text-sm font-semibold text-red-300 rounded-2xl border border-emerald-900/70 bg-[#042713]/55">
                {err}
              </div>
            ) : computed.counts.aN < 2 ? (
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
                  intercept={compareActive ? (computed.interceptMarker as any) : undefined}
                  height={340}
                  formatXLabel={timeXLabel}
                />
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
            <div className="mt-1 text-[11px] text-emerald-100/55 font-semibold">Model asymptote + {EPS_VIS.toFixed(1)} HI (visual threshold)</div>

            {compareActive ? (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                  <div className="text-[11px] text-emerald-100/70 font-bold">{computed.names.a}</div>
                  <div className="mt-1 text-base font-extrabold text-emerald-50 tabular-nums">{computed.potentialFloor.a.value ?? "—"}</div>
                  <div className="mt-1 text-[10px] text-emerald-100/55 font-semibold">Approx. by {computed.potentialFloor.a.etaISO ?? "—"}</div>
                </div>
                <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                  <div className="text-[11px] text-emerald-100/70 font-bold">{computed.names.b}</div>
                  <div className="mt-1 text-base font-extrabold text-emerald-50 tabular-nums">{computed.potentialFloor.b.value ?? "—"}</div>
                  <div className="mt-1 text-[10px] text-emerald-100/55 font-semibold">Approx. by {computed.potentialFloor.b.etaISO ?? "—"}</div>
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                <div className="text-[11px] text-emerald-100/70 font-bold">You</div>
                <div className="mt-1 text-base font-extrabold text-emerald-50 tabular-nums">{computed.potentialFloor.a.value ?? "—"}</div>
                <div className="mt-1 text-[10px] text-emerald-100/55 font-semibold">Approx. by {computed.potentialFloor.a.etaISO ?? "—"}</div>
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
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1" style={{ WebkitOverflowScrolling: "touch" }}>
            {allGoalRows.map((r) => (
              <div key={r.id} className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-extrabold text-emerald-50">{r.name}</div>
                  <div className="text-[11px] font-bold text-emerald-100/70 tabular-nums">{r.hiNow !== null ? `HI ${r.hiNow}` : "—"}</div>
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
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1" style={{ WebkitOverflowScrolling: "touch" }}>
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
