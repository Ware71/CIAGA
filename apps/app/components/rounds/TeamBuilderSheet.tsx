"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { RoundFormatType } from "./FormatSelector";

export type TeamBuilderParticipant = {
  id: string;
  name: string;
  avatarUrl: string | null;
  team_id: string | null;
};

export type TeamBuilderTeam = {
  id: string;
  name: string;
  team_number: number;
};

type Props = {
  roundId: string;
  format: RoundFormatType;
  teams: TeamBuilderTeam[];
  participants: TeamBuilderParticipant[];
  onClose: () => void;
  onMutated: () => void;
  getToken: () => Promise<string | null>;
};

/** WHS team handicap formulas, returns a human-readable description */
export function getTeamHandicapDescription(format: RoundFormatType, teamSize: number): string {
  if (format === "scramble") {
    if (teamSize <= 2) return "35% lowest + 15% highest";
    if (teamSize === 3) return "25% lowest + 15% second + 10% highest";
    return "25% lowest + 15% second + 10% third + 5% highest";
  }
  if (format === "greensomes") return "60% lowest + 40% highest";
  if (format === "foursomes") return "50% combined";
  return "";
}

function initialsFrom(name: string) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "U";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (a + b).toUpperCase().slice(0, 2);
}

async function apiCall(url: string, body: object, token: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

export function TeamBuilderSheet({ roundId, format, teams, participants, onClose, onMutated, getToken }: Props) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Compute max team size across all teams (for handicap description)
  const maxTeamSize = teams.reduce((max, t) => {
    const count = participants.filter((p) => p.team_id === t.id).length;
    return Math.max(max, count);
  }, 2);

  const handicapDesc = getTeamHandicapDescription(format, maxTeamSize);

  async function addTeam() {
    setSaving(true);
    setErr(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      const teamNum = teams.length + 1;
      await apiCall("/api/rounds/manage-teams", { round_id: roundId, action: "create_team", name: `Team ${teamNum}` }, token);
      onMutated();
    } catch (e: any) {
      setErr(e?.message || "Failed to add team");
    } finally {
      setSaving(false);
    }
  }

  async function deleteTeam(teamId: string) {
    if (!window.confirm("Delete this team? Players will become unassigned.")) return;
    setSaving(true);
    setErr(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      await apiCall("/api/rounds/manage-teams", { round_id: roundId, action: "delete_team", team_id: teamId }, token);
      onMutated();
    } catch (e: any) {
      setErr(e?.message || "Failed to delete team");
    } finally {
      setSaving(false);
    }
  }

  async function assignPlayer(participantId: string, teamId: string | null) {
    setSaving(true);
    setErr(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      await apiCall("/api/rounds/manage-teams", { round_id: roundId, action: "assign_player", participant_id: participantId, team_id: teamId }, token);
      onMutated();
    } catch (e: any) {
      setErr(e?.message || "Failed to assign player");
    } finally {
      setSaving(false);
    }
  }

  const unassigned = participants.filter((p) => !p.team_id);

  return (
    <div className="fixed inset-0 z-50">
      <button className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close" />
      <div className="absolute left-0 right-0 bottom-0 px-3 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-[520px] rounded-t-3xl border border-emerald-900/70 bg-[#061f12] shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
          {/* Header */}
          <div className="p-4 border-b border-emerald-900/60 flex items-center justify-between shrink-0">
            <div className="text-sm font-semibold text-emerald-50">Set Up Teams</div>
            <button className="text-emerald-100/70 hover:text-emerald-50 text-lg px-1" onClick={onClose} aria-label="Close">✕</button>
          </div>

          <div className="overflow-y-auto flex-1 p-4 space-y-3" style={{ scrollbarWidth: "thin" }}>
            {err && (
              <div className="rounded-xl border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-100">{err}</div>
            )}

            {/* Teams */}
            {teams.map((team) => {
              const members = participants.filter((p) => p.team_id === team.id);
              return (
                <div key={team.id} className="rounded-2xl border border-emerald-900/70 bg-[#042713]/60 overflow-hidden">
                  <div className="px-3 py-2.5 flex items-center justify-between border-b border-emerald-900/50">
                    <div className="text-[13px] font-bold text-[#f5e6b0]">{team.name}</div>
                    <button
                      onClick={() => deleteTeam(team.id)}
                      disabled={saving}
                      className="text-[11px] text-red-400/70 hover:text-red-400 disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </div>

                  <div className="divide-y divide-emerald-900/40">
                    {members.length === 0 && (
                      <div className="px-3 py-2 text-[11px] text-emerald-100/40">No players assigned</div>
                    )}
                    {members.map((p) => (
                      <div key={p.id} className="px-3 py-2 flex items-center gap-2.5">
                        <div className="h-7 w-7 rounded-full border border-emerald-200/60 bg-[#0b3b21]/60 flex items-center justify-center text-[9px] font-semibold text-emerald-50 shrink-0 overflow-hidden">
                          {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="w-full h-full object-cover" /> : initialsFrom(p.name)}
                        </div>
                        <div className="text-[12px] font-semibold text-emerald-50 flex-1 truncate">{p.name}</div>
                        <button
                          onClick={() => assignPlayer(p.id, null)}
                          disabled={saving}
                          className="text-[11px] text-emerald-100/50 hover:text-emerald-100 disabled:opacity-40"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Drop targets — quick assign from unassigned */}
                  {unassigned.length > 0 && (
                    <div className="px-3 py-1.5 border-t border-emerald-900/40">
                      <div className="text-[10px] text-emerald-100/40 mb-1">Add to this team:</div>
                      <div className="flex flex-wrap gap-1.5">
                        {unassigned.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => assignPlayer(p.id, team.id)}
                            disabled={saving}
                            className="rounded-lg border border-emerald-900/60 bg-[#0b3b21]/50 px-2 py-1 text-[11px] text-emerald-100/80 hover:bg-emerald-900/40 disabled:opacity-40"
                          >
                            + {p.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Unassigned players */}
            {unassigned.length > 0 && (
              <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/40 overflow-hidden">
                <div className="px-3 py-2.5 border-b border-emerald-900/50">
                  <div className="text-[13px] font-bold text-emerald-100/70">Unassigned</div>
                </div>
                <div className="divide-y divide-emerald-900/40">
                  {unassigned.map((p) => (
                    <div key={p.id} className="px-3 py-2 flex items-center gap-2.5">
                      <div className="h-7 w-7 rounded-full border border-emerald-200/60 bg-[#0b3b21]/60 flex items-center justify-center text-[9px] font-semibold text-emerald-50 shrink-0 overflow-hidden">
                        {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="w-full h-full object-cover" /> : initialsFrom(p.name)}
                      </div>
                      <div className="text-[12px] font-semibold text-emerald-50 flex-1 truncate">{p.name}</div>
                      {teams.length > 0 && (
                        <div className="flex gap-1">
                          {teams.map((t) => (
                            <button
                              key={t.id}
                              onClick={() => assignPlayer(p.id, t.id)}
                              disabled={saving}
                              className="rounded-lg border border-emerald-900/60 bg-[#0b3b21]/50 px-2 py-1 text-[10px] text-emerald-100/70 hover:bg-emerald-900/40 disabled:opacity-40"
                            >
                              {t.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add team button */}
            <Button
              onClick={addTeam}
              disabled={saving}
              variant="ghost"
              className="w-full rounded-2xl border border-emerald-900/70 text-emerald-100 hover:bg-emerald-900/20"
            >
              {saving ? "…" : "+ Add Team"}
            </Button>

            {/* WHS handicap formula note */}
            {handicapDesc && (
              <div className="rounded-xl border border-emerald-900/50 bg-[#042713]/40 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-[0.12em] text-emerald-100/50 mb-0.5">WHS Team Handicap</div>
                <div className="text-[12px] text-emerald-100/80">{handicapDesc}</div>
                <div className="text-[10px] text-emerald-100/40 mt-0.5">Applied to the team at round start</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
