"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { one } from "@/lib/stats/helpers";
import { shortDate, monthKey } from "@/lib/profile/helpers";

type RoundRow = {
  id: string;
  name: string | null;
  status: string;
  started_at: string | null;
  created_at: string | null;
  course_id: string | null;
  courses?: { name: string | null }[] | { name: string | null } | null;
};

type Props = {
  rounds: RoundRow[];
  teeNameByRoundId: Record<string, string>;
  totalByRoundId: Record<string, number>;
  agsByRoundId: Record<string, number>;
  scoreDiffByRoundId: Record<string, number>;
  hiUsedByRoundId: Record<string, number>;
  countingSet?: Set<string>;
  cutoffRoundId?: string | null;
  fromContext?: "player" | "history";
  emptyMessage?: string;
};

export default function RoundHistoryList({
  rounds,
  teeNameByRoundId,
  totalByRoundId,
  agsByRoundId,
  scoreDiffByRoundId,
  hiUsedByRoundId,
  countingSet,
  cutoffRoundId,
  fromContext = "player",
  emptyMessage = "No rounds yet.",
}: Props) {
  const grouped = useMemo(() => {
    const m = new Map<string, RoundRow[]>();
    for (const r of rounds) {
      const k = monthKey(r.started_at ?? r.created_at);
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    }
    return Array.from(m.entries());
  }, [rounds]);

  if (rounds.length === 0) {
    return (
      <div className="mt-2 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/70">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-4">
      {grouped.map(([month, list]) => (
        <section key={month} className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70">{month}</div>
            <div className="text-[11px] text-emerald-100/60">{list.length}</div>
          </div>

          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 overflow-hidden">
            <div className="p-2 space-y-2">
              {list.map((r) => {
                const course = one(r.courses)?.name ?? "Unknown course";
                const played = shortDate(r.started_at ?? r.created_at);
                const titleText = r.name?.trim() ? r.name.trim() : course;
                const teeName = teeNameByRoundId[r.id] ?? "\u2014";

                const href = { pathname: `/round/${r.id}`, query: { from: fromContext } } as const;

                const total = totalByRoundId[r.id];
                const scoreText = typeof total === "number" ? String(total) : "\u2014";

                const ags = agsByRoundId[r.id];
                const agsText = typeof ags === "number" ? `(${ags})` : "";

                const sd = scoreDiffByRoundId[r.id];
                const sdText = typeof sd === "number" ? `Score Diff: ${sd.toFixed(1)}` : "SD \u2014";

                const hiForRound = hiUsedByRoundId[r.id];
                const isExceptional =
                  typeof hiForRound === "number" && typeof sd === "number" && sd <= hiForRound - 7;

                const hiText2 = typeof hiForRound === "number" ? `Index: ${hiForRound.toFixed(1)}` : "\u2014";

                const isCounting = countingSet?.has(r.id) ?? false;
                const isCutoff = cutoffRoundId === r.id;

                return (
                  <Link
                    key={r.id}
                    href={href}
                    className={[
                      "block p-3 hover:bg-emerald-900/15 transition-colors",
                      isCounting ? "rounded-2xl ring-2 ring-[#f5e6b0]/80" : "",
                      isCutoff ? "border-b-6 border-b-[#f5e6b0]" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-emerald-50 truncate">{titleText}</div>
                        <div className="text-[11px] text-emerald-100/70 truncate">
                          {teeName} &middot; {played}
                        </div>
                      </div>

                      <div className="shrink-0 grid grid-cols-2 gap-4 items-center">
                        <div className="text-right">
                          <div className="text-[16px] font-extrabold tabular-nums text-emerald-50 leading-none">
                            {hiText2}
                          </div>
                          <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-emerald-100/60">
                            <span className="inline-flex items-center gap-1 justify-end">
                              {sdText}
                              {isExceptional && (
                                <span className="text-[#f5e6b0]/80" title="Exceptional round">
                                  ✨
                                </span>
                              )}
                            </span>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-[18px] font-extrabold tabular-nums text-[#f5e6b0] leading-none">
                            {scoreText}
                          </div>
                          <div className="mt-1 text-[10px] text-emerald-100/60">{agsText || "\u00A0"}</div>
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
