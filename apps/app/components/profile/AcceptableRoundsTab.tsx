"use client";

import React, { useMemo } from "react";
import RoundHistoryList from "@/components/profile/RoundHistoryList";
import { usedDifferentialsCount } from "@/lib/profile/helpers";

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
  loading?: boolean;
  error?: string | null;
  fromContext?: "player" | "history";
};

export default function AcceptableRoundsTab({
  rounds,
  teeNameByRoundId,
  totalByRoundId,
  agsByRoundId,
  scoreDiffByRoundId,
  hiUsedByRoundId,
  loading,
  error,
  fromContext = "player",
}: Props) {
  const acceptableRounds = useMemo(
    () => rounds.filter((r) => typeof scoreDiffByRoundId[r.id] === "number"),
    [rounds, scoreDiffByRoundId]
  );

  const scoringRoundsNewestFirst = useMemo(() => {
    return acceptableRounds
      .map((r) => {
        const sd = scoreDiffByRoundId[r.id];
        return typeof sd === "number" ? { roundId: r.id, sd } : null;
      })
      .filter(Boolean) as { roundId: string; sd: number }[];
  }, [acceptableRounds, scoreDiffByRoundId]);

  const window20 = useMemo(() => scoringRoundsNewestFirst.slice(0, 20), [scoringRoundsNewestFirst]);
  const usedCount = useMemo(() => usedDifferentialsCount(window20.length), [window20.length]);

  const countingSet = useMemo(() => {
    if (usedCount <= 0) return new Set<string>();
    const sortedBySd = [...window20].sort((a, b) => a.sd - b.sd);
    const used = sortedBySd.slice(0, usedCount).map((x) => x.roundId);
    return new Set(used);
  }, [window20, usedCount]);

  const cutoffRoundId = useMemo(() => {
    if (!window20.length) return null;
    return window20[window20.length - 1].roundId;
  }, [window20]);

  if (loading) {
    return (
      <div className="mt-2 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
        Loading history...
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-2 rounded-2xl border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-100">
        {error}
      </div>
    );
  }

  return (
    <div>
      {window20.length >= 3 && usedCount > 0 && (
        <div className="px-1 mb-1 text-[10px] text-emerald-100/60">
          {usedCount} of {window20.length} counting
        </div>
      )}
      <RoundHistoryList
        rounds={acceptableRounds}
        teeNameByRoundId={teeNameByRoundId}
        totalByRoundId={totalByRoundId}
        agsByRoundId={agsByRoundId}
        scoreDiffByRoundId={scoreDiffByRoundId}
        hiUsedByRoundId={hiUsedByRoundId}
        countingSet={countingSet}
        cutoffRoundId={cutoffRoundId}
        fromContext={fromContext}
        emptyMessage="No acceptable rounds yet."
      />
    </div>
  );
}
