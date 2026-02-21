"use client";

import React, { useMemo } from "react";
import RoundHistoryList from "@/components/profile/RoundHistoryList";

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

export default function NonAcceptableRoundsTab({
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
  const nonAcceptableRounds = useMemo(
    () => rounds.filter((r) => typeof scoreDiffByRoundId[r.id] !== "number"),
    [rounds, scoreDiffByRoundId]
  );

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
    <RoundHistoryList
      rounds={nonAcceptableRounds}
      teeNameByRoundId={teeNameByRoundId}
      totalByRoundId={totalByRoundId}
      agsByRoundId={agsByRoundId}
      scoreDiffByRoundId={scoreDiffByRoundId}
      hiUsedByRoundId={hiUsedByRoundId}
      fromContext={fromContext}
      emptyMessage="No non-acceptable rounds."
    />
  );
}
