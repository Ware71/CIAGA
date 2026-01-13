// src/lib/stats/timeModel.ts

export type HiPoint = { date: string; hi: number };
export type SeriesT = { t: number; v: number };

// -----------------------------
// Date/Math helpers
// -----------------------------
export function daysBetween(a: Date, b: Date) {
  return (b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}
export function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
export function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
export function round1(n: number) {
  return Math.round(n * 10) / 10;
}
export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
export function fmtDM(d: Date) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

// -----------------------------
// Regression helpers
// -----------------------------
export function linearRegression(xs: number[], ys: number[]) {
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
// Fit: best-fit floor via grid search
// HI(t) = a * exp(-b t) + c
// -----------------------------
export function fitExpBestFloor(
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
  const upperByMin = minHi - 0.1;
  const upperByLast = lastHi - 1.0;
  const cMax = Math.min(upperByMin, upperByLast);
  if (!(cMax > cMin)) return null;

  const steps = Math.max(80, opts?.steps ?? 240);
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

  const practicalFloorT = (eps: number) => {
    if (best!.b <= 0) return null;
    if (best!.a <= 0) return null;
    const t = Math.log(best!.a / eps) / best!.b;
    return Number.isFinite(t) ? t : null;
  };

  return { a: best.a, b: best.b, c: best.c, predict, firstDate, practicalFloorT };
}

// -----------------------------
// Solve exp curve to a target HI
// target = a*exp(-b t) + c
// => t = -ln((target - c)/a)/b
// -----------------------------
export function solveExpTimeToTarget(params: { a: number; b: number; c: number }, target: number) {
  const { a, b, c } = params;

  if (target <= c) return null; // below asymptote is unreachable (model)
  if (!(a > 0) || !(b > 0)) return null;

  const ratio = (target - c) / a;
  if (!(ratio > 0)) return null;
  if (ratio >= 1) return 0;

  const t = -Math.log(ratio) / b;
  return Number.isFinite(t) ? t : null;
}

// -----------------------------
// Intercept finder (first crossing after tStart)
// -----------------------------
export function findNextInterceptT(
  f: (t: number) => number,
  g: (t: number) => number,
  tStart: number,
  tEnd: number,
  samples = 1600
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
        let lo = prevT,
          hi = t;
        let dlo = prevD;

        for (let k = 0; k < 60; k++) {
          const mid = (lo + hi) / 2;
          const dm = diff(mid);
          if (!Number.isFinite(dm)) break;
          if (Math.abs(dm) < 1e-6) return mid;

          if ((dlo < 0 && dm > 0) || (dlo > 0 && dm < 0)) hi = mid;
          else {
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
// Sampling helpers
// -----------------------------
export function sampleCurve(predict: (t: number) => number, tStart: number, tEnd: number, steps: number): SeriesT[] {
  const out: SeriesT[] = [];
  const span = Math.max(0.0001, tEnd - tStart);
  for (let i = 0; i <= steps; i++) {
    const t = tStart + (i / steps) * span;
    out.push({ t, v: predict(t) });
  }
  return out;
}

export function niceStep(span: number, targetTicks = 6) {
  const raw = span / Math.max(1, targetTicks);
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * pow;
}
