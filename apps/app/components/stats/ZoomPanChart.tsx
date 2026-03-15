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
// Zoom + Pan SVG chart (data-driven axes)
// -----------------------------
export function ZoomPanChart({
  aActual,
  aTrend,
  aProj,
  bActual,
  bTrend,
  bProj,
  intercept,
  height = 960,
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
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Touch gesture state: mode, pinch anchor, or pan tracking
  const touchRef = useRef<{
    mode: "pan" | "pinch";
    lastX?: number;   // pan: last clientX
    d0?: number;      // pinch: initial pixel distance
    midT?: number;    // pinch: T at midpoint (fixed at gesture start)
    vMin0?: number;   // pinch: viewMinT at gesture start
    vMax0?: number;   // pinch: viewMaxT at gesture start
  } | null>(null);

  const dragRef = useRef<{ active: boolean; lastClientX: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // The visible time window (null = show full range)
  const [viewMinT, setViewMinT] = useState<number | null>(null);
  const [viewMaxT, setViewMaxT] = useState<number | null>(null);

  const baseWidth = 1400;
  const padL = 96;
  const padR = 28;
  const padT = 20;
  const padB = 60;
  const MIN_WINDOW_DAYS = 7;

  const allSeries: SeriesT[] = [
    ...aActual,
    ...(aTrend ?? []),
    ...(aProj ?? []),
    ...(bActual ?? []),
    ...(bTrend ?? []),
    ...(bProj ?? []),
    ...(intercept ? [{ t: intercept.t, v: intercept.aV }, { t: intercept.t, v: intercept.bV }] : []),
  ].filter((p) => Number.isFinite(p.v) && Number.isFinite(p.t));

  const absoluteMinT = allSeries.length >= 2 ? Math.min(...allSeries.map((p) => p.t)) : 0;
  const absoluteMaxT = allSeries.length >= 2 ? Math.max(...allSeries.map((p) => p.t)) : 1;

  // Initialise / reset view window when absolute range changes (e.g., switching players)
  useEffect(() => {
    if (allSeries.length < 2) return;
    setViewMinT(absoluteMinT);
    setViewMaxT(absoluteMaxT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [absoluteMinT, absoluteMaxT]);

  if (allSeries.length < 2) {
    return (
      <div className="h-[340px] flex items-center justify-center text-sm font-semibold text-emerald-100/70">
        Not enough history yet
      </div>
    );
  }

  // Resolved view window
  const vMin = viewMinT ?? absoluteMinT;
  const vMax = viewMaxT ?? absoluteMaxT;
  const viewSpan = Math.max(0.001, vMax - vMin);

  const xScale = (t: number) => padL + ((t - vMin) / viewSpan) * (baseWidth - padL - padR);

  // Coordinate conversion: client pixel → T value
  function clientXToT(clientX: number): number {
    if (!svgRef.current) return vMin;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * baseWidth;
    return vMin + ((svgX - padL) / (baseWidth - padL - padR)) * viewSpan;
  }

  // Pixel delta → T delta
  function pixelDeltaToT(dxPixels: number): number {
    if (!svgRef.current) return 0;
    const rect = svgRef.current.getBoundingClientRect();
    return (dxPixels / rect.width) * (baseWidth / (baseWidth - padL - padR)) * viewSpan;
  }

  function applyZoom(pivotT: number, zoomFactor: number) {
    const span = vMax - vMin;
    const newSpan = Math.max(MIN_WINDOW_DAYS, span / zoomFactor);
    const f = (pivotT - vMin) / Math.max(0.001, span);
    let newMin = pivotT - f * newSpan;
    let newMax = pivotT + (1 - f) * newSpan;
    if (newMin < absoluteMinT) { newMin = absoluteMinT; newMax = Math.min(absoluteMaxT, newMin + newSpan); }
    if (newMax > absoluteMaxT) { newMax = absoluteMaxT; newMin = Math.max(absoluteMinT, newMax - newSpan); }
    setViewMinT(newMin);
    setViewMaxT(newMax);
  }

  function applyPan(dtDays: number) {
    const span = vMax - vMin;
    let newMin = vMin - dtDays; // drag right → earlier data
    let newMax = vMax - dtDays;
    if (newMin < absoluteMinT) { newMin = absoluteMinT; newMax = absoluteMinT + span; }
    if (newMax > absoluteMaxT) { newMax = absoluteMaxT; newMin = absoluteMaxT - span; }
    setViewMinT(newMin);
    setViewMaxT(newMax);
  }

  // ---------- Event handlers ----------

  const onWheel = (e: React.WheelEvent) => {
    if (!svgRef.current) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      applyZoom(clientXToT(e.clientX), Math.exp(-e.deltaY * 0.0022));
    } else {
      applyPan(pixelDeltaToT(e.deltaX !== 0 ? e.deltaX : e.deltaY));
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const d0 = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const midClientX = (t1.clientX + t2.clientX) / 2;
      touchRef.current = {
        mode: "pinch",
        d0,
        midT: clientXToT(midClientX),
        vMin0: vMin,
        vMax0: vMax,
      };
    } else if (e.touches.length === 1) {
      touchRef.current = { mode: "pan", lastX: e.touches[0].clientX };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchRef.current) return;
    e.preventDefault();

    if (touchRef.current.mode === "pinch" && e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const d = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const { d0, midT, vMin0, vMax0 } = touchRef.current;
      if (!d0 || midT == null || vMin0 == null || vMax0 == null) return;

      const zoomFactor = d / Math.max(1, d0);
      const span0 = vMax0 - vMin0;
      const newSpan = Math.max(MIN_WINDOW_DAYS, span0 / zoomFactor);
      const f = (midT - vMin0) / Math.max(0.001, span0);
      let newMin = midT - f * newSpan;
      let newMax = midT + (1 - f) * newSpan;
      if (newMin < absoluteMinT) { newMin = absoluteMinT; newMax = Math.min(absoluteMaxT, newMin + newSpan); }
      if (newMax > absoluteMaxT) { newMax = absoluteMaxT; newMin = Math.max(absoluteMinT, newMax - newSpan); }
      setViewMinT(newMin);
      setViewMaxT(newMax);
    } else if (touchRef.current.mode === "pan" && e.touches.length === 1) {
      const clientX = e.touches[0].clientX;
      const dxPixels = clientX - (touchRef.current.lastX ?? clientX);
      touchRef.current.lastX = clientX;
      applyPan(pixelDeltaToT(dxPixels));
    }
  };

  const onTouchEnd = () => { touchRef.current = null; };

  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { active: true, lastClientX: e.clientX };
    setIsDragging(true);
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current?.active) return;
    const dxPixels = e.clientX - dragRef.current.lastClientX;
    dragRef.current.lastClientX = e.clientX;
    applyPan(pixelDeltaToT(dxPixels));
  };

  const onMouseUp = () => { dragRef.current = null; setIsDragging(false); };
  const onMouseLeave = () => { dragRef.current = null; setIsDragging(false); };

  // ---------- Y-axis (auto-scales to visible window) ----------

  const visiblePoints = (series: SeriesT[]) =>
    series.filter((p) => p.t >= vMin && p.t <= vMax && Number.isFinite(p.v) && Number.isFinite(p.t));

  const actualOnly: SeriesT[] = [...aActual, ...(bActual ?? [])].filter(
    (p) => Number.isFinite(p.v) && Number.isFinite(p.t)
  );

  const visActual = [
    ...visiblePoints(aActual),
    ...(bActual ? visiblePoints(bActual) : []),
  ];

  const baseForY =
    visActual.length >= 1
      ? visActual
      : actualOnly.length >= 2
      ? actualOnly
      : allSeries;

  const minBase = Math.min(...baseForY.map((p) => p.v));
  const maxBase = Math.max(...baseForY.map((p) => p.v));
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

  // ---------- X-ticks (based on visible window) ----------

  const xStep = niceStep(viewSpan, 6);
  const xTick0 = Math.ceil(vMin / xStep) * xStep;
  const xTicks: number[] = [];
  for (let t = xTick0; t <= vMax + 1e-9; t += xStep) xTicks.push(t);

  // ---------- Y-axis labels ----------

  const yTop = round1(maxBase);
  const yMid = round1((maxBase + minBase) / 2);
  const yBot = round1(minBase);

  // ---------- Intercept marker ----------

  const ix = intercept ? xScale(intercept.t) : null;
  const iyA = intercept ? yScale(intercept.aV) : null;
  const iyB = intercept ? yScale(intercept.bV) : null;

  // ---------- Reset button visibility ----------

  const isZoomed =
    viewMinT !== null &&
    (Math.abs(viewMinT - absoluteMinT) > 0.5 || Math.abs((viewMaxT ?? absoluteMaxT) - absoluteMaxT) > 0.5);

  return (
    <div
      className="w-full rounded-2xl border border-emerald-900/70 bg-[#042713]/55"
      style={{ touchAction: "none" }}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
    >
      <div className="px-2 py-3">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${baseWidth} ${height}`}
          className="w-full h-auto"
          role="img"
          aria-label="HI projections"
          style={{ cursor: isDragging ? "grabbing" : "grab" }}
        >
          <defs>
            <clipPath id="chart-area">
              <rect
                x={padL}
                y={padT}
                width={baseWidth - padL - padR}
                height={height - padT - padB}
              />
            </clipPath>
          </defs>

          {/* Vertical grid lines */}
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

          {/* Horizontal guides */}
          <g opacity={0.22}>
            <line x1={padL} y1={padT} x2={baseWidth - padR} y2={padT} stroke="rgba(245,230,176,0.34)" strokeWidth={1.5} />
            <line
              x1={padL}
              y1={(height - padB + padT) / 2}
              x2={baseWidth - padR}
              y2={(height - padB + padT) / 2}
              stroke="rgba(245,230,176,0.26)"
              strokeWidth={1.25}
            />
            <line
              x1={padL}
              y1={height - padB}
              x2={baseWidth - padR}
              y2={height - padB}
              stroke="rgba(245,230,176,0.20)"
              strokeWidth={1.25}
            />
          </g>

          {/* Y-axis labels */}
          <g fill="rgba(226,252,231,0.70)" fontSize="28" fontFamily="ui-sans-serif, system-ui" fontWeight={900} textAnchor="end">
            <text x={padL - 8} y={padT + 22}>{yTop}</text>
            <text x={padL - 8} y={(height - padB + padT) / 2 + 10}>{yMid}</text>
            <text x={padL - 8} y={height - padB + 10}>{yBot}</text>
          </g>

          {/* X-axis labels */}
          <g fill="rgba(226,252,231,0.62)" fontSize="26" fontFamily="ui-sans-serif, system-ui" fontWeight={800}>
            {xTicks.map((t) => {
              const x = xScale(t);
              const label = formatXLabel ? formatXLabel(t) : `${Math.round(t)}`;
              return (
                <text key={t} x={x} y={height - 18} textAnchor="middle">
                  {label}
                </text>
              );
            })}
          </g>

          {/* Data elements — clipped to chart area */}
          <g clipPath="url(#chart-area)">
            {/* Intercept marker */}
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
          </g>
        </svg>

        <div className="mt-2 flex items-center justify-between text-[11px] font-semibold text-emerald-100/65">
          <div>Drag to pan · Pinch to zoom</div>
          {isZoomed && (
            <button
              type="button"
              onClick={() => { setViewMinT(absoluteMinT); setViewMaxT(absoluteMaxT); }}
              className="text-[#f5e6b0] underline underline-offset-2"
            >
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
