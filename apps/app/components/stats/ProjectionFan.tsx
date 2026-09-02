// components/stats/ProjectionFan.tsx
"use client";

import React, { useMemo, useRef, useState } from "react";
import { formatHI } from "@/lib/rounds/handicapUtils";
import { dayIndexFromISO, isoFromDayIndex } from "@/lib/whs/handicapIndex";

/*
  The projection chart.

  Replaced ZoomPanChart, which was a generic line-and-band component from the
  curve-fit era: it could draw one band, so it could not show a two-tier fan, and
  it spent its complexity on pan/zoom — not much use on a projection you read
  once. Its axis labels were also sized for a 1400-unit viewBox, which on a
  384px phone rendered at about seven pixels.

  Series colours are validated, not chosen by eye. The app's own emerald and gold
  fail badly as a pair — ΔE 4.0 under protan simulation and 9.5 even with normal
  colour vision, i.e. genuinely hard to tell apart. These three clear the
  lightness band, chroma floor, CVD separation, normal-vision floor and contrast
  against the #0b3b21 panel.
*/
const RECORDED = "#3b82f6";
const PROJECTED = "#c2810c";
const OTHER = "#0f9d8f";

export type FanPoint = {
  dateISO: string;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
};

export type HistoryPoint = { d: string; hi: number };

type Props = {
  history: HistoryPoint[];
  fan: FanPoint[];
  todayISO: string;
  currentHi: number | null;
  /** Median only — a second fan would be unreadable at this size. */
  otherFan?: FanPoint[];
  otherHistory?: HistoryPoint[];
  otherName?: string;
};

const W = 380;
const H = 250;
const PL = 26;
const PR = 30;
const PT = 12;
const PB = 22;

