// app/stats/projections/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/ui/BackButton";

import type { HiPoint } from "@/lib/stats/chartMath";
import {
  addDays,
  calendarDaysBetween,
  clamp,
  fmtDM,
  isoLocal,
  parseISODateLocal,
  startOfLocalDay,
} from "@/lib/stats/chartMath";

import {
  clampToHorizon,
  confidenceOf,
  defaultProjectionDate,
  directionOf,
  goalOutlook,
  hiLabel,
  hiValue,
  horizonLabel,
  percentLabel,
  projectedHiOn,
  readiness,
  realisticFloor,
  trendPerRoundLabel,
  type Confidence,
} from "@/lib/stats/projectionView";
import { buildProjection, SWEEP_SETTINGS, type Projection } from "@/lib/stats/projection/simulate";
import { differentialNeededFor, nextRoundImpact } from "@/lib/stats/projection/nextRound";
import { countingWindow, isoFromDayIndex } from "@/lib/whs/handicapIndex";

import type { FollowProfile } from "@/lib/stats/data";
import { getHandicapHistoryPointsBatch, getFollowedProfiles } from "@/lib/stats/data";
import { fetchDifferentialStreams, type DiffPoint } from "@/lib/stats/projectionData";

import { Modal } from "@/components/stats/Modal";
import { Wheel } from "@/components/stats/Wheel";
import { ZoomPanChart } from "@/components/stats/ZoomPanChart";
import { formatHI } from "@/lib/rounds/handicapUtils";

const ME = "__me__";
const CHART_PAST_DAYS = 540;
const CHART_FUTURE_DAYS = 365;

const CONFIDENCE_STYLE: Record<Confidence["level"], string> = {
  low: "border-red-900/60 text-red-200/80",
  medium: "border-emerald-900/70 text-emerald-100/70",
  high: "border-[#f5e6b0]/40 text-[#f5e6b0]",
};

type PlayerData = { name: string; history: HiPoint[]; stream: DiffPoint[] };

