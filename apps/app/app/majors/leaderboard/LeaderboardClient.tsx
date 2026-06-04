"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { supabase } from "@/lib/supabaseClient";
import type {
  LeaderboardEntryWithProfile,
  GroupStandingWithProfile,
  FrozenLeaderboardEntry,
  LeaderboardFreezeState,
  LeaderboardRevealStyle,
} from "@/lib/majors/types";
import { LeaderboardReveal } from "@/components/majors/LeaderboardReveal";

type Tab = "competition" | "group";

type FreezeConfig = {
  freeze_state: LeaderboardFreezeState;
  freeze_last_holes: number | null;
  freeze_scope: string;
  freeze_top_x: number | null;
  reveal_style: LeaderboardRevealStyle;
  reveal_top_x: number | null;
  total_holes: number;
};

type CompetitionRow = LeaderboardEntryWithProfile | FrozenLeaderboardEntry;

function isCompetitionRow(row: any): row is LeaderboardEntryWithProfile {
  return "computed_at" in row;
}

function getScore(row: CompetitionRow, scoringModel: string): number | null {
  if (isCompetitionRow(row)) return row.net_score ?? row.gross_score ?? null;
  return (row as FrozenLeaderboardEntry).net_score ?? (row as FrozenLeaderboardEntry).gross_score ?? null;
}

function getToPar(row: CompetitionRow): number | null {
  return (row as any).to_par ?? null;
}

function formatLeaderboardScore(
  toPar: number | null,
  rawScore: number | null
): string {
  if (toPar != null) return toPar === 0 ? "E" : toPar > 0 ? `+${toPar}` : String(toPar);
  return rawScore != null ? String(rawScore) : "—";
}

function getHoles(row: CompetitionRow): number {
  if (isCompetitionRow(row)) return row.holes_completed ?? 0;
  return (row as FrozenLeaderboardEntry).holes_shown ?? 0;
}

function isLive(row: CompetitionRow): boolean {
  if (isCompetitionRow(row)) return row.is_live ?? false;
  return (row as FrozenLeaderboardEntry).is_live ?? false;
}

