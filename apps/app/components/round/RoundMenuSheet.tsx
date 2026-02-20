"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Participant } from "@/lib/rounds/hooks/useRoundDetail";
import type { RoundFormatType } from "@/lib/rounds/hooks/useRoundDetail";
import type { FormatDisplayData } from "@/lib/rounds/formatScoring";

const FORMAT_LABELS: Record<RoundFormatType, string> = {
  strokeplay: "Stroke Play",
  stableford: "Stableford",
  matchplay: "Match Play",
  pairs_stableford: "Pairs Stableford",
  team_strokeplay: "Team Stroke Play",
  team_stableford: "Team Stableford",
  team_bestball: "Best Ball",
  scramble: "Scramble",
  greensomes: "Greensomes",
  foursomes: "Foursomes",
  skins: "Skins",
  wolf: "Wolf",
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

type LeaderboardTab = "gross" | "net" | `format:${number}`;

type LeaderboardRow = {
  participantId: string;
  name: string;
  avatarUrl: string | null;
  score: number | string;
  toPar: number | null;
};

export default function RoundMenuSheet(props: {
  onClose: () => void;
  canFinish: boolean;
  isFinished: boolean;
  onFinishRound: () => void;
  participants: Participant[];
  formatDisplays: FormatDisplayData[];
  grossTotals: Record<string, { out: number; in: number; total: number }>;
  netTotals: Record<string, { out: number; in: number; total: number }>;
  parTotal: number | null;
  getParticipantLabel: (p: Participant) => string;
  getParticipantAvatar: (p: Participant) => string | null;
  courseLabel: string;
  formatType: RoundFormatType;
}) {
  const {
    onClose,
    canFinish,
    isFinished,
    onFinishRound,
    participants,
    formatDisplays,
    grossTotals,
    netTotals,
    parTotal,
    getParticipantLabel,
    getParticipantAvatar,
    courseLabel,
    formatType,
  } = props;

  const [activeTab, setActiveTab] = useState<LeaderboardTab>("gross");

  // Build leaderboard rows for the active tab
  function buildRows(): LeaderboardRow[] {
    if (activeTab === "gross") {
      return participants.map((p) => {
        const t = grossTotals[p.id];
        const total = t?.total ?? 0;
        return {
          participantId: p.id,
          name: getParticipantLabel(p),
          avatarUrl: getParticipantAvatar(p),
          score: total,
          toPar: typeof parTotal === "number" && total > 0 ? total - parTotal : null,
        };
      });
    }

    if (activeTab === "net") {
      return participants.map((p) => {
        const t = netTotals[p.id];
        const total = t?.total ?? 0;
        return {
          participantId: p.id,
          name: getParticipantLabel(p),
          avatarUrl: getParticipantAvatar(p),
          score: total,
          toPar: typeof parTotal === "number" && total > 0 ? total - parTotal : null,
        };
      });
    }

    // Format tab
    const idx = parseInt(activeTab.split(":")[1], 10);
    const fd = formatDisplays[idx];
    if (!fd) return [];

    return participants
      .filter((p) => !fd.filteredParticipantIds || fd.filteredParticipantIds.includes(p.id))
      .map((p) => {
        const summary = fd.summaries.find((s) => s.participantId === p.id);
        return {
          participantId: p.id,
          name: getParticipantLabel(p),
          avatarUrl: getParticipantAvatar(p),
          score: summary?.total ?? "–",
          toPar: null,
        };
      });
  }

  function sortRows(rows: LeaderboardRow[]): LeaderboardRow[] {
    // For format tabs, respect higherIsBetter
    if (activeTab.startsWith("format:")) {
      const idx = parseInt(activeTab.split(":")[1], 10);
      const fd = formatDisplays[idx];
      if (fd?.higherIsBetter) {
        return [...rows].sort((a, b) => {
          if (typeof a.score === "number" && typeof b.score === "number") return b.score - a.score;
          return 0;
        });
      }
    }
    // Default: lower is better (strokeplay, net, gross)
    return [...rows].sort((a, b) => {
      if (typeof a.score === "number" && typeof b.score === "number") return a.score - b.score;
      // String scores (matchplay) — W before L
      if (typeof a.score === "string" && typeof b.score === "string") {
        const aWin = a.score.startsWith("W");
        const bWin = b.score.startsWith("W");
        if (aWin && !bWin) return -1;
        if (!aWin && bWin) return 1;
        return 0;
      }
      return 0;
    });
  }

  const rows = sortRows(buildRows());

  // Available tabs
  const tabs: { key: LeaderboardTab; label: string }[] = [
    { key: "gross", label: "Gross" },
    { key: "net", label: "Net" },
  ];
  for (let i = 0; i < formatDisplays.length; i++) {
    tabs.push({ key: `format:${i}` as LeaderboardTab, label: formatDisplays[i].tabLabel });
  }

  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close" />
      <div className="absolute left-0 right-0 bottom-0 px-3 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-[520px] rounded-t-3xl border border-emerald-900/70 bg-[#061f12] shadow-2xl overflow-hidden max-h-[80vh] flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-emerald-900/60 flex items-center justify-between shrink-0">
            <div className="text-sm font-semibold text-emerald-50">Round Menu</div>
            <button
              className="text-emerald-100/70 hover:text-emerald-50 text-lg px-1"
              onClick={onClose}
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="overflow-y-auto flex-1" style={{ scrollbarWidth: "thin" }}>
            {/* Finish Round */}
            {canFinish && (
              <div className="p-4 border-b border-emerald-900/60">
                <Button
                  className="w-full rounded-2xl bg-[#f5e6b0] text-[#042713] hover:bg-[#e9d79c]"
                  onClick={onFinishRound}
                >
                  Finish Round
                </Button>
              </div>
            )}

            {/* Leaderboard */}
            <div className="p-4 border-b border-emerald-900/60">
              <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 mb-2">
                Leaderboard
              </div>

              {/* Tab bar */}
              <div className="rounded-xl border border-emerald-900/70 bg-[#0b3b21]/50 p-1 flex items-center overflow-hidden mb-3">
                <div className="flex overflow-x-auto w-full" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                  {tabs.map((tab) => (
                    <button
                      key={tab.key}
                      className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg shrink-0 whitespace-nowrap ${
                        activeTab === tab.key
                          ? "bg-[#f5e6b0] text-[#042713]"
                          : "text-emerald-100/80 hover:bg-emerald-900/20"
                      }`}
                      onClick={() => setActiveTab(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Rows */}
              <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/60 overflow-hidden divide-y divide-emerald-900/60">
                {rows.map((r, idx) => {
                  const prev = rows[idx - 1];
                  const sameScore = prev && prev.score === r.score;
                  const rank = idx === 0 ? 1 : sameScore ? null : idx + 1;

                  return (
                    <div key={r.participantId} className="px-3 py-2.5 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-6 text-center text-[11px] font-bold text-emerald-100/90">
                          {rank ?? "•"}
                        </div>
                        <Avatar className="h-7 w-7 border border-emerald-200/70 shrink-0">
                          {r.avatarUrl ? <AvatarImage src={r.avatarUrl} /> : null}
                          <AvatarFallback className="text-[9px]">{initialsFrom(r.name)}</AvatarFallback>
                        </Avatar>
                        <div className="text-[12px] font-semibold text-emerald-50 truncate">{r.name}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[15px] font-extrabold tabular-nums text-[#f5e6b0]">
                          {r.score}
                          {r.toPar != null && (
                            <span className="text-[10px] font-bold text-emerald-100/80 ml-1">
                              ({formatToPar(r.toPar)})
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {rows.length === 0 && (
                  <div className="px-3 py-4 text-center text-[11px] text-emerald-100/50">
                    No scores yet
                  </div>
                )}
              </div>
            </div>

            {/* Round Settings */}
            <div className="p-4">
              <div className="text-[11px] uppercase tracking-[0.14em] text-emerald-100/70 mb-2">
                Round Settings
              </div>
              <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/60 divide-y divide-emerald-900/60">
                <div className="px-3 py-2.5 flex justify-between items-center">
                  <span className="text-[11px] text-emerald-100/70">Format</span>
                  <span className="text-[12px] font-semibold text-emerald-50">{FORMAT_LABELS[formatType] ?? formatType}</span>
                </div>
                {courseLabel && (
                  <div className="px-3 py-2.5 flex justify-between items-center">
                    <span className="text-[11px] text-emerald-100/70">Course</span>
                    <span className="text-[12px] font-semibold text-emerald-50 truncate ml-4 text-right">{courseLabel}</span>
                  </div>
                )}
                <div className="px-3 py-2.5 flex justify-between items-center">
                  <span className="text-[11px] text-emerald-100/70">Status</span>
                  <span className="text-[12px] font-semibold text-emerald-50">{isFinished ? "Completed" : "In Progress"}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
