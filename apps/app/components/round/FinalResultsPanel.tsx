"use client";

import React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { FormatDisplayData } from "@/lib/rounds/formatScoring";

type FinalRow = {
  participantId: string;
  name: string;
  avatarUrl: string | null;
  total: number | string;
  out: number | string;
  in: number | string;
  toPar: number | null;
};

function initialsFrom(name: string) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "U";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (a + b).toUpperCase().slice(0, 2);
}

function formatToPar(toPar: number | null) {
  if (toPar == null) return "";
  if (toPar === 0) return "E";
  return toPar > 0 ? `+${toPar}` : `${toPar}`;
}

export default function FinalResultsPanel(props: {
  winner: FinalRow;
  finalRows: FinalRow[];
  formatDisplay?: FormatDisplayData | null;
  notAcceptedIds?: Set<string>;
}) {
  const { winner, finalRows, formatDisplay, notAcceptedIds } = props;
  const isStringTotal = typeof winner.total === "string";
  const scoreLabel = isStringTotal ? "Result" : formatDisplay?.higherIsBetter ? "Points" : "Total";
  const showOutIn = !isStringTotal;

  return (
    <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 overflow-hidden">
      <div className="p-4 border-b border-emerald-900/60">
        <div className="text-sm font-semibold text-[#f5e6b0]">Final results</div>
        <div className="text-[11px] text-emerald-100/70 mt-1">
          Scores are locked. This is the final scorecard.
        </div>
      </div>

      <div className="p-3">
        <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/60 p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="rounded-full border border-emerald-900/70 bg-[#0b3b21]/50 px-2.5 py-1 text-[10px] font-bold text-emerald-100/90">
              WINNER
            </div>
            <Avatar className="h-9 w-9 border border-emerald-200/70 shrink-0">
              {winner.avatarUrl ? <AvatarImage src={winner.avatarUrl} /> : null}
              <AvatarFallback className="text-[10px]">{initialsFrom(winner.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-emerald-50 truncate">{winner.name}</div>
              {showOutIn && (
                <div className="text-[11px] text-emerald-100/70">
                  OUT {winner.out} · IN {winner.in}
                </div>
              )}
              {notAcceptedIds?.has(winner.participantId) && (
                <div className="text-[9px] text-amber-400/80 mt-0.5">Not accepted for handicap</div>
              )}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-[10px] uppercase tracking-[0.14em] text-emerald-100/70">{scoreLabel}</div>
            <div className="text-2xl font-extrabold tabular-nums text-[#f5e6b0]">
              {winner.total}{" "}
              {!isStringTotal && (
                <span className="text-[12px] font-bold text-emerald-100/80 ml-1">
                  {winner.toPar != null ? `(${formatToPar(winner.toPar)})` : ""}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="divide-y divide-emerald-900/60">
        {finalRows.map((r, idx) => {
          const prev = finalRows[idx - 1];
          const rank = idx === 0 ? 1 : prev && prev.total === r.total ? null : idx + 1;

          return (
            <div key={r.participantId} className="p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-7 text-center text-[12px] font-bold text-emerald-100/90">
                  {rank ?? "•"}
                </div>

                <Avatar className="h-8 w-8 border border-emerald-200/70 shrink-0">
                  {r.avatarUrl ? <AvatarImage src={r.avatarUrl} /> : null}
                  <AvatarFallback className="text-[10px]">{initialsFrom(r.name)}</AvatarFallback>
                </Avatar>

                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-emerald-50 truncate">{r.name}</div>
                  {showOutIn && (
                    <div className="text-[11px] text-emerald-100/70">
                      OUT {r.out} · IN {r.in}
                    </div>
                  )}
                  {notAcceptedIds?.has(r.participantId) && (
                    <div className="text-[9px] text-amber-400/80 mt-0.5">Not accepted for handicap</div>
                  )}
                </div>
              </div>

              <div className="shrink-0 text-right">
                <div className="text-[10px] uppercase tracking-[0.14em] text-emerald-100/70">{scoreLabel}</div>
                <div className="text-xl font-extrabold tabular-nums text-[#f5e6b0]">
                  {r.total}{" "}
                  {!isStringTotal && (
                    <span className="text-[12px] font-bold text-emerald-100/80 ml-1">
                      {r.toPar != null ? `(${formatToPar(r.toPar)})` : ""}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