export default function ProjectionsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [followList, setFollowList] = useState<FollowProfile[]>([]);
  const [data, setData] = useState<Map<string, PlayerData>>(new Map());

  const [compareBId, setCompareBId] = useState<string>("");
  const [bLoading, setBLoading] = useState(false);

  // −5.4 to 54.0 in tenths, covering plus handicaps through the WHS ceiling.
  const targetValues = useMemo(() => {
    const out: number[] = [];
    for (let i = -54; i <= 540; i++) out.push(i / 10);
    return out;
  }, []);
  const [target, setTarget] = useState<number>(18.0);
  const [goalWheelOpen, setGoalWheelOpen] = useState(false);
  const [projDateISO, setProjDateISO] = useState<string>(() => defaultProjectionDate(new Date()));

  const [goalCompareOpen, setGoalCompareOpen] = useState(false);
  const [sweepLoading, setSweepLoading] = useState(false);
  const [windowOpen, setWindowOpen] = useState(false);

  const today = useMemo(() => startOfLocalDay(new Date()), []);

  // ---- Load -----------------------------------------------------------------

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
        setMyProfileId(pid);

        const profs = await getFollowedProfiles(pid);
        if (!alive) return;
        setFollowList(profs);

        // Two batched reads: the recorded index history (authoritative, drives
        // the chart's actual line) and the differential stream (drives the
        // simulation).
        const [history, streams] = await Promise.all([
          getHandicapHistoryPointsBatch([pid]),
          fetchDifferentialStreams([pid]),
        ]);
        if (!alive) return;

        setData(
          new Map([
            [ME, { name: "You", history: history.get(pid) ?? [], stream: streams.get(pid) ?? [] }],
          ])
        );
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? "Failed to load stats");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const ensurePlayer = useCallback(
    async (id: string) => {
      if (id === ME || data.has(id)) return;
      const [history, streams] = await Promise.all([
        getHandicapHistoryPointsBatch([id]),
        fetchDifferentialStreams([id]),
      ]);
      const name = followList.find((p) => p.id === id)?.name ?? id.slice(0, 8);
      setData((prev) =>
        new Map(prev).set(id, {
          name,
          history: history.get(id) ?? [],
          stream: streams.get(id) ?? [],
        })
      );
    },
    [data, followList]
  );

  useEffect(() => {
    let alive = true;
    if (!compareBId) return;
    setBLoading(true);
    ensurePlayer(compareBId)
      .catch(() => {})
      .finally(() => {
        if (alive) setBLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [compareBId, ensurePlayer]);

  // ---- Projections ----------------------------------------------------------
  //
  // Built once per player and memoised on their stream, NOT on the target or the
  // projection date: those are pure lookups against the finished matrix, so the
  // wheel and the date picker stay instant.

  const aProjection = useMemo(() => {
    const s = data.get(ME)?.stream ?? [];
    return buildProjection({ stream: s, today, seedKey: myProfileId ?? "me" });
  }, [data, today, myProfileId]);

  const bProjection = useMemo(() => {
    if (!compareBId) return null;
    const s = data.get(compareBId)?.stream;
    if (!s) return null;
    return buildProjection({ stream: s, today, seedKey: compareBId });
  }, [data, compareBId, today]);

  const compareActive = Boolean(compareBId && bProjection);

  const entries = useMemo(() => {
    const out: { id: string; name: string; p: Projection }[] = [
      { id: ME, name: "You", p: aProjection },
    ];
    if (compareActive && bProjection) {
      out.push({ id: compareBId, name: data.get(compareBId)?.name ?? "Them", p: bProjection });
    }
    return out;
  }, [aProjection, bProjection, compareActive, compareBId, data]);

  const aReady = readiness(aProjection);
  const aConfidence = confidenceOf(aProjection);

  // ---- Chart ----------------------------------------------------------------

  const chart = useMemo(() => {
    const anchor = addDays(today, -CHART_PAST_DAYS);
    const absEnd = CHART_PAST_DAYS + CHART_FUTURE_DAYS;
    const todayAbs = CHART_PAST_DAYS;

    const actualOf = (id: string) =>
      (data.get(id)?.history ?? [])
        .map((p) => ({ t: calendarDaysBetween(anchor, parseISODateLocal(p.date)), v: p.hi }))
        .filter((p) => p.t >= 0 && p.t <= absEnd);

    const fanOf = (p: Projection) => {
      if (!p.fan.length) return { median: undefined, band: undefined };
      const pts = p.fan.filter((f) => f.dayIndex - p.todayDayIndex <= CHART_FUTURE_DAYS);
      return {
        median: pts.map((f) => ({ t: todayAbs + (f.dayIndex - p.todayDayIndex), v: f.p50 })),
        band: {
          upper: pts.map((f) => ({ t: todayAbs + (f.dayIndex - p.todayDayIndex), v: f.p10 })),
          lower: pts.map((f) => ({ t: todayAbs + (f.dayIndex - p.todayDayIndex), v: f.p90 })),
        },
      };
    };

    const a = fanOf(aProjection);
    const b = bProjection ? fanOf(bProjection) : { median: undefined, band: undefined };

    return {
      aActual: actualOf(ME),
      bActual: compareActive ? actualOf(compareBId) : undefined,
      aProj: a.median,
      bProj: compareActive ? b.median : undefined,
      aBand: a.band,
      bBand: compareActive ? b.band : undefined,
      formatXLabel: (t: number) => fmtDM(addDays(anchor, t)),
      rangeLabel: `${isoLocal(anchor)} → ${isoLocal(addDays(today, CHART_FUTURE_DAYS))}`,
    };
  }, [data, aProjection, bProjection, compareActive, compareBId, today]);

  // ---- What your next round does -------------------------------------------

  const nextRound = useMemo(() => {
    const p = aProjection;
    if (p.currentHi === null) return null;

    const level = p.diagnostics.levelNow ?? p.currentHi;
    const day = p.todayDayIndex;
    const grid = nextRoundImpact(p.state, day, {
      centre: level,
      spread: 8,
      stepTenths: 20,
      currentHi: p.currentHi,
    });

    // A round that would shave a stroke off the current index.
    const neededForMinusOne = differentialNeededFor(
      p.state,
      day,
      Math.round((p.currentHi - 1) * 10) / 10
    );

    return { grid, neededForMinusOne, currentHi: p.currentHi };
  }, [aProjection]);

  const window20 = useMemo(() => countingWindow(aProjection.state), [aProjection]);
  const worstCounting = useMemo(() => {
    const counting = window20.filter((e) => e.counting);
    if (!counting.length) return null;
    return counting.reduce((a, b) => (a.differential >= b.differential ? a : b));
  }, [window20]);

  // ---- Compare all ----------------------------------------------------------

  type SweepRow = {
    id: string;
    name: string;
    hiNow: number | null;
    probability: number | null;
    medianDateISO: string | null;
    note: string;
    confidence: Confidence;
  };
  const [sweepRows, setSweepRows] = useState<SweepRow[]>([]);

  const runSweep = async () => {
    setSweepLoading(true);
    try {
      // Differentials only: the sweep reports simulated outcomes, and the
      // recorded index history is only needed for the chart's actual line.
      const ids = followList.map((p) => p.id);
      const streams = ids.length
        ? await fetchDifferentialStreams(ids)
        : new Map<string, DiffPoint[]>();

      const pool = [
        { id: ME, name: "You", stream: data.get(ME)?.stream ?? [] },
        ...followList.map((p) => ({
          id: p.id,
          name: p.name ?? p.id.slice(0, 8),
          stream: streams.get(p.id) ?? [],
        })),
      ];

      const rows = pool.map(({ id, name, stream }) => {
        const p = buildProjection({ stream, today, ...SWEEP_SETTINGS, seedKey: id });
        const g = goalOutlook(p, target, clampToHorizon(projDateISO, today), today);
        return {
          id,
          name,
          hiNow: p.currentHi,
          probability: g.probability,
          medianDateISO: g.medianDateISO,
          note: g.reached ? "Already there" : g.note,
          confidence: confidenceOf(p),
        };
      });

      rows.sort((x, y) => (y.probability ?? -1) - (x.probability ?? -1) || x.name.localeCompare(y.name));
      setSweepRows(rows);
    } finally {
      setSweepLoading(false);
    }
  };

  // ---- Render helpers -------------------------------------------------------

  const ConfidencePill = ({ c }: { c: Confidence }) => (
    <span
      title={c.reason}
      className={`rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${CONFIDENCE_STYLE[c.level]}`}
    >
      {c.level}
    </span>
  );

  const Card = ({ children }: { children: React.ReactNode }) => (
    <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-4 space-y-3">{children}</div>
  );

  const byDate = clampToHorizon(projDateISO, today);

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-6">
        <header className="relative flex items-center justify-center">
          <BackButton className="absolute left-0 font-semibold" onClick={() => router.back()} />
          <div className="text-center">
            <div className="text-lg font-extrabold tracking-wide text-[#f5e6b0]">Stats</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70 font-semibold">
              Projections
            </div>
          </div>
        </header>

        {loading ? (
          <div className="h-[300px] flex items-center justify-center text-sm font-semibold text-emerald-100/70 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70">
            Loading…
          </div>
        ) : err ? (
          <div className="p-6 text-center text-sm font-semibold text-red-300 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70">
            {err}
          </div>
        ) : (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5 space-y-5">
            {/* Current index + status */}
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] text-emerald-100/70 font-semibold">Your index</div>
                  <div className="mt-0.5 text-2xl font-extrabold text-emerald-50 tabular-nums">
                    {hiValue(aProjection.currentHi)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  {aReady.canProject ? <ConfidencePill c={aConfidence} /> : null}
                  {directionOf(aProjection) ? (
                    <span
                      className={`text-[11px] font-extrabold ${
                        directionOf(aProjection) === "Improving"
                          ? "text-emerald-300"
                          : directionOf(aProjection) === "Slipping"
                          ? "text-red-300"
                          : "text-emerald-100/60"
                      }`}
                    >
                      {directionOf(aProjection)}
                      {trendPerRoundLabel(aProjection) ? ` ${trendPerRoundLabel(aProjection)}` : ""}
                    </span>
                  ) : null}
                </div>
              </div>

              {aReady.detail ? (
                <div className="rounded-xl border border-emerald-900/50 bg-[#042713]/40 px-3 py-2.5">
                  {aReady.headline ? (
                    <div className="text-[11px] font-extrabold text-emerald-50">{aReady.headline}</div>
                  ) : null}
                  <div className="mt-0.5 text-[11px] font-semibold text-emerald-100/65 leading-snug">
                    {aReady.detail}
                  </div>
                </div>
              ) : (
                <div className="text-[11px] font-semibold text-emerald-100/55 leading-snug">
                  {aConfidence.reason}
                </div>
              )}
            </div>

            {/* Comparison */}
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
              {bLoading ? (
                <div className="text-[11px] text-emerald-100/60 font-semibold">Loading…</div>
              ) : null}
            </div>

            {/* Trajectory */}
            <div className="space-y-3">
              <div>
                <div className="text-sm font-extrabold text-emerald-50">Trajectory</div>
                <div className="text-[11px] text-emerald-100/55 font-semibold">
                  {chart.rangeLabel}
                </div>
              </div>

              {chart.aActual.length < 2 ? (
                <div className="h-[220px] flex items-center justify-center px-6 text-center text-sm font-semibold text-emerald-100/70 rounded-2xl border border-emerald-900/70 bg-[#042713]/55">
                  {aReady.detail ?? "Not enough history yet"}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between text-[11px] font-bold">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-200" />
                      <span className="text-emerald-50">You</span>
                    </div>
                    {compareActive ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#f5e6b0]" />
                        <span className="text-emerald-50">{data.get(compareBId)?.name}</span>
                      </div>
                    ) : null}
                  </div>

                  <ZoomPanChart
                    aActual={chart.aActual}
                    aProj={chart.aProj}
                    bActual={chart.bActual}
                    bProj={chart.bProj}
                    aProjBand={chart.aBand}
                    bProjBand={chart.bBand}
                    height={960}
                    formatXLabel={chart.formatXLabel}
                    formatYLabel={(v) => formatHI(v)}
                  />

                  {aReady.canProject ? (
                    <div className="text-[10px] text-emerald-100/45 font-semibold leading-snug">
                      Dashed line is the median of {aProjection.diagnostics.sims.toLocaleString()}{" "}
                      simulated futures; the shaded band covers the middle 80%. Assumes about{" "}
                      {Math.round(aProjection.diagnostics.roundsPerYear)} rounds a year.
                    </div>
                  ) : null}
                </>
              )}
            </div>

            {/* What your next round does — no model, works from 3 rounds */}
            {nextRound ? (
              <Card>
                <div>
                  <div className="text-sm font-extrabold text-emerald-50">Your next round</div>
                  <div className="text-[11px] text-emerald-100/55 font-semibold">
                    Exact — not a forecast
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  {nextRound.grid
                    .filter((_, i) => i % 2 === 0)
                    .slice(0, 9)
                    .map((pt) => (
                      <div
                        key={pt.differential}
                        className="rounded-xl border border-emerald-900/60 bg-[#042713]/55 px-2 py-1.5 text-center"
                      >
                        <div className="text-[10px] font-bold text-emerald-100/60 tabular-nums">
                          {pt.differential.toFixed(1)}
                        </div>
                        <div className="text-[12px] font-extrabold text-emerald-50 tabular-nums">
                          {hiValue(pt.handicapIndex)}
                        </div>
                        {pt.delta !== null ? (
                          <div
                            className={`text-[9px] font-bold tabular-nums ${
                              pt.delta < 0
                                ? "text-emerald-300"
                                : pt.delta > 0
                                ? "text-red-300"
                                : "text-emerald-100/40"
                            }`}
                          >
                            {pt.delta === 0 ? "—" : `${pt.delta > 0 ? "+" : "−"}${Math.abs(pt.delta).toFixed(1)}`}
                          </div>
                        ) : null}
                      </div>
                    ))}
                </div>

                <div className="text-[11px] font-semibold text-emerald-100/65 leading-snug">
                  {nextRound.neededForMinusOne !== null ? (
                    <>
                      To reach {hiLabel(Math.round((nextRound.currentHi - 1) * 10) / 10)} next time
                      you need a differential of{" "}
                      <span className="font-extrabold text-[#f5e6b0]">
                        {nextRound.neededForMinusOne.toFixed(1)}
                      </span>{" "}
                      or better.
                    </>
                  ) : (
                    <>No single round can take a full stroke off — your index is an average of your best {window20.filter((e) => e.counting).length}.</>
                  )}
                </div>
              </Card>
            ) : null}

            {/* Goal */}
            <Card>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-extrabold text-emerald-50">Goal</div>
                  <div className="text-[11px] text-emerald-100/55 font-semibold">
                    Chance of reaching a target
                  </div>
                </div>
                <Button
                  size="sm"
                  className="h-9 px-3 bg-transparent border border-emerald-900/70 text-emerald-100 hover:bg-emerald-900/30 font-semibold"
                  onClick={async () => {
                    setGoalCompareOpen(true);
                    await runSweep();
                  }}
                >
                  Compare all
                </Button>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-xs text-emerald-100/70 w-[70px] font-semibold">Target</div>
                <button
                  type="button"
                  onClick={() => setGoalWheelOpen(true)}
                  className="h-10 flex-1 rounded-xl border border-emerald-900/70 bg-[#042713] px-3 text-left text-sm font-extrabold text-emerald-50 outline-none focus:border-[#f5e6b0]/70"
                >
                  {hiLabel(target)}
                </button>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-xs text-emerald-100/70 w-[70px] font-semibold">By</div>
                <input
                  type="date"
                  value={byDate}
                  onChange={(e) => setProjDateISO(e.target.value)}
                  className="h-10 flex-1 rounded-xl border border-emerald-900/70 bg-[#042713] px-3 text-sm font-semibold text-emerald-50 outline-none focus:border-[#f5e6b0]/70"
                />
              </div>

              <div className={compareActive ? "grid grid-cols-2 gap-3" : ""}>
                {entries.map(({ id, name, p }) => {
                  const g = goalOutlook(p, target, byDate, today);
                  return (
                    <div
                      key={id}
                      className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3"
                    >
                      {compareActive ? (
                        <div className="text-[11px] text-emerald-100/70 font-bold">{name}</div>
                      ) : null}
                      {g.probability !== null ? (
                        <div className="mt-1 text-2xl font-extrabold text-emerald-50 tabular-nums">
                          {percentLabel(g.probability)}
                        </div>
                      ) : null}
                      {g.medianDateISO ? (
                        <div className="mt-1 text-[11px] font-semibold text-emerald-100/70 leading-snug">
                          Typically {horizonLabel(g.medianDays)} ({g.medianDateISO})
                          {g.earliestISO && g.latestISO ? (
                            <span className="block text-emerald-100/45">
                              80% between {g.earliestISO} and {g.latestISO}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {g.note ? (
                        <div className="mt-1 text-[10px] text-emerald-100/55 font-semibold leading-snug">
                          {g.note}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Projected index */}
            <Card>
              <div>
                <div className="text-sm font-extrabold text-emerald-50">Projected index</div>
                <div className="text-[11px] text-emerald-100/55 font-semibold">On {byDate}</div>
              </div>

              <div className={compareActive ? "grid grid-cols-2 gap-3" : ""}>
                {entries.map(({ id, name, p }) => {
                  const v = projectedHiOn(p, byDate);
                  return (
                    <div
                      key={id}
                      className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3"
                    >
                      {compareActive ? (
                        <div className="text-[11px] text-emerald-100/70 font-bold">{name}</div>
                      ) : null}
                      {v.p50 !== null ? (
                        <>
                          <div className="mt-1 text-xl font-extrabold text-emerald-50 tabular-nums">
                            {hiValue(v.p50)}
                          </div>
                          <div className="text-[10px] font-semibold text-emerald-100/50 tabular-nums">
                            likely {hiValue(v.p10)} – {hiValue(v.p90)}
                          </div>
                        </>
                      ) : (
                        <div className="text-[10px] text-emerald-100/55 font-semibold leading-snug">
                          {v.note}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Realistic floor */}
            <Card>
              <div>
                <div className="text-sm font-extrabold text-emerald-50">Realistic floor</div>
                <div className="text-[11px] text-emerald-100/55 font-semibold">
                  Where the best-8-of-20 formula settles at your current standard
                </div>
              </div>

              <div className={compareActive ? "grid grid-cols-2 gap-3" : ""}>
                {entries.map(({ id, name, p }) => {
                  const f = realisticFloor(p);
                  return (
                    <div
                      key={id}
                      className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3"
                    >
                      {compareActive ? (
                        <div className="text-[11px] text-emerald-100/70 font-bold">{name}</div>
                      ) : null}
                      {f.p50 !== null ? (
                        <>
                          <div className="mt-1 text-xl font-extrabold text-emerald-50 tabular-nums">
                            {hiValue(f.p50)}
                          </div>
                          <div className="text-[10px] font-semibold text-emerald-100/50 tabular-nums">
                            likely {hiValue(f.p10)} – {hiValue(f.p90)}
                          </div>
                        </>
                      ) : (
                        <div className="text-[10px] text-emerald-100/55 font-semibold leading-snug">
                          {f.note}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>

            {/* Counting window */}
            {window20.length ? (
              <Card>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-extrabold text-emerald-50">Counting scores</div>
                    <div className="text-[11px] text-emerald-100/55 font-semibold">
                      {window20.filter((e) => e.counting).length} of your last {window20.length} set
                      your index
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="h-9 px-3 bg-transparent border border-emerald-900/70 text-emerald-100 hover:bg-emerald-900/30 font-semibold"
                    onClick={() => setWindowOpen(true)}
                  >
                    View
                  </Button>
                </div>

                {worstCounting ? (
                  <div className="text-[11px] font-semibold text-emerald-100/65 leading-snug">
                    Your worst counting score is{" "}
                    <span className="font-extrabold text-[#f5e6b0]">
                      {worstCounting.differential.toFixed(1)}
                    </span>{" "}
                    from {isoFromDayIndex(worstCounting.dayIndex)} — it drops out after{" "}
                    {worstCounting.roundsUntilDropOut} more round
                    {worstCounting.roundsUntilDropOut === 1 ? "" : "s"}.
                  </div>
                ) : null}
              </Card>
            ) : null}
          </div>
        )}

        <div className="pt-1 text-[10px] text-emerald-100/50 text-center font-semibold">
          CIAGA · Projections (WHS simulation)
        </div>
      </div>

      {/* Target wheel */}
      <Modal title="Select target HI" open={goalWheelOpen} onClose={() => setGoalWheelOpen(false)}>
        <div className="text-[11px] text-emerald-100/60 font-semibold mb-3">
          Swipe the wheel to pick a handicap index.
        </div>
        <Wheel values={targetValues} value={target} onChange={setTarget} />
      </Modal>

      {/* Counting window */}
      <Modal title="Your last 20 scores" open={windowOpen} onClose={() => setWindowOpen(false)}>
        <div className="text-[11px] text-emerald-100/60 font-semibold mb-3 leading-snug">
          Highlighted scores are the ones averaged to set your index. A score leaves the window when
          20 newer ones have been posted — that's rounds played, not days elapsed.
        </div>
        <div
          className="space-y-1.5 max-h-[60vh] overflow-y-auto overscroll-y-contain pr-1"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {[...window20].reverse().map((e) => (
            <div
              key={`${e.position}-${e.dayIndex}`}
              className={`flex items-center justify-between rounded-xl border px-3 py-2 ${
                e.counting
                  ? "border-[#f5e6b0]/40 bg-[#f5e6b0]/10"
                  : "border-emerald-900/60 bg-[#042713]/45"
              }`}
            >
              <div className="text-[11px] font-semibold text-emerald-100/70 tabular-nums">
                {isoFromDayIndex(e.dayIndex)}
              </div>
              <div className="flex items-center gap-3">
                <div className="text-[10px] font-semibold text-emerald-100/45 tabular-nums">
                  {e.roundsUntilDropOut} to go
                </div>
                <div
                  className={`text-sm font-extrabold tabular-nums ${
                    e.counting ? "text-[#f5e6b0]" : "text-emerald-100/60"
                  }`}
                >
                  {e.differential.toFixed(1)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* Compare all */}
      <Modal
        title={`${hiLabel(target)} by ${byDate}`}
        open={goalCompareOpen}
        onClose={() => setGoalCompareOpen(false)}
      >
        {sweepLoading ? (
          <div className="text-sm font-semibold text-emerald-100/70">Simulating…</div>
        ) : (
          <div
            className="space-y-2 max-h-[60vh] overflow-y-auto overscroll-y-contain pr-1"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {sweepRows.map((r) => (
              <div
                key={r.id}
                className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-extrabold text-emerald-50">{r.name}</div>
                  <div className="flex items-center gap-2">
                    <ConfidencePill c={r.confidence} />
                    <div className="text-[11px] font-bold text-emerald-100/70 tabular-nums">
                      {hiLabel(r.hiNow)}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-[11px] text-emerald-100/65 font-semibold">Chance</div>
                  <div className="text-[11px] font-extrabold text-emerald-50 tabular-nums">
                    {percentLabel(r.probability)}
                  </div>
                </div>
                {r.medianDateISO ? (
                  <div className="mt-1 flex items-center justify-between">
                    <div className="text-[11px] text-emerald-100/65 font-semibold">Typically by</div>
                    <div className="text-[11px] font-extrabold text-emerald-50 tabular-nums">
                      {r.medianDateISO}
                    </div>
                  </div>
                ) : null}
                {r.note ? (
                  <div className="mt-1 text-[10px] text-emerald-100/55 font-semibold leading-snug">
                    {r.note}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
