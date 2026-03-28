"use client";

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
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
  onMutated: () => void;
  getToken: () => Promise<string | null>;
};

/** WHS team handicap formulas — corrected per WHS published allowances table */
export function getTeamHandicapDescription(format: RoundFormatType, teamSize: number): string {
  if (format === "scramble") {
    if (teamSize <= 2) return "35% lowest + 15% highest";
    if (teamSize === 3) return "30% lowest + 20% second + 10% highest";
    return "25% lowest + 20% second + 15% third + 10% highest";
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

export function TeamBuilderSheet({ roundId, format, teams, participants, onMutated, getToken }: Props) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ── Rename state ──────────────────────────────────────────────────────────
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // ── Drag state ────────────────────────────────────────────────────────────
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dropTargetTeamId, setDropTargetTeamId] = useState<string | null>(null);
  const [dropTargetUnassigned, setDropTargetUnassigned] = useState(false);

  // Refs to each team card so we can hit-test during pointermove
  const teamCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const unassignedZoneRef = useRef<HTMLDivElement | null>(null);

  const draggingParticipant = participants.find((p) => p.id === draggingId) ?? null;

  function resetDrag() {
    setDraggingId(null);
    setDragPos(null);
    setDropTargetTeamId(null);
    setDropTargetUnassigned(false);
  }

  function hitTest(x: number, y: number) {
    // Check unassigned zone
    const uz = unassignedZoneRef.current;
    if (uz) {
      const r = uz.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        setDropTargetTeamId(null);
        setDropTargetUnassigned(true);
        return;
      }
    }
    // Check team cards
    for (const [teamId, el] of Object.entries(teamCardRefs.current)) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        setDropTargetTeamId(teamId);
        setDropTargetUnassigned(false);
        return;
      }
    }
    setDropTargetTeamId(null);
    setDropTargetUnassigned(false);
  }

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, participantId: string) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setDraggingId(participantId);
      setDragPos({ x: e.clientX, y: e.clientY });
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingId) return;
      setDragPos({ x: e.clientX, y: e.clientY });
      hitTest(e.clientX, e.clientY);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draggingId]
  );

  const handlePointerUp = useCallback(
    async (e: React.PointerEvent) => {
      if (!draggingId) return;
      const targetTeam = dropTargetTeamId;
      const targetUnassigned = dropTargetUnassigned;
      resetDrag();

      if (targetTeam) {
        await assignPlayer(draggingId, targetTeam);
      } else if (targetUnassigned) {
        await assignPlayer(draggingId, null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draggingId, dropTargetTeamId, dropTargetUnassigned]
  );

  // ── API actions ───────────────────────────────────────────────────────────

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

  async function renameTeam(teamId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    setErr(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not authenticated");
      await apiCall("/api/rounds/manage-teams", { round_id: roundId, action: "rename_team", team_id: teamId, name: trimmed }, token);
      onMutated();
    } catch (e: any) {
      setErr(e?.message || "Failed to rename team");
    } finally {
      setSaving(false);
    }
  }

  function commitRename(teamId: string) {
    const trimmed = editingName.trim();
    setEditingTeamId(null);
    if (trimmed) {
      renameTeam(teamId, trimmed);
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

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={resetDrag}
      style={{ touchAction: draggingId ? "none" : undefined }}
    >
      <div className="space-y-3">
            {err && (
              <div className="rounded-xl border border-red-900/50 bg-red-950/30 p-3 text-sm text-red-100">{err}</div>
            )}

            {draggingId && (
              <div className="text-[11px] text-center text-emerald-100/50 -mb-1">
                Drag to a team or the Unassigned section
              </div>
            )}

            {/* Teams */}
            {teams.map((team) => {
              const members = participants.filter((p) => p.team_id === team.id);
              const isDropTarget = dropTargetTeamId === team.id;
              const isEditing = editingTeamId === team.id;
              return (
                <div
                  key={team.id}
                  ref={(el) => { teamCardRefs.current[team.id] = el; }}
                  className={`rounded-2xl border overflow-hidden transition-all ${
                    isDropTarget
                      ? "border-[#f5e6b0]/60 ring-2 ring-[#f5e6b0]/40 bg-[#042713]/80"
                      : "border-emerald-900/70 bg-[#042713]/60"
                  }`}
                >
                  <div className="px-3 py-2.5 flex items-center justify-between border-b border-emerald-900/50">
                    {isEditing ? (
                      <input
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(team.id);
                          if (e.key === "Escape") setEditingTeamId(null);
                        }}
                        onBlur={() => commitRename(team.id)}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="flex-1 bg-transparent border-b border-emerald-200/40 text-[13px] font-bold text-[#f5e6b0] outline-none min-w-0 mr-2"
                      />
                    ) : (
                      <div className="flex items-center gap-1 min-w-0 flex-1">
                        <div className="text-[13px] font-bold text-[#f5e6b0] truncate">{team.name}</div>
                        <button
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => { setEditingTeamId(team.id); setEditingName(team.name); }}
                          disabled={saving}
                          className="shrink-0 text-emerald-100/40 hover:text-emerald-100/80 disabled:opacity-40"
                          aria-label="Rename team"
                        >
                          <Pencil size={12} />
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => deleteTeam(team.id)}
                      disabled={saving}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="text-[11px] text-red-400/70 hover:text-red-400 disabled:opacity-40 shrink-0"
                    >
                      Delete
                    </button>
                  </div>

                  <div className="divide-y divide-emerald-900/40">
                    {members.length === 0 && (
                      <div className="px-3 py-2 text-[11px] text-emerald-100/40">
                        {isDropTarget ? "Drop here to assign" : "No players assigned — drag a player here"}
                      </div>
                    )}
                    {members.map((p) => (
                      <div
                        key={p.id}
                        className={`px-3 py-2 flex items-center gap-2.5 ${draggingId ? "cursor-grabbing" : "cursor-grab"}`}
                        onPointerDown={(e) => handlePointerDown(e, p.id)}
                        style={{ userSelect: "none", WebkitUserSelect: "none" }}
                      >
                        <div className="h-7 w-7 rounded-full border border-emerald-200/60 bg-[#0b3b21]/60 flex items-center justify-center text-[9px] font-semibold text-emerald-50 shrink-0 overflow-hidden">
                          {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="w-full h-full object-cover" /> : initialsFrom(p.name)}
                        </div>
                        <div className="text-[12px] font-semibold text-emerald-50 flex-1 truncate">{p.name}</div>
                        <button
                          onClick={(e) => { e.stopPropagation(); assignPlayer(p.id, null); }}
                          disabled={saving}
                          className="text-[11px] text-emerald-100/50 hover:text-emerald-100 disabled:opacity-40 shrink-0"
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Unassigned players */}
            {unassigned.length > 0 && (
              <div
                ref={unassignedZoneRef}
                className={`rounded-2xl border overflow-hidden transition-all ${
                  dropTargetUnassigned
                    ? "border-emerald-400/60 ring-2 ring-emerald-400/30 bg-[#042713]/60"
                    : "border-emerald-900/70 bg-[#042713]/40"
                }`}
              >
                <div className="px-3 py-2.5 border-b border-emerald-900/50">
                  <div className="text-[13px] font-bold text-emerald-100/70">
                    {dropTargetUnassigned ? "Drop to unassign" : "Unassigned"}
                  </div>
                </div>
                <div className="divide-y divide-emerald-900/40">
                  {unassigned.map((p) => (
                    <div
                      key={p.id}
                      className={`px-3 py-2 flex items-center gap-2.5 ${draggingId ? "cursor-grabbing" : "cursor-grab"}`}
                      onPointerDown={(e) => handlePointerDown(e, p.id)}
                      style={{ userSelect: "none", WebkitUserSelect: "none" }}
                    >
                      <div className="h-7 w-7 rounded-full border border-emerald-200/60 bg-[#0b3b21]/60 flex items-center justify-center text-[9px] font-semibold text-emerald-50 shrink-0 overflow-hidden">
                        {p.avatarUrl ? <img src={p.avatarUrl} alt="" className="w-full h-full object-cover" /> : initialsFrom(p.name)}
                      </div>
                      <div className="text-[12px] font-semibold text-emerald-50 flex-1 truncate">{p.name}</div>
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

      {/* Drag ghost — follows pointer */}
      {draggingId && dragPos && draggingParticipant && (
        <div
          className="fixed pointer-events-none z-[200] flex items-center gap-2 rounded-xl border border-[#f5e6b0]/60 bg-[#061f12]/95 px-2.5 py-1.5 shadow-xl"
          style={{ left: dragPos.x - 16, top: dragPos.y - 18, transform: "rotate(2deg)" }}
        >
          <div className="h-6 w-6 rounded-full border border-emerald-200/60 bg-[#0b3b21]/60 flex items-center justify-center text-[9px] font-semibold text-emerald-50 shrink-0 overflow-hidden">
            {draggingParticipant.avatarUrl
              ? <img src={draggingParticipant.avatarUrl} alt="" className="w-full h-full object-cover" />
              : initialsFrom(draggingParticipant.name)}
          </div>
          <span className="text-[12px] font-semibold text-[#f5e6b0] whitespace-nowrap">{draggingParticipant.name}</span>
        </div>
      )}
    </div>
  );
}

