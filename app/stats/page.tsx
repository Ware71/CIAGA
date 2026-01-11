"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Button } from "@/components/ui/button";

type HiRow = { as_of_date: string; handicap_index: number };
type HiPoint = { date: string; hi: number };
type SeriesT = { t: number; v: number };

type FollowProfile = {
  id: string;
  name: string | null;
  avatar_url: string | null;
};

// -----------------------------
// Config
// -----------------------------
const TIME_LOOKBACK_DAYS = 120;
const TIME_FUTURE_DAYS = 30;

const ROUNDS_LOOKBACK = 40;
const ROUNDS_FUTURE = 10;

// "visual floor" threshold: floor + EPS_VIS
// If you want stricter, set to 0.5. If you want looser, set 1.5.
const EPS_VIS = 1.0;

// Intercept search horizon (beyond visible window)
const INTERCEPT_MAX_DAYS_AHEAD = 3650; // 10y
const INTERCEPT_MAX_ROUNDS_AHEAD = 600; // future rounds search

// -----------------------------
// Date/Math helpers
// -----------------------------
function daysBetween(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}
function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function round1(n: number) {
  return Math.round(n * 10) / 10;
}
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function linearRegression(xs: number[], ys: number[]) {
  const n = xs.length;
  if (n < 2) return null;

  let sumX = 0,
    sumY = 0,
    sumXX = 0,
    sumXY = 0;

  for (let i = 0; i < n; i++) {
    const x = xs[i];
    const y = ys[i];
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }

  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return null;

  const m = (n * sumXY - sumX * sumY) / denom;
  const k = (sumY - m * sumX) / n;
  return { m, k };
}

// -----------------------------
// Fit: Option C (best-fit floor via grid search)
// HI(t) = a * exp(-b t) + c
// -----------------------------
function fitExpBestFloor(
  points: HiPoint[],
  tOf: (p: HiPoint, idx: number, firstDate: Date) => number,
  opts?: { cMin?: number; steps?: number }
) {
  if (points.length < 4) return null;

  const sorted = [...points].sort((p1, p2) => p1.date.localeCompare(p2.date));
  const firstDate = new Date(sorted[0].date);

  const his = sorted.map((p) => p.hi);
  const minHi = Math.min(...his);
  const lastHi = sorted[sorted.length - 1].hi;

  const tsAll: number[] = [];
  for (let i = 0; i < sorted.length; i++) tsAll.push(tOf(sorted[i], i, firstDate));

  const cMin = opts?.cMin ?? -5;
  const upperByMin = minHi - 0.1; // keep HI - c > 0
  const upperByLast = lastHi - 1.0; // avoid “floor above current”
  const cMax = Math.min(upperByMin, upperByLast);

  if (!(cMax > cMin)) return null;

  const steps = Math.max(60, opts?.steps ?? 180);
  const step = (cMax - cMin) / steps;

  let best: null | { a: number; b: number; c: number; sse: number } = null;

  for (let s = 0; s <= steps; s++) {
    const c = cMin + step * s;

    const ts: number[] = [];
    const lns: number[] = [];
    const ys: number[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const yPrime = sorted[i].hi - c;
      if (yPrime <= 0) {
        ts.length = 0;
        break;
      }
      ts.push(tsAll[i]);
      lns.push(Math.log(yPrime));
      ys.push(sorted[i].hi);
    }

    if (ts.length < 4) continue;

    const lr = linearRegression(ts, lns);
    if (!lr) continue;

    const b = -lr.m;
    const a = Math.exp(lr.k);

    let sse = 0;
    for (let i = 0; i < ts.length; i++) {
      const pred = a * Math.exp(-b * ts[i]) + c;
      const err = ys[i] - pred;
      sse += err * err;
    }

    if (!best || sse < best.sse - 1e-9 || (Math.abs(sse - best.sse) < 1e-9 && c < best.c)) {
      best = { a, b, c, sse };
    }
  }

  if (!best) return null;

  const predict = (t: number) => best!.a * Math.exp(-best!.b * t) + best!.c;

  // Solve for time to reach within eps of floor:
  // HI(t) - c = a * exp(-b t) <= eps  => t >= ln(a/eps)/b
  const practicalFloorT = (eps: number) => {
    if (best!.b <= 0) return null;
    if (best!.a <= 0) return null;
    const t = Math.log(best!.a / eps) / best!.b;
    return Number.isFinite(t) ? t : null;
  };

  return { a: best.a, b: best.b, c: best.c, predict, firstDate, practicalFloorT };
}

