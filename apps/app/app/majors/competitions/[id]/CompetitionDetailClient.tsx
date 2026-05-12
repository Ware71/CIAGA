"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type {
  CompetitionWithGroup,
  CompetitionTypeV2,
  LeaderboardEntryWithProfile,
  CompetitionTeeTime,
  TeeTimeParticipant,
  MatchplayStage,
  MatchplayFixture,
  MatchplayLeagueTableEntryWithProfile,
  CompetitionWinningWithProfile,
  ProposedWinning,
  CompetitionWaitlistEntry,
} from "@/lib/majors/types";
import { COMP_TYPES, SCORING_MODELS, POINTS_MODELS } from "@/lib/competitions/constants";
import { HandicapRulesEditor } from "@/components/competitions/HandicapRulesEditor";
import { CoursePickerModal } from "@/components/rounds/CoursePickerModal";

const FEDEX_POINTS_SCALE = [500, 300, 190, 140, 110, 90, 75, 60, 48, 38, 30, 24, 18, 14, 10, 8, 6, 4, 2, 1];

function getPointsForPosition(
  position: number | null,
  pointsModel: string,
  pointsTable: Record<string, unknown>
): number | null {
  if (!position || pointsModel === "none") return null;
  if (pointsModel === "fedex_style") {
    return FEDEX_POINTS_SCALE[position - 1] ?? 0;
  }
  if (pointsModel === "position_based" || pointsModel === "custom_table") {
    const val = pointsTable[String(position)];
    return typeof val === "number" ? val : null;
  }
  return null;
}

type Tab = "overview" | "leaderboard" | "tee-times" | "rules" | "results" | "fixtures" | "bracket" | "league-table" | "winnings";

const STROKE_TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "leaderboard", label: "Leaderboard" },
  { id: "tee-times", label: "Tee Times" },
  { id: "rules", label: "Rules" },
  { id: "winnings", label: "Winnings" },
  { id: "results", label: "Results" },
];

const MATCHPLAY_LEAGUE_TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "fixtures", label: "Fixtures" },
  { id: "league-table", label: "Table" },
  { id: "rules", label: "Rules" },
  { id: "results", label: "Results" },
];

const MATCHPLAY_KNOCKOUT_TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "fixtures", label: "Fixtures" },
  { id: "bracket", label: "Bracket" },
  { id: "rules", label: "Rules" },
  { id: "results", label: "Results" },
];

function isMatchplayLeague(type: CompetitionTypeV2 | undefined | null) {
  return type === "matchplay" || type === "matchplay_fixture";
}

function isMatchplayKnockout(type: CompetitionTypeV2 | undefined | null) {
  return type === "matchplay_knockout_match";
}

function getTabsForCompetition(comp: CompetitionWithGroup | null) {
  if (!comp) return STROKE_TABS;
  if (isMatchplayKnockout(comp.competition_type)) return MATCHPLAY_KNOCKOUT_TABS;
  if (isMatchplayLeague(comp.competition_type)) return MATCHPLAY_LEAGUE_TABS;
  return STROKE_TABS;
}

type FinishedRound = { id: string; name: string | null; finished_at: string | null };
type LeaderboardRowWithRoundId = LeaderboardEntryWithProfile & { round_id: string | null };
type Participant = { profile_id: string; profile: { id: string; name: string | null; avatar_url: string | null } | null };

