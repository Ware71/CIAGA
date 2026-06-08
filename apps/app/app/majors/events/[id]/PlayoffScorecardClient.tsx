"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { strokesReceivedOnHole } from "@/lib/rounds/handicapUtils";
import type {
  EventPlayoff,
  EventPlayoffHole,
  EventPlayoffScore,
  PlayoffHoleWithScores,
} from "@/lib/majors/types";

interface Props {
  playoff: EventPlayoff;
  eventId: string;
  canScore: boolean;
}

type Profile = { id: string; name: string | null; avatar_url: string | null };
type EntryInfo = { profile_id: string; course_handicap: number };

export function PlayoffScorecardClient({ playoff, eventId, canScore }: Props) {
  const [holes, setHoles] = useState<PlayoffHoleWithScores[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [entries, setEntries] = useState<Record<string, EntryInfo>>({});
  const [loading, setLoading] = useState(true);
  const [scoreInput, setScoreInput] = useState<Record<string, string>>({});  // `${holeId}:${profileId}` → value
  const [saving, setSaving] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [addingHole, setAddingHole] = useState(false);
  const [nextHole, setNextHole] = useState<number | null>(null);
  const [tiedAgain, setTiedAgain] = useState(false);
  const [remainingIds, setRemainingIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const session = await getViewerSession();
    if (!session) return;

    const res = await fetch(`/api/majors/events/${eventId}/playoff`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!res.ok) return;
    const json = await res.json();
    setHoles(json.holes ?? []);

    // Load profiles for tied players
    const allIds = playoff.tied_profile_ids;
    const { data: profileData } = await supabase
      .from("profiles")
      .select("id, name, avatar_url")
      .in("id", allIds);
    const pm: Record<string, Profile> = {};
    for (const p of profileData ?? []) pm[p.id] = p;
    setProfiles(pm);

    // Load course handicaps from event_entries
    const { data: entryData } = await supabase
      .from("event_entries")
      .select("profile_id, assigned_course_handicap")
      .eq("event_id", eventId)
      .in("profile_id", allIds);
    const em: Record<string, EntryInfo> = {};
    for (const e of entryData ?? []) {
      em[e.profile_id] = { profile_id: e.profile_id, course_handicap: (e as any).assigned_course_handicap ?? 0 };
    }
    setEntries(em);
    setLoading(false);
  }

  useEffect(() => {
    load();

    // Realtime subscription for playoff scores
    const channel = supabase
      .channel(`playoff:${playoff.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_playoff_scores" },
        () => load()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "event_playoff_holes" },
        () => load()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [playoff.id, eventId]);

  async function apiPost(body: Record<string, unknown>) {
    const session = await getViewerSession();
    if (!session) throw new Error("Not authenticated");
    const res = await fetch(`/api/majors/events/${eventId}/playoff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Request failed");
    return json;
  }

  async function submitScore(holeId: string, profileId: string, gross: number) {
    const key = `${holeId}:${profileId}`;
    setSaving(key);
    setError(null);
    try {
      await apiPost({
        action: "submit_score",
        playoff_hole_id: holeId,
        target_profile_id: profileId,
        gross_strokes: gross,
      });
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  }

  async function handleAdvance(holeId: string) {
    setAdvancing(true);
    setError(null);
    try {
      const json = await apiPost({ action: "advance", playoff_hole_id: holeId });
      if (json.complete) {
        // Complete the playoff
        const final_positions = playoff.tied_profile_ids.map((pid: string) => ({
          profile_id: pid,
          position: pid === json.winner_profile_id ? 1 : 2,
        }));
        await apiPost({
          action: "complete",
          playoff_id: playoff.id,
          winner_profile_id: json.winner_profile_id,
          final_positions,
        });
        await load();
      } else if (json.tied_again) {
        setTiedAgain(true);
        setRemainingIds(json.remaining);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAdvancing(false);
    }
  }

  async function handleAddHole() {
    if (!nextHole) return;
    const lastHole = holes[holes.length - 1];
    setAddingHole(true);
    setError(null);
    try {
      await apiPost({
        action: "add_hole",
        playoff_id: playoff.id,
        hole_number: nextHole,
        course_id: lastHole.course_id,
        tee_box_id: lastHole.tee_box_id,
        remaining_profile_ids: remainingIds,
      });
      setTiedAgain(false);
      setNextHole(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAddingHole(false);
    }
  }

  const currentHole = holes[holes.length - 1];
  const isComplete = playoff.status === "completed";

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center text-emerald-100/60 text-sm">
        Loading playoff…
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] pb-8 pt-12 px-4 max-w-sm mx-auto space-y-4">
      <div className="text-center space-y-1">
        <p className="text-[10px] uppercase tracking-widest text-emerald-100/50">
          {isComplete ? "Playoff Complete" : "Playoff In Progress"}
        </p>
        <h1 className="text-lg font-bold text-[#f5e6b0]">Playoff Scorecard</h1>
      </div>

      {/* Hole sequence pills */}
      {holes.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {holes.map((h, i) => (
            <div
              key={h.id}
              className={`flex-shrink-0 rounded-full px-3 py-1 text-[11px] font-bold border ${
                i === holes.length - 1 && !isComplete
                  ? "bg-[#f5e6b0] text-[#042713] border-transparent"
                  : "border-emerald-700/40 text-emerald-200/70"
              }`}
            >
              H{h.hole_number}
            </div>
          ))}
          {!isComplete && tiedAgain && (
            <div className="flex-shrink-0 rounded-full px-3 py-1 text-[11px] font-bold border border-amber-700/50 text-amber-300">
              + next
            </div>
          )}
        </div>
      )}

      {/* Each hole card */}
      {holes.map((hole, hi) => {
        const isCurrent = hi === holes.length - 1 && !isComplete;
        const allScored = hole.remaining_profile_ids.every((pid) =>
          hole.scores?.some((s) => s.profile_id === pid && s.gross_strokes != null)
        );

        return (
          <div
            key={hole.id}
            className={`rounded-2xl border px-4 py-3 space-y-3 ${
              isCurrent
                ? "border-emerald-600/50 bg-emerald-900/20"
                : "border-emerald-900/30 bg-transparent"
            }`}
          >
            {/* Hole header */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-emerald-200">
                  Hole {hole.hole_number}
                  {hi > 0 && <span className="ml-1 text-emerald-100/50 font-normal">(Round {hi + 1})</span>}
                </p>
                <p className="text-[10px] text-emerald-100/50">
                  Par {hole.par} · SI {hole.stroke_index}
                </p>
              </div>
              {isCurrent && (
                <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wide">Live</span>
              )}
            </div>

            {/* Players */}
            <div className="space-y-2">
              {playoff.tied_profile_ids.map((pid: string) => {
                const isRemaining = hole.remaining_profile_ids.includes(pid);
                const existingScore = hole.scores?.find((s) => s.profile_id === pid);
                const courseHcp = entries[pid]?.course_handicap ?? 0;
                const strokesRecv = strokesReceivedOnHole(courseHcp, hole.stroke_index);
                const profile = profiles[pid];
                const inputKey = `${hole.id}:${pid}`;

                if (!isRemaining) {
                  return (
                    <div key={pid} className="flex items-center gap-3 opacity-50">
                      <PlayerAvatar profile={profile} />
                      <span className="flex-1 text-sm text-emerald-200/60 truncate">
                        {profile?.name ?? "Unknown"}
                      </span>
                      <span className="text-sm font-bold text-red-400">✕</span>
                    </div>
                  );
                }

                return (
                  <div key={pid} className="flex items-center gap-3">
                    <PlayerAvatar profile={profile} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-emerald-50 truncate">{profile?.name ?? "Unknown"}</p>
                      <p className="text-[10px] text-emerald-100/50">
                        {strokesRecv > 0 ? `+${strokesRecv} stroke${strokesRecv !== 1 ? "s" : ""}` : "No strokes"}
                      </p>
                    </div>
                    {existingScore?.gross_strokes != null ? (
                      <div className="text-right">
                        <p className="text-sm font-bold text-[#f5e6b0]">{existingScore.gross_strokes}</p>
                        <p className="text-[10px] text-emerald-100/50">
                          net {existingScore.net_strokes ?? existingScore.gross_strokes - strokesRecv}
                        </p>
                      </div>
                    ) : canScore && isCurrent ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={1}
                          max={15}
                          value={scoreInput[inputKey] ?? ""}
                          onChange={(e) => setScoreInput((prev) => ({ ...prev, [inputKey]: e.target.value }))}
                          className="w-12 rounded-lg bg-emerald-900/60 border border-emerald-700/40 text-center text-sm text-white py-1"
                          placeholder="—"
                        />
                        <button
                          type="button"
                          disabled={!scoreInput[inputKey] || saving === inputKey}
                          onClick={() => submitScore(hole.id, pid, Number(scoreInput[inputKey]))}
                          className="rounded-lg bg-emerald-700 px-2 py-1 text-[11px] text-white font-semibold disabled:opacity-40"
                        >
                          {saving === inputKey ? "…" : "✓"}
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm text-emerald-100/30">—</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Advance button for current hole when all scored */}
            {canScore && isCurrent && allScored && !advancing && !tiedAgain && (
              <button
                type="button"
                onClick={() => handleAdvance(hole.id)}
                className="w-full py-2 rounded-xl bg-emerald-700 text-white text-sm font-semibold"
              >
                Determine Result
              </button>
            )}
            {advancing && isCurrent && (
              <p className="text-xs text-emerald-100/50 text-center">Calculating…</p>
            )}
          </div>
        );
      })}

      {/* Next hole selector when tied again */}
      {tiedAgain && canScore && !isComplete && (
        <div className="rounded-2xl border border-amber-700/50 bg-amber-900/20 px-4 py-3 space-y-3">
          <p className="text-xs font-semibold text-amber-300 text-center">Still Tied — Select Next Hole</p>
          <div className="grid grid-cols-6 gap-1.5">
            {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setNextHole(h)}
                className={`rounded-xl py-1.5 text-xs font-bold transition-colors ${
                  nextHole === h
                    ? "bg-[#f5e6b0] text-[#042713]"
                    : "border border-amber-700/30 text-amber-200"
                }`}
              >
                {h}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={!nextHole || addingHole}
            onClick={handleAddHole}
            className="w-full py-2 rounded-xl bg-[#f5e6b0] text-[#042713] text-sm font-semibold disabled:opacity-40"
          >
            {addingHole ? "Adding…" : "Continue Playoff"}
          </button>
        </div>
      )}

      {/* Complete state */}
      {isComplete && (
        <div className="rounded-2xl border border-emerald-600/50 bg-emerald-900/20 px-4 py-4 text-center space-y-1">
          <p className="text-base font-bold text-[#f5e6b0]">🏆 Playoff Complete</p>
          <p className="text-[11px] text-emerald-300/70">
            Winner: {profiles[playoff.winner_profile_id ?? ""]?.name ?? "Unknown"}
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-400 text-center">{error}</p>}
    </div>
  );
}

function PlayerAvatar({ profile }: { profile: Profile | undefined }) {
  if (profile?.avatar_url) {
    return <img src={profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />;
  }
  return (
    <div className="h-7 w-7 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">
      {profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
    </div>
  );
}