// -----------------------------
// Intercept finder (first crossing after tStart)
// -----------------------------
function findNextInterceptT(
  f: (t: number) => number,
  g: (t: number) => number,
  tStart: number,
  tEnd: number,
  samples = 1200
) {
  const diff = (t: number) => f(t) - g(t);
  const span = Math.max(1e-9, tEnd - tStart);

  let prevT = tStart;
  let prevD = diff(prevT);

  for (let i = 1; i <= samples; i++) {
    const t = tStart + (i / samples) * span;
    const d = diff(t);

    if (Number.isFinite(d) && Math.abs(d) < 1e-6) return t;

    if (Number.isFinite(prevD) && Number.isFinite(d)) {
      if ((prevD < 0 && d > 0) || (prevD > 0 && d < 0)) {
        // bisection
        let lo = prevT,
          hi = t;
        let dlo = prevD;

        for (let k = 0; k < 60; k++) {
          const mid = (lo + hi) / 2;
          const dm = diff(mid);
          if (!Number.isFinite(dm)) break;
          if (Math.abs(dm) < 1e-6) return mid;

          if ((dlo < 0 && dm > 0) || (dlo > 0 && dm < 0)) {
            hi = mid;
          } else {
            lo = mid;
            dlo = dm;
          }
        }
        return (lo + hi) / 2;
      }
    }

    prevT = t;
    prevD = d;
  }

  return null;
}

// -----------------------------
// SVG smoothing (Catmull–Rom -> Bezier)
// -----------------------------
type XY = { x: number; y: number };