// ─── Submit Round sheet ───────────────────────────────────────────────────────
// Only shown for competitions without admin-managed tee times (e.g. open competitions
// where a player records their own round and manually submits it).

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
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/competitions/${competitionId}/submit-round`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ round_id: selected }),
      });
      if (res.ok) {
        onSubmit();
        onClose();
      } else {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Submission failed");
      }
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
        {error && <div className="text-sm text-red-400">{error}</div>}
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

type GroupMember = {
  profile_id: string;
  profile: { name: string | null; avatar_url: string | null } | null;
  preferred_tee_name: string | null;
};

type TeeBoxOption = { id: string; name: string; yards: number | null; rating: number | null; slope: number | null };

function AddTeeTimeSheet({
  competitionId,
  courseId,
  groupMembers,
  entryFeeAmount,
  entryFeeCurrency,
  onClose,
  onCreated,
}: {
  competitionId: string;
  courseId: string | null;
  groupMembers: GroupMember[];
  entryFeeAmount: number | null;
  entryFeeCurrency: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [teeTime, setTeeTime] = useState("");
  const [groupNumber, setGroupNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [playerTees, setPlayerTees] = useState<Record<string, string>>({}); // profile_id → tee_box_id
  const [teeBoxes, setTeeBoxes] = useState<TeeBoxOption[]>([]);
  const [guestName, setGuestName] = useState("");
  const [guests, setGuests] = useState<string[]>([]);
  const [guestChargeTo, setGuestChargeTo] = useState<Record<string, string>>({}); // guestName → profile_id of host to charge
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch tee boxes for the competition's course
  useEffect(() => {
    if (!courseId) return;
    (async () => {
      const res = await fetch(`/api/courses/tee-boxes?course_id=${courseId}`);
      if (res.ok) {
        const j = await res.json();
        setTeeBoxes(j.tee_boxes ?? []);
      }
    })();
  }, [courseId]);

  const totalPlayers = selectedPlayers.length + guests.length;

  // Resolve a member's preferred tee name to an actual tee_box_id
  const resolvePreferredTee = (preferredTeeName: string | null): string | undefined => {
    if (!preferredTeeName || teeBoxes.length === 0) return undefined;
    const match = teeBoxes.find(
      (t) => t.name.toLowerCase().trim() === preferredTeeName.toLowerCase().trim()
    );
    return match?.id;
  };

  const togglePlayer = (profileId: string) => {
    setSelectedPlayers((prev) => {
      if (prev.includes(profileId)) {
        const next = prev.filter((id) => id !== profileId);
        setPlayerTees((tees) => { const t = { ...tees }; delete t[profileId]; return t; });
        return next;
      }
      if (totalPlayers >= 4) return prev;
      // Pre-fill tee preference for newly added player
      const member = groupMembers.find((m) => m.profile_id === profileId);
      if (member?.preferred_tee_name) {
        const teeId = resolvePreferredTee(member.preferred_tee_name);
        if (teeId) setPlayerTees((tees) => ({ ...tees, [profileId]: teeId }));
      }
      return [...prev, profileId];
    });
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
        ...selectedPlayers.map((pid) => ({
          profile_id: pid,
          tee_box_id: playerTees[pid] ?? null,
        })),
        ...guests.map((name) => ({ is_guest: true, display_name: name, charge_to: guestChargeTo[name] ?? null })),
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
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {groupMembers.map((m) => {
              const selected = selectedPlayers.includes(m.profile_id);
              const disabled = !selected && totalPlayers >= 4;
              return (
                <div key={m.profile_id} className="space-y-1">
                  <button
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
                  {selected && teeBoxes.length > 0 && (
                    <div className="flex items-center gap-2 pl-9">
                      <span className="text-[10px] text-emerald-200/50 shrink-0">Tee:</span>
                      <select
                        value={playerTees[m.profile_id] ?? ""}
                        onChange={(e) => setPlayerTees((tees) => ({ ...tees, [m.profile_id]: e.target.value }))}
                        className="flex-1 rounded-lg bg-emerald-900/30 border border-emerald-800/40 px-2 py-1 text-xs text-emerald-50 focus:outline-none"
                      >
                        <option value="">— round default —</option>
                        {teeBoxes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}{t.yards ? ` (${t.yards}y)` : ""}{t.rating ? ` · ${t.rating}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
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
              <div key={g} className="space-y-1">
                <div className="flex items-center justify-between rounded-xl border border-emerald-900/40 bg-emerald-900/20 px-3 py-1.5">
                  <span className="text-sm text-emerald-100">{g} <span className="text-[10px] text-emerald-200/50">guest</span></span>
                  <button type="button" onClick={() => removeGuest(g)} className="text-emerald-200/50 text-xs hover:text-red-400">✕</button>
                </div>
                {/* Guest fee — charge to a host player */}
                {entryFeeAmount && entryFeeAmount > 0 && selectedPlayers.length > 0 && (
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-[10px] text-emerald-200/50">
                      Charge {entryFeeCurrency === "GBP" ? "£" : ""}{entryFeeAmount.toFixed(2)} guest fee to:
                    </span>
                    <select
                      value={guestChargeTo[g] ?? ""}
                      onChange={(e) => setGuestChargeTo((prev) => ({ ...prev, [g]: e.target.value }))}
                      className="flex-1 rounded-lg border border-emerald-900/50 bg-[#0b3b21]/60 px-2 py-1 text-[10px] text-emerald-50"
                    >
                      <option value="">— none —</option>
                      {selectedPlayers.map((pid) => {
                        const m = groupMembers.find((m) => m.profile_id === pid);
                        return <option key={pid} value={pid}>{m?.profile?.name ?? pid}</option>;
                      })}
                    </select>
                  </div>
                )}
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
  onViewScorecard,
  onStartRound,
  isStarting,
}: {
  tt: CompetitionTeeTime;
  isAdmin: boolean;
  onDelete: () => void;
  onViewScorecard?: () => void;
  onStartRound?: () => void;
  isStarting?: boolean;
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
      {tt.round?.status === "finished" && onViewScorecard && (
        <button
          type="button"
          onClick={onViewScorecard}
          className="text-[11px] text-emerald-400 hover:text-emerald-300 text-left"
        >
          View Scorecard →
        </button>
      )}
      {tt.round?.status === "scheduled" && onStartRound && (
        <button
          type="button"
          onClick={onStartRound}
          disabled={isStarting}
          className="text-[11px] text-emerald-400 hover:text-emerald-300 text-left disabled:opacity-50"
        >
          {isStarting ? "Starting…" : "Start Round →"}
        </button>
      )}
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

// ─── Fixture card ────────────────────────────────────────────────────────────

function FixtureCard({ fixture }: { fixture: MatchplayFixture & { home_entry?: any; away_entry?: any } }) {
  const resultLabel = fixture.result_type
    ? fixture.result_type === "halved"
      ? "½"
      : fixture.margin_holes != null && fixture.holes_remaining != null
      ? `${fixture.margin_holes}&${fixture.holes_remaining}`
      : fixture.result_type.replace("_", " ")
    : null;

  const homeWon = fixture.result_type === "home_win" || fixture.result_type === "walkover_home";
  const awayWon = fixture.result_type === "away_win" || fixture.result_type === "walkover_away";

  return (
    <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        {/* Home */}
        <div className={`flex-1 flex items-center gap-2 min-w-0 ${homeWon ? "opacity-100" : awayWon ? "opacity-50" : "opacity-100"}`}>
          <div className="h-6 w-6 rounded-full bg-emerald-900/60 grid place-items-center text-[9px] font-bold text-emerald-200 shrink-0">
            {(fixture.home_entry?.profile?.name ?? "?").slice(0, 2).toUpperCase()}
          </div>
          <span className={`text-xs truncate ${homeWon ? "font-bold text-emerald-50" : "text-emerald-100/70"}`}>
            {fixture.home_entry?.profile?.name ?? "TBD"}
          </span>
        </div>

        {/* Result */}
        <div className="shrink-0 text-center w-14">
          {fixture.status === "completed" && resultLabel ? (
            <span className="text-xs font-bold text-[#f5e6b0]">{resultLabel}</span>
          ) : fixture.scheduled_at ? (
            <span className="text-[10px] text-emerald-200/50">
              {new Date(fixture.scheduled_at).toLocaleDateString([], { month: "short", day: "numeric" })}
            </span>
          ) : (
            <span className="text-[10px] text-emerald-200/30">vs</span>
          )}
        </div>

        {/* Away */}
        <div className={`flex-1 flex items-center gap-2 justify-end min-w-0 ${awayWon ? "opacity-100" : homeWon ? "opacity-50" : "opacity-100"}`}>
          <span className={`text-xs truncate text-right ${awayWon ? "font-bold text-emerald-50" : "text-emerald-100/70"}`}>
            {fixture.away_entry?.profile?.name ?? "TBD"}
          </span>
          <div className="h-6 w-6 rounded-full bg-emerald-900/60 grid place-items-center text-[9px] font-bold text-emerald-200 shrink-0">
            {(fixture.away_entry?.profile?.name ?? "?").slice(0, 2).toUpperCase()}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Competition Setup Sheet ──────────────────────────────────────────────────

function CompetitionSetupSheet({
  competition,
  onClose,
  onSaved,
}: {
  competition: CompetitionWithGroup;
  onClose: () => void;
  onSaved: (updated: CompetitionWithGroup) => void;
}) {
  const compType = competition.competition_type;
  const isAggregate = competition.competition_category === "aggregate";
  const handicap = (competition.handicap_rules ?? {}) as Record<string, unknown>;

  const [name, setName] = useState(competition.name ?? "");
  const [description, setDescription] = useState(competition.description ?? "");
  const [competitionDate, setCompetitionDate] = useState(
    competition.competition_date ? competition.competition_date.slice(0, 10) : ""
  );
  const [entryStart, setEntryStart] = useState(
    competition.entry_window_start ? competition.entry_window_start.slice(0, 16) : ""
  );
  const [entryEnd, setEntryEnd] = useState(
    competition.entry_window_end ? competition.entry_window_end.slice(0, 16) : ""
  );
  const [courseId, setCourseId] = useState(competition.course_id ?? "");
  const [courseName, setCourseName] = useState(competition.course?.name ?? "");
  const [showCoursePicker, setShowCoursePicker] = useState(false);
  const [selectedCompType, setSelectedCompType] = useState<string>(compType ?? "stroke");
  const [scoringModel, setScoringModel] = useState<string>(competition.scoring_model ?? "net");
  const [pointsModel, setPointsModel] = useState<string>(competition.points_model ?? "none");
  const [numRounds, setNumRounds] = useState(String(competition.num_rounds ?? 1));
  const [standingsContrib, setStandingsContrib] = useState(competition.standings_contribution ?? "event_only");
  const [rulesText, setRulesText] = useState(competition.rules_text ?? "");
  const [handicapMode, setHandicapMode] = useState<string>((handicap.mode as string) ?? "allowance_pct");
  const [handicapPct, setHandicapPct] = useState(handicap.allowance_pct != null ? String(handicap.allowance_pct) : "100");
  const [handicapMax, setHandicapMax] = useState(handicap.max_handicap != null ? String(handicap.max_handicap) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);


  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const session = await getViewerSession();
      if (!session) { setError("Not signed in"); return; }

      const handicap_rules = scoringModel !== "gross"
        ? {
            mode: handicapMode,
            allowance_pct: handicapMode === "allowance_pct" ? (parseInt(handicapPct, 10) || 100) : null,
            max_handicap: handicapMax ? parseInt(handicapMax, 10) : null,
          }
        : {};

      const res = await fetch(`/api/majors/competitions/${competition.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          competition_date: competitionDate || null,
          entry_window_start: entryStart || null,
          entry_window_end: entryEnd || null,
          course_id: courseId || null,
          competition_type: isAggregate ? competition.competition_type : selectedCompType,
          scoring_model: scoringModel,
          handicap_rules,
          points_model: pointsModel,
          num_rounds: isAggregate ? competition.num_rounds : (parseInt(numRounds, 10) || 1),
          rules_text: rulesText.trim() || null,
          standings_contribution: standingsContrib,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Save failed"); return; }
      onSaved({
        ...competition,
        ...json.competition,
        group: competition.group,
        course: courseId ? { id: courseId, name: courseName } : competition.course,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60 pb-[env(safe-area-inset-bottom)]" onClick={onClose}>
      <div
        className="w-full max-w-sm mx-auto rounded-t-3xl bg-[#071f13] border-t border-emerald-900/70 px-4 pt-5 space-y-4 max-h-[90dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-emerald-800/60 mx-auto mb-1" />
        <div className="text-sm font-semibold text-emerald-50">Edit Competition Setup</div>

        <div className="space-y-4 pb-6">
          {/* Name */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Name *</label>
            <input className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 focus:outline-none"
              value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Description</label>
            <textarea className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 focus:outline-none resize-none"
              rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          {/* Date */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Competition Date</label>
            <input type="date" className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 focus:outline-none"
              value={competitionDate} onChange={(e) => setCompetitionDate(e.target.value)} />
          </div>

          {/* Entry window */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Entry Opens</label>
              <input type="datetime-local" className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-2 py-2 text-xs text-emerald-50 focus:outline-none"
                value={entryStart} onChange={(e) => setEntryStart(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Entry Closes</label>
              <input type="datetime-local" className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-2 py-2 text-xs text-emerald-50 focus:outline-none"
                value={entryEnd} onChange={(e) => setEntryEnd(e.target.value)} />
            </div>
          </div>

          {/* Course */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Course</label>
            {courseId ? (
              <div className="flex items-center justify-between rounded-xl border border-emerald-600/60 bg-emerald-900/30 px-3 py-2">
                <span className="text-sm text-emerald-50 truncate">{courseName}</span>
                <button type="button" onClick={() => { setCourseId(""); setCourseName(""); }}
                  className="ml-2 text-[11px] text-emerald-300/60 hover:text-emerald-200 shrink-0">✕</button>
              </div>
            ) : (
              <button type="button" onClick={() => setShowCoursePicker(true)}
                className="w-full rounded-xl border border-emerald-800/40 bg-emerald-900/20 px-3 py-2 text-sm text-emerald-200/60 text-left">
                Select course…
              </button>
            )}
            <CoursePickerModal
              open={showCoursePicker}
              onClose={() => setShowCoursePicker(false)}
              onSelect={(id, name) => { setCourseId(id); setCourseName(name ?? ""); setShowCoursePicker(false); }}
            />
          </div>

          {/* Format */}
          {!isAggregate && (
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Format</label>
              <div className="grid grid-cols-2 gap-1.5">
                {COMP_TYPES.map((t) => (
                  <button key={t.value} type="button" onClick={() => setSelectedCompType(t.value)}
                    className={`rounded-xl border px-2 py-1.5 text-[11px] transition-colors ${selectedCompType === t.value ? "border-emerald-500 bg-emerald-900/50 text-emerald-50" : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200/60"}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Scoring model */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Scoring</label>
            <div className="grid grid-cols-2 gap-1.5">
              {SCORING_MODELS.map((s) => (
                <button key={s.value} type="button" onClick={() => setScoringModel(s.value)}
                  className={`rounded-xl border px-2 py-1.5 text-[11px] transition-colors ${scoringModel === s.value ? "border-emerald-500 bg-emerald-900/50 text-emerald-50" : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200/60"}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Handicap rules */}
          {scoringModel !== "gross" && (
            <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/30 p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-emerald-200/50 font-semibold">Handicap Rules</div>
              <HandicapRulesEditor
                compact
                value={{ mode: handicapMode as any, allowance_pct: handicapPct, max_handicap: handicapMax }}
                onChange={(v) => { setHandicapMode(v.mode); setHandicapPct(v.allowance_pct); setHandicapMax(v.max_handicap); }}
              />
            </div>
          )}

          {/* Points model */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Points</label>
            <div className="grid grid-cols-2 gap-1.5">
              {POINTS_MODELS.map((p) => (
                <button key={p.value} type="button" onClick={() => setPointsModel(p.value)}
                  className={`rounded-xl border px-2 py-1.5 text-[11px] transition-colors ${pointsModel === p.value ? "border-emerald-500 bg-emerald-900/50 text-emerald-50" : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200/60"}`}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Num rounds */}
          {!isAggregate && (
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Rounds</label>
              <input type="number" min={1} max={10} value={numRounds}
                onChange={(e) => setNumRounds(e.target.value)}
                className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 focus:outline-none" />
            </div>
          )}

          {/* Rules */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Rules</label>
            <textarea className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-200/30 focus:outline-none resize-none"
              rows={3} value={rulesText} onChange={(e) => setRulesText(e.target.value)} />
          </div>

          {/* Standings contribution */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Season Standings</label>
            <div className="grid grid-cols-3 gap-1.5">
              {(["event_only", "season", "both"] as const).map((v) => (
                <button key={v} type="button" onClick={() => setStandingsContrib(v)}
                  className={`rounded-xl border px-2 py-1.5 text-[10px] text-center transition-colors ${standingsContrib === v ? "border-emerald-500 bg-emerald-900/50 text-emerald-50" : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200/60"}`}>
                  {v === "event_only" ? "Event only" : v === "season" ? "Season" : "Both"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && <div className="text-sm text-red-400 pb-2">{error}</div>}
        <div className="flex gap-3 pb-6">
          <button type="button" onClick={onClose}
            className="flex-1 py-3 rounded-full border border-emerald-900/60 text-sm text-emerald-200/70">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={!name.trim() || saving}
            className="flex-1 py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
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
  const [leaderboard, setLeaderboard] = useState<LeaderboardRowWithRoundId[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
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
  const [matchplayStages, setMatchplayStages] = useState<MatchplayStage[]>([]);
  const [matchplayFixtures, setMatchplayFixtures] = useState<MatchplayFixture[]>([]);
  const [leagueTable, setLeagueTable] = useState<MatchplayLeagueTableEntryWithProfile[]>([]);
  const [winnings, setWinnings] = useState<CompetitionWinningWithProfile[]>([]);
  const [waitlistEntry, setWaitlistEntry] = useState<CompetitionWaitlistEntry | null>(null);
  const [joiningWaitlist, setJoiningWaitlist] = useState(false);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [proposedWinnings, setProposedWinnings] = useState<ProposedWinning[] | null>(null);
  const [proposingWinnings, setProposingWinnings] = useState(false);
  const [showSetupSheet, setShowSetupSheet] = useState(false);
  const [startingRoundId, setStartingRoundId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const session = await getViewerSession();
        if (!session || cancelled) return;
        setMyProfileId(session.profileId);
        const headers = { Authorization: `Bearer ${session.accessToken}` };

        const [compRes, lbRes, roundsRes, teeTimesRes, participantsRes, winningsRes] = await Promise.all([
          fetch(`/api/majors/competitions/${competitionId}`, { headers }),
          fetch(`/api/majors/competitions/${competitionId}/leaderboard`, { headers }),
          fetch(`/api/rounds?status=finished&limit=20`, { headers }),
          fetch(`/api/majors/competitions/${competitionId}/tee-times`, { headers }),
          fetch(`/api/majors/competitions/${competitionId}/participants`, { headers }),
          fetch(`/api/majors/competitions/${competitionId}/winnings`, { headers }),
        ]);

        if (cancelled) return;

        if (compRes.ok) {
          const j = await compRes.json();
          const comp = j.competition;
          setCompetition(comp);

          // Load matchplay fixtures if applicable
          if (isMatchplayLeague(comp?.competition_type) || isMatchplayKnockout(comp?.competition_type)) {
            const fixRes = await fetch(`/api/majors/competitions/${competitionId}/fixtures`, { headers });
            if (!cancelled && fixRes.ok) {
              const fj = await fixRes.json();
              setMatchplayStages(fj.stages ?? []);
              setMatchplayFixtures(fj.fixtures ?? []);
            }
            const ltRes = await fetch(`/api/majors/competitions/${competitionId}/league-table`, { headers }).catch(() => null);
            if (!cancelled && ltRes?.ok) {
              const lj = await ltRes.json();
              setLeagueTable(lj.entries ?? []);
            }
          }

          // Load group members and my role if competition has a group
          if (j.competition?.group_id) {
            const membersRes = await fetch(`/api/majors/groups/${j.competition.group_id}/members`, { headers });
            if (!cancelled && membersRes.ok) {
              const mj = await membersRes.json();
              const members: any[] = mj.members ?? [];
              setGroupMembers(members.filter((m: any) => m.status === "active").map((m: any) => ({
                profile_id: m.profile_id,
                profile: m.profile ?? null,
                preferred_tee_name: m.preferred_tee_name ?? null,
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

        if (participantsRes.ok) {
          const j = await participantsRes.json();
          const fetched: Participant[] = j.participants ?? [];
          setParticipants(fetched);
          const entered = fetched.some((p) => p.profile_id === session.profileId);
          setIsEntered(entered);

          // If not entered, check waitlist status
          if (!entered) {
            const wlRes = await fetch(`/api/majors/competitions/${competitionId}/waitlist`, { headers });
            if (!cancelled && wlRes.ok) {
              const wj = await wlRes.json();
              const myEntry = (wj.waitlist ?? []).find((w: any) => w.profile_id === session.profileId);
              setWaitlistEntry(myEntry ?? null);
            }
          }
        }

        if (winningsRes.ok) {
          const j = await winningsRes.json();
          setWinnings(j.winnings ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [competitionId]);

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
      if (res.ok) {
        setIsEntered(true);
        // Refresh participants so the leaderboard shows the new entrant
        const pRes = await fetch(`/api/majors/competitions/${competitionId}/participants`, {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (pRes.ok) {
          const pj = await pRes.json();
          setParticipants(pj.participants ?? []);
        }
      }
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

  const handleWithdraw = async () => {
    setWithdrawing(true);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/competitions/${competitionId}/withdraw`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (res.ok) {
        setIsEntered(false);
        setShowWithdrawConfirm(false);
        // Re-fetch participants and tee times
        const [pRes, ttRes, wlRes] = await Promise.all([
          fetch(`/api/majors/competitions/${competitionId}/participants`, { headers: { Authorization: `Bearer ${session.accessToken}` } }),
          fetch(`/api/majors/competitions/${competitionId}/tee-times`, { headers: { Authorization: `Bearer ${session.accessToken}` } }),
          fetch(`/api/majors/competitions/${competitionId}/waitlist`, { headers: { Authorization: `Bearer ${session.accessToken}` } }),
        ]);
        if (pRes.ok) { const j = await pRes.json(); setParticipants(j.participants ?? []); }
        if (ttRes.ok) { const j = await ttRes.json(); setTeeTimes(j.tee_times ?? []); }
        if (wlRes.ok) { const j = await wlRes.json(); setWaitlistEntry((j.waitlist ?? []).find((w: any) => w.profile_id === session.profileId) ?? null); }
      }
    } finally {
      setWithdrawing(false);
    }
  };

  const handleJoinWaitlist = async () => {
    setJoiningWaitlist(true);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/competitions/${competitionId}/waitlist`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (res.ok) {
        const j = await res.json();
        setWaitlistEntry(j.entry ?? null);
      }
    } finally {
      setJoiningWaitlist(false);
    }
  };

  const handleLeaveWaitlist = async () => {
    try {
      const session = await getViewerSession();
      if (!session) return;
      await fetch(`/api/majors/competitions/${competitionId}/waitlist`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      setWaitlistEntry(null);
    } catch {}
  };

  const handleProposeWinnings = async () => {
    setProposingWinnings(true);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/competitions/${competitionId}/winnings/propose`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (res.ok) {
        const j = await res.json();
        setProposedWinnings(j.proposed ?? []);
      }
    } finally {
      setProposingWinnings(false);
    }
  };

  const handleConfirmWinnings = async () => {
    if (!proposedWinnings) return;
    const session = await getViewerSession();
    if (!session) return;
    for (const pw of proposedWinnings) {
      await fetch(`/api/majors/competitions/${competitionId}/winnings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id: pw.profile_id, amount: pw.amount, position: pw.position }),
      });
    }
    setProposedWinnings(null);
    const wRes = await fetch(`/api/majors/competitions/${competitionId}/winnings`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (wRes.ok) { const j = await wRes.json(); setWinnings(j.winnings ?? []); }
  };

  const handleJoinTeeTimeSlot = async (teeTimeId: string) => {
    const session = await getViewerSession();
    if (!session) return;
    await fetch(`/api/majors/competitions/${competitionId}/tee-times/${teeTimeId}/join`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    refreshTeeTimes();
  };

  const handleLeaveTeeTimeSlot = async (teeTimeId: string) => {
    const session = await getViewerSession();
    if (!session) return;
    await fetch(`/api/majors/competitions/${competitionId}/tee-times/${teeTimeId}/leave`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    refreshTeeTimes();
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

  const handleStartRound = async (roundId: string) => {
    setStartingRoundId(roundId);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch("/api/rounds/start", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ round_id: roundId }),
      });
      if (res.ok) {
        router.push(`/round/${roundId}?from=competition&competitionId=${competitionId}`);
      }
    } finally {
      setStartingRoundId(null);
    }
  };

  const now = new Date();
  const entryOpen = competition
    ? (!competition.entry_window_start || new Date(competition.entry_window_start) <= now) &&
      (!competition.entry_window_end || new Date(competition.entry_window_end) >= now) &&
      competition.majors_status !== "completed" &&
      competition.majors_status !== "cancelled"
    : false;

  const isAdminOrOwner =
    myRole === "owner" ||
    myRole === "admin" ||
    (!competition?.group_id && competition?.created_by_profile_id === myProfileId);

  const visibleTabs = (() => {
    const BASE = getTabsForCompetition(competition);
    let tabs = competition?.majors_status === "completed" ? BASE : BASE.filter((t) => t.id !== "results");
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

        {/* Entry fee */}
        {(competition as any).entry_fee_amount > 0 && (
          <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5 flex items-center justify-between">
            <span className="text-[12px] text-emerald-200/60">Entry Fee</span>
            <span className="text-sm font-bold text-[#f5e6b0]">
              {((competition as any).entry_fee_currency ?? "GBP") === "GBP" ? "£" : ""}
              {((competition as any).entry_fee_amount as number).toFixed(2)}
            </span>
          </div>
        )}

        {/* Admin edit setup */}
        {isAdminOrOwner && (
          <button
            type="button"
            onClick={() => setShowSetupSheet(true)}
            className="w-full py-2 rounded-full border border-emerald-800/60 text-[11px] font-semibold text-emerald-300/70 hover:text-emerald-200 hover:border-emerald-700/60 transition-colors"
          >
            Edit Setup
          </button>
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

        {/* Waitlist CTA */}
        {!isEntered && !entryOpen && (competition as any).waitlist_enabled && (
          waitlistEntry ? (
            <div className="space-y-2">
              <div className="rounded-xl border border-amber-800/40 bg-amber-900/20 px-3 py-2.5 text-center">
                <div className="text-[11px] text-amber-300 font-semibold">
                  {waitlistEntry.status === "offered" ? "A spot has been offered to you!" : "You're on the waitlist"}
                </div>
                {waitlistEntry.status === "offered" && (
                  <button type="button" onClick={handleEnter} disabled={entering}
                    className="mt-2 w-full py-2 rounded-full bg-emerald-700 text-sm font-semibold text-white disabled:opacity-50">
                    {entering ? "Entering…" : "Accept Spot"}
                  </button>
                )}
              </div>
              <button type="button" onClick={handleLeaveWaitlist}
                className="w-full py-2 rounded-full border border-red-900/50 text-sm text-red-400/70 hover:text-red-400">
                Leave Waitlist
              </button>
            </div>
          ) : (
            <button type="button" onClick={handleJoinWaitlist} disabled={joiningWaitlist}
              className="w-full py-3 rounded-full border border-amber-700/60 text-sm font-semibold text-amber-200 hover:bg-amber-900/20 disabled:opacity-50">
              {joiningWaitlist ? "Joining…" : "Join Waitlist"}
            </button>
          )
        )}

        {isEntered && (() => {
          // Is this player's round managed by the competition (via a tee time)?
          // If so, their score is submitted automatically when the round finishes —
          // no manual submit step needed.
          const myTeeTime = myProfileId
            ? teeTimes.find((tt) =>
                tt.round?.participants?.some((p) => p.profile_id === myProfileId)
              )
            : null;
          const competitionOwnsRound = !!myTeeTime;

          return (
          <div className="space-y-2">
            <div className="flex gap-3">
              <div className="flex-1 py-3 rounded-full border border-emerald-700/50 text-sm font-semibold text-emerald-400 text-center">
                ✓ Entered
              </div>
              {entryOpen && !competitionOwnsRound && (
                <button
                  type="button"
                  onClick={() => setShowSubmitSheet(true)}
                  className="flex-1 py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600"
                >
                  Submit Round
                </button>
              )}
            </div>
            {entryOpen && competitionOwnsRound && myTeeTime && (
              <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5 text-[11px] text-emerald-200/60">
                {myTeeTime.round?.status === "finished"
                  ? "Your score has been submitted automatically."
                  : myTeeTime.round?.status === "live"
                  ? "Round in progress — your score will be submitted when the round is finished."
                  : `Tee time at ${new Date(myTeeTime.tee_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — your score will be submitted automatically.`}
              </div>
            )}
            {/* Withdraw */}
            {competition.majors_status !== "live" && competition.majors_status !== "completed" && (
              (competition as any).allow_self_withdrawal !== false ? (
                <button type="button" onClick={() => setShowWithdrawConfirm(true)}
                  className="w-full py-2 rounded-full border border-red-900/50 text-sm text-red-400/70 hover:text-red-400 transition-colors">
                  Withdraw from Competition
                </button>
              ) : (
                <div className="text-center text-[11px] text-emerald-200/40 py-1">
                  Contact the organiser to withdraw
                </div>
              )
            )}
          </div>
          );
        })()}
      </div>
    ) : null,

    leaderboard: (() => {
      const rankedIds = new Set(leaderboard.map((r) => r.profile_id));
      const unranked = participants.filter((p) => !rankedIds.has(p.profile_id));
      const showPts = competition?.points_model && competition.points_model !== "none";
      return (
        <div className="space-y-2">
          {leaderboard.length === 0 && unranked.length === 0 && (
            <div className="text-sm text-emerald-100/60 text-center py-8">
              No participants yet. Enter to appear here.
            </div>
          )}
          {leaderboard.map((row) => {
            const pts = showPts
              ? (row.points_earned ?? getPointsForPosition(row.position ?? null, competition.points_model, competition.points_table as Record<string, unknown>))
              : null;
            const inner = (
              <>
                <PositionBadge position={row.position ?? null} />
                {row.profile?.avatar_url ? (
                  <img src={row.profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">
                    {row.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
                  </div>
                )}
                <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{row.profile?.name ?? "Unknown"}</span>
                {showPts && (
                  <div className="text-right shrink-0 mr-1">
                    <div className="text-[10px] text-emerald-200/50 uppercase tracking-wider leading-none">Pts</div>
                    <div className="text-xs font-bold text-emerald-300">{pts ?? "—"}</div>
                  </div>
                )}
                <div className="text-right shrink-0">
                  <div className="text-xs font-extrabold text-[#f5e6b0]">{row.net_score ?? row.gross_score ?? "—"}</div>
                  <div className="text-[10px] text-emerald-100/50">{row.rounds_submitted} rnd</div>
                </div>
                {row.round_id && (
                  <span className="text-[10px] text-emerald-400/70 shrink-0">→</span>
                )}
              </>
            );
            const rowClass = `flex items-center gap-3 rounded-xl border px-3 py-2.5 w-full text-left ${
              row.position === 1
                ? "border-[#f5e6b0]/25 bg-[#f5e6b0]/5"
                : row.position === 2
                ? "border-[#c0c0c0]/20 bg-[#c0c0c0]/5"
                : row.position === 3
                ? "border-[#cd7f32]/20 bg-[#cd7f32]/5"
                : "border-emerald-900/50 bg-[#0b3b21]/60"
            }`;
            return row.round_id ? (
              <button
                key={row.id}
                type="button"
                className={`${rowClass} hover:brightness-110 active:scale-[0.99] transition-all`}
                onClick={() => router.push(`/round/${row.round_id}?from=competition&competitionId=${competitionId}`)}
              >
                {inner}
              </button>
            ) : (
              <div key={row.id} className={rowClass}>
                {inner}
              </div>
            );
          })}
          {unranked.length > 0 && (
            <>
              {leaderboard.length > 0 && (
                <div className="flex items-center gap-2 py-1">
                  <div className="flex-1 h-px bg-emerald-900/50" />
                  <span className="text-[10px] text-emerald-200/40 uppercase tracking-wider">Entered</span>
                  <div className="flex-1 h-px bg-emerald-900/50" />
                </div>
              )}
              {unranked.map((p) => (
                <div
                  key={p.profile_id}
                  className="flex items-center gap-3 rounded-xl border border-emerald-900/40 bg-[#0b3b21]/40 px-3 py-2.5"
                >
                  <span className="w-7 text-center text-xs text-emerald-200/30">—</span>
                  {p.profile?.avatar_url ? (
                    <img src={p.profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover shrink-0 opacity-60" />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-emerald-900/40 grid place-items-center text-[10px] font-bold text-emerald-200/50 shrink-0">
                      {p.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
                    </div>
                  )}
                  <span className="flex-1 text-sm font-semibold text-emerald-50/50 truncate">{p.profile?.name ?? "Unknown"}</span>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-emerald-200/30">—</div>
                    <div className="text-[10px] text-emerald-100/30">0 rnd</div>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      );
    })(),

    "tee-times": (() => {
      const isSelfSelect = (competition as any)?.tee_time_mode === "self_select";
      // Which tee time round_id does this player belong to?
      const myTeeTimeId = isSelfSelect && myProfileId
        ? teeTimes.find((tt) =>
            tt.round?.participants?.some((p) => p.profile_id === myProfileId)
          )?.id ?? null
        : null;

      return (
        <div className="space-y-3">
          {isSelfSelect && (
            <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2 text-[11px] text-emerald-200/60">
              Players can choose their own tee time slot.
            </div>
          )}
          {isAdminOrOwner && (
            <button
              type="button"
              onClick={() => setShowAddTeeTime(true)}
              className="w-full py-2.5 rounded-full border border-emerald-700/60 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/30"
            >
              + {isSelfSelect ? "Add Slot" : "Add Tee Time"}
            </button>
          )}
          {teeTimes.length === 0 ? (
            <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 p-5 text-center space-y-1">
              <div className="text-sm text-emerald-100/60">
                {isAdminOrOwner
                  ? "No tee times set up yet."
                  : isEntered
                  ? isSelfSelect ? "No slots available yet. Check back soon." : "Your tee time hasn't been set yet."
                  : "No tee times have been scheduled yet."}
              </div>
            </div>
          ) : (
            teeTimes.map((tt) => {
              const participantCount = tt.round?.participants?.length ?? 0;
              const hasSlot = tt.round?.participants?.some((p) => p.profile_id === myProfileId) ?? false;
              const isMySlot = hasSlot;
              const canJoin = isSelfSelect && isEntered && myProfileId && !myTeeTimeId && participantCount < 4;

              return (
                <div key={tt.id} className="space-y-2">
                  <TeeTimeCard
                    tt={tt}
                    isAdmin={isAdminOrOwner}
                    onDelete={() => handleDeleteTeeTime(tt.id)}
                    onViewScorecard={tt.round?.id ? () => router.push(`/round/${tt.round!.id}?from=competition&competitionId=${competitionId}`) : undefined}
                    onStartRound={hasSlot && tt.round?.status === "scheduled" && tt.round?.id ? () => handleStartRound(tt.round!.id) : undefined}
                    isStarting={startingRoundId === tt.round?.id}
                  />
                  {isSelfSelect && (
                    isMySlot ? (
                      <button
                        type="button"
                        onClick={() => handleLeaveTeeTimeSlot(tt.id)}
                        className="w-full py-2 rounded-full border border-red-900/40 text-[11px] text-red-400/70 hover:text-red-400"
                      >
                        Leave this slot
                      </button>
                    ) : canJoin ? (
                      <button
                        type="button"
                        onClick={() => handleJoinTeeTimeSlot(tt.id)}
                        className="w-full py-2 rounded-full bg-emerald-700/80 text-[11px] font-semibold text-white hover:bg-emerald-700"
                      >
                        Join this slot
                      </button>
                    ) : null
                  )}
                </div>
              );
            })
          )}
        </div>
      );
    })(),

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

    fixtures: (
      <div className="space-y-4">
        {matchplayStages.length === 0 && matchplayFixtures.length === 0 ? (
          <div className="text-sm text-emerald-100/60 text-center py-8">
            {isAdminOrOwner ? "No fixtures generated yet." : "Fixtures not yet scheduled."}
          </div>
        ) : (
          matchplayStages.length > 0
            ? matchplayStages.map((stage) => (
                <div key={stage.id} className="space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-emerald-200/60 font-semibold px-1">{stage.name}</div>
                  {matchplayFixtures.filter((f) => f.stage_id === stage.id).map((f) => (
                    <FixtureCard key={f.id} fixture={f as any} />
                  ))}
                </div>
              ))
            : matchplayFixtures.map((f) => <FixtureCard key={f.id} fixture={f as any} />)
        )}
      </div>
    ),

    bracket: (
      <div className="space-y-3 text-sm text-emerald-100/70 text-center py-8">
        Bracket view coming soon.
      </div>
    ),

    "league-table": (
      <div className="space-y-2">
        {leagueTable.length === 0 ? (
          <div className="text-sm text-emerald-100/60 text-center py-8">
            League table will appear after fixtures are played.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-6 text-[10px] uppercase tracking-wider text-emerald-200/50 px-3 pb-1">
              <span className="col-span-2">Player</span>
              <span className="text-center">P</span>
              <span className="text-center">W</span>
              <span className="text-center">H</span>
              <span className="text-center">Pts</span>
            </div>
            {leagueTable.map((row) => (
              <div key={row.id} className="grid grid-cols-6 items-center rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5">
                <div className="col-span-2 flex items-center gap-2 min-w-0">
                  <span className="text-[11px] text-emerald-200/50 w-4 shrink-0">{row.position ?? "—"}</span>
                  {row.profile?.avatar_url ? (
                    <img src={row.profile.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="h-6 w-6 rounded-full bg-emerald-900/60 grid place-items-center text-[9px] font-bold text-emerald-200 shrink-0">
                      {row.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
                    </div>
                  )}
                  <span className="text-xs font-semibold text-emerald-50 truncate">{row.profile?.name ?? "—"}</span>
                </div>
                <span className="text-center text-xs text-emerald-100/70">{row.played}</span>
                <span className="text-center text-xs text-emerald-100/70">{row.won}</span>
                <span className="text-center text-xs text-emerald-100/70">{row.halved}</span>
                <span className="text-center text-xs font-bold text-[#f5e6b0]">{row.league_points}</span>
              </div>
            ))}
          </>
        )}
      </div>
    ),

    winnings: (
      <div className="space-y-4">
        {/* Admin: propose / confirm winnings */}
        {isAdminOrOwner && competition?.majors_status === "completed" && (competition as any).prize_table && (
          <div className="space-y-2">
            {!proposedWinnings ? (
              <button
                type="button"
                onClick={handleProposeWinnings}
                disabled={proposingWinnings}
                className="w-full py-2.5 rounded-full border border-amber-700/60 text-sm font-semibold text-amber-200 hover:bg-amber-900/20 disabled:opacity-50"
              >
                {proposingWinnings ? "Calculating…" : "Propose Winnings from Prize Table"}
              </button>
            ) : (
              <div className="rounded-xl border border-amber-800/40 bg-amber-900/20 px-3 py-3 space-y-3">
                <div className="text-[11px] text-amber-300 font-semibold uppercase tracking-wide">Proposed Payouts</div>
                {proposedWinnings.map((pw) => (
                  <div key={pw.profile_id} className="flex items-center gap-3">
                    <PositionBadge position={pw.position} />
                    <span className="flex-1 text-sm text-emerald-50">{pw.profile?.name ?? "?"}</span>
                    <span className="text-sm font-bold text-[#f5e6b0]">£{pw.amount.toFixed(2)}</span>
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={() => setProposedWinnings(null)}
                    className="flex-1 py-2 rounded-full border border-emerald-900/60 text-[11px] text-emerald-200/60">
                    Cancel
                  </button>
                  <button type="button" onClick={handleConfirmWinnings}
                    className="flex-1 py-2 rounded-full bg-emerald-700 text-[11px] font-semibold text-white">
                    Confirm & Record
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Winnings list */}
        {winnings.length === 0 ? (
          <div className="text-sm text-emerald-100/60 text-center py-8">No winnings recorded yet.</div>
        ) : (
          <div className="space-y-2">
            {winnings.map((w) => (
              <div key={w.id} className="flex items-center gap-3 rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5">
                <PositionBadge position={w.position ?? null} />
                {w.profile?.avatar_url ? (
                  <img src={w.profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">
                    {w.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
                  </div>
                )}
                <span className="flex-1 text-sm font-semibold text-emerald-50">{w.profile?.name ?? "Unknown"}</span>
                <span className="text-sm font-bold text-[#f5e6b0]">£{w.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    ),

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

      {showSetupSheet && competition && (
        <CompetitionSetupSheet
          competition={competition}
          onClose={() => setShowSetupSheet(false)}
          onSaved={(updated) => {
            setCompetition(updated);
            setShowSetupSheet(false);
          }}
        />
      )}

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
          courseId={competition.course_id ?? null}
          groupMembers={groupMembers}
          entryFeeAmount={(competition as any).entry_fee_amount ?? null}
          entryFeeCurrency={(competition as any).entry_fee_currency ?? "GBP"}
          onClose={() => setShowAddTeeTime(false)}
          onCreated={refreshTeeTimes}
        />
      )}

      {/* Withdraw confirmation sheet */}
      {showWithdrawConfirm && (
        <div className="fixed inset-0 z-50">
          <button className="absolute inset-0 bg-black/60" onClick={() => setShowWithdrawConfirm(false)} aria-label="Close" />
          <div className="absolute left-0 right-0 bottom-0 px-3 pb-[env(safe-area-inset-bottom)]">
            <div className="mx-auto w-full max-w-[520px] rounded-t-3xl border border-red-900/60 bg-[#1a0a0a] shadow-2xl overflow-hidden">
              <div className="p-4 border-b border-red-900/40">
                <div className="text-sm font-semibold text-red-100">Withdraw from {competition.name}?</div>
                <div className="text-[11px] text-red-200/60 mt-1">
                  This will remove your entry and any assigned tee time. This action cannot be undone.
                </div>
              </div>
              <div className="p-4 flex gap-2">
                <button
                  className="flex-1 rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/40 text-emerald-50 py-3 text-sm hover:bg-emerald-900/20"
                  onClick={() => setShowWithdrawConfirm(false)}
                  disabled={withdrawing}
                >
                  Cancel
                </button>
                <button
                  className="flex-1 rounded-2xl bg-red-600 text-white py-3 text-sm font-semibold hover:bg-red-700 disabled:opacity-60"
                  onClick={handleWithdraw}
                  disabled={withdrawing}
                >
                  {withdrawing ? "Withdrawing…" : "Withdraw"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
