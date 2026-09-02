"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { one } from "@/lib/stats/helpers";
import { shortDate, monthKey } from "@/lib/profile/helpers";
import { formatHI } from "@/lib/rounds/handicapUtils";
import { rejectedReasonLabel } from "@/lib/whs/acceptability";

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
  netByRoundId?: Record<string, number>;
  scoreDiffByRoundId: Record<string, number>;
  hiUsedByRoundId: Record<string, number>;
  countingSet?: Set<string>;
  cutoffRoundId?: string | null;
  /** `handicap_round_results.rejected_reason` per round, for non-acceptable rounds. */
  rejectedReasonByRoundId?: Record<string, string | null>;
  fromContext?: "player" | "history";
  emptyMessage?: string;
};

export default function RoundHistoryList({
  rounds,
  teeNameByRoundId,
  totalByRoundId,
  agsByRoundId,
  netByRoundId,
  scoreDiffByRoundId,
  hiUsedByRoundId,
  countingSet,
  cutoffRoundId,
  rejectedReasonByRoundId,
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
      <div className="mt-2 rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] p-4 text-sm text-[color:var(--sec-muted)]">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-4">
      {grouped.map(([month, list]) => (
        <section key={month} className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <div className="text-[11px] uppercase tracking-[0.14em] text-[color:var(--sec-muted)]">{month}</div>
            <div className="text-[11px] text-[color:var(--sec-muted)]">{list.length}</div>
          </div>

          <div className="rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] overflow-hidden">
            <div className="p-2 space-y-2">
              {list.map((r) => {
                const course = one(r.courses)?.name ?? "Unknown course";
                const played = shortDate(r.started_at ?? r.created_at);
                const titleText = r.name?.trim() ? r.name.trim() : course;
                const teeName = teeNameByRoundId[r.id] ?? "\u2014";

                const href = { pathname: `/round/${r.id}`, query: { from: fromContext } } as const;

                const ags = agsByRoundId[r.id];
                const total = totalByRoundId[r.id];
                const displayScore = total ?? ags;
                const scoreText = typeof displayScore === "number" ? String(displayScore) : "\u2014";

                const net = netByRoundId?.[r.id];
                const netText = typeof net === "number" ? `Net: ${net}` : "";

                const sd = scoreDiffByRoundId[r.id];
                const hiForRound = hiUsedByRoundId[r.id];
                const isExceptional =
                  typeof hiForRound === "number" && typeof sd === "number" && sd <= hiForRound - 7;

                const isCounting = countingSet?.has(r.id) ?? false;
                const isCutoff = cutoffRoundId === r.id;
                const rejectionText = rejectedReasonLabel(rejectedReasonByRoundId?.[r.id]);

                return (
                  <Link
                    key={r.id}
                    href={href}
                    className={[
                      "block p-3 hover:bg-[color:var(--sec-surface-2)] transition-colors",
                      isCounting ? "rounded-2xl ring-2 ring-[color:color-mix(in_srgb,var(--sec-accent)_80%,transparent)]" : "",
                      isCutoff ? "border-b-6 border-b-[color:var(--sec-accent)]" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-semibold text-[color:var(--sec-text)] truncate">{titleText}</div>
                        <div className="text-[9px] text-[color:var(--sec-muted)] truncate">
                          {teeName} &middot; {played}
                        </div>
                        {rejectionText && (
                          <div className="text-[9px] text-amber-400/80 truncate mt-0.5">
                            {rejectionText}
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 grid grid-cols-2 gap-1 items-center">
                        <div className="text-right">
                          <div className="text-[12px] font-extrabold tabular-nums text-[color:var(--sec-text)] leading-none">
                            {typeof hiForRound === "number" ? `HI ${formatHI(hiForRound)}` : "—"}
                          </div>
                          <div className="mt-0.5 text-[9px] tabular-nums text-[color:var(--sec-muted)]">
                            <span className="inline-flex items-center gap-0.5 justify-end">
                              {typeof sd === "number" ? `SD ${sd.toFixed(1)}` : ""}
                              {isExceptional && (
                                <span className="text-[color:color-mix(in_srgb,var(--sec-accent)_80%,transparent)]" title="Exceptional round">&#10024;</span>
                              )}
                            </span>
                          </div>
                        </div>

                        <div className="text-right">
                          <div className="text-[14px] font-extrabold tabular-nums text-[color:var(--sec-accent)] leading-none">
                            {scoreText}
                          </div>
                          <div className="mt-0.5 text-[9px] text-[color:var(--sec-muted)]">{netText || " "}</div>
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