function catmullRomPath(points: XY[], tension = 0.85) {
  if (!points || points.length < 2) return "";
  const pts = points;

  const d: string[] = [];
  d.push(`M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`);

  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];

    const c1x = p1.x + ((p2.x - p0.x) / 6) * tension;
    const c1y = p1.y + ((p2.y - p0.y) / 6) * tension;

    const c2x = p2.x - ((p3.x - p1.x) / 6) * tension;
    const c2y = p2.y - ((p3.y - p1.y) / 6) * tension;

    d.push(
      `C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(
        2
      )}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
    );
  }

  return d.join(" ");
}

function sampleCurve(predict: (t: number) => number, tStart: number, tEnd: number, steps: number): SeriesT[] {
  const out: SeriesT[] = [];
  const span = Math.max(0.0001, tEnd - tStart);
  for (let i = 0; i <= steps; i++) {
    const t = tStart + (i / steps) * span;
    out.push({ t, v: predict(t) });
  }
  return out;
}

function clampTail<T>(arr: T[], maxLen: number) {
  if (arr.length <= maxLen) return arr;
  return arr.slice(arr.length - maxLen);
}

// -----------------------------
// Chart component (matches theme)
// -----------------------------
function HiChart({
  meActual,
  meTrend,
  meProj,
  otherActual,
  otherTrend,
  otherProj,
  intercept,
  height = 240,
}: {
  meActual: SeriesT[];
  meTrend?: SeriesT[];
  meProj?: SeriesT[];
  otherActual?: SeriesT[];
  otherTrend?: SeriesT[];
  otherProj?: SeriesT[];
  intercept?: { t: number; meV: number; otherV: number };
  height?: number;
}) {
  const width = 820;
  const padL = 36;
  const padR = 16;
  const padT = 12;
  const padB = 26;

  const allSeries: SeriesT[] = [
    ...meActual,
    ...(meTrend ?? []),
    ...(meProj ?? []),
    ...(otherActual ?? []),
    ...(otherTrend ?? []),
    ...(otherProj ?? []),
    ...(intercept ? [{ t: intercept.t, v: intercept.meV }, { t: intercept.t, v: intercept.otherV }] : []),
  ].filter((p) => Number.isFinite(p.v) && Number.isFinite(p.t));

  if (allSeries.length < 2) {
    return (
      <div className="h-[240px] flex items-center justify-center text-sm text-emerald-100/70">
        Not enough history yet
      </div>
    );
  }

  const minY = Math.min(...allSeries.map((p) => p.v));
  const maxY = Math.max(...allSeries.map((p) => p.v));
  const spanY = Math.max(0.001, maxY - minY);

  const minT = Math.min(...allSeries.map((p) => p.t));
  const maxT = Math.max(...allSeries.map((p) => p.t));
  const spanT = Math.max(0.001, maxT - minT);

  const xScale = (t: number) => padL + ((t - minT) / spanT) * (width - padL - padR);
  const yScale = (v: number) => padT + ((maxY - v) / spanY) * (height - padT - padB);

  const mkXY = (arr: SeriesT[]) => arr.map((p) => ({ x: xScale(p.t), y: yScale(p.v) }));

  const meActualPts = mkXY(meActual);
  const meTrendPts = meTrend ? mkXY(meTrend) : null;
  const meProjPts = meProj ? mkXY(meProj) : null;

  const otherActualPts = otherActual ? mkXY(otherActual) : null;
  const otherTrendPts = otherTrend ? mkXY(otherTrend) : null;
  const otherProjPts = otherProj ? mkXY(otherProj) : null;

  const meActualPath = catmullRomPath(meActualPts, 0.85);
  const meTrendPath = meTrendPts ? catmullRomPath(meTrendPts, 0.85) : "";
  const meProjPath = meProjPts ? catmullRomPath(meProjPts, 0.85) : "";

  const otherActualPath = otherActualPts ? catmullRomPath(otherActualPts, 0.85) : "";
  const otherTrendPath = otherTrendPts ? catmullRomPath(otherTrendPts, 0.85) : "";
  const otherProjPath = otherProjPts ? catmullRomPath(otherProjPts, 0.85) : "";

  const yTop = round1(maxY);
  const yMid = round1((maxY + minY) / 2);
  const yBot = round1(minY);

  const ix = intercept ? xScale(intercept.t) : null;
  const iyMe = intercept ? yScale(intercept.meV) : null;
  const iyOther = intercept ? yScale(intercept.otherV) : null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="HI projections">
      {/* subtle grid */}
      <g opacity={0.18}>
        <line x1={padL} y1={padT} x2={width - padR} y2={padT} stroke="rgba(245,230,176,0.30)" />
        <line
          x1={padL}
          y1={(height - padB + padT) / 2}
          x2={width - padR}
          y2={(height - padB + padT) / 2}
          stroke="rgba(245,230,176,0.22)"
        />
        <line x1={padL} y1={height - padB} x2={width - padR} y2={height - padB} stroke="rgba(245,230,176,0.16)" />
      </g>

      {/* y labels */}
      <g fill="rgba(226,252,231,0.55)" fontSize="10" fontFamily="ui-sans-serif, system-ui">
        <text x={2} y={padT + 9}>
          {yTop}
        </text>
        <text x={2} y={(height - padB + padT) / 2 + 4}>
          {yMid}
        </text>
        <text x={2} y={height - padB + 4}>
          {yBot}
        </text>
      </g>

      {/* intercept highlight */}
      {intercept && ix !== null ? (
        <g>
          <line
            x1={ix}
            y1={padT}
            x2={ix}
            y2={height - padB}
            stroke="rgba(245,230,176,0.42)"
            strokeWidth={1.25}
            strokeDasharray="4 7"
          />
          {iyMe !== null ? <circle cx={ix} cy={iyMe} r={3.2} fill="rgb(167,243,208)" /> : null}
          {iyOther !== null ? <circle cx={ix} cy={iyOther} r={3.2} fill="rgba(245,230,176,0.95)" /> : null}
        </g>
      ) : null}

      {/* compare */}
      {otherTrendPts && <path d={otherTrendPath} fill="none" stroke="rgba(245,230,176,0.90)" strokeWidth={2} />}
      {otherProjPts && (
        <path d={otherProjPath} fill="none" stroke="rgba(245,230,176,0.95)" strokeWidth={2} strokeDasharray="7 7" />
      )}
      {otherActualPts && <path d={otherActualPath} fill="none" stroke="rgba(110,231,183,0.55)" strokeWidth={2.25} />}

      {/* me */}
      {meTrendPts && <path d={meTrendPath} fill="none" stroke="rgba(245,230,176,0.85)" strokeWidth={2} opacity={0.85} />}
      {meProjPts && (
        <path d={meProjPath} fill="none" stroke="rgba(245,230,176,0.9)" strokeWidth={2} strokeDasharray="7 7" opacity={0.9} />
      )}
      <path d={meActualPath} fill="none" stroke="rgb(167,243,208)" strokeWidth={2.75} opacity={0.95} />

      {/* me points */}
      <g>
        {meActualPts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.0} fill="rgb(167,243,208)" opacity={0.95} />
        ))}
      </g>
    </svg>
  );
}

// -----------------------------
// Page
// -----------------------------
export default function StatsPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [myPoints, setMyPoints] = useState<HiPoint[]>([]);
  const [followList, setFollowList] = useState<FollowProfile[]>([]);
  const [compareProfileId, setCompareProfileId] = useState<string>("");

  const [comparePoints, setComparePoints] = useState<HiPoint[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);

  const [mode, setMode] = useState<"time" | "rounds">("time");

  // Load my HI + following list
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

        const { data: hiData, error: hiErr } = await supabase
          .from("handicap_index_history")
          .select("as_of_date, handicap_index")
          .eq("profile_id", pid)
          .not("handicap_index", "is", null)
          .order("as_of_date", { ascending: true });

        if (hiErr) throw hiErr;

        const myPts: HiPoint[] = ((hiData as any as HiRow[]) ?? [])
          .filter((r) => typeof r.handicap_index === "number")
          .map((r) => ({ date: r.as_of_date, hi: Number(r.handicap_index) }));

        if (!alive) return;
        setMyPoints(myPts);

        // following list
        const { data: follows, error: followsErr } = await supabase
          .from("follows")
          .select("following_id")
          .eq("follower_id", pid);

        if (followsErr) {
          setFollowList([]);
          return;
        }

        const followingIds = (follows ?? []).map((r: any) => r.following_id as string).filter(Boolean);

        if (!followingIds.length) {
          setFollowList([]);
          return;
        }

        const { data: profs, error: profErr } = await supabase
          .from("profiles")
          .select("id, name, avatar_url")
          .in("id", followingIds)
          .order("name", { ascending: true });

        if (profErr) {
          setFollowList([]);
          return;
        }

        setFollowList((profs as any) ?? []);
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

  // Load compare history
  useEffect(() => {
    let alive = true;

    (async () => {
      if (!compareProfileId) {
        setComparePoints([]);
        return;
      }
      setCompareLoading(true);
      try {
        const { data, error } = await supabase
          .from("handicap_index_history")
          .select("as_of_date, handicap_index")
          .eq("profile_id", compareProfileId)
          .not("handicap_index", "is", null)
          .order("as_of_date", { ascending: true });

        if (error) throw error;

        const pts: HiPoint[] = ((data as any as HiRow[]) ?? [])
          .filter((r) => typeof r.handicap_index === "number")
          .map((r) => ({ date: r.as_of_date, hi: Number(r.handicap_index) }));

        if (!alive) return;
        setComparePoints(pts);
      } catch {
        if (!alive) return;
        setComparePoints([]);
      } finally {
        if (!alive) return;
        setCompareLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [compareProfileId]);

  const computed = useMemo(() => {
    const today = new Date();
    const todayISO = iso(today);

    // Visible TIME window
    const windowStart = addDays(today, -TIME_LOOKBACK_DAYS);
    const windowEnd = addDays(today, TIME_FUTURE_DAYS);
    const anchor = windowStart; // tAbs=days since anchor

    const absStart = 0;
    const absEnd = daysBetween(anchor, windowEnd);
    const todayAbs = clamp(daysBetween(anchor, today), absStart, absEnd);

    // Me
    const meSorted = [...myPoints].sort((a, b) => a.date.localeCompare(b.date));
    const meN = meSorted.length;
    const meLast = meN ? meSorted[meN - 1] : null;

    const meFitTime = fitExpBestFloor(meSorted, (p, _idx, fd) => daysBetween(fd, new Date(p.date)));
    const meFitRounds = fitExpBestFloor(meSorted, (_p, idx) => idx);

    // Compare
    const otherSorted = [...comparePoints].sort((a, b) => a.date.localeCompare(b.date));
    const otherN = otherSorted.length;

    const otherFitTime = otherN ? fitExpBestFloor(otherSorted, (p, _idx, fd) => daysBetween(fd, new Date(p.date))) : null;
    const otherFitRounds = otherN ? fitExpBestFloor(otherSorted, (_p, idx) => idx) : null;

    // Actual series (visible window)
    const meActualTime: SeriesT[] = meSorted
      .map((p) => ({ t: daysBetween(anchor, new Date(p.date)), v: p.hi }))
      .filter((p) => p.t >= absStart && p.t <= absEnd);

    const otherActualTime: SeriesT[] = otherSorted
      .map((p) => ({ t: daysBetween(anchor, new Date(p.date)), v: p.hi }))
      .filter((p) => p.t >= absStart && p.t <= absEnd);

    // abs-days -> each model’s t
    const meModelTFromAbs = (tAbs: number) => {
      if (!meFitTime) return null;
      const date = addDays(anchor, tAbs);
      return daysBetween(meFitTime.firstDate, date);
    };
    const otherModelTFromAbs = (tAbs: number) => {
      if (!otherFitTime) return null;
      const date = addDays(anchor, tAbs);
      return daysBetween(otherFitTime.firstDate, date);
    };

    const mePredictAbs = (tAbs: number) => {
      const mt = meModelTFromAbs(tAbs);
      return mt === null ? NaN : meFitTime!.predict(mt);
    };
    const otherPredictAbs = (tAbs: number) => {
      const ot = otherModelTFromAbs(tAbs);
      return ot === null ? NaN : otherFitTime!.predict(ot);
    };

    // Visible trend + projection
    const meTrendTime =
      meFitTime && meN >= 2 ? sampleCurve((tAbs) => mePredictAbs(tAbs), absStart, absEnd, 240) : undefined;

    const meProjTime =
      meFitTime && meN >= 2 ? sampleCurve((tAbs) => mePredictAbs(tAbs), todayAbs, absEnd, 120) : undefined;

    const otherTrendTime =
      otherFitTime && otherN >= 2 ? sampleCurve((tAbs) => otherPredictAbs(tAbs), absStart, absEnd, 240) : undefined;

    const otherProjTime =
      otherFitTime && otherN >= 2 ? sampleCurve((tAbs) => otherPredictAbs(tAbs), todayAbs, absEnd, 120) : undefined;

    // Rounds window
    const meRoundsWindow = clampTail(meSorted, ROUNDS_LOOKBACK);
    const meRoundsStartIndex = Math.max(0, meN - meRoundsWindow.length);
    const meActualRounds: SeriesT[] = meRoundsWindow.map((p, i) => ({ t: meRoundsStartIndex + i, v: p.hi }));
    const meRoundsEnd = (meN ? meN - 1 : 0) + ROUNDS_FUTURE;

    const otherRoundsWindow = clampTail(otherSorted, ROUNDS_LOOKBACK);
    const otherRoundsStartIndex = Math.max(0, otherN - otherRoundsWindow.length);
    const otherActualRounds: SeriesT[] = otherRoundsWindow.map((p, i) => ({ t: otherRoundsStartIndex + i, v: p.hi }));
    const otherRoundsEnd = (otherN ? otherN - 1 : 0) + ROUNDS_FUTURE;

    const meTrendRounds =
      meFitRounds && meN >= 2 ? sampleCurve(meFitRounds.predict, meRoundsStartIndex, meN - 1, 180) : undefined;

    const meProjRounds =
      meFitRounds && meN >= 2 ? sampleCurve(meFitRounds.predict, meN - 1, meRoundsEnd, 100) : undefined;

    const otherTrendRounds =
      otherFitRounds && otherN >= 2
        ? sampleCurve(otherFitRounds.predict, otherRoundsStartIndex, otherN - 1, 180)
        : undefined;

    const otherProjRounds =
      otherFitRounds && otherN >= 2 ? sampleCurve(otherFitRounds.predict, otherN - 1, otherRoundsEnd, 100) : undefined;

    // Prediction numbers
    const timePred =
      meFitTime && meLast
        ? [30, 60, 90].map((d) => {
            const dt = addDays(today, d);
            const t = daysBetween(meFitTime.firstDate, dt);
            return { label: `+${d}d`, value: round1(meFitTime.predict(t)) };
          })
        : [];

    const roundsPred =
      meFitRounds && meLast
        ? [5, 10, 20].map((r) => {
            const t = (meN - 1) + r;
            return { label: `+${r}`, value: round1(meFitRounds.predict(t)) };
          })
        : [];

    // Floor + VISUAL target (floor + EPS_VIS)
    const floor = meFitTime ? round1(meFitTime.c) : null;
    const targetHi = meFitTime ? round1(meFitTime.c + EPS_VIS) : null;

    // ETA date to VISUAL target (time-model)
    let etaDateISO: string | null = null;
    if (meFitTime) {
      const tToTarget = meFitTime.practicalFloorT(EPS_VIS);
      if (tToTarget !== null) {
        etaDateISO = iso(addDays(meFitTime.firstDate, tToTarget));
      }
    }

    // ETA rounds to VISUAL target (round-model)
    let roundsToTarget: number | null = null;
    let targetRoundNumber: number | null = null;
    if (meFitRounds && meN > 0) {
      const tToTarget = meFitRounds.practicalFloorT(EPS_VIS);
      if (tToTarget !== null) {
        const fromNow = Math.max(0, Math.ceil(tToTarget - (meN - 1)));
        roundsToTarget = fromNow;
        targetRoundNumber = (meN - 1) + fromNow;
      }
    }

    // NEXT intercept (outside visible window)
    let nextInterceptLabel: string | null = null;
    let relativeLabel: string | null = null;
    let interceptMarker: { t: number; meV: number; otherV: number } | undefined = undefined;

    const compareName = compareProfileId
      ? (followList.find((p) => p.id === compareProfileId)?.name ?? "Comparison")
      : null;

    if (compareProfileId) {
      if (mode === "time" && meFitTime && otherFitTime) {
        const searchStart = todayAbs;
        const searchEnd = todayAbs + INTERCEPT_MAX_DAYS_AHEAD;

        // We search in abs-day space (anchored at visible window start),
        // but allow it to extend far beyond absEnd.
        const tHit = findNextInterceptT(mePredictAbs, otherPredictAbs, searchStart, searchEnd, 1400);

        if (tHit !== null) {
          const date = addDays(anchor, tHit);
          const daysFromToday = Math.round(daysBetween(today, date));
          nextInterceptLabel = `Next intercept: ${iso(date)} (in ~${daysFromToday} day${daysFromToday === 1 ? "" : "s"})`;

          // Only draw marker if it falls inside visible chart window
          if (tHit >= absStart && tHit <= absEnd) {
            const meV = mePredictAbs(tHit);
            const otherV = otherPredictAbs(tHit);
            if (Number.isFinite(meV) && Number.isFinite(otherV)) interceptMarker = { t: tHit, meV, otherV };
          }

          // Relative label: who ends up better AFTER intercept
          const tAfter = tHit + 7; // a week after
          const meAfter = mePredictAbs(tAfter);
          const otherAfter = otherPredictAbs(tAfter);
          if (Number.isFinite(meAfter) && Number.isFinite(otherAfter)) {
            const meBetterAfter = meAfter < otherAfter;
            const who = meBetterAfter ? "You overtake" : `${compareName ?? "They"} overtake`;
            const whom = meBetterAfter ? (compareName ?? "them") : "you";
            relativeLabel = `${who} ${whom}`;
          }
        } else {
          // If no crossing found in horizon, we can still message it
          nextInterceptLabel = `No intercept found in next ${INTERCEPT_MAX_DAYS_AHEAD} days`;
        }
      }

      if (mode === "rounds" && meFitRounds && otherFitRounds && meN > 0) {
        const start = meN - 1;
        const end = start + INTERCEPT_MAX_ROUNDS_AHEAD;

        const tHit = findNextInterceptT(meFitRounds.predict, otherFitRounds.predict, start, end, 1400);
        if (tHit !== null) {
          const r = Math.round(tHit);
          const inRounds = Math.max(0, r - (meN - 1));
          nextInterceptLabel = `Next intercept: round ${r} (in ~${inRounds} round${inRounds === 1 ? "" : "s"})`;

          if (tHit >= meRoundsStartIndex && tHit <= meRoundsEnd) {
            const meV = meFitRounds.predict(tHit);
            const otherV = otherFitRounds.predict(tHit);
            if (Number.isFinite(meV) && Number.isFinite(otherV)) interceptMarker = { t: tHit, meV, otherV };
          }

          const tAfter = tHit + 2;
          const meAfter = meFitRounds.predict(tAfter);
          const otherAfter = otherFitRounds.predict(tAfter);
          if (Number.isFinite(meAfter) && Number.isFinite(otherAfter)) {
            const meBetterAfter = meAfter < otherAfter;
            const who = meBetterAfter ? "You overtake" : `${compareName ?? "They"} overtake`;
            const whom = meBetterAfter ? (compareName ?? "them") : "you";
            relativeLabel = `${who} ${whom}`;
          }
        } else {
          nextInterceptLabel = `No intercept found in next ${INTERCEPT_MAX_ROUNDS_AHEAD} rounds`;
        }
      }
    }

    return {
      todayISO,
      windowLabelTime: `${iso(windowStart)} → ${iso(windowEnd)}`,
      windowLabelRounds: `Last ${ROUNDS_LOOKBACK} rounds → +${ROUNDS_FUTURE}`,

      meN,
      meLast,

      time: {
        meActual: meActualTime,
        meTrend: meTrendTime,
        meProj: meProjTime,
        otherActual: otherActualTime,
        otherTrend: otherTrendTime,
        otherProj: otherProjTime,
      },
      rounds: {
        meActual: meActualRounds,
        meTrend: meTrendRounds,
        meProj: meProjRounds,
        otherActual: otherActualRounds,
        otherTrend: otherTrendRounds,
        otherProj: otherProjRounds,
      },

      timePred,
      roundsPred,

      floor,
      targetHi,
      etaDateISO,
      roundsToTarget,
      targetRoundNumber,

      nextInterceptLabel,
      relativeLabel,
      interceptMarker,
    };
  }, [myPoints, comparePoints, compareProfileId, mode, followList]);

  const modeSeries = mode === "time" ? computed.time : computed.rounds;
  const windowLabel = mode === "time" ? computed.windowLabelTime : computed.windowLabelRounds;

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="px-2 text-emerald-100 hover:bg-emerald-900/30"
            onClick={() => router.back()}
          >
            ← Back
          </Button>

          <div className="text-center flex-1">
            <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Stats</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">Account</div>
          </div>

          <div className="flex gap-2 w-[120px] justify-end">
            <Button
              size="sm"
              className={
                mode === "time"
                  ? "h-8 px-3 bg-[#f5e6b0] text-[#042713] hover:bg-[#f5e6b0]/90"
                  : "h-8 px-3 bg-transparent border border-emerald-900/70 text-emerald-100 hover:bg-emerald-900/30"
              }
              onClick={() => setMode("time")}
            >
              Time
            </Button>
            <Button
              size="sm"
              className={
                mode === "rounds"
                  ? "h-8 px-3 bg-[#f5e6b0] text-[#042713] hover:bg-[#f5e6b0]/90"
                  : "h-8 px-3 bg-transparent border border-emerald-900/70 text-emerald-100 hover:bg-emerald-900/30"
              }
              onClick={() => setMode("rounds")}
            >
              Rounds
            </Button>
          </div>
        </header>

        {/* Projections tile */}
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-5 space-y-4">
          <div className="text-base font-semibold text-emerald-50">Projections</div>

          {/* Compare */}
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="text-xs text-emerald-100/70 w-[64px]">Compare</div>
              <select
                value={compareProfileId}
                onChange={(e) => setCompareProfileId(e.target.value)}
                className="h-10 flex-1 rounded-xl border border-emerald-900/70 bg-[#042713] px-3 text-sm text-emerald-50 outline-none focus:border-[#f5e6b0]/70"
              >
                <option value="">None</option>
                {followList.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name ?? p.id.slice(0, 8)}
                  </option>
                ))}
              </select>
              {compareLoading ? <div className="text-[11px] text-emerald-100/60">Loading…</div> : null}
            </div>

            {computed.meLast ? (
              <div className="text-xs text-emerald-100/70">
                Current HI <span className="font-semibold text-emerald-50">{round1(computed.meLast.hi)}</span>
              </div>
            ) : null}
          </div>

          {/* Chart */}
          <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/55 p-3">
            {loading ? (
              <div className="h-[240px] flex items-center justify-center text-sm text-emerald-100/70">Loading…</div>
            ) : err ? (
              <div className="h-[240px] flex items-center justify-center text-sm text-red-300">{err}</div>
            ) : computed.meN < 2 ? (
              <div className="h-[240px] flex items-center justify-center text-sm text-emerald-100/70">
                Play a couple more rounds to unlock projections.
              </div>
            ) : (
              <>
                <HiChart
                  meActual={modeSeries.meActual}
                  meTrend={modeSeries.meTrend}
                  meProj={modeSeries.meProj}
                  otherActual={compareProfileId ? modeSeries.otherActual : undefined}
                  otherTrend={compareProfileId ? modeSeries.otherTrend : undefined}
                  otherProj={compareProfileId ? modeSeries.otherProj : undefined}
                  intercept={compareProfileId ? computed.interceptMarker : undefined}
                  height={240}
                />

                <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-emerald-100/70">
                  <div>{windowLabel}</div>
                </div>

                {compareProfileId && computed.nextInterceptLabel ? (
                  <div className="mt-1 text-[11px] text-[#f5e6b0]">{computed.nextInterceptLabel}</div>
                ) : null}

                {compareProfileId && computed.relativeLabel ? (
                  <div className="text-[11px] text-emerald-100/80">{computed.relativeLabel}</div>
                ) : null}
              </>
            )}
          </div>

          {/* Predictions */}
          <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-4">
            <div className="text-[11px] text-emerald-100/70 mb-2">
              {mode === "time" ? `From today (${computed.todayISO})` : `From latest round`}
            </div>

            <div className="space-y-2">
              {(mode === "time" ? computed.timePred : computed.roundsPred).map((p) => (
                <div key={p.label} className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-emerald-50 tabular-nums">{p.label}</div>
                  <div className="text-sm font-semibold text-emerald-50 tabular-nums">{p.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Floor */}
          <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/45 p-4">
            <div className="text-[11px] text-emerald-100/70 mb-2">Floor</div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm text-emerald-50">Floor HI</div>
                <div className="text-sm font-semibold text-emerald-50 tabular-nums">
                  {computed.floor ?? "—"}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-sm text-emerald-50">Target HI</div>
                <div className="text-sm font-semibold text-emerald-50 tabular-nums">
                  {computed.targetHi ?? "—"}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-sm text-emerald-50">ETA date</div>
                <div className="text-sm font-semibold text-emerald-50 tabular-nums">
                  {computed.etaDateISO ?? "—"}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-sm text-emerald-50">Rounds to target</div>
                <div className="text-sm font-semibold text-emerald-50 tabular-nums">
                  {computed.roundsToTarget !== null ? `${computed.roundsToTarget}` : "—"}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="text-sm text-emerald-50">Target round</div>
                <div className="text-sm font-semibold text-emerald-50 tabular-nums">
                  {computed.targetRoundNumber !== null ? `${computed.targetRoundNumber}` : "—"}
                </div>
              </div>
            </div>

            <div className="mt-2 text-[10px] text-emerald-100/50">
              Visual target = floor + {EPS_VIS.toFixed(1)} HI
            </div>
          </div>
        </div>

        {/* Footer micro text like placeholder */}
        <div className="pt-1 text-[10px] text-emerald-100/50 text-center">
          CIAGA · Stats Engine v1
        </div>
      </div>
    </div>
  );
}
