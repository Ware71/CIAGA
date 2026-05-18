"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type {
  CompetitionWithGroup,
  CompetitionTypeV2,
  CompetitionRound,
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
import { supabase } from "@/lib/supabaseClient";

const FEDEX_POINTS_SCALE = [500, 300, 190, 140, 110, 90, 75, 60, 48, 38, 30, 24, 18, 14, 10, 8, 6, 4, 2, 1];

function formatToPar(n: number): string {
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : `${n}`;
}

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
  profile: { name: string | null; avatar_url: string | null; gender: string | null } | null;
  preferred_tee_name: string | null;
};

type TeeBoxOption = { id: string; name: string; gender: string | null; yards: number | null; rating: number | null; slope: number | null };

function EditRoundSheet({
  competitionId,
  round,
  onClose,
  onSaved,
}: {
  competitionId: string;
  round: CompetitionRound;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(round.name);
  const [scheduledDate, setScheduledDate] = useState(round.scheduled_date ?? "");
  const [status, setStatus] = useState(round.status);
  const [courseId, setCourseId] = useState(round.course_id ?? "");
  const [courseName, setCourseName] = useState(round.course?.name ?? "");
  const [maleTeeId, setMaleTeeId] = useState(round.default_tee_box_id_male ?? "");
  const [femaleTeeId, setFemaleTeeId] = useState(round.default_tee_box_id_female ?? "");
  const [teeBoxes, setTeeBoxes] = useState<TeeBoxOption[]>([]);
  const [showCoursePicker, setShowCoursePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!courseId) { setTeeBoxes([]); return; }
    fetch(`/api/courses/tee-boxes?course_id=${courseId}`)
      .then((r) => r.json())
      .then((j) => setTeeBoxes(j.tee_boxes ?? []));
  }, [courseId]);

  const maleTees = teeBoxes.filter((t) => !t.gender || t.gender === "male" || t.gender === "unisex");
  const femaleTees = teeBoxes.filter((t) => !t.gender || t.gender === "female" || t.gender === "unisex");

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/competitions/${competitionId}/rounds/${round.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || round.name,
          scheduled_date: scheduledDate || null,
          status,
          course_id: courseId || null,
          default_tee_box_id_male: maleTeeId || null,
          default_tee_box_id_female: femaleTeeId || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        setError(j.error ?? "Failed to save");
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const inputCls = "w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2.5 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600";

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-sm mx-auto rounded-t-3xl bg-[#071f13] border-t border-emerald-900/70 px-4 pt-5 pb-[env(safe-area-inset-bottom)] space-y-4 overflow-y-auto max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-emerald-800/60 mx-auto mb-1" />
        <div className="text-sm font-semibold text-emerald-50">Edit {round.name}</div>
        {error && <div className="text-[11px] text-red-400">{error}</div>}
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Name</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Date</label>
          <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className={inputCls} />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Status</label>
          <select value={status} onChange={(e) => setStatus(e.target.value as CompetitionRound["status"])} className={inputCls}>
            <option value="scheduled">Scheduled</option>
            <option value="live">Live</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Course</label>
          {courseName ? (
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm text-emerald-50 truncate">{courseName}</span>
              <button type="button" onClick={() => setShowCoursePicker(true)}
                className="text-[11px] text-emerald-400/70 hover:text-emerald-300 shrink-0">Change</button>
            </div>
          ) : (
            <button type="button" onClick={() => setShowCoursePicker(true)}
              className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2.5 text-sm text-emerald-200/50 text-left">
              Select course…
            </button>
          )}
        </div>
        {teeBoxes.length > 0 && (
          <>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Men&apos;s Default Tee</label>
              <select value={maleTeeId} onChange={(e) => setMaleTeeId(e.target.value)} className={inputCls}>
                <option value="">— None —</option>
                {maleTees.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Women&apos;s Default Tee</label>
              <select value={femaleTeeId} onChange={(e) => setFemaleTeeId(e.target.value)} className={inputCls}>
                <option value="">— None —</option>
                {femaleTees.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
    <CoursePickerModal
      open={showCoursePicker}
      onClose={() => setShowCoursePicker(false)}
      onSelect={(id, cname) => {
        setCourseId(id);
        setCourseName(cname ?? "");
        setMaleTeeId("");
        setFemaleTeeId("");
        setShowCoursePicker(false);
      }}
    />
    </>
  );
}

function AddTeeTimeSheet({
  competitionId,
  courseId,
  groupMembers,
  entrantProfileIds,
  entryFeeAmount,
  entryFeeCurrency,
  teeTimes,
  competitionRounds,
  onClose,
  onCreated,
}: {
  competitionId: string;
  courseId: string | null;
  groupMembers: GroupMember[];
  entrantProfileIds: Set<string>;
  entryFeeAmount: number | null;
  entryFeeCurrency: string;
  teeTimes: CompetitionTeeTime[];
  competitionRounds: CompetitionRound[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [teeTime, setTeeTime] = useState("");
  const [groupNumber, setGroupNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(
    () => competitionRounds.length === 1 ? competitionRounds[0].id : null
  );
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

  // Map of profileId → tee time they're currently assigned to (for badge display)
  const assignedMap = new Map<string, { groupNumber: number | null }>();
  for (const tt of teeTimes) {
    for (const p of tt.round?.participants ?? []) {
      if (p.profile_id) assignedMap.set(p.profile_id, { groupNumber: tt.group_number });
    }
  }

  // Filter tee boxes to only those appropriate for a player's gender
  const getTeeBoxesForPlayer = (profileId: string): TeeBoxOption[] => {
    const member = groupMembers.find((m) => m.profile_id === profileId);
    const playerGender = member?.profile?.gender ?? "male";
    return teeBoxes.filter((t) => {
      if (!t.gender) return true;
      if (playerGender === "female") return t.gender === "female" || t.gender === "unisex";
      return t.gender === "male" || t.gender === "unisex";
    });
  };

  // Resolve a member's preferred tee name to an actual tee_box_id, respecting gender
  const resolvePreferredTee = (preferredTeeName: string | null, profileId: string): string | undefined => {
    if (!preferredTeeName || teeBoxes.length === 0) return undefined;
    const filtered = getTeeBoxesForPlayer(profileId);
    const match = filtered.find(
      (t) => t.name.toLowerCase().trim() === preferredTeeName.toLowerCase().trim()
    );
    return match?.id;
  };

  // Resolve the gender-appropriate default tee from the selected competition round.
  // Takes priority over the player's stored preferred tee.
  const resolveRoundDefaultTee = (profileId: string): string | undefined => {
    if (!selectedRoundId) return undefined;
    const cr = competitionRounds.find((r) => r.id === selectedRoundId);
    if (!cr) return undefined;
    const member = groupMembers.find((m) => m.profile_id === profileId);
    const isFemale = member?.profile?.gender === "female";
    const defaultId = isFemale ? cr.default_tee_box_id_female : cr.default_tee_box_id_male;
    return defaultId ?? undefined;
  };

  const togglePlayer = (profileId: string) => {
    setSelectedPlayers((prev) => {
      if (prev.includes(profileId)) {
        const next = prev.filter((id) => id !== profileId);
        setPlayerTees((tees) => { const t = { ...tees }; delete t[profileId]; return t; });
        return next;
      }
      if (totalPlayers >= 4) return prev;
      // Pre-fill tee: competition round default takes priority over player's stored preference
      const roundTeeId = resolveRoundDefaultTee(profileId);
      if (roundTeeId) {
        setPlayerTees((tees) => ({ ...tees, [profileId]: roundTeeId }));
      } else {
        const member = groupMembers.find((m) => m.profile_id === profileId);
        if (member?.preferred_tee_name) {
          const teeId = resolvePreferredTee(member.preferred_tee_name, profileId);
          if (teeId) setPlayerTees((tees) => ({ ...tees, [profileId]: teeId }));
        }
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
          competition_round_id: selectedRoundId ?? undefined,
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

        {/* Round picker — only shown when there are multiple rounds */}
        {competitionRounds.length > 1 && (
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Round *</label>
            <div className="flex flex-wrap gap-2">
              {competitionRounds.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedRoundId(r.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    selectedRoundId === r.id
                      ? "bg-emerald-700 border-emerald-600 text-white"
                      : "border-emerald-800/60 text-emerald-200/70 hover:border-emerald-600"
                  }`}
                >
                  {r.name}
                </button>
              ))}
            </div>
          </div>
        )}

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
            {groupMembers.filter((m) => entrantProfileIds.has(m.profile_id)).map((m) => {
              const selected = selectedPlayers.includes(m.profile_id);
              const disabled = !selected && totalPlayers >= 4;
              const assignment = !selected ? assignedMap.get(m.profile_id) : undefined;
              const filteredTees = getTeeBoxesForPlayer(m.profile_id);
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
                    {assignment && (
                      <span className="text-[9px] text-amber-400/80 bg-amber-900/30 rounded px-1.5 py-0.5 shrink-0">
                        {assignment.groupNumber != null ? `Grp ${assignment.groupNumber}` : "Assigned"}
                      </span>
                    )}
                    {selected && <span className="text-emerald-400 text-xs">✓</span>}
                  </button>
                  {selected && filteredTees.length > 0 && (
                    <div className="flex items-center gap-2 pl-9">
                      <span className="text-[10px] text-emerald-200/50 shrink-0">Tee:</span>
                      <select
                        value={playerTees[m.profile_id] ?? ""}
                        onChange={(e) => setPlayerTees((tees) => ({ ...tees, [m.profile_id]: e.target.value }))}
                        className="flex-1 rounded-lg bg-emerald-900/30 border border-emerald-800/40 px-2 py-1 text-xs text-emerald-50 focus:outline-none"
                      >
                        <option value="">— round default —</option>
                        {filteredTees.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}{t.gender ? ` (${t.gender})` : ""}{t.yards ? ` · ${t.yards}y` : ""}{t.rating ? ` · ${t.rating}/${t.slope ?? "—"}` : ""}
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

// ─── Edit Tee Time Sheet ──────────────────────────────────────────────────────

function EditTeeTimeSheet({
  competitionId,
  tt,
  groupMembers,
  entrantProfileIds,
  teeTimes,
  onClose,
  onSaved,
}: {
  competitionId: string;
  tt: CompetitionTeeTime;
  groupMembers: GroupMember[];
  entrantProfileIds: Set<string>;
  teeTimes: CompetitionTeeTime[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const d = new Date(tt.tee_time);
  const toLocalInput = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  const existingMemberIds = (tt.round?.participants ?? [])
    .filter((p) => !p.is_guest && p.profile_id)
    .map((p) => p.profile_id as string);

  const [teeTime, setTeeTime] = useState(toLocalInput(d));
  const [groupNumber, setGroupNumber] = useState(tt.group_number != null ? String(tt.group_number) : "");
  const [notes, setNotes] = useState(tt.notes ?? "");
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>(existingMemberIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guestParticipants = (tt.round?.participants ?? []).filter((p) => p.is_guest);

  const totalPlayers = selectedPlayers.length + guestParticipants.length;

  // Map profileId → other tee time they're in (exclude current tee time)
  const assignedMap = new Map<string, { groupNumber: number | null }>();
  for (const other of teeTimes) {
    for (const p of other.round?.participants ?? []) {
      if (p.profile_id) assignedMap.set(p.profile_id, { groupNumber: other.group_number });
    }
  }

  const togglePlayer = (profileId: string) => {
    setSelectedPlayers((prev) => {
      if (prev.includes(profileId)) return prev.filter((id) => id !== profileId);
      if (totalPlayers >= 4) return prev;
      return [...prev, profileId];
    });
  };

  const handleSave = async () => {
    if (!teeTime) { setError("Please select a tee time"); return; }
    setSaving(true);
    setError(null);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const players = [
        ...selectedPlayers.map((pid) => ({ profile_id: pid })),
        ...guestParticipants.map((g) => ({ is_guest: true, display_name: g.display_name ?? "" })),
      ];
      const res = await fetch(`/api/majors/competitions/${competitionId}/tee-times/${tt.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          tee_time: new Date(teeTime).toISOString(),
          group_number: groupNumber ? parseInt(groupNumber, 10) : null,
          notes: notes || null,
          players,
        }),
      });
      if (!res.ok) {
        const j = await res.json();
        setError(j.error ?? "Failed to save");
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-sm mx-auto rounded-t-3xl bg-[#071f13] border-t border-emerald-900/70 px-4 pt-5 pb-[env(safe-area-inset-bottom)] space-y-4 max-h-[85dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-emerald-800/60 mx-auto mb-1" />
        <div className="text-sm font-semibold text-emerald-50">Edit Tee Time</div>

        <div className="space-y-1">
          <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Tee Time *</label>
          <input
            type="datetime-local"
            value={teeTime}
            onChange={(e) => setTeeTime(e.target.value)}
            className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2.5 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600"
          />
        </div>

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

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Players</label>
            <span className="text-[10px] text-emerald-200/50">{totalPlayers}/4</span>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {groupMembers.filter((m) => entrantProfileIds.has(m.profile_id) || selectedPlayers.includes(m.profile_id)).map((m) => {
              const selected = selectedPlayers.includes(m.profile_id);
              const disabled = !selected && totalPlayers >= 4;
              const assignment = !selected ? assignedMap.get(m.profile_id) : undefined;
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
                  {assignment && (
                    <span className="text-[9px] text-amber-400/80 bg-amber-900/30 rounded px-1.5 py-0.5 shrink-0">
                      {assignment.groupNumber != null ? `Grp ${assignment.groupNumber}` : "Assigned"}
                    </span>
                  )}
                  {selected && <span className="text-emerald-400 text-xs">✓</span>}
                </button>
              );
            })}
            {guestParticipants.map((g) => (
              <div key={g.display_name} className="flex items-center gap-3 rounded-xl border border-emerald-900/30 bg-emerald-900/10 px-3 py-2 opacity-60">
                <div className="h-6 w-6 rounded-full bg-emerald-900/60 grid place-items-center text-[9px] font-bold text-emerald-200">★</div>
                <span className="flex-1 text-sm text-emerald-100">{g.display_name} <span className="text-[10px] text-emerald-200/50">guest</span></span>
              </div>
            ))}
          </div>
        </div>

        {error && <div className="text-sm text-red-400">{error}</div>}

        <div className="flex gap-3 pb-2">
          <button type="button" onClick={onClose} className="flex-1 py-3 rounded-full border border-emerald-900/60 text-sm text-emerald-200/70">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save Changes"}
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
  onEdit,
  onViewScorecard,
  onStartRound,
  isStarting,
}: {
  tt: CompetitionTeeTime;
  isAdmin: boolean;
  onDelete: () => void;
  onEdit?: () => void;
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
          {isAdmin && onEdit && tt.round?.status !== "live" && tt.round?.status !== "finished" && (
            <button
              type="button"
              onClick={onEdit}
              className="text-[11px] text-emerald-200/40 hover:text-emerald-200 transition-colors px-1"
            >
              ✎
            </button>
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
  const [teeTimeMode, setTeeTimeMode] = useState<"admin_assigned" | "self_select">((competition as any).tee_time_mode ?? "admin_assigned");
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
          tee_time_mode: teeTimeMode,
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

          {/* Tee time mode */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Tee Time Assignment</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(["admin_assigned", "self_select"] as const).map((v) => (
                <button key={v} type="button" onClick={() => setTeeTimeMode(v)}
                  className={`rounded-xl border px-2 py-1.5 text-[10px] text-center transition-colors ${teeTimeMode === v ? "border-emerald-500 bg-emerald-900/50 text-emerald-50" : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200/60"}`}>
                  {v === "admin_assigned" ? "Admin assigned" : "Self select"}
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
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [teeTimes, setTeeTimes] = useState<CompetitionTeeTime[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEntered, setIsEntered] = useState(false);
  const [entering, setEntering] = useState(false);
  const [enterError, setEnterError] = useState<string | null>(null);
  const [showSubmitSheet, setShowSubmitSheet] = useState(false);
  const [showAddTeeTime, setShowAddTeeTime] = useState(false);
  const [editingTeeTime, setEditingTeeTime] = useState<CompetitionTeeTime | null>(null);
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
  const [competitionRounds, setCompetitionRounds] = useState<CompetitionRound[]>([]);
  const [editingRound, setEditingRound] = useState<CompetitionRound | null>(null);
  const [leaderboardFreeze, setLeaderboardFreeze] = useState<{
    freeze_state: string;
    freeze_last_holes: number | null;
    freeze_scope: string;
    freeze_top_x: number | null;
  } | null>(null);
  const [lbView, setLbView] = useState<"score" | "gross">("score");
  const [detailPlayer, setDetailPlayer] = useState<any | null>(null);
  const [playerRounds, setPlayerRounds] = useState<any[] | null>(null);
  const [playerRoundsLoading, setPlayerRoundsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const session = await getViewerSession();
        if (!session || cancelled) return;
        setMyProfileId(session.profileId);
        const headers = { Authorization: `Bearer ${session.accessToken}` };

        const [compRes, lbRes, roundsRes, teeTimesRes, participantsRes, winningsRes, compRoundsRes] = await Promise.all([
          fetch(`/api/majors/competitions/${competitionId}`, { headers }),
          fetch(`/api/majors/leaderboard?competition_id=${competitionId}`, { headers }),
          fetch(`/api/rounds?status=finished&limit=20`, { headers }),
          fetch(`/api/majors/competitions/${competitionId}/tee-times`, { headers }),
          fetch(`/api/majors/competitions/${competitionId}/participants`, { headers }),
          fetch(`/api/majors/competitions/${competitionId}/winnings`, { headers }),
          fetch(`/api/majors/competitions/${competitionId}/rounds`, { headers }),
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
          if (j.freeze) setLeaderboardFreeze(j.freeze);
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

        if (compRoundsRes.ok) {
          const j = await compRoundsRes.json();
          setCompetitionRounds(j.rounds ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [competitionId]);

  // Realtime: recompute leaderboard whenever competition_leaderboard_entries changes
  useEffect(() => {
    const channel = supabase
      .channel(`competition-lb:${competitionId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "competition_leaderboard_entries",
          filter: `competition_id=eq.${competitionId}`,
        },
        () => {
          getViewerSession().then((session) => {
            if (!session) return;
            fetch(`/api/majors/leaderboard?competition_id=${competitionId}`, {
              headers: { Authorization: `Bearer ${session.accessToken}` },
            })
              .then((r) => (r.ok ? r.json() : null))
              .then((j) => {
                if (j) {
                  setLeaderboard(j.rows ?? []);
                  if (j.freeze) setLeaderboardFreeze(j.freeze);
                }
              });
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [competitionId]);

  const refreshTeeTimes = async () => {
    const session = await getViewerSession();
    if (!session) return;
    const headers = { Authorization: `Bearer ${session.accessToken}` };
    const [ttRes, crRes] = await Promise.all([
      fetch(`/api/majors/competitions/${competitionId}/tee-times`, { headers }),
      fetch(`/api/majors/competitions/${competitionId}/rounds`, { headers }),
    ]);
    if (ttRes.ok) {
      const j = await ttRes.json();
      setTeeTimes(j.tee_times ?? []);
    }
    if (crRes.ok) {
      const j = await crRes.json();
      setCompetitionRounds(j.rounds ?? []);
    }
  };

  const handleEnter = async () => {
    setEntering(true);
    setEnterError(null);
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
      } else {
        const j = await res.json().catch(() => ({}));
        setEnterError(j.error ?? "Entry failed. Please try again.");
      }
    } finally {
      setEntering(false);
    }
  };

  const handleSubmitDone = async () => {
    const session = await getViewerSession();
    if (!session) return;
    const res = await fetch(`/api/majors/leaderboard?competition_id=${competitionId}`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (res.ok) {
      const j = await res.json();
      setLeaderboard(j.rows ?? []);
      if (j.freeze) setLeaderboardFreeze(j.freeze);
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

  const scoringModel = competition?.scoring_model ?? "net";
  const displayScore = (row: any) =>
    scoringModel === "gross" ? row.gross_score : (row.net_score ?? row.gross_score);
  const scoreLabel = scoringModel === "gross" ? "Gross" : "Net";

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
          <>
            <button
              type="button"
              onClick={handleEnter}
              disabled={entering}
              className="w-full py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {entering ? "Entering…" : "Enter Competition"}
            </button>
            {enterError && (
              <div className="text-sm text-red-400 text-center">{enterError}</div>
            )}
          </>
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
              {competition.majors_status !== "completed" && competition.majors_status !== "cancelled"
                && !competitionOwnsRound && isAdminOrOwner && (
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
      const isFrozen = leaderboardFreeze?.freeze_state === "frozen";
      function getThruLabel(row: any): string {
        const holesPerRound = 18;
        const holesShown = row.holes_completed ?? row.holes_shown ?? 0;
        if (holesShown === 0) return "";
        const completedRounds = Math.floor(holesShown / holesPerRound);
        const holesInRound = holesShown % holesPerRound;

        const isFrozenRow = isFrozen && (
          leaderboardFreeze?.freeze_scope !== "top_x" ||
          (row.position ?? 999) <= (leaderboardFreeze?.freeze_top_x ?? Infinity)
        );
        const actualHoles: number | undefined = row.actual_holes_completed;

        if (isFrozenRow && actualHoles != null && actualHoles > holesShown) {
          if (holesInRound === 0) {
            return `R${Math.min(completedRounds, competition?.num_rounds ?? 1)} thru ${holesPerRound} (${actualHoles})`;
          }
          return `R${completedRounds + 1} thru ${holesInRound} (${actualHoles})`;
        }
        if (isFrozenRow && !row.is_live) {
          if (holesInRound === 0) {
            return `R${Math.min(completedRounds, competition?.num_rounds ?? 1)} [F] (F)`;
          }
          return `R${completedRounds + 1} thru ${holesInRound} (F)`;
        }

        if (row.is_live) {
          return `R${completedRounds + 1} thru ${holesInRound || holesPerRound}`;
        }
        if (holesInRound === 0) {
          return `R${Math.min(completedRounds, competition?.num_rounds ?? 1)} [F]`;
        }
        return `R${completedRounds + 1} thru ${holesInRound}`;
      }
      const rankedIds = new Set(leaderboard.map((r) => r.profile_id));
      const unranked = participants.filter((p) => !rankedIds.has(p.profile_id));
      const showPts = competition?.points_model && competition.points_model !== "none";
      const displayRows = lbView === "gross"
        ? [...leaderboard].sort((a, b) => {
            if (a.gross_score == null && b.gross_score == null) return 0;
            if (a.gross_score == null) return 1;
            if (b.gross_score == null) return -1;
            return a.gross_score - b.gross_score;
          })
        : leaderboard;
      return (
        <>
          {leaderboardFreeze?.freeze_state === "frozen" && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-700/50 bg-amber-900/20 px-3 py-2 mb-2">
              <span className="text-amber-400 text-sm">🔒</span>
              <div>
                <p className="text-xs font-semibold text-amber-300">Leaderboard frozen</p>
                {leaderboardFreeze.freeze_last_holes != null && (
                  <p className="text-[10px] text-amber-300/70">
                    Last {leaderboardFreeze.freeze_last_holes} hole{leaderboardFreeze.freeze_last_holes !== 1 ? "s" : ""} hidden
                    {leaderboardFreeze.freeze_scope === "top_x" && leaderboardFreeze.freeze_top_x != null
                      ? ` (top ${leaderboardFreeze.freeze_top_x} positions only)` : ""}
                  </p>
                )}
              </div>
            </div>
          )}
        <div className="space-y-2">
          {leaderboard.length > 0 && (
            <div className="flex gap-1 mb-2">
              {(["score", "gross"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setLbView(v)}
                  className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
                    lbView === v
                      ? "bg-emerald-700 text-white"
                      : "border border-emerald-900/60 text-emerald-200/70 hover:text-emerald-50"
                  }`}
                >
                  {v === "score" ? "By Score" : "By Gross"}
                </button>
              ))}
            </div>
          )}
          {leaderboard.length === 0 && unranked.length === 0 && (
            <div className="text-sm text-emerald-100/60 text-center py-8">
              No participants yet. Enter to appear here.
            </div>
          )}
          {displayRows.map((row) => {
            const pts = showPts
              ? (row.points_earned ?? getPointsForPosition(row.position ?? null, competition.points_model, competition.points_table as Record<string, unknown>))
              : null;
            const thru = getThruLabel(row);
            const isFrozenRow = isFrozen && (
              leaderboardFreeze?.freeze_scope !== "top_x" ||
              (row.position ?? 999) <= (leaderboardFreeze?.freeze_top_x ?? Infinity)
            );
            // Compute to-par for net and gross views
            const netToPar: number | null = row.to_par ?? null;
            const grossToPar: number | null =
              row.gross_score != null && row.course_par != null
                ? row.gross_score - row.course_par
                : null;
            const mainToPar = lbView === "gross" ? grossToPar : netToPar;
            const mainTotal = lbView === "gross" ? row.gross_score : displayScore(row);
            const mainScoreText = mainToPar != null
              ? formatToPar(mainToPar)
              : mainTotal != null ? String(mainTotal) : "—";
            const bracketText = mainToPar != null && mainTotal != null ? `(${mainTotal})` : null;
            const subLabel = (() => {
              const label = lbView === "gross" ? "Gross" : scoreLabel;
              return thru ? `${thru} · ${label}` : label;
            })();
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
                <div className="flex items-center gap-1 flex-1 min-w-0">
                  <span className="text-sm font-semibold text-emerald-50 truncate">{row.profile?.name ?? "Unknown"}</span>
                  {isFrozenRow && <span className="text-[11px] leading-none shrink-0">❄️</span>}
                </div>
                {showPts && (
                  <div className="text-right shrink-0 mr-1">
                    <div className="text-[10px] text-emerald-200/50 uppercase tracking-wider leading-none">Pts</div>
                    <div className="text-xs font-bold text-emerald-300">{pts ?? "—"}</div>
                  </div>
                )}
                <div className="text-right shrink-0">
                  <div className="text-xs font-extrabold text-[#f5e6b0]">{mainScoreText}</div>
                  {bracketText ? (
                    <div className="text-[10px] text-emerald-100/50">{bracketText} · {subLabel}</div>
                  ) : (
                    <div className="text-[10px] text-emerald-100/50">{subLabel}</div>
                  )}
                </div>
                <span className="text-[10px] text-emerald-400/70 shrink-0">→</span>
              </>
            );
            const rowClass = `flex items-center gap-3 rounded-xl border px-3 py-2.5 w-full text-left hover:brightness-110 active:scale-[0.99] transition-all ${
              isFrozenRow
                ? "border-cyan-700/40 bg-cyan-900/30"
                : row.position === 1
                ? "border-[#f5e6b0]/25 bg-[#f5e6b0]/5"
                : row.position === 2
                ? "border-[#c0c0c0]/20 bg-[#c0c0c0]/5"
                : row.position === 3
                ? "border-[#cd7f32]/20 bg-[#cd7f32]/5"
                : "border-emerald-900/50 bg-[#0b3b21]/60"
            }`;
            const handleRowClick = async () => {
              setDetailPlayer(row);
              setPlayerRounds(null);
              setPlayerRoundsLoading(true);
              try {
                const session = await getViewerSession();
                const res = await fetch(
                  `/api/majors/competitions/${competitionId}/leaderboard/${row.profile_id}`,
                  { headers: { Authorization: `Bearer ${session?.accessToken}` } }
                );
                const j = await res.json();
                setPlayerRounds(j.rounds ?? []);
              } finally {
                setPlayerRoundsLoading(false);
              }
            };
            return (
              <button
                key={row.profile_id ?? row.id}
                type="button"
                className={rowClass}
                onClick={handleRowClick}
              >
                {inner}
              </button>
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
        {/* Player round breakdown sheet */}
        {detailPlayer && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setDetailPlayer(null)}>
            <div
              className="bg-[#0a2e1a] border-t border-emerald-900/60 rounded-t-2xl px-4 pb-8 pt-4 max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center gap-3 mb-4">
                {detailPlayer.profile?.avatar_url ? (
                  <img src={detailPlayer.profile.avatar_url} alt="" className="h-10 w-10 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="h-10 w-10 rounded-full bg-emerald-900/60 grid place-items-center text-sm font-bold text-emerald-200 shrink-0">
                    {detailPlayer.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-emerald-50 truncate">{detailPlayer.profile?.name ?? "Unknown"}</div>
                  <div className="text-[10px] text-emerald-200/50">
                    {detailPlayer.position != null ? `#${detailPlayer.position}` : ""}
                    {detailPlayer.to_par != null ? ` · ${formatToPar(detailPlayer.to_par)}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailPlayer(null)}
                  className="text-emerald-200/60 text-sm px-3 py-1 rounded-lg border border-emerald-900/50"
                >
                  Close
                </button>
              </div>
              {/* Round rows */}
              {playerRoundsLoading ? (
                <div className="text-center py-6 text-emerald-200/50 text-sm">Loading…</div>
              ) : playerRounds && playerRounds.length > 0 ? (
                <div className="space-y-1">
                  {/* Column headers */}
                  <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-2 pb-1">
                    <div className="text-[10px] text-emerald-200/40 uppercase tracking-wider">Round</div>
                    <div className="text-[10px] text-emerald-200/40 uppercase tracking-wider text-right w-12">Gross</div>
                    <div className="text-[10px] text-emerald-200/40 uppercase tracking-wider text-right w-12">Net</div>
                  </div>
                  {playerRounds.map((r: any, i: number) => {
                    const label = r.competition_round?.name ?? `R${r.competition_round?.round_number ?? i + 1}`;
                    return (
                      <div key={r.competition_round_id ?? i} className="grid grid-cols-[1fr_auto_auto] gap-2 items-center rounded-xl border border-emerald-900/40 bg-[#0b3b21]/60 px-3 py-2">
                        <div className="text-sm font-semibold text-emerald-100 truncate">{label}</div>
                        <div className="text-sm font-bold tabular-nums text-[#f5e6b0] text-right w-12">
                          {r.gross_score != null ? r.gross_score : "—"}
                        </div>
                        <div className="text-sm font-bold tabular-nums text-emerald-300 text-right w-12">
                          {r.net_score_snapshot != null ? r.net_score_snapshot : "—"}
                        </div>
                      </div>
                    );
                  })}
                  {/* Totals */}
                  {playerRounds.length > 1 && (() => {
                    const totalGross = playerRounds.every((r: any) => r.gross_score != null)
                      ? playerRounds.reduce((s: number, r: any) => s + r.gross_score, 0) : null;
                    const totalNet = playerRounds.every((r: any) => r.net_score_snapshot != null)
                      ? playerRounds.reduce((s: number, r: any) => s + r.net_score_snapshot, 0) : null;
                    return (
                      <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center rounded-xl border border-emerald-700/40 bg-emerald-900/20 px-3 py-2 mt-1">
                        <div className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider">Total</div>
                        <div className="text-sm font-bold tabular-nums text-[#f5e6b0] text-right w-12">
                          {totalGross != null ? totalGross : "—"}
                        </div>
                        <div className="text-sm font-bold tabular-nums text-emerald-300 text-right w-12">
                          {totalNet != null ? totalNet : "—"}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : playerRounds != null ? (
                <div className="text-center py-6 text-emerald-200/40 text-sm">No accepted rounds yet.</div>
              ) : null}
            </div>
          </div>
        )}
        </>
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

      // Group tee times by competition_round_id for structured display
      const teeTimesByRound = new Map<string | null, CompetitionTeeTime[]>();
      for (const tt of teeTimes) {
        const key = tt.competition_round_id ?? null;
        if (!teeTimesByRound.has(key)) teeTimesByRound.set(key, []);
        teeTimesByRound.get(key)!.push(tt);
      }

      const renderTeeTimeCard = (tt: CompetitionTeeTime) => {
        const participantCount = tt.round?.participants?.length ?? 0;
        const hasSlot = tt.round?.participants?.some((p) => p.profile_id === myProfileId) ?? false;
        const canJoin = isSelfSelect && isEntered && myProfileId && !myTeeTimeId && participantCount < 4;
        return (
          <div key={tt.id} className="space-y-2">
            {hasSlot && tt.competition_round && (
              <div className="text-[10px] text-emerald-400/80 font-semibold uppercase tracking-wider px-0.5">
                {tt.competition_round.name} · Your tee time
              </div>
            )}
            <TeeTimeCard
              tt={tt}
              isAdmin={isAdminOrOwner}
              onDelete={() => handleDeleteTeeTime(tt.id)}
              onEdit={isAdminOrOwner ? () => setEditingTeeTime(tt) : undefined}
              onViewScorecard={tt.round?.id ? () => router.push(`/round/${tt.round!.id}?from=competition&competitionId=${competitionId}`) : undefined}
              onStartRound={hasSlot && tt.round?.status === "scheduled" && tt.round?.id ? () => handleStartRound(tt.round!.id) : undefined}
              isStarting={startingRoundId === tt.round?.id}
            />
            {isSelfSelect && (
              hasSlot ? (
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
      };

      const numRounds = (competition as any)?.num_rounds ?? 1;
      const hasMultipleRounds = numRounds > 1;

      return (
        <div className="space-y-3">
          {isSelfSelect && (
            <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2 text-[11px] text-emerald-200/60">
              Players can choose their own tee time slot.
            </div>
          )}
          {/* Admin: init rounds banner for competitions missing competition_round rows */}
          {isAdminOrOwner && hasMultipleRounds && competitionRounds.length === 0 && (
            <div className="rounded-xl border border-amber-800/50 bg-amber-900/20 px-3 py-2.5 flex items-center justify-between gap-2">
              <span className="text-[11px] text-amber-200/80">Rounds not yet initialised.</span>
              <button
                type="button"
                className="text-[11px] font-semibold text-amber-300 hover:text-amber-100 shrink-0"
                onClick={async () => {
                  const session = await getViewerSession();
                  if (!session) return;
                  for (let i = 1; i <= numRounds; i++) {
                    await fetch(`/api/majors/competitions/${competitionId}/rounds`, {
                      method: "POST",
                      headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
                      body: JSON.stringify({ round_number: i, name: `Round ${i}` }),
                    });
                  }
                  await refreshTeeTimes();
                }}
              >
                Initialise rounds
              </button>
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
          {teeTimes.length === 0 && competitionRounds.length === 0 ? (
            <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 p-5 text-center space-y-1">
              <div className="text-sm text-emerald-100/60">
                {isAdminOrOwner
                  ? "No tee times set up yet."
                  : isEntered
                  ? isSelfSelect ? "No slots available yet. Check back soon." : "Your tee time hasn't been set yet."
                  : "No tee times have been scheduled yet."}
              </div>
            </div>
          ) : competitionRounds.length > 0 ? (
            // Grouped view: one section per competition round
            <div className="space-y-5">
              {competitionRounds.map((cr) => {
                const roundTeeTimes = teeTimesByRound.get(cr.id) ?? [];
                const dateLabel = cr.scheduled_date
                  ? new Date(cr.scheduled_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                  : null;
                const statusColour =
                  cr.status === "live" ? "text-emerald-400" :
                  cr.status === "completed" ? "text-emerald-200/40" :
                  cr.status === "cancelled" ? "text-red-400/60" :
                  "text-emerald-200/50";
                return (
                  <div key={cr.id} className="space-y-2">
                    {/* Round header */}
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                            {cr.name}
                          </span>
                          {dateLabel && (
                            <span className="text-[10px] text-emerald-200/50">{dateLabel}</span>
                          )}
                          <span className={`text-[10px] capitalize ${statusColour}`}>{cr.status}</span>
                        </div>
                        {(cr.course?.name || cr.tee_male?.name || cr.tee_female?.name) && (
                          <div className="text-[10px] text-emerald-200/50 mt-0.5 flex items-center gap-1.5">
                            {cr.course?.name && <span>{cr.course.name}</span>}
                            {cr.tee_male?.name && (
                              <span className="text-emerald-200/40">· ♂ {cr.tee_male.name}</span>
                            )}
                            {cr.tee_female?.name && (
                              <span className="text-emerald-200/40">· ♀ {cr.tee_female.name}</span>
                            )}
                          </div>
                        )}
                      </div>
                      {isAdminOrOwner && (
                        <button
                          type="button"
                          onClick={() => setEditingRound(cr)}
                          className="text-[10px] text-emerald-400/60 hover:text-emerald-300 px-1 shrink-0"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                    {roundTeeTimes.length === 0 ? (
                      <div className="text-[11px] text-emerald-200/40 pl-0.5">No tee times for this round yet.</div>
                    ) : (
                      <div className="space-y-3">{roundTeeTimes.map(renderTeeTimeCard)}</div>
                    )}
                  </div>
                );
              })}
              {/* Unlinked tee times (legacy) */}
              {(teeTimesByRound.get(null)?.length ?? 0) > 0 && (
                <div className="space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-200/40">Unassigned</div>
                  <div className="space-y-3">{(teeTimesByRound.get(null) ?? []).map(renderTeeTimeCard)}</div>
                </div>
              )}
            </div>
          ) : (
            // No competition_rounds yet (single-round or legacy) — flat list
            <div className="space-y-3">{teeTimes.map(renderTeeTimeCard)}</div>
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
                <div className="text-xs font-extrabold text-[#f5e6b0]">{displayScore(row) ?? "—"}</div>
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
          entrantProfileIds={new Set(participants.map((p) => p.profile_id))}
          entryFeeAmount={(competition as any).entry_fee_amount ?? null}
          entryFeeCurrency={(competition as any).entry_fee_currency ?? "GBP"}
          teeTimes={teeTimes}
          competitionRounds={competitionRounds}
          onClose={() => setShowAddTeeTime(false)}
          onCreated={refreshTeeTimes}
        />
      )}

      {editingTeeTime && (
        <EditTeeTimeSheet
          competitionId={competitionId}
          tt={editingTeeTime}
          groupMembers={groupMembers}
          entrantProfileIds={new Set(participants.map((p) => p.profile_id))}
          teeTimes={teeTimes.filter((t) => t.id !== editingTeeTime.id)}
          onClose={() => setEditingTeeTime(null)}
          onSaved={refreshTeeTimes}
        />
      )}

      {editingRound && (
        <EditRoundSheet
          competitionId={competitionId}
          round={editingRound}
          onClose={() => setEditingRound(null)}
          onSaved={refreshTeeTimes}
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