/** A round-numbered tick step covering `span` in roughly `target` steps. */
function niceStep(span: number, target = 5) {
  const raw = Math.max(1e-6, span / Math.max(1, target));
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export function ProjectionFan({
  history,
  fan,
  todayISO,
  currentHi,
  otherFan,
  otherHistory,
  otherName,
}: Props) {
  const [probe, setProbe] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const model = useMemo(() => {
    const pts = [
      ...history.map((h) => ({ x: dayIndexFromISO(h.d), y: h.hi })),
      ...(otherHistory ?? []).map((h) => ({ x: dayIndexFromISO(h.d), y: h.hi })),
      ...fan.flatMap((f) => {
        const x = dayIndexFromISO(f.dateISO);
        return [{ x, y: f.p10 }, { x, y: f.p90 }];
      }),
      ...(otherFan ?? []).map((f) => ({ x: dayIndexFromISO(f.dateISO), y: f.p50 })),
    ].filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));

    if (pts.length < 2) return null;

    const x0 = Math.min(...pts.map((p) => p.x));
    const x1 = Math.max(...pts.map((p) => p.x));
    const rawLo = Math.min(...pts.map((p) => p.y));
    const rawHi = Math.max(...pts.map((p) => p.y));

    const step = niceStep(Math.max(1, rawHi - rawLo), 5);
    const lo = Math.min(0, Math.floor(rawLo / step) * step);
    const hi = Math.ceil((rawHi + step * 0.15) / step) * step;

    const X = (d: number) => PL + ((d - x0) / Math.max(1, x1 - x0)) * (W - PL - PR);
    const Y = (v: number) => PT + ((hi - v) / Math.max(1e-6, hi - lo)) * (H - PT - PB);

    const ticks: number[] = [];
    for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 10) / 10);

    // Year boundaries inside the window.
    const years: { x: number; label: string }[] = [];
    const startYear = new Date(x0 * 86400000).getUTCFullYear();
    const endYear = new Date(x1 * 86400000).getUTCFullYear();
    for (let y = startYear + 1; y <= endYear; y++) {
      const d = dayIndexFromISO(`${y}-01-01`);
      if (d >= x0 && d <= x1) years.push({ x: X(d), label: String(y) });
    }

    return { x0, x1, lo, hi, X, Y, ticks, years };
  }, [history, fan, otherFan, otherHistory]);

  if (!model) {
    return (
      <div className="h-[200px] flex items-center justify-center rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--ciaga-ground)_55%,transparent)] text-sm font-semibold text-[color:var(--sec-muted)]">
        Not enough history yet
      </div>
    );
  }

  const { x0, x1, X, Y, ticks, years } = model;

  // A Handicap Index is constant between postings and jumps on the day, so the
  // recorded line is a step, not a curve. Smoothing it invents indices the
  // player never had.
  const stepPath = (rows: HistoryPoint[]) =>
    rows
      .map((r, i) => {
        const px = X(dayIndexFromISO(r.d)).toFixed(1);
        const py = Y(r.hi).toFixed(1);
        return i === 0 ? `M${px} ${py}` : `H${px}V${py}`;
      })
      .join("");

  const linePath = (rows: FanPoint[], key: "p50") =>
    rows
      .map((f, i) => `${i ? "L" : "M"}${X(dayIndexFromISO(f.dateISO)).toFixed(1)} ${Y(f[key]).toFixed(1)}`)
      .join("");

  const bandPath = (a: keyof FanPoint, b: keyof FanPoint) => {
    const up = fan.map((f) => `${X(dayIndexFromISO(f.dateISO)).toFixed(1)},${Y(f[a] as number).toFixed(1)}`);
    const dn = [...fan]
      .reverse()
      .map((f) => `${X(dayIndexFromISO(f.dateISO)).toFixed(1)},${Y(f[b] as number).toFixed(1)}`);
    return up.concat(dn).join(" ");
  };

  const todayX = X(dayIndexFromISO(todayISO));
  const last = fan[fan.length - 1];

  // ---- readout ------------------------------------------------------------

  const onProbe = (clientX: number) => {
    const el = svgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * W;
    if (vx < PL || vx > W - PR) return setProbe(null);
    setProbe(x0 + ((vx - PL) / (W - PL - PR)) * (x1 - x0));
  };

  const readout = (() => {
    if (probe === null) return null;
    const todayIdx = dayIndexFromISO(todayISO);
    if (probe <= todayIdx) {
      let best: HistoryPoint | null = null;
      for (const h of history) if (dayIndexFromISO(h.d) <= probe) best = h;
      if (!best) return null;
      return { date: best.d, rows: [["Recorded", formatHI(best.hi)] as const] };
    }
    let best: FanPoint | null = null;
    for (const f of fan) if (dayIndexFromISO(f.dateISO) <= probe) best = f;
    if (!best) return null;
    return {
      date: best.dateISO,
      rows: [
        ["Median", formatHI(Math.round(best.p50 * 10) / 10)] as const,
        ["Likely", `${formatHI(Math.round(best.p10 * 10) / 10)} – ${formatHI(Math.round(best.p90 * 10) / 10)}`] as const,
      ],
    };
  })();

  const probeX = probe === null ? null : X(probe);

  return (
    <div className="space-y-2">
      {/* Legend — identity is never colour alone, so every series is named. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold text-[color:var(--sec-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-[3px] w-4 rounded-sm" style={{ background: RECORDED }} />
          Recorded
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-[3px] w-4 rounded-sm" style={{ background: PROJECTED }} />
          Projected
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-3 rounded-sm" style={{ background: "rgba(194,129,12,0.30)" }} />
          Middle 50 / 80%
        </span>
        {otherFan?.length ? (
          <span className="inline-flex items-center gap-1.5">
            <i className="inline-block h-[3px] w-4 rounded-sm" style={{ background: OTHER }} />
            {otherName ?? "Them"}
          </span>
        ) : null}
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="block w-full h-auto touch-none select-none"
          role="img"
          aria-label={`Recorded handicap index, then a projected median reaching ${formatHI(
            Math.round(last.p50 * 10) / 10
          )} with a middle-80% range of ${formatHI(Math.round(last.p10 * 10) / 10)} to ${formatHI(
            Math.round(last.p90 * 10) / 10
          )}.`}
          onMouseMove={(e) => onProbe(e.clientX)}
          onMouseLeave={() => setProbe(null)}
          onTouchStart={(e) => onProbe(e.touches[0].clientX)}
          onTouchMove={(e) => onProbe(e.touches[0].clientX)}
          onTouchEnd={() => setProbe(null)}
        >
          <defs>
            <clipPath id="fan-plot">
              <rect x={PL} y={PT} width={W - PL - PR} height={H - PT - PB} />
            </clipPath>
          </defs>

          {/* Gridlines, each one labelled — the old chart drew its labels from the
              raw data extremes while positioning them on a padded domain, so no
              number ever sat on its own line. */}
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PL} y1={Y(v)} x2={W - PR} y2={Y(v)} stroke="#17472c" strokeWidth={0.8} />
              <text x={PL - 5} y={Y(v) + 3.2} textAnchor="end" fill="#5d7a68" fontSize="8.5" fontWeight={700}>
                {v}
              </text>
            </g>
          ))}

          {years.map((y) => (
            <g key={y.label}>
              <line x1={y.x} y1={PT} x2={y.x} y2={H - PB} stroke="#10341e" strokeWidth={0.8} />
              <text x={y.x} y={H - PB + 12} textAnchor="middle" fill="#5d7a68" fontSize="8.5" fontWeight={700}>
                {y.label}
              </text>
            </g>
          ))}

          <g clipPath="url(#fan-plot)">
            <polygon points={bandPath("p10", "p90")} fill="rgba(194,129,12,0.16)" />
            <polygon points={bandPath("p25", "p75")} fill="rgba(194,129,12,0.30)" />

            {otherHistory?.length ? (
              <path d={stepPath(otherHistory)} fill="none" stroke={OTHER} strokeWidth={1.2} opacity={0.55} />
            ) : null}
            {otherFan?.length ? (
              <path
                d={linePath(otherFan, "p50")}
                fill="none"
                stroke={OTHER}
                strokeWidth={1.8}
                strokeDasharray="2 3"
                strokeLinecap="round"
              />
            ) : null}

            <path d={stepPath(history)} fill="none" stroke={RECORDED} strokeWidth={1.7} strokeLinejoin="round" />
            <path
              d={linePath(fan, "p50")}
              fill="none"
              stroke={PROJECTED}
              strokeWidth={2}
              strokeDasharray="5 3.5"
              strokeLinecap="round"
            />
          </g>

          <line
            x1={todayX}
            y1={PT}
            x2={todayX}
            y2={H - PB}
            stroke="#8aa894"
            strokeWidth={0.8}
            strokeDasharray="2 3"
          />

          {/* Endpoints, ringed in the surface colour so overlaps stay readable. */}
          {currentHi !== null ? (
            <circle cx={todayX} cy={Y(currentHi)} r={3.2} fill={RECORDED} stroke="#0b3b21" strokeWidth={1.4} />
          ) : null}
          <circle cx={X(dayIndexFromISO(last.dateISO))} cy={Y(last.p50)} r={3.2} fill={PROJECTED} stroke="#0b3b21" strokeWidth={1.4} />
          <text
            x={X(dayIndexFromISO(last.dateISO)) - 4}
            y={Y(last.p50) - 6}
            textAnchor="end"
            fill="#e0a63a"
            fontSize="10"
            fontWeight={800}
          >
            {formatHI(Math.round(last.p50 * 10) / 10)}
          </text>

          {probeX !== null ? (
            <line x1={probeX} y1={PT} x2={probeX} y2={H - PB} stroke="#e6f5ea" strokeWidth={0.8} opacity={0.35} />
          ) : null}
        </svg>

        {/* Readout sits above the plot rather than floating over it — at this
            width a tooltip would cover most of the chart. */}
        <div className="mt-1 flex min-h-[18px] items-center gap-3 text-[10px] font-bold tabular-nums">
          {readout ? (
            <>
              <span className="text-[color:var(--sec-muted)]">{readout.date}</span>
              {readout.rows.map(([k, v]) => (
                <span key={k} className="text-[color:var(--sec-muted)]">
                  {k} <b className="text-[color:var(--sec-text)]">{v}</b>
                </span>
              ))}
            </>
          ) : (
            <span className="text-[color:var(--sec-muted)]">Drag across the chart to read any date</span>
          )}
        </div>
      </div>
    </div>
  );
}

export { isoFromDayIndex };
