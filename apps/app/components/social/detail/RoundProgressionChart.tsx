"use client";

import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { RoundDetailPlayer, HoleRow, FormatChart } from "@/lib/feed/types";

const PALETTE = ["#f5e6b0", "#7dd3fc", "#86efac", "#fca5a5", "#c4b5fd", "#fdba74"];

type ValueMode = "topar" | "points" | "margin";

function toParLabel(n: number | null | undefined) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : `${n}`;
}

function marginLabel(n: number | null | undefined, short = false) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n === 0) return short ? "AS" : "All square";
  if (n > 0) return short ? `${n}U` : `${n} up`;
  return short ? `${-n}D` : `${-n} dn`;
}

function fmtValue(v: number | null | undefined, mode: ValueMode) {
  if (mode === "topar") return toParLabel(v);
  if (mode === "margin") return marginLabel(v);
  return typeof v === "number" && Number.isFinite(v) ? String(v) : "—";
}

type ViewSeries = { key: string; name: string };

function ViewTooltip({ active, payload, label, series, mode }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  return (
    <div className="rounded-lg border border-[color:var(--sec-hair)] bg-[color:var(--ciaga-ground)] px-3 py-2 shadow-lg">
      <div className="text-[11px] font-extrabold text-[color:var(--sec-muted)]">Hole {label}</div>
      <div className="mt-1 space-y-0.5">
        {series.map((s: ViewSeries, i: number) => {
          const v = row[s.key];
          if (v === null || v === undefined) return null;
          return (
            <div key={s.key} className="flex items-center gap-2 text-[11px] font-semibold">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="text-[color:var(--sec-text)]">{s.name}</span>
              <span className="ml-auto text-[color:var(--sec-accent)]">{fmtValue(v, mode)}</span>
              {mode === "topar" && typeof row[`${s.key}_rank`] === "number" ? (
                <span className="text-[color:var(--sec-muted)]">P{row[`${s.key}_rank`]}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function RoundProgressionChart({
  players,
  grossRows,
  netRows,
  formatChart = null,
}: {
  players: RoundDetailPlayer[];
  grossRows: HoleRow[];
  netRows: HoleRow[];
  formatChart?: FormatChart | null;
}) {
  const [mode, setMode] = useState<"gross" | "net" | "format">("gross");

  const toggles = useMemo(() => {
    const t: Array<{ key: "gross" | "net" | "format"; label: string }> = [
      { key: "gross", label: "Gross" },
      { key: "net", label: "Net" },
    ];
    if (formatChart) t.push({ key: "format", label: formatChart.label });
    return t;
  }, [formatChart]);

  // Resolve the active view.
  const view = useMemo(() => {
    if (mode === "format" && formatChart) {
      const valueMode: ValueMode = formatChart.kind === "margin" ? "margin" : "points";
      return {
        data: formatChart.rows,
        series: formatChart.series as ViewSeries[],
        valueMode,
        reversed: false,
        showAsLine: formatChart.kind === "margin",
        caption:
          formatChart.kind === "margin"
            ? "Match state by hole · 1up / 1dn"
            : `${formatChart.label} points by hole · higher is better`,
      };
    }
    const data = mode === "net" ? netRows : grossRows;
    return {
      data,
      series: players.map((p) => ({ key: p.key, name: p.name })) as ViewSeries[],
      valueMode: "topar" as ValueMode,
      reversed: true,
      showAsLine: false,
      caption: "Score to par by hole · lower is better",
    };
  }, [mode, formatChart, grossRows, netRows, players]);

  return (
    <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_40%,transparent)] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-extrabold text-[color:var(--sec-accent)]">Through the round</div>
        <div className="flex flex-wrap gap-1">
          {toggles.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setMode(t.key)}
              className={[
                "rounded-full px-2.5 py-1 text-[10px] font-extrabold tracking-wide transition",
                mode === t.key
                  ? "bg-[color:var(--sec-accent)] text-[color:var(--ciaga-ground)]"
                  : "border border-[color:var(--sec-hair)] bg-[color:var(--sec-surface)] text-[color:var(--sec-muted)] hover:bg-[color:var(--sec-surface-2)]",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-2 text-[10px] font-semibold text-[color:var(--sec-muted)]">{view.caption}</div>

      {/* Legend */}
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
        {view.series.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1.5 text-[11px] font-semibold text-[color:var(--sec-text)]">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
            {s.name}
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={view.data} margin={{ top: 6, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid stroke="#0b3b21" strokeDasharray="3 3" />
          <XAxis dataKey="hole" tick={{ fill: "#8fd4ad", fontSize: 10 }} stroke="#0b3b21" />
          <YAxis
            reversed={view.reversed}
            tick={{ fill: "#8fd4ad", fontSize: 10 }}
            stroke="#0b3b21"
            allowDecimals={false}
            tickFormatter={(v) =>
              view.valueMode === "topar"
                ? toParLabel(v as number)
                : view.valueMode === "margin"
                  ? marginLabel(v as number, true)
                  : String(v)
            }
          />
          {view.valueMode === "margin" ? <ReferenceLine y={0} stroke="#1f7a47" strokeDasharray="4 3" /> : null}
          <Tooltip content={<ViewTooltip series={view.series} mode={view.valueMode} />} />
          {view.series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
