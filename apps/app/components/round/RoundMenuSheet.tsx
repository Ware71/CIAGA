"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Participant } from "@/lib/rounds/hooks/useRoundDetail";
import type { RoundFormatType } from "@/lib/rounds/hooks/useRoundDetail";
import type { FormatDisplayData } from "@/lib/rounds/formatScoring";
import { supabase } from "@/lib/supabaseClient";

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

type FreezeConfig = {
  freeze_state: "live" | "frozen" | "revealed";
  freeze_last_holes: number | null;
  freeze_scope: "all" | "top_x";
  freeze_top_x: number | null;
  reveal_style: "none" | "animated";
  reveal_top_x: number | null;
  total_holes: number;
};

type LeaderboardTab = "gross" | "net" | `format:${number}` | "competition" | "season";

type LeaderboardRow = {
  participantId: string;
  profileId?: string;
  name: string;
  avatarUrl: string | null;
  score: number | string;
  toPar: number | null;
  thru: number | null;
};

type CompetitionStandingEntry = {
  profile_id: string;
  name: string | null;
  avatar_url: string | null;
  gross_score: number | null;
  net_score: number | null;
  points_earned: number | null;
  position: number | null;
  thru: number;
  holes_completed: number;
  is_live: boolean;
  is_submitted: boolean;
};

type SeasonStandingEntry = {
  profile_id: string;
  name: string | null;
  avatar_url: string | null;
  season_points: number;
  events_played: number;
  wins: number;
  position: number | null;
};

const FEDEX_POINTS_SCALE = [500, 300, 190, 140, 110, 90, 75, 60, 48, 38, 30, 24, 18, 14, 10, 8, 6, 4, 2, 1];