export default function LeaderboardClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const competitionId = searchParams.get("event_id");
  const groupId = searchParams.get("group_id");

  const initialTab: Tab = groupId ? "group" : "competition";
  const [tab, setTab] = useState<Tab>(initialTab);

  const [compRows, setCompRows] = useState<CompetitionRow[]>([]);
  const [groupRows, setGroupRows] = useState<GroupStandingWithProfile[]>([]);
  const [freeze, setFreeze] = useState<FreezeConfig | null>(null);
  const [scoringModel, setScoringModel] = useState<string>("net");
  const [loading, setLoading] = useState(true);
  const [showReveal, setShowReveal] = useState(false);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [revealLoading, setRevealLoading] = useState(false);
  const accessTokenRef = useRef<string | null>(null);

  async function fetchLeaderboard(id: string, t: Tab) {
    const session = await getViewerSession();
    if (!session) return;
    accessTokenRef.current = session.accessToken;

    const param = t === "competition" ? `event_id=${id}` : `group_id=${id}`;
    const res = await fetch(`/api/majors/leaderboard?${param}`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!res.ok) return;
    const json = await res.json();
    if (t === "competition") {
      setCompRows(json.rows ?? []);
      if (json.freeze) setFreeze(json.freeze);
      if (json.my_role !== undefined) setMyRole(json.my_role);
      if (json.scoring_model) setScoringModel(json.scoring_model);
    } else {
      setGroupRows(json.rows ?? []);
    }
  }

  // Initial fetch + realtime subscription
  useEffect(() => {
    let cancelled = false;
    const id = tab === "competition" ? competitionId : groupId;
    if (!id) { setLoading(false); return; }

    (async () => {
      setLoading(true);
      try {
        await fetchLeaderboard(id, tab);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // Realtime subscription for competition tab
    if (tab === "competition" && competitionId) {
      const channel = supabase
        .channel(`leaderboard:${competitionId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "event_leaderboard_entries",
            filter: `event_id=eq.${competitionId}`,
          },
          () => {
            if (!cancelled) fetchLeaderboard(competitionId, "competition");
          }
        )
        // Also watch competitions row for freeze_state changes
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "events",
            filter: `id=eq.${competitionId}`,
          },
          (payload) => {
            if (!cancelled && payload.new) {
              const c = payload.new as any;
              setFreeze((prev) =>
                prev
                  ? {
                      ...prev,
                      freeze_state: c.leaderboard_freeze_state ?? prev.freeze_state,
                    }
                  : prev
              );
              // Switch to frozen data as soon as freeze activates
              if (c.leaderboard_freeze_state === "frozen") {
                fetchLeaderboard(competitionId, "competition");
              }
              // If just revealed, trigger reveal sequence
              if (c.leaderboard_freeze_state === "revealed") {
                fetchLeaderboard(competitionId, "competition");
                setShowReveal(true);
              }
            }
          }
        )
        .subscribe();

      return () => {
        cancelled = true;
        supabase.removeChannel(channel);
      };
    }

    return () => { cancelled = true; };
  }, [tab, competitionId, groupId]);

  async function handleReveal() {
    if (!competitionId) return;
    setRevealLoading(true);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/events/${competitionId}/freeze-control`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({ action: "reveal" }),
      });
      if (res.ok) {
        setFreeze((prev) => prev ? { ...prev, freeze_state: "revealed" } : prev);
        setShowReveal(true);
      }
    } finally {
      setRevealLoading(false);
    }
  }

  const rows = tab === "competition" ? compRows : groupRows;
  const isFrozen = freeze?.freeze_state === "frozen";
  const totalHoles = freeze?.total_holes ?? 18;
  const canReveal = freeze?.freeze_state !== "revealed" && (myRole === "owner" || myRole === "admin");

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] px-4 pt-8 max-w-sm mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => router.back()} className="text-[11px] text-emerald-100/70 hover:text-emerald-50">
          ← Back
        </button>
        <h1 className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Leaderboard</h1>
        <div className="w-14" />
      </div>

      {/* Tab strip */}
      {competitionId && groupId && (
        <div className="flex gap-2">
          {(["competition", "group"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors capitalize ${
                tab === t
                  ? "bg-emerald-700 text-white"
                  : "border border-emerald-900/60 text-emerald-200/70"
              }`}
            >
              {t === "competition" ? "Competition" : "Season"}
            </button>
          ))}
        </div>
      )}

      {/* Freeze banner */}
      {tab === "competition" && isFrozen && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-700/50 bg-amber-900/20 px-3 py-2">
          <span className="text-amber-400 text-sm">🔒</span>
          <div>
            <p className="text-xs font-semibold text-amber-300">Leaderboard frozen</p>
            {freeze?.freeze_last_holes != null && (
              <p className="text-[10px] text-amber-300/70">
                Last {freeze.freeze_last_holes} hole{freeze.freeze_last_holes !== 1 ? "s" : ""} hidden
                {freeze.freeze_scope === "top_x" && freeze.freeze_top_x != null
                  ? ` (top ${freeze.freeze_top_x} positions only)`
                  : ""}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Reveal button — owners and admins only */}
      {tab === "competition" && canReveal && (
        <button
          type="button"
          onClick={handleReveal}
          disabled={revealLoading}
          className="w-full py-3 rounded-full bg-[#f5e6b0] text-[#042713] text-sm font-semibold disabled:opacity-50"
        >
          {revealLoading ? "Revealing…" : isFrozen ? "Reveal Results" : "Start Ceremony"}
        </button>
      )}

      {loading && (
        <div className="text-sm text-emerald-100/60 text-center py-10">Loading…</div>
      )}

      {!loading && rows.length === 0 && (
        <div className="text-sm text-emerald-100/60 text-center py-10">
          No results yet. Submit a round to appear here.
        </div>
      )}

      <div className="space-y-2 pb-8">
        {rows.map((row: any, idx) => {
          const score = tab === "competition" ? getScore(row, scoringModel) : null;
          const holes = tab === "competition" ? getHoles(row) : null;
          const live = tab === "competition" ? isLive(row) : false;
          const threshold = freeze
            ? freeze.total_holes - (freeze.freeze_last_holes ?? 0)
            : Infinity;
          const playerHolesShown = (row as any).holes_shown ?? (isCompetitionRow(row) ? row.holes_completed ?? 0 : 0);
          const isFrozenRow = isFrozen && tab === "competition" &&
            playerHolesShown >= threshold &&
            (freeze?.freeze_scope !== "top_x" || (row.position ?? idx + 1) <= (freeze?.freeze_top_x ?? Infinity));
          const actualHoles: number | undefined = (row as any).actual_holes_completed;

          const thruLabel = (() => {
            if (holes == null || holes === 0) return null;
            if (isFrozenRow && live && actualHoles != null && actualHoles > holes) {
              return `thru ${holes} (${actualHoles})`;
            }
            if (isFrozenRow && !live) return `thru ${holes} (F)`;
            if (live) return `thru ${holes}`;
            return holes >= totalHoles ? "F" : `thru ${holes}`;
          })();

          return (
            <div
              key={row.id ?? row.profile_id}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
                isFrozenRow
                  ? "border-cyan-700/40 bg-cyan-900/30"
                  : "border-emerald-900/50 bg-[#0b3b21]/60"
              }`}
            >
              <span className="w-6 text-center text-xs font-extrabold text-[#f5e6b0]">
                {row.position ?? idx + 1}
              </span>
              <button
                type="button"
                className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                onClick={() => router.push(`/player/${row.profile_id}`)}
              >
                {row.profile?.avatar_url ? (
                  <img src={row.profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">
                    {row.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="block text-sm font-semibold text-emerald-50 truncate text-left">
                      {row.profile?.name ?? "Unknown"}
                    </span>
                    {isFrozenRow && <span className="text-[11px] leading-none shrink-0">❄️</span>}
                  </div>
                  {tab === "competition" && thruLabel && (
                    <span className={`text-[10px] ${isFrozenRow ? "text-cyan-300/70" : "text-emerald-100/40"}`}>
                      {thruLabel}
                    </span>
                  )}
                </div>
              </button>
              <div className="text-right shrink-0">
                {tab === "competition" ? (
                  scoringModel === "stableford_points" ? (
                    <>
                      <div className="text-xs font-extrabold text-[#f5e6b0]">
                        {(row as any).format_points != null ? `${(row as any).format_points} pts` : "—"}
                      </div>
                      {getToPar(row) != null && (
                        <div className="text-[10px] text-emerald-100/50">
                          {getToPar(row) === 0 ? "E" : getToPar(row)! > 0 ? `+${getToPar(row)}` : String(getToPar(row))}
                        </div>
                      )}
                      {(row as any).gross_score != null && (
                        <div className="text-[10px] text-emerald-100/40">{(row as any).gross_score} gross</div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="text-xs font-extrabold text-[#f5e6b0]">
                        {formatLeaderboardScore(getToPar(row), score)}
                      </div>
                      <div className="text-[10px] text-emerald-100/50">to par</div>
                      {(row as any).gross_score != null && (
                        <div className="text-[10px] text-emerald-100/40">{(row as any).gross_score} gross</div>
                      )}
                    </>
                  )
                ) : (
                  <>
                    <div className="text-xs font-extrabold text-[#f5e6b0]">{row.season_points ?? 0} pts</div>
                    <div className="text-[10px] text-emerald-100/50">{row.events_played ?? 0} events</div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Animated reveal overlay */}
      {showReveal && freeze && tab === "competition" && (
        <LeaderboardReveal
          rows={compRows as LeaderboardEntryWithProfile[]}
          revealStyle={freeze.reveal_style}
          revealTopX={freeze.reveal_top_x}
          scoringModel={scoringModel}
          onDone={() => setShowReveal(false)}
        />
      )}
    </div>
  );
}
