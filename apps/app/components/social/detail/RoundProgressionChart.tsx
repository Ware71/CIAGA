"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { RoundDetailPlayer } from "@/lib/feed/types";

const PALETTE = ["#f5e6b0", "#7dd3fc", "#86efac", "#fca5a5", "#c4b5fd", "#fdba74"];

function toParLabel(n: number | null | undefined) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : `${n}`;
}

function ChartTooltip({ active, payload, label, players }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  return (
    <div className="rounded-lg border border-emerald-900/70 bg-[#04240f] px-3 py-2 shadow-lg">
      <div className="text-[11px] font-extrabold text-emerald-100/70">Hole {label}</div>
      <div className="mt-1 space-y-0.5">
        {players.map((pl: RoundDetailPlayer, i: number) => {
          const toPar = row[`p${i}`];
          const rank = row[`p${i}_rank`];
          if (toPar === null || toPar === undefined) return null;
          return (
            <div key={pl.key} className="flex items-center gap-2 text-[11px] font-semibold">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
              <span className="text-emerald-50">{pl.name}</span>
              <span className="ml-auto text-[#f5e6b0]">{toParLabel(toPar)}</span>
              {typeof rank === "number" ? (
                <span className="text-emerald-100/50">P{rank}</span>
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
  rows,
}: {
  players: RoundDetailPlayer[];
  rows: Array<Record<string, number | null> & { hole: number }>;
}) {
  return (
    <div className="rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/40 p-3">
      <div className="mb-1 text-xs font-extrabold text-[#f5e6b0]">Through the round</div>
      <div className="mb-2 text-[10px] font-semibold text-emerald-100/50">
        Score to par by hole · lower is better
      </div>

      {/* Legend */}
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
        {players.map((pl, i) => (
          <div key={pl.key} className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-50">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
            {pl.name}
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid stroke="#0e4a2a" strokeDasharray="3 3" />
          <XAxis
            dataKey="hole"
            tick={{ fill: "#8fd4ad", fontSize: 10 }}
            stroke="#0e4a2a"
          />
          <YAxis
            reversed
            tick={{ fill: "#8fd4ad", fontSize: 10 }}
            stroke="#0e4a2a"
            allowDecimals={false}
            tickFormatter={(v) => toParLabel(v as number)}
          />
          <Tooltip content={<ChartTooltip players={players} />} />
          {players.map((pl, i) => (
            <Line
              key={pl.key}
              type="monotone"
              dataKey={pl.key}
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