function projectedPoints(
  rank: number | null,
  pointsModel: string | undefined,
  pointsTable: Record<string, number> | undefined
): number | null {
  if (!rank || !pointsModel || pointsModel === "none") return null;
  if (pointsModel === "fedex_style") return FEDEX_POINTS_SCALE[rank - 1] ?? 0;
  if ((pointsModel === "position_based" || pointsModel === "custom_table") && pointsTable) {
    return pointsTable[String(rank)] ?? null;
  }
  return null;
}

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
  holesCompletedByParticipantId: Record<string, number>;
  teams?: Array<{ id: string; name: string }>;
  allParticipants?: Participant[];
  isTeamFormat?: boolean;
  competitionId?: string;
  competitionPointsModel?: string;
  competitionPointsTable?: Record<string, number>;
  groupId?: string;
  seasonId?: string;
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
    holesCompletedByParticipantId,
    teams,
    allParticipants,
    isTeamFormat,
    competitionId,
    competitionPointsModel,
    competitionPointsTable,
    groupId,
    seasonId,
  } = props;

  const showPts = !!competitionPointsModel && competitionPointsModel !== "none";

  const [activeTab, setActiveTab] = useState<LeaderboardTab>(competitionId ? "competition" : "gross");

  // Competition standings (realtime-synced)
  const [compStandings, setCompStandings] = useState<CompetitionStandingEntry[] | null>(null);
  const [compLoading, setCompLoading] = useState(false);
  const [compFreeze, setCompFreeze] = useState<FreezeConfig | null>(null);

  async function fetchCompStandings() {
    if (!competitionId) return;
    setCompLoading(true);
    try {
      const res = await fetch(`/api/majors/leaderboard?competition_id=${competitionId}`);
      const data = await res.json();
      const rows = (data.rows ?? []).map((r: any) => ({
        profile_id: r.profile_id,
        name: r.profile?.name ?? null,
        avatar_url: r.profile?.avatar_url ?? null,
        gross_score: r.gross_score,
        net_score: r.net_score,
        points_earned: r.points_earned ?? null,
        position: r.position ?? null,
        thru: r.holes_completed ?? 0,
        holes_completed: r.holes_completed ?? 0,
        is_live: r.is_live ?? false,
        is_submitted: (r.rounds_submitted ?? 0) > 0,
      }));
      setCompStandings(rows);
      if (data.freeze) setCompFreeze(data.freeze);
    } catch {
      setCompStandings([]);
    } finally {
      setCompLoading(false);
    }
  }

  // Season/group standings (realtime-synced)
  const [seasonStandings, setSeasonStandings] = useState<SeasonStandingEntry[] | null>(null);
  const [seasonLoading, setSeasonLoading] = useState(false);

  async function fetchSeasonStandings() {
    if (!seasonId && !groupId) return;
    setSeasonLoading(true);
    try {
      let rows: SeasonStandingEntry[] = [];
      if (seasonId) {
        const res = await fetch(`/api/majors/seasons/${seasonId}/standings`);
        const data = await res.json();
        rows = (data.standings ?? []).map((r: any) => ({
          profile_id: r.profile_id,
          name: r.profile?.name ?? null,
          avatar_url: r.profile?.avatar_url ?? null,
          season_points: r.season_points ?? 0,
          events_played: r.events_played ?? 0,
          wins: r.wins ?? 0,
          position: r.position ?? null,
        }));
      } else {
        const res = await fetch(`/api/majors/leaderboard?group_id=${groupId}`);
        const data = await res.json();
        rows = (data.rows ?? []).map((r: any) => ({
          profile_id: r.profile_id,
          name: r.profile?.name ?? null,
          avatar_url: r.profile?.avatar_url ?? null,
          season_points: r.season_points ?? 0,
          events_played: r.events_played ?? 0,
          wins: r.wins ?? 0,
          position: r.position ?? null,
        }));
      }
      setSeasonStandings(rows);
    } catch {
      setSeasonStandings([]);
    } finally {
      setSeasonLoading(false);
    }
  }

  function handleTabChange(tab: LeaderboardTab) {
    setActiveTab(tab);
    if (tab === "competition") fetchCompStandings();
    if (tab === "season") fetchSeasonStandings();
  }

  const hasSeasonTab = !!(groupId || seasonId);

  // Realtime: competition leaderboard
  useEffect(() => {
    if (!competitionId) return;
    fetchCompStandings();

    let cancelled = false;
    const channel = supabase
      .channel(`round-menu:comp:${competitionId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "competition_leaderboard_entries",
        filter: `competition_id=eq.${competitionId}`,
      }, () => { if (!cancelled) fetchCompStandings(); })
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "competitions",
        filter: `id=eq.${competitionId}`,
      }, (payload) => {
        if (!cancelled && payload.new) {
          const c = payload.new as any;
          setCompFreeze((prev) =>
            prev ? { ...prev, freeze_state: c.leaderboard_freeze_state ?? prev.freeze_state } : prev
          );
          if (c.leaderboard_freeze_state === "revealed") fetchCompStandings();
        }
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [competitionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: season standings
  useEffect(() => {
    if (!seasonId && !groupId) return;
    fetchSeasonStandings();

    let cancelled = false;
    const channelKey = seasonId ?? groupId!;
    const table = seasonId ? "season_standings_entries" : "major_group_standings";
    const filter = seasonId ? `season_id=eq.${seasonId}` : `group_id=eq.${groupId}`;
    const channel = supabase
      .channel(`round-menu:season:${channelKey}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table,
        filter,
      }, () => { if (!cancelled) fetchSeasonStandings(); })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [seasonId, groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Map from first-member participant ID → all team members (for showing players under each team row)
  const teamMembersByFirstId = useMemo<Record<string, Participant[]>>(() => {
    if (!isTeamFormat || !teams?.length || !allParticipants?.length) return {};
    const map: Record<string, Participant[]> = {};
    for (const t of teams) {
      const members = allParticipants.filter((p) => (p as any).team_id === t.id);
      const first = members[0];
      if (first) map[first.id] = members;
    }
    return map;
  }, [isTeamFormat, teams, allParticipants]);

  // Build leaderboard rows for the active tab
  function buildRows(): LeaderboardRow[] {
    if (activeTab === "gross") {
      return participants.map((p) => {
        const t = grossTotals[p.id];
        const total = t?.total ?? 0;
        const thru = holesCompletedByParticipantId[p.id] ?? null;
        return {
          participantId: p.id,
          profileId: (p as any).profile_id ?? undefined,
          name: getParticipantLabel(p),
          avatarUrl: getParticipantAvatar(p),
          score: total,
          toPar: typeof parTotal === "number" && total > 0 ? total - parTotal : null,
          thru: thru > 0 ? thru : null,
        };
      });
    }

    if (activeTab === "net") {
      return participants.map((p) => {
        const t = netTotals[p.id];
        const total = t?.total ?? 0;
        const thru = holesCompletedByParticipantId[p.id] ?? null;
        return {
          participantId: p.id,
          profileId: (p as any).profile_id ?? undefined,
          name: getParticipantLabel(p),
          avatarUrl: getParticipantAvatar(p),
          score: total,
          toPar: typeof parTotal === "number" && total > 0 ? total - parTotal : null,
          thru: thru > 0 ? thru : null,
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
        const thru = holesCompletedByParticipantId[p.id] ?? null;
        return {
          participantId: p.id,
          profileId: (p as any).profile_id ?? undefined,
          name: getParticipantLabel(p),
          avatarUrl: getParticipantAvatar(p),
          score: summary?.total ?? "–",
          toPar: null,
          thru: thru > 0 ? thru : null,
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

  // Available tabs — round tabs, then competition / season if applicable
  const tabs: { key: LeaderboardTab; label: string }[] = [
    { key: "gross", label: "Gross" },
    ...(!competitionId ? [{ key: "net" as LeaderboardTab, label: "Net" }] : []),
  ];
  for (let i = 0; i < formatDisplays.length; i++) {
    tabs.push({ key: `format:${i}` as LeaderboardTab, label: formatDisplays[i].tabLabel });
  }
  if (competitionId) {
    tabs.push({ key: "competition", label: "Competition" });
  }
  if (hasSeasonTab) {
    tabs.push({ key: "season", label: "Season" });
  }

  const isRoundTab = activeTab === "gross" || activeTab === "net" || activeTab.startsWith("format:");

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
                      onClick={() => handleTabChange(tab.key)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Round leaderboard rows (only when a round tab is active) */}
              {isRoundTab && (
                <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/60 overflow-hidden divide-y divide-emerald-900/60">
                  {rows.map((r, idx) => {
                    const prev = rows[idx - 1];
                    const sameScore = prev && prev.score === r.score;
                    const rank = idx === 0 ? 1 : sameScore ? null : idx + 1;
                    const effectiveRank = rank ?? idx + 1;
                    // When this is a competition round, use full-field position from compStandings
                    const compEntry = (competitionId && compStandings && r.profileId)
                      ? compStandings.find((s) => s.profile_id === r.profileId)
                      : null;
                    const pts = showPts
                      ? (compEntry
                          ? (compEntry.points_earned ?? projectedPoints(compEntry.position, competitionPointsModel, competitionPointsTable))
                          : projectedPoints(effectiveRank, competitionPointsModel, competitionPointsTable))
                      : null;
                    const teamMembers = teamMembersByFirstId[r.participantId];

                    return (
                      <div key={r.participantId}>
                        <div className="px-3 py-2.5 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-6 text-center text-[11px] font-bold text-emerald-100/90">
                              {rank ?? "•"}
                            </div>
                            <Avatar className="h-7 w-7 border border-emerald-200/70 shrink-0">
                              {r.avatarUrl ? <AvatarImage src={r.avatarUrl} /> : null}
                              <AvatarFallback className="text-[9px]">{initialsFrom(r.name)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="text-[12px] font-semibold text-emerald-50 truncate">{r.name}</div>
                              {r.thru != null && (
                                <div className="text-[10px] text-emerald-100/55 leading-none mt-0.5">Thru {r.thru}</div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            {showPts && (
                              <div className="text-right">
                                <div className="text-[9px] text-emerald-200/50 uppercase tracking-wider leading-none">Pts</div>
                                <div className="text-[11px] font-bold text-emerald-300 tabular-nums">{pts ?? "—"}</div>
                              </div>
                            )}
                            <div className="text-right">
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
                        </div>
                        {isTeamFormat && teamMembers && teamMembers.length > 0 && (
                          <div className="pl-11 pr-3 pb-2 flex flex-wrap gap-1.5">
                            {teamMembers.map((m) => {
                              const mName = getParticipantLabel(m);
                              const mUrl = getParticipantAvatar(m);
                              return (
                                <div key={m.id} className="flex items-center gap-1 text-[10px] text-emerald-100/60">
                                  <Avatar className="h-4 w-4 border border-emerald-200/50 shrink-0">
                                    {mUrl ? <AvatarImage src={mUrl} /> : null}
                                    <AvatarFallback className="text-[7px]">{initialsFrom(mName)}</AvatarFallback>
                                  </Avatar>
                                  <span>{mName}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {rows.length === 0 && (
                    <div className="px-3 py-4 text-center text-[11px] text-emerald-100/50">
                      No scores yet
                    </div>
                  )}
                </div>
              )}

              {/* Competition tab */}
              {activeTab === "competition" && (
                <>
                {compFreeze?.freeze_state === "frozen" && (
                  <div className="flex items-center gap-2 rounded-xl border border-amber-700/50 bg-amber-900/20 px-3 py-2 mb-3">
                    <span className="text-amber-400 text-sm">🔒</span>
                    <div>
                      <p className="text-xs font-semibold text-amber-300">Leaderboard frozen</p>
                      {compFreeze.freeze_last_holes != null && (
                        <p className="text-[10px] text-amber-300/70">
                          Last {compFreeze.freeze_last_holes} hole{compFreeze.freeze_last_holes !== 1 ? "s" : ""} hidden
                          {compFreeze.freeze_scope === "top_x" && compFreeze.freeze_top_x != null
                            ? ` (top ${compFreeze.freeze_top_x} positions only)`
                            : ""}
                        </p>
                      )}
                    </div>
                  </div>
                )}
                <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/60 overflow-hidden divide-y divide-emerald-900/60">
                  {compLoading && (
                    <div className="px-3 py-4 text-center text-[11px] text-emerald-100/50">Loading…</div>
                  )}
                  {!compLoading && (compStandings ?? []).map((s) => {
                    const score = s.net_score ?? s.gross_score;
                    const pts = showPts
                      ? (s.points_earned ?? projectedPoints(s.position, competitionPointsModel, competitionPointsTable))
                      : null;
                    return (
                      <div key={s.profile_id} className="px-3 py-2.5 flex items-center gap-2.5">
                        <div className="w-6 text-center text-[11px] font-bold text-emerald-100/90">{s.position ?? "—"}</div>
                        <Avatar className="h-7 w-7 border border-emerald-200/70 shrink-0">
                          {s.avatar_url ? <AvatarImage src={s.avatar_url} /> : null}
                          <AvatarFallback className="text-[9px]">{initialsFrom(s.name ?? "")}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] font-semibold text-emerald-50 truncate">{s.name ?? "—"}</div>
                          <div className="text-[10px] text-emerald-100/55 leading-none mt-0.5">
                            {s.is_live ? `Live · Thru ${s.holes_completed}` : s.is_submitted ? "Submitted" : "Pending"}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {showPts && (
                            <div className="text-right">
                              <div className="text-[9px] text-emerald-200/50 uppercase tracking-wider leading-none">Pts</div>
                              <div className="text-[11px] font-bold text-emerald-300 tabular-nums">{pts ?? "—"}</div>
                            </div>
                          )}
                          <div className="text-right">
                            <div className="text-[15px] font-extrabold tabular-nums text-[#f5e6b0]">
                              {score != null ? score : "—"}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {!compLoading && (compStandings ?? []).length === 0 && (
                    <div className="px-3 py-4 text-center text-[11px] text-emerald-100/50">No scores yet</div>
                  )}
                </div>
                </>
              )}

              {/* Season tab */}
              {activeTab === "season" && (
                <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/60 overflow-hidden divide-y divide-emerald-900/60">
                  {seasonLoading && (
                    <div className="px-3 py-4 text-center text-[11px] text-emerald-100/50">Loading…</div>
                  )}
                  {!seasonLoading && (seasonStandings ?? []).map((s) => (
                    <div key={s.profile_id} className="px-3 py-2.5 flex items-center gap-2.5">
                      <div className="w-6 text-center text-[11px] font-bold text-emerald-100/90">{s.position ?? "—"}</div>
                      <Avatar className="h-7 w-7 border border-emerald-200/70 shrink-0">
                        {s.avatar_url ? <AvatarImage src={s.avatar_url} /> : null}
                        <AvatarFallback className="text-[9px]">{initialsFrom(s.name ?? "")}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-semibold text-emerald-50 truncate">{s.name ?? "—"}</div>
                        <div className="text-[10px] text-emerald-100/55 leading-none mt-0.5">
                          {s.events_played} event{s.events_played !== 1 ? "s" : ""}{s.wins > 0 ? ` · ${s.wins}W` : ""}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[15px] font-extrabold tabular-nums text-[#f5e6b0]">{s.season_points}</div>
                        <div className="text-[9px] text-emerald-100/50">pts</div>
                      </div>
                    </div>
                  ))}
                  {!seasonLoading && (seasonStandings ?? []).length === 0 && (
                    <div className="px-3 py-4 text-center text-[11px] text-emerald-100/50">No standings yet</div>
                  )}
                </div>
              )}
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
