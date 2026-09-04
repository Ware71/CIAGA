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
  netByRoundId?: Record<string, number>;
  scoreDiffByRoundId: Record<string, number>;
  hiUsedByRoundId: Record<string, number>;
  /** `handicap_round_results.rejected_reason` per round — why it didn't count. */
  rejectedReasonByRoundId?: Record<string, string | null>;
  loading?: boolean;
  error?: string | null;
  fromContext?: "player" | "history";
};

export default function NonAcceptableRoundsTab({
  rounds,
  teeNameByRoundId,
  totalByRoundId,
  agsByRoundId,
  netByRoundId,
  scoreDiffByRoundId,
  hiUsedByRoundId,
  rejectedReasonByRoundId,
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
      <div className="mt-2 rounded-2xl border border-[color:var(--sec-hair)] bg-[color:color-mix(in_srgb,var(--sec-surface)_70%,transparent)] p-4 text-sm text-[color:var(--sec-muted)]">
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
      netByRoundId={netByRoundId}
      scoreDiffByRoundId={scoreDiffByRoundId}
      hiUsedByRoundId={hiUsedByRoundId}
      rejectedReasonByRoundId={rejectedReasonByRoundId}
      fromContext={fromContext}
      emptyMessage="No non-acceptable rounds."
    />
  );
}
