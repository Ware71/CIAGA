// src/components/stats/ZoomPanChart.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import type { SeriesT } from "@/lib/stats/timeModel";
import { clamp, niceStep, round1 } from "@/lib/stats/timeModel";

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
      `C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
    );
  }

  return d.join(" ");
}

// -----------------------------
// Zoom + Scroll SVG chart
// -----------------------------
export function ZoomPanChart({
  aActual,
  aTrend,
  aProj,
  bActual,
  bTrend,
  bProj,
  intercept,
  height = 340,
  formatXLabel,
}: {
  aActual: SeriesT[];
  aTrend?: SeriesT[];
  aProj?: SeriesT[];
  bActual?: SeriesT[];
  bTrend?: SeriesT[];
  bProj?: SeriesT[];
  intercept?: { t: number; aV: number; bV: number };
  height?: number;
  formatXLabel?: (t: number) => string;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const didAutoScrollRef = useRef(false);

  const [scale, setScale] = useState(1);
  const pinchRef = useRef<{ active: boolean; d0: number; s0: number } | null>(null);

  const clampScale = (s: number) => clamp(s, 1, 4);

  // Base chart width (bigger => more history visible + more scroll room)
  const baseWidth = 1400;
  const width = baseWidth; // SVG coordinate width stays stable; we scale the container width
  const padL = 48;
  const padR = 22;
  const padT = 16;
  const padB = 40;

  const allSeries: SeriesT[] = [
    ...aActual,
    ...(aTrend ?? []),
    ...(aProj ?? []),
    ...(bActual ?? []),
    ...(bTrend ?? []),
    ...(bProj ?? []),
    ...(intercept ? [{ t: intercept.t, v: intercept.aV }, { t: intercept.t, v: intercept.bV }] : []),
  ].filter((p) => Number.isFinite(p.v) && Number.isFinite(p.t));

  // Auto-scroll to most recent once
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (didAutoScrollRef.current) return;
    if (allSeries.length < 2) return;

    didAutoScrollRef.current = true;
    requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth;
    });
  }, [allSeries.length]);

  const onWheel = (e: React.WheelEvent) => {
    // Desktop zoom: Ctrl/Cmd + wheel
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();

    const next = clampScale(scale * Math.exp(-e.deltaY * 0.0022));
    setScale(next);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const d0 = Math.hypot(dx, dy);
      pinchRef.current = { active: true, d0, s0: scale };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current?.active) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const d = Math.hypot(dx, dy);
      const next = clampScale(pinchRef.current.s0 * (d / Math.max(1, pinchRef.current.d0)));
      setScale(next);
    }
  };

  const onTouchEnd = () => {
    pinchRef.current = null;
  };

  if (allSeries.length < 2) {
    return (
      <div className="h-[340px] flex items-center justify-center text-sm font-semibold text-emerald-100/70">
        Not enough history yet
      </div>
    );
  }

  const minT = Math.min(...allSeries.map((p) => p.t));
  const maxT = Math.max(...allSeries.map((p) => p.t));
  const spanT = Math.max(0.001, maxT - minT);
  const xScale = (t: number) => padL + ((t - minT) / spanT) * (width - padL - padR);

  const actualOnly: SeriesT[] = [...aActual, ...(bActual ?? [])].filter((p) => Number.isFinite(p.v) && Number.isFinite(p.t));
  const base = actualOnly.length >= 2 ? actualOnly : allSeries;

  const minBase = Math.min(...base.map((p) => p.v));
  const maxBase = Math.max(...base.map((p) => p.v));
  const spanBase = Math.max(0.001, maxBase - minBase);

  const minAll = Math.min(...allSeries.map((p) => p.v));
  const maxAll = Math.max(...allSeries.map((p) => p.v));

  const clampPad = spanBase * 0.6;
  const minY0 = Math.max(minAll, minBase - clampPad);
  const maxY0 = Math.min(maxAll, maxBase + clampPad);

  const yPad = Math.max(0.6, (maxY0 - minY0) * 0.12);
  const minY = minY0 - yPad;
  const maxY = maxY0 + yPad;
  const spanY = Math.max(0.001, maxY - minY);

  const yScale = (v: number) => padT + ((maxY - v) / spanY) * (height - padT - padB);
  const mkXY = (arr: SeriesT[]) => arr.map((p) => ({ x: xScale(p.t), y: yScale(p.v) }));

  const aActualPts = mkXY(aActual);
  const aTrendPts = aTrend ? mkXY(aTrend) : null;
  const aProjPts = aProj ? mkXY(aProj) : null;

  const bActualPts = bActual ? mkXY(bActual) : null;
  const bTrendPts = bTrend ? mkXY(bTrend) : null;
  const bProjPts = bProj ? mkXY(bProj) : null;

  const aActualPath = catmullRomPath(aActualPts, 0.85);
  const aTrendPath = aTrendPts ? catmullRomPath(aTrendPts, 0.85) : "";
  const aProjPath = aProjPts ? catmullRomPath(aProjPts, 0.85) : "";

  const bActualPath = bActualPts ? catmullRomPath(bActualPts, 0.85) : "";
  const bTrendPath = bTrendPts ? catmullRomPath(bTrendPts, 0.85) : "";
  const bProjPath = bProjPts ? catmullRomPath(bProjPts, 0.85) : "";

  const xStep = niceStep(spanT, 6);
  const xTick0 = Math.ceil(minT / xStep) * xStep;
  const xTicks: number[] = [];
  for (let t = xTick0; t <= maxT + 1e-9; t += xStep) xTicks.push(t);

  const yTop = round1(maxBase);
  const yMid = round1((maxBase + minBase) / 2);
  const yBot = round1(minBase);

  const ix = intercept ? xScale(intercept.t) : null;
  const iyA = intercept ? yScale(intercept.aV) : null;
  const iyB = intercept ? yScale(intercept.bV) : null;

  const innerWidthPx = `${Math.round(baseWidth * scale)}px`;

  return (
    <div
      ref={scrollerRef}
      className="w-full overflow-x-auto overscroll-x-contain rounded-2xl border border-emerald-900/70 bg-[#042713]/55"
      style={{ WebkitOverflowScrolling: "touch" }}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="px-2 py-3" style={{ width: innerWidthPx }}>
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="HI projections">
          <g opacity={0.22}>
            {xTicks.map((t) => {
              const x = xScale(t);
              return (
                <line
                  key={t}
                  x1={x}
                  y1={padT}
                  x2={x}
                  y2={height - padB}
                  stroke="rgba(245,230,176,0.18)"
                  strokeWidth={1.15}
                />
              );
            })}
          </g>

          <g opacity={0.22}>
            <line x1={padL} y1={padT} x2={width - padR} y2={padT} stroke="rgba(245,230,176,0.34)" strokeWidth={1.5} />
            <line
              x1={padL}
              y1={(height - padB + padT) / 2}
              x2={width - padR}
              y2={(height - padB + padT) / 2}
              stroke="rgba(245,230,176,0.26)"
              strokeWidth={1.25}
            />
            <line
              x1={padL}
              y1={height - padB}
              x2={width - padR}
              y2={height - padB}
              stroke="rgba(245,230,176,0.20)"
              strokeWidth={1.25}
            />
          </g>

          <g fill="rgba(226,252,231,0.70)" fontSize="12" fontFamily="ui-sans-serif, system-ui" fontWeight={900}>
            <text x={4} y={padT + 12}>
              {yTop}
            </text>
            <text x={4} y={(height - padB + padT) / 2 + 6}>
              {yMid}
            </text>
            <text x={4} y={height - padB + 6}>
              {yBot}
            </text>
          </g>

          <g fill="rgba(226,252,231,0.62)" fontSize="11" fontFamily="ui-sans-serif, system-ui" fontWeight={800}>
            {xTicks.map((t) => {
              const x = xScale(t);
              const label = formatXLabel ? formatXLabel(t) : `${Math.round(t)}`;
              return (
                <text key={t} x={x} y={height - 12} textAnchor="middle">
                  {label}
                </text>
              );
            })}
          </g>

          {intercept && ix !== null ? (
            <g>
              <line
                x1={ix}
                y1={padT}
                x2={ix}
                y2={height - padB}
                stroke="rgba(245,230,176,0.55)"
                strokeWidth={2.0}
                strokeDasharray="5 8"
              />
              {iyA !== null ? <circle cx={ix} cy={iyA} r={4.0} fill="rgb(167,243,208)" /> : null}
              {iyB !== null ? <circle cx={ix} cy={iyB} r={4.0} fill="rgba(245,230,176,0.98)" /> : null}
            </g>
          ) : null}

          {bTrendPts && <path d={bTrendPath} fill="none" stroke="rgba(245,230,176,0.92)" strokeWidth={3.0} />}
          {bProjPts && <path d={bProjPath} fill="none" stroke="rgba(245,230,176,0.96)" strokeWidth={3.0} strokeDasharray="10 8" />}
          {bActualPts && <path d={bActualPath} fill="none" stroke="rgba(110,231,183,0.58)" strokeWidth={3.3} />}

          {aTrendPts && <path d={aTrendPath} fill="none" stroke="rgba(245,230,176,0.86)" strokeWidth={2.8} opacity={0.9} />}
          {aProjPts && <path d={aProjPath} fill="none" stroke="rgba(245,230,176,0.92)" strokeWidth={2.8} strokeDasharray="10 8" opacity={0.98} />}
          <path d={aActualPath} fill="none" stroke="rgb(167,243,208)" strokeWidth={3.8} opacity={0.98} />

          <g>
            {aActualPts.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={2.6} fill="rgb(167,243,208)" opacity={0.98} />
            ))}
          </g>
        </svg>

        <div className="mt-2 flex items-center justify-between text-[11px] font-semibold text-emerald-100/65">
          <div>Swipe to scroll · Pinch to zoom</div>
          <div className="text-[#f5e6b0]">×{scale.toFixed(1)}</div>
        </div>
      </div>
    </div>
  );
}
