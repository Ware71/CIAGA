"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type {
  CompetitionWithGroup,
  LeaderboardEntryWithProfile,
  CompetitionTeeTime,
  TeeTimeParticipant,
} from "@/lib/majors/types";

type Tab = "overview" | "leaderboard" | "tee-times" | "rules" | "results";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "leaderboard", label: "Leaderboard" },
  { id: "tee-times", label: "Tee Times" },
  { id: "rules", label: "Rules" },
  { id: "results", label: "Results" },
];

type FinishedRound = { id: string; name: string | null; finished_at: string | null };

// ─── Submit Round sheet ───────────────────────────────────────────────────────

function SubmitRoundSheet({
  competitionId,
  rounds,
  onClose,
  onSubmit,
}: {
  competitionId: string;
  rounds: FinishedRound[];
  onClose: () => void;
  onSubmit: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/competitions/${competitionId}/submit-round`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ round_id: selected }),
      });
      if (res.ok) { onSubmit(); onClose(); }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-sm mx-auto rounded-t-3xl bg-[#071f13] border-t border-emerald-900/70 px-4 pt-5 pb-[env(safe-area-inset-bottom)] space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-emerald-800/60 mx-auto mb-1" />
        <div className="text-sm font-semibold text-emerald-50">Submit a Round</div>
        {rounds.length === 0 ? (
          <div className="text-sm text-emerald-100/60 py-4 text-center">
            No finished rounds available to submit.
          </div>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {rounds.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelected(r.id)}
                className={`w-full text-left rounded-xl border px-3 py-2 transition-colors ${
                  selected === r.id
                    ? "border-emerald-500 bg-emerald-900/50"
                    : "border-emerald-900/50 bg-emerald-900/20 hover:border-emerald-700/50"
                }`}
              >
                <div className="text-sm font-semibold text-emerald-50">{r.name ?? r.id.slice(0, 8)}</div>
                {r.finished_at && (
                  <div className="text-[10px] text-emerald-100/55">
                    {new Date(r.finished_at).toLocaleDateString()}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 py-3 rounded-full border border-emerald-900/60 text-sm text-emerald-200/70">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selected || submitting}
            className="flex-1 py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Add Tee Time sheet ───────────────────────────────────────────────────────

type GroupMember = { profile_id: string; profile: { name: string | null; avatar_url: string | null } | null };

function AddTeeTimeSheet({
  competitionId,
  groupMembers,
  onClose,
  onCreated,
}: {
  competitionId: string;
  groupMembers: GroupMember[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [teeTime, setTeeTime] = useState("");
  const [groupNumber, setGroupNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [guestName, setGuestName] = useState("");
  const [guests, setGuests] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalPlayers = selectedPlayers.length + guests.length;

  const togglePlayer = (profileId: string) => {
    setSelectedPlayers((prev) =>
      prev.includes(profileId)
        ? prev.filter((id) => id !== profileId)
        : totalPlayers < 4
        ? [...prev, profileId]
        : prev
    );
  };

  const addGuest = () => {
    if (!guestName.trim() || totalPlayers >= 4) return;
    setGuests((prev) => [...prev, guestName.trim()]);
    setGuestName("");
  };

  const removeGuest = (name: string) => setGuests((prev) => prev.filter((g) => g !== name));

  const handleSubmit = async () => {
    if (!teeTime) { setError("Please select a tee time"); return; }
    setSubmitting(true);
    setError(null);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const players = [
        ...selectedPlayers.map((pid) => ({ profile_id: pid })),
        ...guests.map((name) => ({ is_guest: true, display_name: name })),
      ];
      const res = await fetch(`/api/majors/competitions/${competitionId}/tee-times`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          tee_time: new Date(teeTime).toISOString(),
          group_number: groupNumber ? parseInt(groupNumber, 10) : undefined,
          notes: notes || undefined,
          players,
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        setError(j.error ?? "Failed to create tee time");
        return;
      }
      onCreated();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-sm mx-auto rounded-t-3xl bg-[#071f13] border-t border-emerald-900/70 px-4 pt-5 pb-[env(safe-area-inset-bottom)] space-y-4 max-h-[85dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-emerald-800/60 mx-auto mb-1" />
        <div className="text-sm font-semibold text-emerald-50">Add Tee Time</div>

        {/* Date/time */}
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Tee Time *</label>
          <input
            type="datetime-local"
            value={teeTime}
            onChange={(e) => setTeeTime(e.target.value)}
            className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2.5 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600"
          />
        </div>

        {/* Group number + notes row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Group #</label>
            <input
              type="number"
              min={1}
              value={groupNumber}
              onChange={(e) => setGroupNumber(e.target.value)}
              placeholder="e.g. 1"
              className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2.5 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
              className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2.5 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
            />
          </div>
        </div>

        {/* Players */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Players</label>
            <span className="text-[10px] text-emerald-200/50">{totalPlayers}/4</span>
          </div>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {groupMembers.map((m) => {
              const selected = selectedPlayers.includes(m.profile_id);
              const disabled = !selected && totalPlayers >= 4;
              return (
                <button
                  key={m.profile_id}
                  type="button"
                  onClick={() => togglePlayer(m.profile_id)}
                  disabled={disabled}
                  className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                    selected
                      ? "border-emerald-500 bg-emerald-900/50"
                      : disabled
                      ? "border-emerald-900/30 bg-transparent opacity-40"
                      : "border-emerald-900/50 bg-emerald-900/20 hover:border-emerald-700/50"
                  }`}
                >
                  {m.profile?.avatar_url ? (
                    <img src={m.profile.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                  ) : (
                    <div className="h-6 w-6 rounded-full bg-emerald-900/60 grid place-items-center text-[9px] font-bold text-emerald-200">
                      {m.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
                    </div>
                  )}
                  <span className="flex-1 text-sm text-emerald-50">{m.profile?.name ?? m.profile_id}</span>
                  {selected && <span className="text-emerald-400 text-xs">✓</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Guest add */}
        {totalPlayers < 4 && (
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Add Guest</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addGuest()}
                placeholder="Guest name"
                className="flex-1 rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
              />
              <button
                type="button"
                onClick={addGuest}
                disabled={!guestName.trim()}
                className="px-3 rounded-xl border border-emerald-700/60 text-sm text-emerald-200 disabled:opacity-40"
              >
                Add
              </button>
            </div>
            {guests.map((g) => (
              <div key={g} className="flex items-center justify-between rounded-xl border border-emerald-900/40 bg-emerald-900/20 px-3 py-1.5">
                <span className="text-sm text-emerald-100">{g} <span className="text-[10px] text-emerald-200/50">guest</span></span>
                <button type="button" onClick={() => removeGuest(g)} className="text-emerald-200/50 text-xs hover:text-red-400">✕</button>
              </div>
            ))}
          </div>
        )}

        {error && <div className="text-sm text-red-400">{error}</div>}

        <div className="flex gap-3 pb-2">
          <button type="button" onClick={onClose} className="flex-1 py-3 rounded-full border border-emerald-900/60 text-sm text-emerald-200/70">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Create Tee Time"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tee Time card ────────────────────────────────────────────────────────────

function TeeTimeCard({
  tt,
  isAdmin,
  onDelete,
}: {
  tt: CompetitionTeeTime;
  isAdmin: boolean;
  onDelete: () => void;
}) {
  const slots: (TeeTimeParticipant | null)[] = [...(tt.round?.participants ?? [])];
  while (slots.length < 4) slots.push(null);

  const d = new Date(tt.tee_time);
  const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = d.toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          {tt.group_number != null && (
            <span className="text-[10px] uppercase tracking-wider text-emerald-200/55 mr-2">
              Group {tt.group_number}
            </span>
          )}
          <span className="text-sm font-semibold text-[#f5e6b0]">{timeStr}</span>
          <span className="text-[11px] text-emerald-100/55 ml-2">{dateStr}</span>
        </div>
        <div className="flex items-center gap-2">
          {tt.round?.status && (
            <span className={`text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full font-medium ${
              tt.round.status === "live"
                ? "bg-amber-900/50 text-amber-300"
                : tt.round.status === "finished"
                ? "bg-emerald-900/60 text-emerald-300"
                : "bg-emerald-900/40 text-emerald-200/60"
            }`}>
              {tt.round.status}
            </span>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={onDelete}
              className="text-[11px] text-emerald-200/40 hover:text-red-400 transition-colors"
            >
              ✕
            </button>
          )}
        </div>
      </div>
      {tt.notes && <p className="text-[11px] text-emerald-100/55 italic">{tt.notes}</p>}
      <div className="grid grid-cols-4 gap-2">
        {slots.map((p, i) =>
          p ? (
            <div key={i} className="flex flex-col items-center gap-1">
              {p.profile?.avatar_url ? (
                <img src={p.profile.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover border border-emerald-700/40" />
              ) : (
                <div className="h-9 w-9 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200">
                  {(p.display_name ?? p.profile?.name ?? "?").slice(0, 2).toUpperCase()}
                </div>
              )}
              <span className="text-[9px] text-emerald-100/70 truncate max-w-[52px] text-center leading-tight">
                {p.is_guest ? `${p.display_name} ★` : (p.profile?.name ?? "—")}
              </span>
            </div>
          ) : (
            <div key={i} className="flex flex-col items-center gap-1 opacity-30">
              <div className="h-9 w-9 rounded-full border-2 border-dashed border-emerald-700/40" />
              <span className="text-[9px] text-emerald-100/40">Open</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ─── Position badge ───────────────────────────────────────────────────────────

function PositionBadge({ position }: { position: number | null }) {
  if (position == null) return <span className="w-7 text-center text-xs text-emerald-200/40">—</span>;
  const colours =
    position === 1
      ? "bg-[#f5e6b0]/20 text-[#f5e6b0] border-[#f5e6b0]/40"
      : position === 2
      ? "bg-[#c0c0c0]/15 text-[#c0c0c0] border-[#c0c0c0]/30"
      : position === 3
      ? "bg-[#cd7f32]/20 text-[#cd7f32] border-[#cd7f32]/40"
      : "bg-emerald-900/40 text-emerald-200/70 border-emerald-900/60";
  return (
    <span className={`w-7 h-7 flex items-center justify-center rounded-full border text-[11px] font-extrabold shrink-0 ${colours}`}>
      {position}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CompetitionDetailClient({ competitionId }: { competitionId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [competition, setCompetition] = useState<CompetitionWithGroup | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntryWithProfile[]>([]);
  const [teeTimes, setTeeTimes] = useState<CompetitionTeeTime[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEntered, setIsEntered] = useState(false);
  const [entering, setEntering] = useState(false);
  const [showSubmitSheet, setShowSubmitSheet] = useState(false);
  const [showAddTeeTime, setShowAddTeeTime] = useState(false);
  const [finishedRounds, setFinishedRounds] = useState<FinishedRound[]>([]);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const session = await getViewerSession();
        if (!session || cancelled) return;
        setMyProfileId(session.profileId);
        const headers = { Authorization: `Bearer ${session.accessToken}` };

        const [compRes, lbRes, roundsRes, teeTimesRes] = await Promise.all([
          fetch(`/api/majors/competitions/${competitionId}`, { headers }),
          fetch(`/api/majors/competitions/${competitionId}/leaderboard`, { headers }),
          fetch(`/api/rounds?status=finished&limit=20`, { headers }),
          fetch(`/api/majors/competitions/${competitionId}/tee-times`, { headers }),
        ]);

        if (cancelled) return;

        if (compRes.ok) {
          const j = await compRes.json();
          setCompetition(j.competition);

          // Load group members and my role if competition has a group
          if (j.competition?.group_id) {
            const membersRes = await fetch(`/api/majors/groups/${j.competition.group_id}/members`, { headers });
            if (!cancelled && membersRes.ok) {
              const mj = await membersRes.json();
              const members: any[] = mj.members ?? [];
              setGroupMembers(members.filter((m: any) => m.status === "active").map((m: any) => ({
                profile_id: m.profile_id,
                profile: m.profile ?? null,
              })));
              const own = members.find((m: any) => m.profile_id === session.profileId);
              setMyRole(own?.role ?? null);
            }
          }
        }

        if (lbRes.ok) {
          const j = await lbRes.json();
          setLeaderboard(j.rows ?? []);
        }

        if (roundsRes.ok) {
          const j = await roundsRes.json();
          setFinishedRounds((j.rounds ?? []).map((r: any) => ({
            id: r.id,
            name: r.name,
            finished_at: r.finished_at,
          })));
        }

        if (teeTimesRes.ok) {
          const j = await teeTimesRes.json();
          setTeeTimes(j.tee_times ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [competitionId]);

  useEffect(() => {
    if (myProfileId && leaderboard.length > 0) {
      setIsEntered(leaderboard.some((e) => e.profile_id === myProfileId));
    }
  }, [leaderboard, myProfileId]);

  const refreshTeeTimes = async () => {
    const session = await getViewerSession();
    if (!session) return;
    const res = await fetch(`/api/majors/competitions/${competitionId}/tee-times`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (res.ok) {
      const j = await res.json();
      setTeeTimes(j.tee_times ?? []);
    }
  };

  const handleEnter = async () => {
    setEntering(true);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/competitions/${competitionId}/enter`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) setIsEntered(true);
    } finally {
      setEntering(false);
    }
  };

  const handleSubmitDone = async () => {
    const session = await getViewerSession();
    if (!session) return;
    const res = await fetch(`/api/majors/competitions/${competitionId}/leaderboard`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (res.ok) {
      const j = await res.json();
      setLeaderboard(j.rows ?? []);
      setIsEntered(true);
    }
  };

  const handleDeleteTeeTime = async (teeTimeId: string) => {
    const session = await getViewerSession();
    if (!session) return;
    const res = await fetch(`/api/majors/competitions/${competitionId}/tee-times/${teeTimeId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (res.ok) refreshTeeTimes();
  };

  const now = new Date();
  const entryOpen = competition
    ? (!competition.entry_window_start || new Date(competition.entry_window_start) <= now) &&
      (!competition.entry_window_end || new Date(competition.entry_window_end) >= now) &&
      competition.majors_status !== "completed" &&
      competition.majors_status !== "cancelled"
    : false;

  const isAdminOrOwner = myRole === "owner" || myRole === "admin";

  const visibleTabs = (() => {
    let tabs = competition?.majors_status === "completed" ? TABS : TABS.filter((t) => t.id !== "results");
    if (competition?.majors_status === "cancelled") tabs = tabs.filter((t) => t.id !== "tee-times");
    return tabs;
  })();

  // Entry window countdown
  const entryWindowDaysLeft = competition?.entry_window_end
    ? Math.ceil((new Date(competition.entry_window_end).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const statusColour =
    competition?.majors_status === "live"
      ? "bg-amber-900/50 text-amber-300 border-amber-800/50"
      : competition?.majors_status === "completed"
      ? "bg-emerald-900/60 text-emerald-300 border-emerald-800/50"
      : competition?.majors_status === "cancelled"
      ? "bg-red-900/40 text-red-400 border-red-800/40"
      : "bg-emerald-900/40 text-emerald-200/80 border-emerald-900/60";

  const tabContent: Record<Tab, React.ReactNode> = {
    overview: competition ? (
      <div className="space-y-4">
        {competition.description && (
          <p className="text-[13px] text-emerald-100/75 leading-relaxed">{competition.description}</p>
        )}

        {/* Info grid */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Format", value: competition.format ?? competition.competition_type },
            { label: "Scoring", value: competition.scoring_model },
            { label: "Rounds", value: String(competition.num_rounds) },
            { label: "Points", value: competition.points_model === "none" ? "None" : competition.points_model },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5">
              <div className="text-[10px] text-emerald-200/50 uppercase tracking-wider mb-0.5">{item.label}</div>
              <div className="text-sm font-semibold text-emerald-50 capitalize">{item.value ?? "—"}</div>
            </div>
          ))}
        </div>

        {/* Date / course */}
        {(competition.competition_date || competition.course) && (
          <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5 space-y-1">
            {competition.competition_date && (
              <div className="flex items-center gap-2 text-[12px] text-emerald-100/70">
                <span className="text-emerald-200/40">📅</span>
                {new Date(competition.competition_date).toLocaleDateString([], { weekday: "short", year: "numeric", month: "long", day: "numeric" })}
              </div>
            )}
            {competition.course && (
              <div className="flex items-center gap-2 text-[12px] text-emerald-100/70">
                <span className="text-emerald-200/40">⛳</span>
                {competition.course.name}
              </div>
            )}
          </div>
        )}

        {/* Entry window countdown */}
        {entryWindowDaysLeft != null && entryWindowDaysLeft > 0 && entryWindowDaysLeft <= 7 && (
          <div className="rounded-xl border border-amber-800/40 bg-amber-900/20 px-3 py-2">
            <span className="text-[11px] text-amber-300">
              Entry closes in {entryWindowDaysLeft} day{entryWindowDaysLeft !== 1 ? "s" : ""}
            </span>
          </div>
        )}
        {competition.entry_window_end && entryWindowDaysLeft != null && entryWindowDaysLeft <= 0 && (
          <div className="rounded-xl border border-red-900/40 bg-red-900/20 px-3 py-2">
            <span className="text-[11px] text-red-400">Entry window closed</span>
          </div>
        )}

        {/* Entry / Submit CTAs */}
        {!isEntered && entryOpen && (
          <button
            type="button"
            onClick={handleEnter}
            disabled={entering}
            className="w-full py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {entering ? "Entering…" : "Enter Competition"}
          </button>
        )}
        {isEntered && (
          <div className="flex gap-3">
            <div className="flex-1 py-3 rounded-full border border-emerald-700/50 text-sm font-semibold text-emerald-400 text-center">
              ✓ Entered
            </div>
            {entryOpen && (
              <button
                type="button"
                onClick={() => setShowSubmitSheet(true)}
                className="flex-1 py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600"
              >
                Submit Round
              </button>
            )}
          </div>
        )}
      </div>
    ) : null,

    leaderboard: (
      <div className="space-y-2">
        {leaderboard.length === 0 && (
          <div className="text-sm text-emerald-100/60 text-center py-8">
            No results yet. Submit a round to appear here.
          </div>
        )}
        {leaderboard.map((row) => (
          <div
            key={row.id}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
              row.position === 1
                ? "border-[#f5e6b0]/25 bg-[#f5e6b0]/5"
                : row.position === 2
                ? "border-[#c0c0c0]/20 bg-[#c0c0c0]/5"
                : row.position === 3
                ? "border-[#cd7f32]/20 bg-[#cd7f32]/5"
                : "border-emerald-900/50 bg-[#0b3b21]/60"
            }`}
          >
            <PositionBadge position={row.position ?? null} />
            {row.profile?.avatar_url ? (
              <img src={row.profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
            ) : (
              <div className="h-7 w-7 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">
                {row.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
              </div>
            )}
            <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{row.profile?.name ?? "Unknown"}</span>
            <div className="text-right shrink-0">
              <div className="text-xs font-extrabold text-[#f5e6b0]">{row.net_score ?? row.gross_score ?? "—"}</div>
              <div className="text-[10px] text-emerald-100/50">{row.rounds_submitted} rnd</div>
            </div>
          </div>
        ))}
      </div>
    ),

    "tee-times": (
      <div className="space-y-3">
        {isAdminOrOwner && (
          <button
            type="button"
            onClick={() => setShowAddTeeTime(true)}
            className="w-full py-2.5 rounded-full border border-emerald-700/60 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/30"
          >
            + Add Tee Time
          </button>
        )}
        {teeTimes.length === 0 ? (
          <div className="text-sm text-emerald-100/60 text-center py-8">
            {isAdminOrOwner ? "No tee times set up yet." : "No tee times have been scheduled."}
          </div>
        ) : (
          teeTimes.map((tt) => (
            <TeeTimeCard
              key={tt.id}
              tt={tt}
              isAdmin={isAdminOrOwner}
              onDelete={() => handleDeleteTeeTime(tt.id)}
            />
          ))
        )}
      </div>
    ),

    rules: competition ? (
      <div className="space-y-4 text-[13px] text-emerald-100/75 leading-relaxed">
        {competition.rules_text ? (
          <p>{competition.rules_text}</p>
        ) : (
          <p className="text-emerald-100/50">No custom rules specified.</p>
        )}
        <div className="space-y-2 rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-3">
          {competition.scoring_model && (
            <div className="flex justify-between text-[12px]">
              <span className="text-emerald-200/55">Scoring</span>
              <span className="text-emerald-50 capitalize">{competition.scoring_model}</span>
            </div>
          )}
          {competition.scoring_model !== "gross" && (competition.handicap_rules as any)?.allowance_pct != null && (
            <div className="flex justify-between text-[12px]">
              <span className="text-emerald-200/55">Handicap allowance</span>
              <span className="text-emerald-50">{(competition.handicap_rules as any).allowance_pct}%</span>
            </div>
          )}
          {(competition.handicap_rules as any)?.max_handicap != null && (
            <div className="flex justify-between text-[12px]">
              <span className="text-emerald-200/55">Max handicap</span>
              <span className="text-emerald-50">{(competition.handicap_rules as any).max_handicap}</span>
            </div>
          )}
          {competition.num_rounds > 1 && (
            <div className="flex justify-between text-[12px]">
              <span className="text-emerald-200/55">Rounds required</span>
              <span className="text-emerald-50">{competition.num_rounds}</span>
            </div>
          )}
          {competition.standings_contribution !== "event_only" && (
            <div className="flex justify-between text-[12px]">
              <span className="text-emerald-200/55">Contributes to</span>
              <span className="text-emerald-50 capitalize">{competition.standings_contribution}</span>
            </div>
          )}
        </div>
      </div>
    ) : null,

    results: (
      <div className="space-y-2">
        {leaderboard.length === 0 ? (
          <div className="text-sm text-emerald-100/60 text-center py-8">No final results.</div>
        ) : (
          leaderboard.map((row) => (
            <div
              key={row.id}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                row.position === 1
                  ? "border-[#f5e6b0]/25 bg-[#f5e6b0]/5"
                  : row.position === 2
                  ? "border-[#c0c0c0]/20 bg-[#c0c0c0]/5"
                  : row.position === 3
                  ? "border-[#cd7f32]/20 bg-[#cd7f32]/5"
                  : "border-emerald-900/50 bg-[#0b3b21]/60"
              }`}
            >
              <PositionBadge position={row.position ?? null} />
              <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{row.profile?.name ?? "Unknown"}</span>
              <div className="text-right shrink-0">
                <div className="text-xs font-extrabold text-[#f5e6b0]">{row.net_score ?? row.gross_score ?? "—"}</div>
                {row.points_earned != null && row.points_earned > 0 && (
                  <div className="text-[10px] text-amber-300/70">+{row.points_earned} pts</div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    ),
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <div className="text-sm text-emerald-100/60">Loading…</div>
      </div>
    );
  }

  if (!competition) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-4">
        <div className="text-sm text-emerald-100/60">Competition not found.</div>
        <button type="button" onClick={() => router.push("/majors")} className="text-sm text-emerald-200 underline">
          Back to Hub
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] max-w-sm mx-auto">
      {/* Header */}
      <div className="px-4 pt-8 flex items-center justify-between mb-3">
        <button type="button" onClick={() => router.back()} className="text-[11px] text-emerald-100/70 hover:text-emerald-50">
          ← Back
        </button>
        <div className="w-14" />
      </div>

      {/* Hero section */}
      <div className="px-4 mb-4 space-y-2">
        {competition.group && (
          <button
            type="button"
            onClick={() => router.push(`/majors/groups/${competition.group!.id}`)}
            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-200/55 hover:text-emerald-200 border border-emerald-900/50 rounded-full px-2.5 py-1 transition-colors"
          >
            {competition.group.name}
            {competition.group.ciaga_tag !== "none" && (
              <span className="text-amber-300/70 ml-1">{competition.group.ciaga_tag}</span>
            )}
          </button>
        )}
        <h1 className="text-xl font-bold text-[#f5e6b0] leading-tight">{competition.name}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-medium px-2.5 py-1 rounded-full border capitalize ${statusColour}`}>
            {competition.majors_status}
          </span>
          {competition.competition_date && (
            <span className="text-[11px] text-emerald-100/60">
              {new Date(competition.competition_date).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
            </span>
          )}
          {competition.course && (
            <span className="text-[11px] text-emerald-100/60">· {competition.course.name}</span>
          )}
        </div>
      </div>

      {/* Tab strip */}
      <div className="overflow-x-auto px-4 mb-5">
        <div className="flex gap-2">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                tab === t.id
                  ? "bg-emerald-700 text-white"
                  : "border border-emerald-900/60 text-emerald-200/70 hover:text-emerald-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-8">{tabContent[tab]}</div>

      {showSubmitSheet && (
        <SubmitRoundSheet
          competitionId={competitionId}
          rounds={finishedRounds}
          onClose={() => setShowSubmitSheet(false)}
          onSubmit={handleSubmitDone}
        />
      )}

      {showAddTeeTime && (
        <AddTeeTimeSheet
          competitionId={competitionId}
          groupMembers={groupMembers}
          onClose={() => setShowAddTeeTime(false)}
          onCreated={refreshTeeTimes}
        />
      )}
    </div>
  );
}
