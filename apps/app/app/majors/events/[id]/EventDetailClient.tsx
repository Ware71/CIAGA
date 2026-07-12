"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { NumberField } from "@/components/ui/NumberField";
import { InvitePlayerSheet } from "@/app/majors/groups/InvitePlayerSheet";
import type {
  EventWithGroup,
  EventTypeV2,
  EventRound,
  LeaderboardEntryWithProfile,
  EventTeeTime,
  TeeTimeParticipant,
  MatchplayStage,
  MatchplayFixture,
  MatchplayLeagueTableEntryWithProfile,
  EventWinningWithProfile,
  ProposedWinning,
  EventWaitlistEntry,
  LeaderboardRevealStyle,
  EventCharge,
  EventPlayerChargeWithProfile,
  PrizePotWithDetails,
  PrizePotDistributionType,
  PrizeTableEntry,
  EventPlayoff,
} from "@/lib/majors/types";
import { EVENT_TYPES, SCORING_MODELS, POINTS_MODELS, FEDEX_POINTS, computeFormulaPoints } from "@/lib/events/constants";
import type { PointsConfig } from "@/lib/majors/types";
import { HandicapRulesEditor } from "@/components/competitions/HandicapRulesEditor";
import { CoursePickerModal } from "@/components/rounds/CoursePickerModal";
import { supabase } from "@/lib/supabaseClient";
import { LeaderboardReveal } from "@/components/majors/LeaderboardReveal";
import { TieManagementDrawer } from "../../leaderboard/TieManagementDrawer";
import { PlayoffStatusBanner } from "../../leaderboard/TieBanner";
import { PlayoffScorecardClient } from "./PlayoffScorecardClient";

const FEDEX_POINTS_SCALE = FEDEX_POINTS;

function fmtPts(n: number | null | undefined): string {
  if (n == null) return "—";
  return String(Math.round(n));
}

function formatToPar(n: number): string {
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : `${n}`;
}

function getPointsForPosition(
  position: number | null,
  pointsModel: string,
  pointsTable: Record<string, unknown>,
  pointsConfig?: PointsConfig | null,
  numRounds?: number,
): number | null {
  if (!position || pointsModel === "none") return null;
  if (pointsModel === "fedex_style") {
    return FEDEX_POINTS_SCALE[position - 1] ?? 0;
  }
  if (pointsModel === "position_based" || pointsModel === "custom_table") {
    const val = pointsTable[String(position)];
    return typeof val === "number" ? val : null;
  }
  if (pointsModel === "ciaga_formula" || pointsModel === "custom_formula") {
    if (!pointsConfig) return null;
    const F = pointsConfig.num_participants ?? 12;
    return computeFormulaPoints(position, F, numRounds ?? 1, pointsConfig);
  }
  return null;
}

type Tab = "overview" | "leaderboard" | "tee-times" | "rules" | "fixtures" | "bracket" | "league-table" | "winnings" | "finances";

const STROKE_TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "leaderboard", label: "Leaderboard" },
  { id: "tee-times", label: "Tee Times" },
  { id: "rules", label: "Rules" },
  { id: "winnings", label: "Winnings" },
];

const MATCHPLAY_LEAGUE_TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "fixtures", label: "Fixtures" },
  { id: "league-table", label: "Table" },
  { id: "rules", label: "Rules" },
];

const MATCHPLAY_KNOCKOUT_TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "fixtures", label: "Fixtures" },
  { id: "bracket", label: "Bracket" },
  { id: "rules", label: "Rules" },
];

function isMatchplayLeague(type: EventTypeV2 | undefined | null) {
  return type === "matchplay" || type === "matchplay_fixture";
}

function isMatchplayKnockout(type: EventTypeV2 | undefined | null) {
  return type === "matchplay_knockout_match";
}

function getTabsForEvent(comp: EventWithGroup | null) {
  if (!comp) return STROKE_TABS;
  if (isMatchplayKnockout(comp.event_type)) return MATCHPLAY_KNOCKOUT_TABS;
  if (isMatchplayLeague(comp.event_type)) return MATCHPLAY_LEAGUE_TABS;
  return STROKE_TABS;
}

type LeaderboardRowWithRoundId = LeaderboardEntryWithProfile & { round_id: string | null };
type Participant = { profile_id: string; profile: { id: string; name: string | null; avatar_url: string | null } | null };

// ─── Add Tee Time sheet ───────────────────────────────────────────────────────

type GroupMember = {
  profile_id: string;
  profile: { name: string | null; avatar_url: string | null; gender: string | null } | null;
  preferred_tee_name: string | null;
};

type TeeBoxOption = { id: string; name: string; gender: string | null; yards: number | null; rating: number | null; slope: number | null };

function EditRoundSheet({
  eventId,
  round,
  onClose,
  onSaved,
}: {
  eventId: string;
  round: EventRound;
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
      const res = await fetch(`/api/majors/events/${eventId}/rounds/${round.id}`, {
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
          <select value={status} onChange={(e) => setStatus(e.target.value as EventRound["status"])} className={inputCls}>
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
  eventId,
  courseId,
  groupMembers,
  entrantProfileIds,
  entryFeeAmount,
  entryFeeCurrency,
  teeTimes,
  eventRounds,
  onClose,
  onCreated,
}: {
  eventId: string;
  courseId: string | null;
  groupMembers: GroupMember[];
  entrantProfileIds: Set<string>;
  entryFeeAmount: number | null;
  entryFeeCurrency: string;
  teeTimes: EventTeeTime[];
  eventRounds: EventRound[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [teeTime, setTeeTime] = useState("");
  const [groupNumber, setGroupNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(
    () => eventRounds.length === 1 ? eventRounds[0].id : null
  );
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [playerTees, setPlayerTees] = useState<Record<string, string>>({}); // profile_id → tee_box_id
  const [teeBoxes, setTeeBoxes] = useState<TeeBoxOption[]>([]);
  const [guestName, setGuestName] = useState("");
  const [guests, setGuests] = useState<string[]>([]);
  const [guestChargeTo, setGuestChargeTo] = useState<Record<string, string>>({}); // guestName → profile_id of host to charge
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch tee boxes for the event's course
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

  // Resolve the gender-appropriate default tee from the selected event round.
  // Takes priority over the player's stored preferred tee.
  const resolveRoundDefaultTee = (profileId: string): string | undefined => {
    if (!selectedRoundId) return undefined;
    const cr = eventRounds.find((r) => r.id === selectedRoundId);
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
      // Pre-fill tee: event round default takes priority over player's stored preference
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
      const res = await fetch(`/api/majors/events/${eventId}/tee-times`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          tee_time: new Date(teeTime).toISOString(),
          group_number: groupNumber ? parseInt(groupNumber, 10) : undefined,
          notes: notes || undefined,
          players,
          event_round_id: selectedRoundId ?? undefined,
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
        {eventRounds.length > 1 && (
          <div className="space-y-1">
            <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Round *</label>
            <div className="flex flex-wrap gap-2">
              {eventRounds.map((r) => (
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
  eventId,
  tt,
  groupMembers,
  entrantProfileIds,
  teeTimes,
  onClose,
  onSaved,
}: {
  eventId: string;
  tt: EventTeeTime;
  groupMembers: GroupMember[];
  entrantProfileIds: Set<string>;
  teeTimes: EventTeeTime[];
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
      const res = await fetch(`/api/majors/events/${eventId}/tee-times/${tt.id}`, {
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
  tt: EventTeeTime;
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

// ─── Mini Scorecard (player detail drawer) ──────────────────────────────

function MiniScorecard({
  snap,
  loading,
  profileId,
}: {
  snap: any;
  loading: boolean;
  profileId: string | null;
}) {
  if (loading) {
    return <div className="text-center py-3 text-emerald-200/50 text-xs">Loading scorecard…</div>;
  }
  if (!snap) return null;

  const participant = (snap.participants ?? []).find((p: any) => p.profile_id === profileId);
  if (!participant) {
    return <div className="text-center py-3 text-emerald-200/40 text-xs">No score data</div>;
  }

  const pid: string = participant.id;
  const holes: Array<{ hole_number: number; par: number | null }> = (snap.holes ?? [])
    .slice()
    .sort((a: any, b: any) => a.hole_number - b.hole_number);

  const scoreMap: Record<number, number | null> = {};
  for (const s of snap.scores ?? []) {
    if (s.participant_id === pid) scoreMap[s.hole_number] = s.strokes;
  }

  function badgeType(strokes: number | null, par: number | null) {
    if (strokes == null || par == null) return null;
    const d = strokes - par;
    if (d <= -2) return "eagle";
    if (d === -1) return "birdie";
    if (d === 1) return "bogey";
    if (d >= 2) return "double";
    return null;
  }

  function ScoreCell({ hole }: { hole: { hole_number: number; par: number | null } }) {
    const s = scoreMap[hole.hole_number];
    const b = badgeType(s, hole.par);
    const base = "flex items-center justify-center w-7 h-6 text-xs tabular-nums font-semibold";
    const cls =
      b === "eagle"
        ? `${base} rounded-full bg-[#f5e6b0] text-[#042713]`
        : b === "birdie"
        ? `${base} rounded-full ring-1 ring-[#f5e6b0] text-emerald-50`
        : b === "bogey"
        ? `${base} ring-1 ring-white/50 text-emerald-50`
        : b === "double"
        ? `${base} bg-white/20 text-emerald-50`
        : `${base} text-emerald-100/80`;
    return <div className={cls}>{s ?? "—"}</div>;
  }

  const front = holes.filter((h) => h.hole_number <= 9);
  const back = holes.filter((h) => h.hole_number >= 10);

  function nineTotal(group: typeof front) {
    const par = group.reduce((t, h) => t + (h.par ?? 0), 0);
    const score = group.reduce((t, h) => t + (scoreMap[h.hole_number] ?? 0), 0);
    return { par, score };
  }

  const frontTotals = nineTotal(front);
  const backTotals = nineTotal(back);

  function NineRow({
    group,
    label,
    totals,
  }: {
    group: typeof front;
    label: string;
    totals: { par: number; score: number };
  }) {
    return (
      <div className="flex gap-0.5 items-end">
        {group.map((h) => (
          <div key={h.hole_number} className="flex flex-col items-center gap-0.5 w-7">
            <div className="text-[9px] text-emerald-200/30 leading-none">{h.hole_number}</div>
            <div className="text-[9px] text-emerald-200/40 leading-none">{h.par ?? "—"}</div>
            <ScoreCell hole={h} />
          </div>
        ))}
        <div className="flex flex-col items-center gap-0.5 w-9 border-l border-emerald-900/40 ml-0.5 pl-1">
          <div className="text-[9px] text-emerald-200/30 leading-none">{label}</div>
          <div className="text-[9px] text-emerald-200/40 leading-none">{totals.par}</div>
          <div className="text-xs font-bold text-[#f5e6b0] tabular-nums">{totals.score || "—"}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto px-2 py-2 space-y-2 border-t border-emerald-900/30 mt-0.5">
      {front.length > 0 && <NineRow group={front} label="OUT" totals={frontTotals} />}
      {back.length > 0 && <NineRow group={back} label="IN" totals={backTotals} />}
    </div>
  );
}

// ─── Event Setup Sheet ──────────────────────────────────────────────────

type RoundEditState = {
  id: string | null;
  round_number: number;
  name: string;
  course_id: string;
  course_name: string;
  tee_male_id: string;
  tee_female_id: string;
  tee_boxes: TeeBoxOption[];
  status: EventRound["status"];
};

function EventSetupSheet({
  event,
  eventRounds,
  teeTimes,
  hasEntries,
  onClose,
  onSaved,
}: {
  event: EventWithGroup;
  eventRounds: EventRound[];
  teeTimes: EventTeeTime[];
  hasEntries: boolean;
  onClose: () => void;
  onSaved: (updated: EventWithGroup) => void;
}) {
  const isAggregate = event.event_category === "aggregate";
  const handicap = (event.handicap_rules ?? {}) as Record<string, unknown>;
  const isScoringLocked = ["completed", "official"].includes(event.majors_status ?? "");

  // Event-level fields
  const [name, setName] = useState(event.name ?? "");
  const [description, setDescription] = useState(event.description ?? "");
  const [eventDate, setCompetitionDate] = useState(event.event_date ? event.event_date.slice(0, 10) : "");
  const [entryStart, setEntryStart] = useState(event.entry_window_start ? event.entry_window_start.slice(0, 16) : "");
  const [entryEnd, setEntryEnd] = useState(event.entry_window_end ? event.entry_window_end.slice(0, 16) : "");
  const [selectedCompType, setSelectedCompType] = useState<string>(event.event_type ?? "stroke");
  const [scoringModel, setScoringModel] = useState<string>(event.scoring_model ?? "net");
  const [pointsModel, setPointsModel] = useState<string>(event.points_model ?? "none");
  const [standingsContrib, setStandingsContrib] = useState(event.standings_contribution ?? "event_only");
  const [teeTimeMode, setTeeTimeMode] = useState<"admin_assigned" | "self_select">((event as any).tee_time_mode ?? "admin_assigned");
  const [rulesText, setRulesText] = useState(event.rules_text ?? "");
  const [handicapMode, setHandicapMode] = useState<string>((handicap.mode as string) ?? "allowance_pct");
  const [handicapPct, setHandicapPct] = useState(handicap.allowance_pct != null ? String(handicap.allowance_pct) : "100");
  const [handicapMax, setHandicapMax] = useState(handicap.max_handicap != null ? String(handicap.max_handicap) : "");
  const [majorsStatus, setMajorsStatus] = useState<string>(event.majors_status ?? "upcoming");

  // Per-round state
  const [rounds, setRounds] = useState<RoundEditState[]>(() =>
    eventRounds.map((r) => ({
      id: r.id,
      round_number: r.round_number,
      name: r.name,
      course_id: r.course_id ?? "",
      course_name: r.course?.name ?? "",
      tee_male_id: r.default_tee_box_id_male ?? "",
      tee_female_id: r.default_tee_box_id_female ?? "",
      tee_boxes: [],
      status: r.status,
    }))
  );
  const [pendingDeletes, setPendingDeletes] = useState<string[]>([]);
  const [showCoursePickerIdx, setShowCoursePickerIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch tee boxes for rounds that already have a course on mount
  useEffect(() => {
    eventRounds.forEach((r, idx) => {
      if (!r.course_id) return;
      fetch(`/api/courses/tee-boxes?course_id=${r.course_id}`)
        .then((res) => res.json())
        .then((j) => {
          setRounds((prev) => {
            const next = [...prev];
            if (next[idx]) next[idx] = { ...next[idx], tee_boxes: j.tee_boxes ?? [] };
            return next;
          });
        });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasTeeTimesByRound = useMemo(
    () => new Set(teeTimes.map((tt) => tt.event_round_id).filter(Boolean) as string[]),
    [teeTimes]
  );

  const deleteHint = (r: RoundEditState): string | null => {
    if (!r.id) return null;
    if (hasTeeTimesByRound.has(r.id)) return "Remove tee times first";
    if (r.status !== "scheduled") return `Round is ${r.status}`;
    return null;
  };

  const handleRoundCourseSelect = async (idx: number, courseId: string, courseName: string) => {
    setRounds((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], course_id: courseId, course_name: courseName, tee_male_id: "", tee_female_id: "", tee_boxes: [] };
      return next;
    });
    setShowCoursePickerIdx(null);
    if (!courseId) return;
    const res = await fetch(`/api/courses/tee-boxes?course_id=${courseId}`);
    const j = await res.json();
    setRounds((prev) => {
      const next = [...prev];
      if (next[idx]?.course_id === courseId) next[idx] = { ...next[idx], tee_boxes: j.tee_boxes ?? [] };
      return next;
    });
  };

  const updateRound = (idx: number, fields: Partial<RoundEditState>) =>
    setRounds((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...fields };
      return next;
    });

  const addRound = () => {
    const nextNum = Math.max(0, ...rounds.map((r) => r.round_number)) + 1;
    setRounds((prev) => [
      ...prev,
      { id: null, round_number: nextNum, name: `Round ${nextNum}`, course_id: "", course_name: "", tee_male_id: "", tee_female_id: "", tee_boxes: [], status: "scheduled" },
    ]);
  };

  const removeRound = (idx: number) => {
    const r = rounds[idx];
    const hint = deleteHint(r);
    if (hint) { setError(hint); return; }
    if (r.id) setPendingDeletes((prev) => [...prev, r.id!]);
    setRounds((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const session = await getViewerSession();
      if (!session) { setError("Not signed in"); return; }
      const headers = { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" };

      // 1. Delete removed rounds (sequential so a guard error stops early)
      for (const rid of pendingDeletes) {
        const delRes = await fetch(`/api/majors/events/${event.id}/rounds/${rid}`, { method: "DELETE", headers });
        if (!delRes.ok) {
          const j = await delRes.json();
          setError(j.error ?? "Failed to delete round");
          return;
        }
      }

      // 2. Derive event-level course from first round that has one
      const firstCourse = rounds.find((r) => r.course_id);
      const newCourseId = firstCourse?.course_id ?? null;
      const newCourseName = firstCourse?.course_name ?? null;

      const handicap_rules = scoringModel !== "gross"
        ? { mode: handicapMode, allowance_pct: handicapMode === "allowance_pct" ? (parseInt(handicapPct, 10) || 100) : null, max_handicap: handicapMax ? parseInt(handicapMax, 10) : null }
        : {};

      // 3. PATCH event
      const res = await fetch(`/api/majors/events/${event.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          event_date: eventDate || null,
          entry_window_start: entryStart || null,
          entry_window_end: entryEnd || null,
          course_id: newCourseId,
          event_type: isAggregate ? event.event_type : selectedCompType,
          scoring_model: scoringModel,
          handicap_rules,
          points_model: pointsModel,
          num_rounds: rounds.length,
          rules_text: rulesText.trim() || null,
          standings_contribution: standingsContrib,
          tee_time_mode: teeTimeMode,
          majors_status: majorsStatus,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Save failed"); return; }

      // 4. PATCH existing rounds / POST new rounds
      await Promise.all(
        rounds.map((r) =>
          r.id
            ? fetch(`/api/majors/events/${event.id}/rounds/${r.id}`, {
                method: "PATCH", headers,
                body: JSON.stringify({ course_id: r.course_id || null, default_tee_box_id_male: r.tee_male_id || null, default_tee_box_id_female: r.tee_female_id || null }),
              })
            : fetch(`/api/majors/events/${event.id}/rounds`, {
                method: "POST", headers,
                body: JSON.stringify({ round_number: r.round_number, name: r.name, course_id: r.course_id || null, default_tee_box_id_male: r.tee_male_id || null, default_tee_box_id_female: r.tee_female_id || null }),
              })
        )
      );

      onSaved({ ...event, ...json.event, group: event.group, course: newCourseId ? { id: newCourseId, name: newCourseName ?? "" } : event.course });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end bg-black/60 pb-[env(safe-area-inset-bottom)]" onClick={onClose}>
        <div
          className="w-full max-w-sm mx-auto rounded-t-3xl bg-[#071f13] border-t border-emerald-900/70 px-4 pt-5 space-y-4 max-h-[90dvh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="w-10 h-1 rounded-full bg-emerald-800/60 mx-auto mb-1" />
          <div className="text-sm font-semibold text-emerald-50">Edit Event Setup</div>

          <div className="space-y-4 pb-6">
            {/* Status */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Status</label>
              <div className="grid grid-cols-4 gap-1">
                {(["upcoming", "live", "completed", "cancelled"] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setMajorsStatus(s)}
                    className={`rounded-xl border px-2 py-1.5 text-[10px] text-center capitalize transition-colors ${
                      majorsStatus === s
                        ? s === "live" ? "border-amber-600 bg-amber-900/40 text-amber-200"
                          : s === "completed" ? "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                          : s === "cancelled" ? "border-red-700 bg-red-900/30 text-red-300"
                          : "border-emerald-500 bg-emerald-900/50 text-emerald-50"
                        : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200/60"
                    }`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

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
              <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Event Date</label>
              <input type="date" className="w-full rounded-xl bg-emerald-900/30 border border-emerald-800/40 px-3 py-2 text-sm text-emerald-50 focus:outline-none"
                value={eventDate} onChange={(e) => setCompetitionDate(e.target.value)} />
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

            {/* Per-round course + tees */}
            {!isAggregate && (
              <div className="space-y-2">
                <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Rounds</label>
                {rounds.map((r, idx) => {
                  const tees = r.tee_boxes;
                  const hint = deleteHint(r);
                  return (
                    <div key={r.id ?? `new-${idx}`} className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/30 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-[10px] uppercase tracking-wider text-emerald-200/55 font-semibold">
                          {rounds.length > 1 ? r.name : "Course (optional)"}
                        </div>
                        {rounds.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeRound(idx)}
                            title={hint ?? "Remove round"}
                            className={`text-[10px] px-1.5 py-0.5 rounded-lg transition-colors ${hint ? "text-emerald-200/25 cursor-not-allowed" : "text-red-400/60 hover:text-red-300 hover:bg-red-900/20"}`}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      {r.course_id ? (
                        <div className="flex items-center justify-between rounded-xl border border-emerald-600/60 bg-emerald-900/30 px-3 py-2">
                          <span className="text-sm text-emerald-50 truncate">{r.course_name}</span>
                          <button type="button"
                            onClick={() => { updateRound(idx, { course_id: "", course_name: "", tee_male_id: "", tee_female_id: "", tee_boxes: [] }); setShowCoursePickerIdx(idx); }}
                            className="ml-3 text-[11px] text-emerald-300/60 hover:text-emerald-200 shrink-0">✕</button>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setShowCoursePickerIdx(idx)}
                          className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2 text-sm text-emerald-100/40 hover:border-emerald-700/60 text-left">
                          Search for a course…
                        </button>
                      )}
                      {r.course_id && tees.length > 0 && (
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          {[
                            { label: "Men's tee", field: "tee_male_id" as const, options: tees.filter((t) => !t.gender || t.gender === "male" || t.gender === "unisex") },
                            { label: "Women's tee", field: "tee_female_id" as const, options: tees.filter((t) => !t.gender || t.gender === "female" || t.gender === "unisex") },
                          ].map(({ label, field, options }) => (
                            <div key={field} className="space-y-1">
                              <label className="text-[10px] uppercase tracking-wider text-emerald-200/65">{label}</label>
                              <select value={r[field]} onChange={(e) => updateRound(idx, { [field]: e.target.value })}
                                className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-2 py-1.5 text-[11px] text-emerald-50 focus:outline-none [color-scheme:dark]">
                                <option value="">— optional —</option>
                                {options.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                              </select>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                <button type="button" onClick={addRound}
                  className="w-full py-2 rounded-xl border border-dashed border-emerald-800/50 text-[11px] text-emerald-400/60 hover:text-emerald-300 hover:border-emerald-700/60 transition-colors">
                  + Add Round
                </button>
              </div>
            )}

            {/* Format */}
            {!isAggregate && (
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Format</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {EVENT_TYPES.map((t) => (
                    <button key={t.value} type="button" onClick={() => setSelectedCompType(t.value)}
                      className={`rounded-xl border px-2 py-1.5 text-[11px] transition-colors ${selectedCompType === t.value ? "border-emerald-500 bg-emerald-900/50 text-emerald-50" : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200/60"}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Entry guard */}
            {hasEntries && (
              <div className="rounded-xl border border-amber-800/40 bg-amber-900/15 px-3 py-2 text-[10px] text-amber-300/80 leading-relaxed">
                Players are entered — scoring and format changes will affect their results.
              </div>
            )}

            {/* Scoring model */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Scoring</label>
              {isScoringLocked && (
                <p className="text-[10px] text-amber-400/70">Locked — event is {event.majors_status}. Revert to live to change scoring config.</p>
              )}
              <div className="grid grid-cols-2 gap-1.5">
                {SCORING_MODELS.map((s) => (
                  <button key={s.value} type="button" onClick={() => !isScoringLocked && setScoringModel(s.value)}
                    disabled={isScoringLocked}
                    className={`rounded-xl border px-2 py-1.5 text-[11px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${scoringModel === s.value ? "border-emerald-500 bg-emerald-900/50 text-emerald-50" : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200/60"}`}>
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
                  disabled={isScoringLocked}
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
                  <button key={p.value} type="button" onClick={() => !isScoringLocked && setPointsModel(p.value)}
                    disabled={isScoringLocked}
                    className={`rounded-xl border px-2 py-1.5 text-[11px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${pointsModel === p.value ? "border-emerald-500 bg-emerald-900/50 text-emerald-50" : "border-emerald-800/40 bg-emerald-900/20 text-emerald-200/60"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

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
              <p className="text-[10px] text-emerald-200/45 leading-relaxed mt-1">
                {standingsContrib === "event_only" && "Result stays on this event's leaderboard only — won't affect season standings."}
                {standingsContrib === "season" && "Feeds into the group's cumulative season standings — no event leaderboard points."}
                {standingsContrib === "both" && "Counted in both this event's result and the group's season standings."}
              </p>
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
      {showCoursePickerIdx !== null && (
        <CoursePickerModal
          open={true}
          onClose={() => setShowCoursePickerIdx(null)}
          onSelect={(id, cname) => handleRoundCourseSelect(showCoursePickerIdx, id, cname ?? "")}
        />
      )}
    </>
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

export default function EventDetailClient({ eventId }: { eventId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromHome = searchParams.get("from") === "home";
  const VALID_TABS: readonly Tab[] = ["overview", "leaderboard", "tee-times", "rules", "fixtures", "bracket", "league-table", "winnings", "finances"];
  const tabParam = searchParams.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(tabParam && VALID_TABS.includes(tabParam) ? tabParam : "overview");
  const [event, setCompetition] = useState<EventWithGroup | null>(null);
  const [leaderboard, setLeaderboard] = useState<any[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [teeTimes, setTeeTimes] = useState<EventTeeTime[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEntered, setIsEntered] = useState(false);
  const [entering, setEntering] = useState(false);
  const [enterError, setEnterError] = useState<string | null>(null);
  const [showInvitePlayers, setShowInvitePlayers] = useState(false);
  // Join drawer
  const [showJoinDrawer, setShowJoinDrawer] = useState(false);
  const [joinPreview, setJoinPreview] = useState<any | null>(null);
  const [joinPreviewLoading, setJoinPreviewLoading] = useState(false);
  const [selectedOptionalChargeIds, setSelectedOptionalChargeIds] = useState<string[]>([]);
  const [selectedOptionalPotIds, setSelectedOptionalPotIds] = useState<string[]>([]);
  const [selectedOptionalGroupChargeIds, setSelectedOptionalGroupChargeIds] = useState<string[]>([]);
  const [showAddTeeTime, setShowAddTeeTime] = useState(false);
  const [editingTeeTime, setEditingTeeTime] = useState<EventTeeTime | null>(null);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [fantasyNarrative, setFantasyNarrative] = useState<string | null>(null);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);
  const [matchplayStages, setMatchplayStages] = useState<MatchplayStage[]>([]);
  const [matchplayFixtures, setMatchplayFixtures] = useState<MatchplayFixture[]>([]);
  const [leagueTable, setLeagueTable] = useState<MatchplayLeagueTableEntryWithProfile[]>([]);
  const [winnings, setWinnings] = useState<EventWinningWithProfile[]>([]);
  const [waitlistEntry, setWaitlistEntry] = useState<EventWaitlistEntry | null>(null);
  const [joiningWaitlist, setJoiningWaitlist] = useState(false);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [proposedWinnings, setProposedWinnings] = useState<ProposedWinning[] | null>(null);
  const [proposingWinnings, setProposingWinnings] = useState(false);
  const [showSetupSheet, setShowSetupSheet] = useState(false);
  const [startingRoundId, setStartingRoundId] = useState<string | null>(null);
  const [eventRounds, setCompetitionRounds] = useState<EventRound[]>([]);
  const [editingRound, setEditingRound] = useState<EventRound | null>(null);
  const [leaderboardFreeze, setLeaderboardFreeze] = useState<{
    freeze_state: string;
    freeze_last_holes: number | null;
    freeze_scope: string;
    freeze_top_x: number | null;
    reveal_style: string;
    reveal_top_x: number | null;
  } | null>(null);
  const [showReveal, setShowReveal] = useState(false);
  const [revealLoading, setRevealLoading] = useState(false);
  const [hasFirstPlaceTie, setHasFirstPlaceTie] = useState(false);
  const [allEntrantsComplete, setAllEntrantsComplete] = useState(false);
  const [activePlayoff, setActivePlayoff] = useState<EventPlayoff | null>(null);
  const [showTieDrawer, setShowTieDrawer] = useState(false);
  const [tieDrawerScreen, setTieDrawerScreen] = useState<"choice" | "playoff_setup">("choice");
  const [showPlayoffCard, setShowPlayoffCard] = useState(false);
  const [revealWarning, setRevealWarning] = useState<{
    incomplete_rounds: Array<{
      round_name: string;
      tee_time: string;
      players: Array<{ name: string; holes_completed: number; rounds_submitted: number }>;
    }>;
  } | null>(null);
  const [lbView, setLbView] = useState<"score" | "gross">("score");
  const [detailPlayer, setDetailPlayer] = useState<any | null>(null);
  const [playerRounds, setPlayerRounds] = useState<any[] | null>(null);
  const [playerRoundsLoading, setPlayerRoundsLoading] = useState(false);
  const [playerEntry, setPlayerEntry] = useState<any | null>(null);
  const [scorecardRoundId, setScorecardRoundId] = useState<string | null>(null);
  const [scorecardSnap, setScorecardSnap] = useState<any | null>(null);
  const [scorecardLoading, setScorecardLoading] = useState(false);

  // Finances tab state
  const [eventCharges, setEventCharges] = useState<EventCharge[]>([]);
  const [playerCharges, setPlayerCharges] = useState<EventPlayerChargeWithProfile[]>([]);
  const [prizePots, setPrizePots] = useState<PrizePotWithDetails[]>([]);
  const [financesLoaded, setFinancesLoaded] = useState(false);
  const [addingCharge, setAddingCharge] = useState(false);
  const [addChargeForm, setAddChargeForm] = useState<{ name: string; amount: string; category: string; description: string; round_id: string; is_mandatory: boolean } | null>(null);
  const [chargeError, setChargeError] = useState<string | null>(null);
  const [chargesViewMode, setChargesViewMode] = useState<"list" | "matrix">("list");
  // Prize pot state
  const [potError, setPotError] = useState<string | null>(null);
  const [addPotForm, setAddPotForm] = useState<{
    name: string;
    description: string;
    distribution_type: PrizePotDistributionType | "winner_takes_all";
    entry_fee_amount: string;
    entry_fee_notes: string;
    prize_table: PrizeTableEntry[];
    metric_type: string;
    metric_description: string;
    is_monetary: boolean;
    prize_description: string;
    is_mandatory: boolean;
  } | null>(null);
  const [addingPot, setAddingPot] = useState(false);
  const [expandedPotId, setExpandedPotId] = useState<string | null>(null);
  const [potActionLoading, setPotActionLoading] = useState<string | null>(null);
  const [proposedDistribution, setProposedDistribution] = useState<{ potId: string; total_pot: number; proposed: Array<{ profile_id: string; profile: { name: string | null } | null; position: number | null; amount: number | null; note: string }> } | null>(null);
  const [editPotId, setEditPotId] = useState<string | null>(null);
  const [editPotForm, setEditPotForm] = useState<{
    name: string;
    description: string;
    distribution_type: PrizePotDistributionType | "winner_takes_all";
    entry_fee_amount: string;
    entry_fee_notes: string;
    prize_table: PrizeTableEntry[];
    metric_type: string;
    metric_description: string;
    is_monetary: boolean;
    prize_description: string;
    is_mandatory: boolean;
  } | null>(null);
  const [savingPot, setSavingPot] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const session = await getViewerSession();
        if (!session || cancelled) return;
        setMyProfileId(session.profileId);
        const headers = { Authorization: `Bearer ${session.accessToken}` };

        const [compRes, lbRes, teeTimesRes, participantsRes, winningsRes, compRoundsRes] = await Promise.all([
          fetch(`/api/majors/events/${eventId}`, { headers }),
          fetch(`/api/majors/leaderboard?event_id=${eventId}`, { headers }),
          fetch(`/api/majors/events/${eventId}/tee-times`, { headers }),
          fetch(`/api/majors/events/${eventId}/participants`, { headers }),
          fetch(`/api/majors/events/${eventId}/winnings`, { headers }),
          fetch(`/api/majors/events/${eventId}/rounds`, { headers }),
        ]);

        if (cancelled) return;

        if (compRes.ok) {
          const j = await compRes.json();
          const comp = j.event;
          setCompetition(comp);

          // Load matchplay fixtures if applicable
          if (isMatchplayLeague(comp?.event_type) || isMatchplayKnockout(comp?.event_type)) {
            const fixRes = await fetch(`/api/majors/events/${eventId}/fixtures`, { headers });
            if (!cancelled && fixRes.ok) {
              const fj = await fixRes.json();
              setMatchplayStages(fj.stages ?? []);
              setMatchplayFixtures(fj.fixtures ?? []);
            }
            const ltRes = await fetch(`/api/majors/events/${eventId}/league-table`, { headers }).catch(() => null);
            if (!cancelled && ltRes?.ok) {
              const lj = await ltRes.json();
              setLeagueTable(lj.entries ?? []);
            }
          }

          // Load group members and my role if event has a group
          if (j.event?.group_id) {
            const membersRes = await fetch(`/api/majors/groups/${j.event.group_id}/members`, { headers });
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
          setHasFirstPlaceTie(j.has_first_place_tie ?? false);
          setAllEntrantsComplete(j.all_entrants_complete ?? false);
          setActivePlayoff(j.active_playoff ?? null);
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
            const wlRes = await fetch(`/api/majors/events/${eventId}/waitlist`, { headers });
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
  }, [eventId]);

  // Realtime: recompute leaderboard whenever event_leaderboard_entries changes
  // or the event freeze state transitions.
  useEffect(() => {
    function fetchLeaderboard(): Promise<void> {
      return getViewerSession().then((session) => {
        if (!session) return;
        return fetch(`/api/majors/leaderboard?event_id=${eventId}`, {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            if (j) {
              setLeaderboard(j.rows ?? []);
              if (j.freeze) setLeaderboardFreeze(j.freeze);
              setHasFirstPlaceTie(j.has_first_place_tie ?? false);
              setAllEntrantsComplete(j.all_entrants_complete ?? false);
              setActivePlayoff(j.active_playoff ?? null);
            }
          });
      });
    }

    const channel = supabase
      .channel(`event-lb:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "event_leaderboard_entries",
          filter: `event_id=eq.${eventId}`,
        },
        fetchLeaderboard
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "events",
          filter: `id=eq.${eventId}`,
        },
        (payload) => {
          const freezeState = (payload.new as any)?.leaderboard_freeze_state;
          if (freezeState === "frozen") {
            fetchLeaderboard();
          }
          if (freezeState === "revealed") {
            fetchLeaderboard().then(() => setShowReveal(true));
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [eventId]);

  // Lazy-load finances when tab first opens
  useEffect(() => {
    if (tab !== "finances" || financesLoaded) return;
    refreshFinances();
  }, [tab, financesLoaded]);

  async function handleReveal(force = false) {
    setRevealLoading(true);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/events/${eventId}/freeze-control`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({ action: "reveal", force }),
      });
      const json = await res.json();
      if (res.ok && json.warning) {
        setRevealWarning({ incomplete_rounds: json.incomplete_rounds });
        return;
      }
      if (res.ok) {
        setRevealWarning(null);
        setLeaderboardFreeze((prev) => prev ? { ...prev, freeze_state: "revealed" } : prev);
        // Fetch full scores before starting the reveal animation
        const lbRes = await fetch(`/api/majors/leaderboard?event_id=${eventId}`, {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (lbRes.ok) {
          const j = await lbRes.json();
          setLeaderboard(j.rows ?? []);
          if (j.freeze) setLeaderboardFreeze(j.freeze);
          setHasFirstPlaceTie(j.has_first_place_tie ?? false);
          setAllEntrantsComplete(j.all_entrants_complete ?? false);
          setActivePlayoff(j.active_playoff ?? null);
        }
        setShowReveal(true);
      }
    } finally {
      setRevealLoading(false);
    }
  }

  const refreshLeaderboard = async () => {
    const session = await getViewerSession();
    if (!session) return;
    const res = await fetch(`/api/majors/leaderboard?event_id=${eventId}`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!res.ok) return;
    const j = await res.json();
    setLeaderboard(j.rows ?? []);
    if (j.freeze) setLeaderboardFreeze(j.freeze);
    setHasFirstPlaceTie(j.has_first_place_tie ?? false);
    setAllEntrantsComplete(j.all_entrants_complete ?? false);
    setActivePlayoff(j.active_playoff ?? null);
  };

  const refreshTeeTimes = async () => {
    const session = await getViewerSession();
    if (!session) return;
    const headers = { Authorization: `Bearer ${session.accessToken}` };
    const [ttRes, crRes] = await Promise.all([
      fetch(`/api/majors/events/${eventId}/tee-times`, { headers }),
      fetch(`/api/majors/events/${eventId}/rounds`, { headers }),
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

  const refreshFinances = async () => {
    const session = await getViewerSession();
    if (!session) return;
    const headers = { Authorization: `Bearer ${session.accessToken}` };
    const [cRes, pcRes, ppRes] = await Promise.all([
      fetch(`/api/majors/events/${eventId}/charges`, { headers }),
      fetch(`/api/majors/events/${eventId}/player-charges`, { headers }),
      fetch(`/api/majors/events/${eventId}/prize-pots`, { headers }),
    ]);
    if (cRes.ok) { const j = await cRes.json(); setEventCharges(j.charges ?? []); }
    if (pcRes.ok) { const j = await pcRes.json(); setPlayerCharges(j.player_charges ?? []); }
    if (ppRes.ok) { const j = await ppRes.json(); setPrizePots(j.pots ?? []); }
    setFinancesLoaded(true);
  };

  const openJoinDrawer = async () => {
    setJoinPreviewLoading(true);
    setShowJoinDrawer(true);
    setSelectedOptionalChargeIds([]);
    setSelectedOptionalPotIds([]);
    setSelectedOptionalGroupChargeIds([]);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/events/${eventId}/join-preview`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (res.ok) {
        const j = await res.json();
        setJoinPreview(j);
        // Pre-select all optional pots by default
        setSelectedOptionalPotIds((j.optional_prize_pots ?? []).map((p: any) => p.id));
        setSelectedOptionalPotIds((prev) => [
          ...prev,
          ...(j.season_optional_pots ?? []).map((p: any) => p.id),
        ]);
      }
    } finally {
      setJoinPreviewLoading(false);
    }
  };

  const handleEnter = async () => {
    setEntering(true);
    setEnterError(null);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/events/${eventId}/enter`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          optional_charge_ids: selectedOptionalChargeIds,
          optional_pot_ids: selectedOptionalPotIds,
          optional_group_charge_ids: selectedOptionalGroupChargeIds,
        }),
      });
      if (res.ok) {
        setIsEntered(true);
        setShowJoinDrawer(false);
        // Refresh participants so the leaderboard shows the new entrant
        const pRes = await fetch(`/api/majors/events/${eventId}/participants`, {
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

  const handleWithdraw = async () => {
    setWithdrawing(true);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/events/${eventId}/withdraw`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (res.ok) {
        setIsEntered(false);
        setShowWithdrawConfirm(false);
        // Re-fetch participants and tee times
        const [pRes, ttRes, wlRes] = await Promise.all([
          fetch(`/api/majors/events/${eventId}/participants`, { headers: { Authorization: `Bearer ${session.accessToken}` } }),
          fetch(`/api/majors/events/${eventId}/tee-times`, { headers: { Authorization: `Bearer ${session.accessToken}` } }),
          fetch(`/api/majors/events/${eventId}/waitlist`, { headers: { Authorization: `Bearer ${session.accessToken}` } }),
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
      const res = await fetch(`/api/majors/events/${eventId}/waitlist`, {
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
      await fetch(`/api/majors/events/${eventId}/waitlist`, {
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
      const res = await fetch(`/api/majors/events/${eventId}/winnings/propose`, {
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
      await fetch(`/api/majors/events/${eventId}/winnings`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id: pw.profile_id, amount: pw.amount, position: pw.position }),
      });
    }
    setProposedWinnings(null);
    const wRes = await fetch(`/api/majors/events/${eventId}/winnings`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (wRes.ok) { const j = await wRes.json(); setWinnings(j.winnings ?? []); }
  };

  const handleJoinTeeTimeSlot = async (teeTimeId: string) => {
    const session = await getViewerSession();
    if (!session) return;
    await fetch(`/api/majors/events/${eventId}/tee-times/${teeTimeId}/join`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    refreshTeeTimes();
  };

  const handleLeaveTeeTimeSlot = async (teeTimeId: string) => {
    const session = await getViewerSession();
    if (!session) return;
    await fetch(`/api/majors/events/${eventId}/tee-times/${teeTimeId}/leave`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    refreshTeeTimes();
  };

  const handleDeleteTeeTime = async (teeTimeId: string) => {
    const session = await getViewerSession();
    if (!session) return;
    const res = await fetch(`/api/majors/events/${eventId}/tee-times/${teeTimeId}`, {
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
        router.push(`/round/${roundId}?from=event&eventId=${eventId}`);
      }
    } finally {
      setStartingRoundId(null);
    }
  };

  const now = new Date();
  const entryOpen = event
    ? (!event.entry_window_start || new Date(event.entry_window_start) <= now) &&
      (!event.entry_window_end || new Date(event.entry_window_end) >= now) &&
      event.majors_status !== "completed" &&
      event.majors_status !== "cancelled"
    : false;

  const isAdminOrOwner =
    myRole === "owner" ||
    myRole === "admin" ||
    (!event?.group_id && event?.created_by_profile_id === myProfileId);

  // Accepting an event invite from Home navigates here with ?autoEnter=1 — open
  // the entry drawer once the data has loaded and entry is open.
  const autoEnter = searchParams.get("autoEnter") === "1";
  const [autoEnterHandled, setAutoEnterHandled] = useState(false);
  useEffect(() => {
    if (autoEnter && !autoEnterHandled && entryOpen && !isEntered) {
      setAutoEnterHandled(true);
      void openJoinDrawer();
    }
  }, [autoEnter, autoEnterHandled, entryOpen, isEntered]);

  // Lazy-load the event's auto-written fantasy "Event preview" for the Overview
  // tab. Read-only: the card shows only once the event's fantasy odds have been
  // generated (same condition as the fantasy market board itself).
  useEffect(() => {
    if (tab !== "overview") return;
    let cancelled = false;
    (async () => {
      const session = await getViewerSession();
      if (!session || cancelled) return;
      const res = await fetch(`/api/fantasy/events/${eventId}/narrative`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (!cancelled && res.ok) {
        const j = await res.json();
        setFantasyNarrative((j?.narrative as string | null) ?? null);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, eventId]);

  const scoringModel = event?.scoring_model ?? "net";
  const displayScore = (row: any) =>
    scoringModel === "gross"
      ? row.gross_score
      : scoringModel === "stableford_points"
      ? (row.format_points ?? null)
      : (row.net_score ?? row.gross_score);
  const scoreLabel =
    scoringModel === "gross" ? "Gross" : scoringModel === "stableford_points" ? "Stableford Pts" : "Net";

  const visibleTabs = (() => {
    const BASE = getTabsForEvent(event);
    let tabs = [...BASE];
    if (event?.majors_status === "cancelled") tabs = tabs.filter((t) => t.id !== "tee-times");
    if (isAdminOrOwner && event?.group_id) tabs.push({ id: "finances" as Tab, label: "Finances" });
    return tabs;
  })();

  // Entry window countdown
  const entryWindowDaysLeft = event?.entry_window_end
    ? Math.ceil((new Date(event.entry_window_end).getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  const statusColour =
    event?.majors_status === "live"
      ? "bg-amber-900/50 text-amber-300 border-amber-800/50"
      : event?.majors_status === "completed"
      ? "bg-emerald-900/60 text-emerald-300 border-emerald-800/50"
      : event?.majors_status === "cancelled"
      ? "bg-red-900/40 text-red-400 border-red-800/40"
      : "bg-emerald-900/40 text-emerald-200/80 border-emerald-900/60";

  const tabContent: Record<Tab, React.ReactNode> = {
    overview: event ? (
      <div className="space-y-4">
        {event.description && (
          <p className="text-[13px] text-emerald-100/75 leading-relaxed">{event.description}</p>
        )}

        {/* Fantasy "Event preview" — auto-written narrative */}
        {fantasyNarrative && (
          <button
            type="button"
            onClick={() => router.push(`/majors/fantasy/events/${eventId}`)}
            className="w-full text-left rounded-2xl border border-emerald-900/60 bg-gradient-to-br from-[#0b3b21]/90 to-[#07301a]/90 px-4 py-3 hover:from-[#0b3b21] hover:to-[#07301a] transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <div className="text-[9px] uppercase tracking-[0.2em] text-[#f5e6b0]/60">Event preview</div>
              <span className="text-[10px] text-emerald-400/80">Picks →</span>
            </div>
            <p className="text-[12px] leading-relaxed text-emerald-100/85">{fantasyNarrative}</p>
          </button>
        )}

        {/* Info grid */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Format", value: event.format ?? event.event_type },
            { label: "Scoring", value: event.scoring_model },
            { label: "Rounds", value: String(event.num_rounds) },
            { label: "Points", value: event.points_model === "none" ? "None" : event.points_model },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5">
              <div className="text-[10px] text-emerald-200/50 uppercase tracking-wider mb-0.5">{item.label}</div>
              <div className="text-sm font-semibold text-emerald-50 capitalize">{item.value ?? "—"}</div>
            </div>
          ))}
        </div>

        {/* Date / course */}
        {(event.event_date || event.course || eventRounds.length > 0) && (
          <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5 space-y-1">
            {event.event_date && (
              <div className="flex items-center gap-2 text-[12px] text-emerald-100/70">
                <span className="text-emerald-200/40">📅</span>
                {new Date(event.event_date).toLocaleDateString([], { weekday: "short", year: "numeric", month: "long", day: "numeric" })}
              </div>
            )}
            {eventRounds.length > 0 ? (
              <div className="space-y-0.5">
                {eventRounds.map((r) => (
                  <div key={r.id} className="flex items-start gap-2 text-[12px] text-emerald-100/70">
                    <span className="text-emerald-200/40 shrink-0">⛳</span>
                    <div className="min-w-0">
                      <div>
                        <span className="text-emerald-200/50 text-[11px] mr-1">{r.name}:</span>
                        <span>{r.course?.name ?? "TBC"}</span>
                      </div>
                      {(r.tee_male?.name || r.tee_female?.name) && (
                        <div className="text-emerald-200/40 text-[11px] ml-3 space-y-0.5">
                          {r.tee_male?.name && (
                            <div><span className="text-emerald-200/30">Men's tee: </span>{r.tee_male.name}</div>
                          )}
                          {r.tee_female?.name && (
                            <div><span className="text-emerald-200/30">Women's tee: </span>{r.tee_female.name}</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : event.course ? (
              <div className="flex items-center gap-2 text-[12px] text-emerald-100/70">
                <span className="text-emerald-200/40">⛳</span>
                {event.course.name}
              </div>
            ) : null}
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
        {event.entry_window_end && entryWindowDaysLeft != null && entryWindowDaysLeft <= 0 && (
          <div className="rounded-xl border border-red-900/40 bg-red-900/20 px-3 py-2">
            <span className="text-[11px] text-red-400">Entry window closed</span>
          </div>
        )}

        {/* Entry fee */}
        {(event as any).entry_fee_amount > 0 && (
          <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5 flex items-center justify-between">
            <span className="text-[12px] text-emerald-200/60">Entry Fee</span>
            <span className="text-sm font-bold text-[#f5e6b0]">
              {((event as any).entry_fee_currency ?? "GBP") === "GBP" ? "£" : ""}
              {((event as any).entry_fee_amount as number).toFixed(2)}
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

        {/* Admin: invite players to the event */}
        {isAdminOrOwner && entryOpen && (
          <button
            type="button"
            onClick={() => setShowInvitePlayers(true)}
            className="w-full py-2 rounded-full border border-emerald-800/60 text-[11px] font-semibold text-emerald-300/70 hover:text-emerald-200 hover:border-emerald-700/60 transition-colors"
          >
            Invite Players
          </button>
        )}

        {showInvitePlayers && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
            onClick={() => setShowInvitePlayers(false)}
          >
            <div
              className="w-full max-w-sm rounded-t-2xl bg-[#0b3b21] border border-emerald-800/60 px-4 py-5 max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <InvitePlayerSheet
                title="Invite Players"
                groupId={event?.group_id ?? undefined}
                excludedProfileIds={new Set(participants.map((p) => p.profile_id))}
                onInvite={async (pid) => {
                  const session = await getViewerSession();
                  if (!session) return;
                  await fetch(`/api/majors/events/${eventId}/invitations`, {
                    method: "POST",
                    headers: {
                      Authorization: `Bearer ${session.accessToken}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ profile_id: pid }),
                  });
                }}
                onInvited={() => {}}
                onClose={() => setShowInvitePlayers(false)}
              />
            </div>
          </div>
        )}

        {/* Entry / Submit CTAs */}
        {!isEntered && entryOpen && (
          <>
            <button
              type="button"
              onClick={openJoinDrawer}
              disabled={entering}
              className="w-full py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              Enter Event
            </button>
            {enterError && (
              <div className="text-sm text-red-400 text-center">{enterError}</div>
            )}

            {/* Join Drawer */}
            {showJoinDrawer && (
              <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70" onClick={() => setShowJoinDrawer(false)}>
                <div
                  className="w-full max-w-sm rounded-t-2xl bg-[#071f12] border border-emerald-800/60 flex flex-col max-h-[90vh]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* Header */}
                  <div className="px-4 py-4 border-b border-emerald-900/40 flex items-center justify-between shrink-0">
                    <div className="text-sm font-semibold text-emerald-100">Join {event?.name}</div>
                    <button type="button" onClick={() => setShowJoinDrawer(false)} className="text-emerald-200/40 text-xl leading-none">✕</button>
                  </div>

                  {/* Scrollable content */}
                  <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
                    {joinPreviewLoading ? (
                      <div className="text-sm text-emerald-200/50 text-center py-6">Loading…</div>
                    ) : joinPreview ? (
                      <>
                        {/* Entry fee */}
                        {joinPreview.entry_fee_amount > 0 && (
                          <div>
                            <div className="text-[10px] uppercase text-emerald-200/40 mb-1">Entry Fee</div>
                            <div className="flex justify-between text-sm text-emerald-100 py-1">
                              <span>Event Entry Fee</span>
                              <span className="font-semibold">£{joinPreview.entry_fee_amount?.toFixed(2)}</span>
                            </div>
                          </div>
                        )}

                        {/* Mandatory section */}
                        {(joinPreview.mandatory_charges?.length > 0 || joinPreview.mandatory_prize_pots?.length > 0 || joinPreview.season_mandatory_pots?.length > 0 || joinPreview.group_mandatory_charges?.length > 0) && (
                          <div>
                            <div className="text-[10px] uppercase text-emerald-200/40 mb-1">Mandatory</div>
                            <div className="rounded-xl border border-red-900/30 bg-red-950/10 px-3 py-2 space-y-2">
                              {joinPreview.group_mandatory_charges?.map((c: any) => (
                                <div key={c.id} className="flex justify-between items-start text-sm">
                                  <div>
                                    <div className="text-emerald-100">{c.name}</div>
                                    {c.description && <div className="text-[10px] text-emerald-200/40">{c.description}</div>}
                                    <div className="text-[10px] text-red-400/60">Group charge</div>
                                  </div>
                                  <span className="font-semibold text-emerald-100">£{c.amount?.toFixed(2)}</span>
                                </div>
                              ))}
                              {joinPreview.mandatory_charges?.map((c: any) => (
                                <div key={c.id} className="flex justify-between items-start text-sm">
                                  <div>
                                    <div className="text-emerald-100">{c.name}</div>
                                    {c.description && <div className="text-[10px] text-emerald-200/40">{c.description}</div>}
                                  </div>
                                  <span className="font-semibold text-emerald-100">£{c.amount?.toFixed(2)}</span>
                                </div>
                              ))}
                              {[...joinPreview.mandatory_prize_pots ?? [], ...joinPreview.season_mandatory_pots ?? []].map((p: any) => (
                                <div key={p.id} className="flex justify-between items-start text-sm">
                                  <div>
                                    <div className="text-emerald-100">{p.name}</div>
                                    <div className="text-[10px] text-emerald-200/40">
                                      {p.distribution_type === "position_based" ? "Position-based prize pot" :
                                       p.distribution_type === "metric_weighted" ? "Proportionally split by metric" :
                                       p.distribution_type === "metric_equal" ? "Equal split on metric" :
                                       p.distribution_type === "equal_split" ? "Equal split" :
                                       p.distribution_type === "non_monetary" ? "Non-monetary prize" : "Entry only"}
                                      {p.group_season_id || p.competition_season_id ? " · Season Pot" : ""}
                                    </div>
                                  </div>
                                  <span className="font-semibold text-emerald-100">
                                    {p.entry_fee_amount > 0 ? `£${p.entry_fee_amount.toFixed(2)}` : "Free"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Optional prize pots */}
                        {((joinPreview.optional_prize_pots?.length ?? 0) + (joinPreview.season_optional_pots?.length ?? 0)) > 0 && (
                          <div>
                            <div className="text-[10px] uppercase text-emerald-200/40 mb-1">Optional Prize Pots</div>
                            <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 px-3 py-2 space-y-3">
                              {[...joinPreview.optional_prize_pots ?? [], ...joinPreview.season_optional_pots ?? []].map((p: any) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => setSelectedOptionalPotIds((prev) =>
                                    prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id]
                                  )}
                                  className="w-full flex justify-between items-start text-sm text-left"
                                >
                                  <div className="flex items-start gap-2">
                                    <div className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center text-xs ${selectedOptionalPotIds.includes(p.id) ? "bg-emerald-600 border-emerald-600" : "border-emerald-700/50"}`}>
                                      {selectedOptionalPotIds.includes(p.id) && "✓"}
                                    </div>
                                    <div>
                                      <div className="text-emerald-100">{p.name}</div>
                                      <div className="text-[10px] text-emerald-200/40">
                                        {p.distribution_type === "metric_weighted" ? "Proportionally split" :
                                         p.distribution_type === "metric_equal" ? "Equal split on metric" :
                                         p.distribution_type === "equal_split" ? "Equal split" :
                                         p.distribution_type === "position_based" ? "Position-based" : ""}
                                        {p.metric_type === "twos" ? " · Two's Club" :
                                         p.metric_type === "nearest_pin" ? " · Nearest Pin" :
                                         p.metric_type === "longest_drive" ? " · Longest Drive" : ""}
                                        {(p.group_season_id || p.competition_season_id) ? " · Season Pot" : ""}
                                      </div>
                                    </div>
                                  </div>
                                  <span className="font-semibold text-emerald-100 shrink-0">
                                    {p.entry_fee_amount > 0 ? `£${p.entry_fee_amount.toFixed(2)}` : "Free"}
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Optional charges */}
                        {((joinPreview.optional_charges?.length ?? 0) + (joinPreview.group_optional_charges?.length ?? 0)) > 0 && (
                          <div>
                            <div className="text-[10px] uppercase text-emerald-200/40 mb-1">Optional Extras</div>
                            <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 px-3 py-2 space-y-3">
                              {[...joinPreview.group_optional_charges ?? [], ...joinPreview.optional_charges ?? []].map((c: any) => (
                                <button
                                  key={c.id}
                                  type="button"
                                  onClick={() => setSelectedOptionalChargeIds((prev) =>
                                    prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                                  )}
                                  className="w-full flex justify-between items-center text-sm text-left"
                                >
                                  <div className="flex items-center gap-2">
                                    <div className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center text-xs ${selectedOptionalChargeIds.includes(c.id) ? "bg-emerald-600 border-emerald-600" : "border-emerald-700/50"}`}>
                                      {selectedOptionalChargeIds.includes(c.id) && "✓"}
                                    </div>
                                    <span className="text-emerald-100">{c.name}</span>
                                  </div>
                                  <span className="font-semibold text-emerald-100">£{c.amount?.toFixed(2)}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* No charges at all */}
                        {!joinPreview.entry_fee_amount &&
                          !joinPreview.mandatory_charges?.length &&
                          !joinPreview.optional_charges?.length &&
                          !joinPreview.mandatory_prize_pots?.length &&
                          !joinPreview.optional_prize_pots?.length &&
                          !joinPreview.season_mandatory_pots?.length &&
                          !joinPreview.season_optional_pots?.length &&
                          !joinPreview.group_mandatory_charges?.length &&
                          !joinPreview.group_optional_charges?.length && (
                          <div className="text-sm text-emerald-200/50 text-center py-2">No charges for this event — entry is free!</div>
                        )}
                      </>
                    ) : (
                      <div className="text-sm text-red-400 text-center py-4">Could not load entry details. You can still join.</div>
                    )}
                  </div>

                  {/* Sticky balance preview + confirm */}
                  <div className="px-4 py-3 border-t border-emerald-900/40 space-y-3 shrink-0">
                    {joinPreview && (
                      <div className="flex justify-between text-[11px]">
                        <div>
                          <span className="text-emerald-200/50">Current balance: </span>
                          <span className={joinPreview.current_balance > 0 ? "text-red-400" : joinPreview.current_balance < 0 ? "text-emerald-400" : "text-emerald-200/60"}>
                            {joinPreview.current_balance < 0 ? "£" + Math.abs(joinPreview.current_balance).toFixed(2) + " credit" :
                             joinPreview.current_balance > 0 ? "£" + joinPreview.current_balance.toFixed(2) + " owed" : "Settled"}
                          </span>
                        </div>
                        <div>
                          {(() => {
                            const optPotCost = selectedOptionalPotIds.reduce((s, id) => {
                              const p = [...(joinPreview.optional_prize_pots ?? []), ...(joinPreview.season_optional_pots ?? [])].find((x: any) => x.id === id);
                              return s + (p?.entry_fee_amount ?? 0);
                            }, 0);
                            const optChargeCost = selectedOptionalChargeIds.reduce((s, id) => {
                              const c = [...(joinPreview.optional_charges ?? []), ...(joinPreview.group_optional_charges ?? [])].find((x: any) => x.id === id);
                              return s + (c?.amount ?? 0);
                            }, 0);
                            const total = joinPreview.projected_balance + optPotCost + optChargeCost;
                            return (
                              <>
                                <span className="text-emerald-200/50">After joining: </span>
                                <span className={total > 0 ? "text-red-400 font-semibold" : total < 0 ? "text-emerald-400 font-semibold" : "text-emerald-200/60"}>
                                  {total < 0 ? "£" + Math.abs(total).toFixed(2) + " credit" :
                                   total > 0 ? "£" + total.toFixed(2) + " owed" : "Settled"}
                                </span>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={handleEnter}
                      disabled={entering}
                      className="w-full py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                    >
                      {entering ? "Joining…" : "Confirm & Join"}
                    </button>
                    {enterError && <div className="text-sm text-red-400 text-center">{enterError}</div>}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Waitlist CTA */}
        {!isEntered && !entryOpen && (event as any).waitlist_enabled && (
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
          // Is this player's round managed by the event (via a tee time)?
          // If so, their score is submitted automatically when the round finishes —
          // no manual submit step needed.
          const myTeeTime = myProfileId
            ? teeTimes.find((tt) =>
                tt.round?.participants?.some((p) => p.profile_id === myProfileId)
              )
            : null;
          const eventOwnsRound = !!myTeeTime;

          return (
          <div className="space-y-2">
            <div className="flex gap-3">
              <div className="flex-1 py-3 rounded-full border border-emerald-700/50 text-sm font-semibold text-emerald-400 text-center">
                ✓ Entered
              </div>
            </div>
            {entryOpen && eventOwnsRound && myTeeTime && (
              <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5 text-[11px] text-emerald-200/60">
                {myTeeTime.round?.status === "finished"
                  ? "Your score has been submitted automatically."
                  : myTeeTime.round?.status === "live"
                  ? "Round in progress — your score will be submitted when the round is finished."
                  : `Tee time at ${new Date(myTeeTime.tee_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — your score will be submitted automatically.`}
              </div>
            )}
            {/* Withdraw */}
            {event.majors_status !== "live" &&
             event.majors_status !== "completed" &&
             myTeeTime?.round?.status !== "live" &&
             myTeeTime?.round?.status !== "starting" &&
             myTeeTime?.round?.status !== "finished" && (
              (event as any).allow_self_withdrawal !== false ? (
                <button type="button" onClick={() => setShowWithdrawConfirm(true)}
                  className="w-full py-2 rounded-full border border-red-900/50 text-sm text-red-400/70 hover:text-red-400 transition-colors">
                  Withdraw from Event
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

        const isFrozenRow = isFrozen && !row.is_live && (
          leaderboardFreeze?.freeze_scope !== "top_x" ||
          (row.position ?? 999) <= (leaderboardFreeze?.freeze_top_x ?? Infinity)
        );
        const actualHoles: number | undefined = row.actual_holes_completed;

        if (isFrozenRow && actualHoles != null && actualHoles > holesShown) {
          if (holesInRound === 0) {
            return `R${Math.min(completedRounds, event?.num_rounds ?? 1)} thru ${holesPerRound} (${actualHoles})`;
          }
          return `R${completedRounds + 1} thru ${holesInRound} (${actualHoles})`;
        }
        if (isFrozenRow && !row.is_live) {
          if (holesInRound === 0) {
            return `R${Math.min(completedRounds, event?.num_rounds ?? 1)} [F] (F)`;
          }
          return `R${completedRounds + 1} thru ${holesInRound} (F)`;
        }

        if (row.is_live) {
          return `R${completedRounds + 1} thru ${holesInRound || holesPerRound}`;
        }
        if (holesInRound === 0) {
          return `R${Math.min(completedRounds, event?.num_rounds ?? 1)} [F]`;
        }
        return `R${completedRounds + 1} thru ${holesInRound}`;
      }
      const rankedIds = new Set(leaderboard.map((r) => r.profile_id));
      const unranked = participants.filter((p) => !rankedIds.has(p.profile_id));
      const showPts = event?.points_model && event.points_model !== "none"
        && event.standings_contribution !== "event_only";
      const displayRows = lbView === "gross"
        ? [...leaderboard].sort((a, b) => {
            const aToPar = (a.gross_score ?? Infinity) - (a.course_par ?? 0);
            const bToPar = (b.gross_score ?? Infinity) - (b.course_par ?? 0);
            return aToPar - bToPar;
          })
        : leaderboard;

      const handleRoundCardClick = async (roundId: string) => {
        if (scorecardRoundId === roundId) { setScorecardRoundId(null); return; }
        setScorecardRoundId(roundId);
        setScorecardSnap(null);
        setScorecardLoading(true);
        try {
          const session = await getViewerSession();
          const res = await fetch(`/api/rounds/${roundId}/snapshot`, {
            headers: { Authorization: `Bearer ${session?.accessToken}` },
          });
          if (res.ok) setScorecardSnap(await res.json());
        } finally {
          setScorecardLoading(false);
        }
      };

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
          {activePlayoff && (
            <div className="mb-1.5">
              <PlayoffStatusBanner playoff={activePlayoff} onView={() => setShowPlayoffCard(true)} />
            </div>
          )}
          {/* Tie resolution buttons — owners/admins only, once every entrant has
              finished and the 1st-place tie is unresolved. Replace the reveal button. */}
          {isAdminOrOwner && allEntrantsComplete && hasFirstPlaceTie && !activePlayoff && (
            <div className="flex gap-2 mb-1.5">
              <button
                type="button"
                onClick={() => { setTieDrawerScreen("playoff_setup"); setShowTieDrawer(true); }}
                className="flex-1 py-2 rounded-full bg-[#f5e6b0] text-[#042713] text-xs font-semibold"
              >
                Playoff
              </button>
              <button
                type="button"
                onClick={() => { setTieDrawerScreen("choice"); setShowTieDrawer(true); }}
                className="flex-1 py-2 rounded-full border border-[#f5e6b0]/50 text-[#f5e6b0] text-xs font-semibold"
              >
                Countback
              </button>
            </div>
          )}
          {isAdminOrOwner && leaderboardFreeze?.freeze_state !== "revealed" && allEntrantsComplete && !(hasFirstPlaceTie && !activePlayoff) && (
            <button
              type="button"
              onClick={() => handleReveal()}
              disabled={revealLoading}
              className={`w-full py-2 mb-1.5 rounded-full text-xs transition-colors disabled:opacity-30 ${
                leaderboardFreeze?.freeze_state === "frozen"
                  ? "border border-emerald-600/35 text-emerald-300/60 hover:text-emerald-100 hover:border-emerald-500/50"
                  : "text-emerald-200/25 hover:text-emerald-200/50"
              }`}
            >
              {revealLoading ? "…" : leaderboardFreeze?.freeze_state === "frozen" ? "Reveal Results" : "Start Ceremony"}
            </button>
          )}
          {isAdminOrOwner && leaderboardFreeze?.freeze_state === "revealed" && (
            <button
              type="button"
              onClick={() => setShowReveal(true)}
              className="w-full py-1 mb-1.5 text-[11px] text-emerald-200/25 hover:text-emerald-200/50 transition-colors"
            >
              ↺ Replay ceremony
            </button>
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
              ? (row.points_earned ?? getPointsForPosition(row.position ?? null, event.points_model, event.points_table as Record<string, unknown>, event.points_config, event.num_rounds))
              : null;
            const thru = getThruLabel(row);
            const frozenThreshold =
              ((leaderboardFreeze as any)?.total_holes ?? (event?.num_rounds ?? 1) * 18)
              - (leaderboardFreeze?.freeze_last_holes ?? 0);
            const rowHolesShown = (row as any).holes_shown ?? row.holes_completed ?? 0;
            const isFrozenRow = isFrozen && rowHolesShown >= frozenThreshold && (
              leaderboardFreeze?.freeze_scope !== "top_x" ||
              (row.position ?? 999) <= (leaderboardFreeze?.freeze_top_x ?? Infinity)
            );
            const netToPar: number | null = row.to_par ?? null;
            const grossToPar: number | null =
              row.gross_score != null && row.course_par != null
                ? row.gross_score - row.course_par
                : null;
            // For stableford By Score: show format_points as primary, net-equivalent to-par as secondary
            const isStablefordScore = scoringModel === "stableford_points" && lbView === "score";
            const mainToPar = isStablefordScore ? null : (lbView === "gross" || scoringModel === "gross") ? grossToPar : netToPar;
            const mainTotal = lbView === "gross" ? row.gross_score : displayScore(row);
            const mainScoreText = isStablefordScore
              ? (row.format_points != null ? `${row.format_points} pts` : "—")
              : mainToPar != null
                ? formatToPar(mainToPar)
                : mainTotal != null ? String(mainTotal) : "—";
            const bracketText = isStablefordScore
              ? (netToPar != null ? formatToPar(netToPar) : null)
              : mainToPar != null && mainTotal != null ? `(${mainTotal})` : null;
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
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-sm font-semibold text-emerald-50 truncate">{row.profile?.name ?? "Unknown"}</span>
                    {isFrozenRow && <span className="text-[11px] leading-none shrink-0">❄️</span>}
                  </div>
                  {(row as any).playoff_result && (
                    <span className={`inline-block mt-0.5 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                      String((row as any).playoff_result).startsWith("won")
                        ? "bg-[#f5e6b0] text-[#042713]"
                        : "border border-emerald-700/50 text-emerald-200/70"
                    }`}>
                      {String((row as any).playoff_result).includes("countback")
                        ? (String((row as any).playoff_result).startsWith("won") ? "Won Countback" : "Lost Countback")
                        : (String((row as any).playoff_result).startsWith("won") ? "Won Playoff" : "Lost Playoff")}
                    </span>
                  )}
                </div>
                {showPts && (
                  <div className="text-right shrink-0 mr-1">
                    <div className="text-[10px] text-emerald-200/50 uppercase tracking-wider leading-none">Pts</div>
                    <div className="text-xs font-bold text-emerald-300">{fmtPts(pts)}</div>
                  </div>
                )}
                <div className="text-right shrink-0">
                  <div className="text-xs font-extrabold text-[#f5e6b0]">{mainScoreText}</div>
                  {bracketText ? (
                    <div className="text-[10px] text-emerald-100/50">{subLabel} {bracketText}</div>
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
              setPlayerEntry(null);
              setScorecardRoundId(null);
              setScorecardSnap(null);
              setPlayerRoundsLoading(true);
              try {
                const session = await getViewerSession();
                const res = await fetch(
                  `/api/majors/events/${eventId}/leaderboard/${row.profile_id}`,
                  { headers: { Authorization: `Bearer ${session?.accessToken}` } }
                );
                const j = await res.json();
                setPlayerRounds(j.rounds ?? []);
                setPlayerEntry(j.entry ?? null);
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
        {/* Incomplete rounds warning sheet */}
        {revealWarning && (
          <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={() => setRevealWarning(null)}>
            <div
              className="w-full max-w-sm mx-auto rounded-t-3xl bg-[#071f13] border-t border-emerald-900/70 px-4 pt-5 pb-[env(safe-area-inset-bottom)] space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <span className="text-amber-400 text-lg mt-0.5">⚠️</span>
                <div>
                  <p className="text-sm font-semibold text-amber-300">Some rounds aren&apos;t finished</p>
                  <p className="text-xs text-emerald-200/60 mt-0.5">These players are still on the course. You can wait for them or mark all rounds complete and reveal now.</p>
                </div>
              </div>
              <div className="space-y-3">
                {revealWarning.incomplete_rounds.map((round, ri) => (
                  <div key={ri} className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5">
                    <p className="text-[11px] font-semibold text-emerald-300/80 mb-1.5">{round.round_name}</p>
                    {round.players.map((p, pi) => (
                      <div key={pi} className="flex items-center justify-between py-0.5">
                        <span className="text-xs text-emerald-100">{p.name}</span>
                        <span className="text-[11px] text-emerald-200/50">
                          {p.rounds_submitted > 0 ? "Submitted" : `${p.holes_completed}/18 holes`}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setRevealWarning(null)}
                  className="flex-1 py-2.5 rounded-full border border-emerald-900/50 text-xs text-emerald-200/60 hover:text-emerald-200/90 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleReveal(true)}
                  disabled={revealLoading}
                  className="flex-1 py-2.5 rounded-full border border-amber-700/50 bg-amber-900/20 text-xs text-amber-300 hover:bg-amber-900/40 transition-colors disabled:opacity-40"
                >
                  {revealLoading ? "…" : "Mark complete & reveal"}
                </button>
              </div>
            </div>
          </div>
        )}

        {showReveal && (
          <LeaderboardReveal
            rows={leaderboard}
            revealStyle={(leaderboardFreeze?.reveal_style as LeaderboardRevealStyle) ?? "animated"}
            revealTopX={leaderboardFreeze?.reveal_top_x ?? null}
            scoringModel={event?.scoring_model}
            onDone={() => setShowReveal(false)}
          />
        )}
        {/* Tie management drawer (admin/owner only) */}
        {showTieDrawer && (
          <TieManagementDrawer
            eventId={eventId}
            initialScreen={tieDrawerScreen}
            onClose={() => setShowTieDrawer(false)}
            onResolved={(playoff) => {
              setActivePlayoff(playoff);
              setHasFirstPlaceTie(false);
              setShowTieDrawer(false);
              refreshLeaderboard();
            }}
          />
        )}
        {/* Playoff scorecard view */}
        {showPlayoffCard && activePlayoff && (
          <div className="fixed inset-0 z-50 bg-[#071f13] overflow-y-auto">
            <button
              type="button"
              onClick={() => setShowPlayoffCard(false)}
              className="absolute top-4 right-4 text-emerald-100/60 text-sm z-10"
            >
              ✕ Close
            </button>
            <PlayoffScorecardClient playoff={activePlayoff} eventId={eventId} canScore={isAdminOrOwner} scoringModel={event?.scoring_model} />
          </div>
        )}
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
                    const label = r.event_round?.name ?? `R${r.event_round?.round_number ?? i + 1}`;
                    const isOpen = scorecardRoundId === r.round_id;
                    return (
                      <div key={r.event_round_id ?? i}>
                        <button
                          type="button"
                          onClick={() => r.round_id && handleRoundCardClick(r.round_id)}
                          className="grid grid-cols-[1fr_auto_auto] gap-2 items-center w-full rounded-xl border border-emerald-900/40 bg-[#0b3b21]/60 px-3 py-2 text-left hover:brightness-110 active:scale-[0.99] transition-all"
                        >
                          <div>
                            <div className="text-sm font-semibold text-emerald-100 truncate">{label}</div>
                            {(() => {
                              const hi = r.handicap_index;
                              const ch = r.course_handicap;
                              const ph = r.playing_handicap;
                              if (hi == null && ch == null && ph == null) return null;
                              return (
                                <div className="text-[10px] text-emerald-200/40 mt-0.5 space-x-2">
                                  {hi != null && <span>HI {hi}</span>}
                                  {ch != null && <span>CH {ch}</span>}
                                  {ph != null && <span>PH {ph}</span>}
                                </div>
                              );
                            })()}
                          </div>
                          <div className="text-sm font-bold tabular-nums text-[#f5e6b0] text-right w-12">
                            {r.gross_score != null ? r.gross_score : "—"}
                          </div>
                          <div className="text-sm font-bold tabular-nums text-emerald-300 text-right w-12">
                            {r.net_score_snapshot != null ? r.net_score_snapshot : "—"}
                          </div>
                        </button>
                        {isOpen && (
                          <MiniScorecard
                            snap={scorecardSnap}
                            loading={scorecardLoading}
                            profileId={detailPlayer?.profile_id ?? null}
                          />
                        )}
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
      const isSelfSelect = (event as any)?.tee_time_mode === "self_select";
      // Which tee time round_id does this player belong to?
      const myTeeTimeId = isSelfSelect && myProfileId
        ? teeTimes.find((tt) =>
            tt.round?.participants?.some((p) => p.profile_id === myProfileId)
          )?.id ?? null
        : null;

      // Group tee times by event_round_id for structured display
      const teeTimesByRound = new Map<string | null, EventTeeTime[]>();
      for (const tt of teeTimes) {
        const key = tt.event_round_id ?? null;
        if (!teeTimesByRound.has(key)) teeTimesByRound.set(key, []);
        teeTimesByRound.get(key)!.push(tt);
      }

      const renderTeeTimeCard = (tt: EventTeeTime) => {
        const participantCount = tt.round?.participants?.length ?? 0;
        const hasSlot = tt.round?.participants?.some((p) => p.profile_id === myProfileId) ?? false;
        const canJoin = isSelfSelect && isEntered && myProfileId && !myTeeTimeId && participantCount < 4;
        return (
          <div key={tt.id} className="space-y-2">
            {hasSlot && tt.event_round && (
              <div className="text-[10px] text-emerald-400/80 font-semibold uppercase tracking-wider px-0.5">
                {tt.event_round.name} · Your tee time
              </div>
            )}
            <TeeTimeCard
              tt={tt}
              isAdmin={isAdminOrOwner}
              onDelete={() => handleDeleteTeeTime(tt.id)}
              onEdit={isAdminOrOwner ? () => setEditingTeeTime(tt) : undefined}
              onViewScorecard={tt.round?.id ? () => router.push(`/round/${tt.round!.id}?from=event&eventId=${eventId}`) : undefined}
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

      const numRounds = (event as any)?.num_rounds ?? 1;
      const hasMultipleRounds = numRounds > 1;

      return (
        <div className="space-y-3">
          {isSelfSelect && (
            <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2 text-[11px] text-emerald-200/60">
              Players can choose their own tee time slot.
            </div>
          )}
          {/* Admin: init rounds banner for events missing event_round rows */}
          {isAdminOrOwner && hasMultipleRounds && eventRounds.length === 0 && (
            <div className="rounded-xl border border-amber-800/50 bg-amber-900/20 px-3 py-2.5 flex items-center justify-between gap-2">
              <span className="text-[11px] text-amber-200/80">Rounds not yet initialised.</span>
              <button
                type="button"
                className="text-[11px] font-semibold text-amber-300 hover:text-amber-100 shrink-0"
                onClick={async () => {
                  const session = await getViewerSession();
                  if (!session) return;
                  for (let i = 1; i <= numRounds; i++) {
                    await fetch(`/api/majors/events/${eventId}/rounds`, {
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
          {teeTimes.length === 0 && eventRounds.length === 0 ? (
            <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 p-5 text-center space-y-1">
              <div className="text-sm text-emerald-100/60">
                {isAdminOrOwner
                  ? "No tee times set up yet."
                  : isEntered
                  ? isSelfSelect ? "No slots available yet. Check back soon." : "Your tee time hasn't been set yet."
                  : "No tee times have been scheduled yet."}
              </div>
            </div>
          ) : eventRounds.length > 0 ? (
            // Grouped view: one section per event round
            <div className="space-y-5">
              {eventRounds.map((cr) => {
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
                          <div className="text-[10px] text-emerald-200/50 mt-0.5">
                            {cr.course?.name && <span>{cr.course.name}</span>}
                            {(cr.tee_male?.name || cr.tee_female?.name) && (
                              <div className="space-y-0.5 mt-0.5">
                                {cr.tee_male?.name && (
                                  <div><span className="text-emerald-200/30">Men's tee: </span>{cr.tee_male.name}</div>
                                )}
                                {cr.tee_female?.name && (
                                  <div><span className="text-emerald-200/30">Women's tee: </span>{cr.tee_female.name}</div>
                                )}
                              </div>
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
            // No event_rounds yet (single-round or legacy) — flat list
            <div className="space-y-3">{teeTimes.map(renderTeeTimeCard)}</div>
          )}
        </div>
      );
    })(),

    rules: event ? (
      <div className="space-y-4 text-[13px] text-emerald-100/75 leading-relaxed">
        {event.rules_text ? (
          <p>{event.rules_text}</p>
        ) : (
          <p className="text-emerald-100/50">No custom rules specified.</p>
        )}
        <div className="space-y-2 rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-3">
          {event.scoring_model && (
            <div className="flex justify-between text-[12px]">
              <span className="text-emerald-200/55">Scoring</span>
              <span className="text-emerald-50 capitalize">{event.scoring_model}</span>
            </div>
          )}
          {event.scoring_model !== "gross" && (event.handicap_rules as any)?.allowance_pct != null && (
            <div className="flex justify-between text-[12px]">
              <span className="text-emerald-200/55">Handicap allowance</span>
              <span className="text-emerald-50">{(event.handicap_rules as any).allowance_pct}%</span>
            </div>
          )}
          {(event.handicap_rules as any)?.max_handicap != null && (
            <div className="flex justify-between text-[12px]">
              <span className="text-emerald-200/55">Max handicap</span>
              <span className="text-emerald-50">{(event.handicap_rules as any).max_handicap}</span>
            </div>
          )}
          {event.num_rounds > 1 && (
            <div className="flex justify-between text-[12px]">
              <span className="text-emerald-200/55">Rounds required</span>
              <span className="text-emerald-50">{event.num_rounds}</span>
            </div>
          )}
          {event.standings_contribution !== "event_only" && (
            <div className="flex justify-between text-[12px]">
              <span className="text-emerald-200/55">Contributes to</span>
              <span className="text-emerald-50 capitalize">{event.standings_contribution}</span>
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

    finances: (() => {
      const currencySymbol = "£";
      const entryFee = (event as any)?.entry_fee_amount as number | null;
      const enteredCount = participants.length;
      const pot = entryFee && entryFee > 0 ? entryFee * enteredCount : 0;
      const totalWinningsPaid = winnings.reduce((s, w) => s + w.amount, 0);

      // Category labels
      const categoryLabel: Record<string, string> = {
        green_fee: "Green Fee",
        buggy: "Buggy",
        food: "Food",
        drink: "Drinks",
        other: "Other",
      };

      const handleAddCharge = async () => {
        if (!addChargeForm || !addChargeForm.name || !addChargeForm.amount) return;
        setAddingCharge(true);
        setChargeError(null);
        try {
          const session = await getViewerSession();
          if (!session) return;
          const res = await fetch(`/api/majors/events/${eventId}/charges`, {
            method: "POST",
            headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              name: addChargeForm.name.trim(),
              amount: parseFloat(addChargeForm.amount),
              category: addChargeForm.category,
              description: addChargeForm.description.trim() || null,
              round_id: addChargeForm.round_id || null,
              is_mandatory: addChargeForm.is_mandatory,
            }),
          });
          if (!res.ok) {
            const j = await res.json();
            setChargeError(j.error ?? "Failed to add charge");
            return;
          }
          setAddChargeForm(null);
          await refreshFinances();
        } finally {
          setAddingCharge(false);
        }
      };

      const handleDeleteCharge = async (chargeId: string) => {
        const session = await getViewerSession();
        if (!session) return;
        const res = await fetch(`/api/majors/events/${eventId}/charges/${chargeId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (!res.ok) {
          const j = await res.json();
          setChargeError(j.error ?? "Failed to delete charge");
          return;
        }
        await refreshFinances();
      };

      const handleAssignAll = async (chargeId: string) => {
        const session = await getViewerSession();
        if (!session) return;
        const res = await fetch(`/api/majors/events/${eventId}/charges/${chargeId}/assign-all`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          const j = await res.json();
          setChargeError(j.error ?? "Failed to apply charge");
          return;
        }
        await refreshFinances();
      };

      const handleMarkPaid = async (playerChargeId: string) => {
        const session = await getViewerSession();
        if (!session) return;
        const res = await fetch(`/api/majors/events/${eventId}/player-charges/${playerChargeId}/pay`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          const j = await res.json();
          setChargeError(j.error ?? "Failed to mark paid");
          return;
        }
        await refreshFinances();
      };

      const handleRemovePlayerCharge = async (playerChargeId: string) => {
        const session = await getViewerSession();
        if (!session) return;
        const res = await fetch(`/api/majors/events/${eventId}/player-charges/${playerChargeId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.accessToken}` },
        });
        if (!res.ok) {
          const j = await res.json();
          setChargeError(j.error ?? "Failed to remove charge");
          return;
        }
        await refreshFinances();
      };

      const handleAssignToPlayer = async (chargeId: string, profileId: string) => {
        const session = await getViewerSession();
        if (!session) return;
        const res = await fetch(`/api/majors/events/${eventId}/charges/${chargeId}/assign`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ profile_ids: [profileId] }),
        });
        if (!res.ok) {
          const j = await res.json();
          setChargeError(j.error ?? "Failed to assign charge");
          return;
        }
        await refreshFinances();
      };

      // ── Prize pot handlers ──────────────────────────────────────────────────

      const handleAddPot = async () => {
        if (!addPotForm || !addPotForm.name.trim()) return;
        setAddingPot(true);
        setPotError(null);
        try {
          const session = await getViewerSession();
          if (!session) return;
          const res = await fetch(`/api/majors/events/${eventId}/prize-pots`, {
            method: "POST",
            headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              name: addPotForm.name.trim(),
              description: addPotForm.description.trim() || null,
              distribution_type: addPotForm.distribution_type === "winner_takes_all" ? "position_based" : addPotForm.distribution_type,
              entry_fee_amount: addPotForm.entry_fee_amount ? parseFloat(addPotForm.entry_fee_amount) : null,
              entry_fee_notes: addPotForm.entry_fee_notes.trim() || null,
              prize_table: addPotForm.distribution_type === "winner_takes_all"
                ? [{ position: 1, pct: 100 }]
                : (addPotForm.distribution_type === "position_based" && addPotForm.prize_table.length > 0 ? addPotForm.prize_table : null),
              metric_type: addPotForm.metric_type || null,
              metric_description: addPotForm.metric_description.trim() || null,
              is_monetary: addPotForm.is_monetary,
              prize_description: addPotForm.prize_description.trim() || null,
              is_mandatory: addPotForm.is_mandatory,
            }),
          });
          if (!res.ok) {
            const j = await res.json();
            setPotError(j.error ?? "Failed to create prize pot");
            return;
          }
          setAddPotForm(null);
          await refreshFinances();
        } finally {
          setAddingPot(false);
        }
      };

      const handleDeletePot = async (potId: string) => {
        setPotActionLoading(potId + ":delete");
        setPotError(null);
        try {
          const session = await getViewerSession();
          if (!session) return;
          const res = await fetch(`/api/majors/prize-pots/${potId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${session.accessToken}` },
          });
          if (!res.ok) {
            const j = await res.json();
            setPotError(j.error ?? "Failed to delete prize pot");
            return;
          }
          if (expandedPotId === potId) setExpandedPotId(null);
          await refreshFinances();
        } finally {
          setPotActionLoading(null);
        }
      };

      const handleEditPotClick = (pot: PrizePotWithDetails) => {
        const isWinnerTakesAll =
          pot.distribution_type === "position_based" &&
          pot.prize_table?.length === 1 &&
          pot.prize_table[0].position === 1 &&
          pot.prize_table[0].pct === 100;
        setEditPotForm({
          name: pot.name,
          description: pot.description ?? "",
          distribution_type: isWinnerTakesAll ? "winner_takes_all" : pot.distribution_type,
          entry_fee_amount: pot.entry_fee_amount != null ? String(pot.entry_fee_amount) : "",
          entry_fee_notes: pot.entry_fee_notes ?? "",
          prize_table: (!isWinnerTakesAll && pot.prize_table) ? pot.prize_table : [],
          metric_type: pot.metric_type ?? "",
          metric_description: pot.metric_description ?? "",
          is_monetary: pot.is_monetary,
          prize_description: pot.prize_description ?? "",
          is_mandatory: pot.is_mandatory,
        });
        setEditPotId(pot.id);
        setPotError(null);
      };

      const handleSavePot = async () => {
        if (!editPotForm || !editPotId || !editPotForm.name.trim()) return;
        setSavingPot(true);
        setPotError(null);
        try {
          const session = await getViewerSession();
          if (!session) return;
          const res = await fetch(`/api/majors/prize-pots/${editPotId}`, {
            method: "PATCH",
            headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              name: editPotForm.name.trim(),
              description: editPotForm.description.trim() || null,
              distribution_type: editPotForm.distribution_type === "winner_takes_all" ? "position_based" : editPotForm.distribution_type,
              entry_fee_amount: editPotForm.entry_fee_amount ? parseFloat(editPotForm.entry_fee_amount) : null,
              entry_fee_notes: editPotForm.entry_fee_notes.trim() || null,
              prize_table: editPotForm.distribution_type === "winner_takes_all"
                ? [{ position: 1, pct: 100 }]
                : (editPotForm.distribution_type === "position_based" && editPotForm.prize_table.length > 0 ? editPotForm.prize_table : null),
              metric_type: editPotForm.metric_type || null,
              metric_description: editPotForm.metric_description.trim() || null,
              is_monetary: editPotForm.is_monetary,
              prize_description: editPotForm.prize_description.trim() || null,
              is_mandatory: editPotForm.is_mandatory,
            }),
          });
          if (!res.ok) {
            const j = await res.json();
            setPotError(j.error ?? "Failed to save prize pot");
            return;
          }
          setEditPotId(null);
          setEditPotForm(null);
          await refreshFinances();
        } finally {
          setSavingPot(false);
        }
      };

      const handleEnrollAllPot = async (potId: string) => {
        setPotActionLoading(potId + ":enroll");
        setPotError(null);
        try {
          const session = await getViewerSession();
          if (!session) return;
          const res = await fetch(`/api/majors/prize-pots/${potId}/enroll`, {
            method: "POST",
            headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          if (!res.ok) {
            const j = await res.json();
            setPotError(j.error ?? "Failed to enroll players");
            return;
          }
          await refreshFinances();
        } finally {
          setPotActionLoading(null);
        }
      };

      const handleComputeTwos = async (potId: string) => {
        setPotActionLoading(potId + ":compute");
        setPotError(null);
        try {
          const session = await getViewerSession();
          if (!session) return;
          const res = await fetch(`/api/majors/prize-pots/${potId}/metrics/compute`, {
            method: "POST",
            headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          if (!res.ok) {
            const j = await res.json();
            setPotError(j.error ?? "Failed to compute twos");
            return;
          }
          await refreshFinances();
        } finally {
          setPotActionLoading(null);
        }
      };

      const handleProposeDistribution = async (potId: string) => {
        setPotActionLoading(potId + ":propose");
        setPotError(null);
        setProposedDistribution(null);
        try {
          const session = await getViewerSession();
          if (!session) return;
          const res = await fetch(`/api/majors/prize-pots/${potId}/distribute`, {
            method: "POST",
            headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ confirm: false }),
          });
          const j = await res.json();
          if (!res.ok) {
            setPotError(j.error ?? "Failed to propose distribution");
            return;
          }
          setProposedDistribution({ potId, total_pot: j.total_pot, proposed: j.proposed });
        } finally {
          setPotActionLoading(null);
        }
      };

      const handleConfirmDistribution = async (potId: string) => {
        setPotActionLoading(potId + ":confirm");
        setPotError(null);
        try {
          const session = await getViewerSession();
          if (!session) return;
          const res = await fetch(`/api/majors/prize-pots/${potId}/distribute`, {
            method: "POST",
            headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ confirm: true }),
          });
          const j = await res.json();
          if (!res.ok) {
            setPotError(j.error ?? "Failed to confirm distribution");
            return;
          }
          setProposedDistribution(null);
          await refreshFinances();
        } finally {
          setPotActionLoading(null);
        }
      };

      const distTypeLabel: Record<string, string> = {
        winner_takes_all: "Winner Takes All",
        position_based: "By Finishing Position",
        metric_weighted: "Proportional to Metric",
        metric_equal: "Equal Split (Qualifiers)",
        equal_split: "Equal Split (All Players)",
        non_monetary: "Non-Cash Prize",
        season_standings_winner: "Season Standings Winner",
        entry_only: "Entry Only",
      };

      const metricTypeLabel: Record<string, string> = {
        twos: "Two's Club",
        nearest_pin: "Nearest Pin",
        longest_drive: "Longest Drive",
        season_points: "Season Points",
        custom: "Custom",
      };

      const potStatusColour: Record<string, string> = {
        active: "text-emerald-400 bg-emerald-900/30 border-emerald-700/40",
        locked: "text-yellow-300 bg-yellow-900/20 border-yellow-700/40",
        distributed: "text-blue-300 bg-blue-900/20 border-blue-700/40",
      };

      const emptyAddPotForm = () => ({
        name: "",
        description: "",
        distribution_type: "winner_takes_all" as PrizePotDistributionType | "winner_takes_all",
        entry_fee_amount: "",
        entry_fee_notes: "",
        prize_table: [{ position: 1, pct: 50 }, { position: 2, pct: 30 }, { position: 3, pct: 20 }] as PrizeTableEntry[],
        metric_type: "",
        metric_description: "",
        is_monetary: true,
        prize_description: "",
        is_mandatory: false,
      });

      const inputCls = "w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600";

      return (
        <div className="space-y-5">
          {chargeError && (
            <div className="text-[11px] text-red-400 bg-red-950/30 border border-red-900/50 rounded-xl px-3 py-2">
              {chargeError}
              <button type="button" onClick={() => setChargeError(null)} className="ml-2 underline">Dismiss</button>
            </div>
          )}

          {/* Section A: Competition Fees & Prize Pot */}
          {entryFee && entryFee > 0 && (
            <div className="rounded-2xl border border-emerald-900/50 bg-[#0b3b21]/60 px-4 py-3 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-emerald-200/50 font-semibold">Competition Fee & Prize Pot</div>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center">
                  <div className="text-[10px] text-emerald-200/50">Entry Fee</div>
                  <div className="text-sm font-bold text-emerald-50">{currencySymbol}{entryFee.toFixed(2)}</div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-emerald-200/50">Total Pot</div>
                  <div className="text-sm font-bold text-[#f5e6b0]">{currencySymbol}{pot.toFixed(2)}</div>
                </div>
                <div className="text-center">
                  <div className="text-[10px] text-emerald-200/50">Paid Out</div>
                  <div className="text-sm font-bold text-emerald-400">{currencySymbol}{totalWinningsPaid.toFixed(2)}</div>
                </div>
              </div>
              <div className="text-[10px] text-emerald-200/40 text-center">
                {enteredCount} {enteredCount === 1 ? "entry" : "entries"} · see Winnings tab for payouts
              </div>
            </div>
          )}

          {/* Section B: Charge Catalog */}
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-emerald-200/50 font-semibold">Event Charges</div>

            {eventCharges.length === 0 && !addChargeForm && (
              <div className="text-[11px] text-emerald-200/40 text-center py-2">No charges defined yet.</div>
            )}

            {eventCharges.map((charge) => {
              const chargeRound = charge.round_id ? eventRounds.find((r) => r.id === charge.round_id) : null;
              return (
                <div key={charge.id} className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/50 px-3 py-2.5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-emerald-700/50 text-emerald-300/80 bg-emerald-900/30 shrink-0">
                        {categoryLabel[charge.category] ?? charge.category}
                      </span>
                      {chargeRound && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-blue-700/50 text-blue-300/80 bg-blue-900/20 shrink-0">
                          {chargeRound.name || `Round ${chargeRound.round_number}`}
                        </span>
                      )}
                      <span className="text-sm font-semibold text-emerald-50 truncate">{charge.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-sm font-bold text-emerald-200">{currencySymbol}{charge.amount.toFixed(2)}</span>
                      <button
                        type="button"
                        onClick={() => handleDeleteCharge(charge.id)}
                        className="text-[10px] text-red-400/60 hover:text-red-400"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  {charge.description && <div className="text-[10px] text-emerald-200/40">{charge.description}</div>}
                  <button
                    type="button"
                    onClick={() => handleAssignAll(charge.id)}
                    className="w-full py-1 rounded-full border border-emerald-700/40 text-[10px] text-emerald-200/70 hover:bg-emerald-900/30"
                  >
                    Apply to all entered players
                  </button>
                </div>
              );
            })}

            {addChargeForm ? (
              <div className="rounded-xl border border-emerald-700/40 bg-[#0b3b21]/50 px-3 py-3 space-y-2">
                <div className="text-[11px] font-semibold text-emerald-200">New Charge</div>
                <input
                  type="text"
                  placeholder="Name (e.g. Green Fee, Buggy)"
                  value={addChargeForm.name}
                  onChange={(e) => setAddChargeForm((f) => f && { ...f, name: e.target.value })}
                  className={inputCls}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    placeholder="Amount (£)"
                    value={addChargeForm.amount}
                    onChange={(e) => setAddChargeForm((f) => f && { ...f, amount: e.target.value })}
                    className={inputCls}
                    min="0"
                    step="0.01"
                  />
                  <select
                    value={addChargeForm.category}
                    onChange={(e) => setAddChargeForm((f) => f && { ...f, category: e.target.value })}
                    className={inputCls}
                  >
                    <option value="green_fee">Green Fee</option>
                    <option value="buggy">Buggy</option>
                    <option value="food">Food</option>
                    <option value="drink">Drinks</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <input
                  type="text"
                  placeholder="Description (optional)"
                  value={addChargeForm.description}
                  onChange={(e) => setAddChargeForm((f) => f && { ...f, description: e.target.value })}
                  className={inputCls}
                />
                {eventRounds.length > 1 && (
                  <select
                    value={addChargeForm.round_id}
                    onChange={(e) => setAddChargeForm((f) => f && { ...f, round_id: e.target.value })}
                    className={inputCls}
                  >
                    <option value="">Whole event (all rounds)</option>
                    {eventRounds.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name || `Round ${r.round_number}`}{r.scheduled_date ? ` — ${r.scheduled_date}` : ""}
                      </option>
                    ))}
                  </select>
                )}
                {/* Mandatory toggle */}
                <button
                  type="button"
                  onClick={() => setAddChargeForm((f) => f && { ...f, is_mandatory: !f.is_mandatory })}
                  className="flex items-center justify-between w-full py-2 px-2 rounded-lg border border-emerald-900/40 hover:bg-emerald-900/20"
                >
                  <div className="text-left">
                    <div className="text-[11px] font-semibold text-emerald-100">Mandatory</div>
                    <div className="text-[10px] text-emerald-200/40">Auto-charged when a player joins this event</div>
                  </div>
                  <div className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${addChargeForm.is_mandatory ? "bg-emerald-600" : "bg-emerald-900/50"}`}>
                    <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${addChargeForm.is_mandatory ? "translate-x-5" : ""}`} />
                  </div>
                </button>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setAddChargeForm(null)}
                    className="flex-1 py-1.5 rounded-full border border-emerald-900/60 text-[11px] text-emerald-200/60">
                    Cancel
                  </button>
                  <button type="button" onClick={handleAddCharge} disabled={addingCharge}
                    className="flex-1 py-1.5 rounded-full bg-emerald-700 text-[11px] font-semibold text-white disabled:opacity-50">
                    {addingCharge ? "Adding…" : "Add Charge"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddChargeForm({ name: "", amount: "", category: "green_fee", description: "", round_id: "", is_mandatory: false })}
                className="w-full py-2 rounded-full border border-emerald-700/50 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-900/30"
              >
                + Add Charge
              </button>
            )}
          </div>

          {/* Section C: Player Charges Grid */}
          {(eventCharges.length > 0 || playerCharges.length > 0) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wider text-emerald-200/50 font-semibold">Player Charges</div>
                {eventCharges.length > 0 && participants.length > 0 && (
                  <div className="flex rounded-full border border-emerald-900/60 overflow-hidden text-[9px]">
                    <button
                      type="button"
                      onClick={() => setChargesViewMode("list")}
                      className={`px-2.5 py-1 ${chargesViewMode === "list" ? "bg-emerald-800/60 text-emerald-100" : "text-emerald-200/50 hover:text-emerald-200/80"}`}
                    >
                      List
                    </button>
                    <button
                      type="button"
                      onClick={() => setChargesViewMode("matrix")}
                      className={`px-2.5 py-1 ${chargesViewMode === "matrix" ? "bg-emerald-800/60 text-emerald-100" : "text-emerald-200/50 hover:text-emerald-200/80"}`}
                    >
                      Matrix
                    </button>
                  </div>
                )}
              </div>

              {participants.length === 0 ? (
                <div className="text-[11px] text-emerald-200/40 text-center py-2">No entered players yet.</div>
              ) : chargesViewMode === "matrix" ? (
                /* Matrix view: players × charges grid */
                <div className="overflow-x-auto">
                  <table className="w-full text-[10px] border-collapse">
                    <thead>
                      <tr>
                        <th className="text-left text-emerald-200/50 pb-1 pr-2 font-normal">Player</th>
                        {eventCharges.map((charge) => {
                          const chargeRound = charge.round_id ? eventRounds.find((r) => r.id === charge.round_id) : null;
                          return (
                            <th key={charge.id} className="text-center text-emerald-200/50 pb-1 px-1 font-normal leading-tight max-w-[60px]">
                              <div className="truncate">{charge.name}</div>
                              {chargeRound && <div className="text-[8px] text-blue-300/60">{chargeRound.name || `R${chargeRound.round_number}`}</div>}
                              <div className="text-emerald-200/30">{currencySymbol}{charge.amount.toFixed(0)}</div>
                            </th>
                          );
                        })}
                        <th className="text-right text-emerald-200/50 pb-1 pl-2 font-normal">Bal.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {participants.map((participant) => {
                        const pid = participant.profile_id;
                        const profileName = participant.profile?.name ?? "?";
                        const myCharges = playerCharges.filter((pc) => pc.profile_id === pid);
                        const totalCharged = myCharges.reduce((s, pc) => s + pc.amount, 0);
                        const totalPaid = myCharges.filter((pc) => pc.is_paid).reduce((s, pc) => s + pc.amount, 0);
                        return (
                          <tr key={pid} className="border-t border-emerald-900/30">
                            <td className="py-1.5 pr-2 text-emerald-50 font-medium whitespace-nowrap truncate max-w-[80px]">{profileName}</td>
                            {eventCharges.map((charge) => {
                              const pc = myCharges.find((c) => c.charge_id === charge.id);
                              return (
                                <td key={charge.id} className="text-center py-1.5 px-1">
                                  {pc ? (
                                    pc.is_paid
                                      ? <span className="text-emerald-400">✓</span>
                                      : <span className="text-yellow-400/80">{currencySymbol}{pc.amount.toFixed(0)}</span>
                                  ) : (
                                    <span className="text-emerald-200/20">—</span>
                                  )}
                                </td>
                              );
                            })}
                            <td className={`text-right py-1.5 pl-2 font-semibold ${totalCharged > totalPaid ? "text-red-400" : totalCharged > 0 ? "text-emerald-400" : "text-emerald-200/30"}`}>
                              {totalCharged > 0 ? (totalCharged > totalPaid ? `-${currencySymbol}${(totalCharged - totalPaid).toFixed(0)}` : "✓") : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="space-y-2">
                  {participants.map((participant) => {
                    const pid = participant.profile_id;
                    const profileName = participant.profile?.name ?? "Unknown";
                    const profileAvatar = participant.profile?.avatar_url ?? null;
                    const myCharges = playerCharges.filter((pc) => pc.profile_id === pid);
                    const totalCharged = myCharges.reduce((s, pc) => s + pc.amount, 0);
                    const totalPaid = myCharges.filter((pc) => pc.is_paid).reduce((s, pc) => s + pc.amount, 0);
                    const outstanding = totalCharged - totalPaid;

                    return (
                      <div key={pid} className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/50 px-3 py-3 space-y-2">
                        <div className="flex items-center gap-2">
                          {profileAvatar ? (
                            <img src={profileAvatar} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="h-7 w-7 rounded-full bg-emerald-900/60 grid place-items-center text-[9px] font-bold text-emerald-200 shrink-0">
                              {profileName.slice(0, 2).toUpperCase()}
                            </div>
                          )}
                          <span className="flex-1 text-sm font-semibold text-emerald-50">{profileName}</span>
                          {totalCharged > 0 && (
                            <div className="text-right shrink-0">
                              <div className={`text-[11px] font-bold ${outstanding > 0 ? "text-red-400" : "text-emerald-400"}`}>
                                {outstanding > 0 ? `Owes ${currencySymbol}${outstanding.toFixed(2)}` : "Settled"}
                              </div>
                              <div className="text-[9px] text-emerald-200/30">
                                {currencySymbol}{totalCharged.toFixed(2)} total
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Per-charge rows */}
                        {eventCharges.map((charge) => {
                          const pc = myCharges.find((c) => c.charge_id === charge.id);
                          return (
                            <div key={charge.id} className="flex items-center justify-between gap-2 pl-9 text-[11px]">
                              <span className="text-emerald-200/60">{charge.name}</span>
                              {pc ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-emerald-200/80">{currencySymbol}{pc.amount.toFixed(2)}</span>
                                  {pc.is_paid ? (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-800/50 text-emerald-300">Paid</span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleMarkPaid(pc.id)}
                                      className="text-[9px] px-1.5 py-0.5 rounded-full border border-emerald-700/50 text-emerald-200/70 hover:bg-emerald-900/40"
                                    >
                                      Mark Paid
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleRemovePlayerCharge(pc.id)}
                                    className="text-red-400/50 hover:text-red-400 text-[9px]"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleAssignToPlayer(charge.id, pid)}
                                  className="text-[9px] px-1.5 py-0.5 rounded-full border border-emerald-900/50 text-emerald-200/40 hover:text-emerald-200/80 hover:border-emerald-700/50"
                                >
                                  + Assign
                                </button>
                              )}
                            </div>
                          );
                        })}

                        {/* Ad-hoc player charges not linked to a catalog item */}
                        {myCharges
                          .filter((pc) => !pc.charge_id || !eventCharges.find((c) => c.id === pc.charge_id))
                          .map((pc) => (
                            <div key={pc.id} className="flex items-center justify-between gap-2 pl-9 text-[11px]">
                              <span className="text-emerald-200/60">{pc.name}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-emerald-200/80">{currencySymbol}{pc.amount.toFixed(2)}</span>
                                {pc.is_paid ? (
                                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-800/50 text-emerald-300">Paid</span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleMarkPaid(pc.id)}
                                    className="text-[9px] px-1.5 py-0.5 rounded-full border border-emerald-700/50 text-emerald-200/70 hover:bg-emerald-900/40"
                                  >
                                    Mark Paid
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {/* Section D: Prize Pots */}
          {isAdminOrOwner && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wider text-emerald-200/50 font-semibold">Prize Pots</div>
                {!addPotForm && (
                  <button
                    type="button"
                    onClick={() => setAddPotForm(emptyAddPotForm())}
                    className="text-[10px] text-emerald-300/70 hover:text-emerald-300 border border-emerald-800/50 rounded-full px-2.5 py-1"
                  >
                    + Add Pot
                  </button>
                )}
              </div>

              {potError && (
                <div className="text-[11px] text-red-400 bg-red-950/30 border border-red-900/50 rounded-xl px-3 py-2">
                  {potError}
                  <button type="button" onClick={() => setPotError(null)} className="ml-2 underline">Dismiss</button>
                </div>
              )}

              {prizePots.length === 0 && !addPotForm && (
                <div className="text-[11px] text-emerald-200/30 text-center py-2">
                  No prize pots. Add entry fees, Two&apos;s Club, side pots, or non-monetary prizes.
                </div>
              )}

              {prizePots.map((pot) => {
                const isExpanded = expandedPotId === pot.id;
                const actionPrefix = potActionLoading?.startsWith(pot.id + ":") ? potActionLoading.split(":")[1] : null;

                return (
                  <div key={pot.id} className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/50 overflow-hidden">
                    {/* Pot header */}
                    <div className="px-3 py-2.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-emerald-50">{pot.name}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${potStatusColour[pot.status] ?? ""}`}>
                              {pot.status}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-emerald-700/40 text-emerald-300/70">
                              {distTypeLabel[pot.distribution_type] ?? pot.distribution_type}
                            </span>
                            {pot.metric_type && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-purple-700/40 text-purple-300/70">
                                {metricTypeLabel[pot.metric_type] ?? pot.metric_type}
                              </span>
                            )}
                            {!pot.is_monetary && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-amber-700/40 text-amber-300/70">
                                Non-cash prize
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {pot.is_monetary && (
                            <div className="text-sm font-bold text-[#f5e6b0]">{currencySymbol}{pot.total_pot.toFixed(2)} pot</div>
                          )}
                          {pot.entry_fee_amount && pot.entry_fee_amount > 0 && (
                            <div className="text-[10px] text-emerald-200/50">{currencySymbol}{pot.entry_fee_amount.toFixed(2)}/player</div>
                          )}
                          {pot.prize_description && !pot.is_monetary && (
                            <div className="text-[10px] text-amber-200/70 max-w-[120px] text-right">{pot.prize_description}</div>
                          )}
                        </div>
                      </div>
                      {pot.description && (
                        <div className="text-[10px] text-emerald-200/40">{pot.description}</div>
                      )}

                      {/* Action buttons */}
                      {pot.status !== "distributed" && (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleEnrollAllPot(pot.id)}
                            disabled={actionPrefix === "enroll"}
                            className="text-[10px] px-2.5 py-1 rounded-full border border-emerald-700/50 text-emerald-200/70 hover:bg-emerald-900/30 disabled:opacity-50"
                          >
                            {actionPrefix === "enroll" ? "Enrolling…" : "Enroll All Players"}
                          </button>
                          {pot.metric_type === "twos" && (
                            <button
                              type="button"
                              onClick={() => handleComputeTwos(pot.id)}
                              disabled={actionPrefix === "compute"}
                              className="text-[10px] px-2.5 py-1 rounded-full border border-purple-700/50 text-purple-200/70 hover:bg-purple-900/30 disabled:opacity-50"
                            >
                              {actionPrefix === "compute" ? "Computing…" : "Compute Two's"}
                            </button>
                          )}
                          {pot.distribution_type !== "entry_only" && (
                            <button
                              type="button"
                              onClick={() => handleProposeDistribution(pot.id)}
                              disabled={actionPrefix === "propose"}
                              className="text-[10px] px-2.5 py-1 rounded-full border border-amber-700/50 text-amber-200/70 hover:bg-amber-900/30 disabled:opacity-50"
                            >
                              {actionPrefix === "propose" ? "Calculating…" : "Propose Distribution"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleEditPotClick(pot)}
                            disabled={editPotId === pot.id}
                            className="text-[10px] px-2.5 py-1 rounded-full border border-emerald-700/50 text-emerald-200/70 hover:bg-emerald-900/30 disabled:opacity-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePot(pot.id)}
                            disabled={actionPrefix === "delete"}
                            className="text-[10px] px-2 py-1 text-red-400/50 hover:text-red-400 disabled:opacity-50"
                          >
                            {actionPrefix === "delete" ? "…" : "Delete"}
                          </button>
                        </div>
                      )}

                      {/* Toggle expand */}
                      {(pot.entries.length > 0 || pot.payouts.length > 0) && (
                        <button
                          type="button"
                          onClick={() => setExpandedPotId(isExpanded ? null : pot.id)}
                          className="w-full text-[10px] text-emerald-200/40 hover:text-emerald-200/70 text-center"
                        >
                          {isExpanded ? "▲ Hide" : `▼ ${pot.entries.length} enrolled${pot.payouts.length > 0 ? ` · ${pot.payouts.length} payouts` : ""}`}
                        </button>
                      )}
                    </div>

                    {/* Inline edit form */}
                    {editPotId === pot.id && editPotForm && (
                      <div className="border-t border-emerald-900/50 px-3 py-3 space-y-2">
                        <div className="text-[11px] font-semibold text-emerald-200">Edit Prize Pot</div>

                        {/* Payment warning */}
                        {pot.entries.length > 0 && (pot.entry_fee_amount ?? 0) > 0 && (
                          <div className="rounded-xl border border-amber-800/40 bg-amber-900/20 px-3 py-2 text-[11px] text-amber-300/80">
                            ⚠ {pot.entries.length} player{pot.entries.length !== 1 ? "s have" : " has"} already contributed to this pot. Changing the entry fee or payout structure will not retroactively affect existing contributions.
                          </div>
                        )}

                        <input
                          type="text"
                          placeholder="Name (e.g. Two's Club, Season FedEx Pot)"
                          value={editPotForm.name}
                          onChange={(e) => setEditPotForm((f) => f && { ...f, name: e.target.value })}
                          className={inputCls}
                        />
                        <select
                          value={editPotForm.distribution_type}
                          onChange={(e) => setEditPotForm((f) => f && { ...f, distribution_type: e.target.value as PrizePotDistributionType | "winner_takes_all" })}
                          className={inputCls}
                        >
                          <option value="winner_takes_all">Winner Takes All</option>
                          <option value="position_based">By finishing position (custom splits)</option>
                          <option value="metric_weighted">Proportional to metric (e.g. number of twos)</option>
                          <option value="metric_equal">Equal split among qualifiers (e.g. anyone with a two)</option>
                          <option value="equal_split">Equal split (all enrolled players)</option>
                          <option value="non_monetary">Non-cash prize (trophy, voucher, etc.)</option>
                          <option value="entry_only">Entry collected, no payout</option>
                        </select>

                        {editPotForm.distribution_type === "winner_takes_all" && (
                          <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 px-3 py-2">
                            <div className="text-[11px] text-emerald-200/60">100% of the pot goes to 1st place.</div>
                          </div>
                        )}

                        {editPotForm.distribution_type === "position_based" && (
                          <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 px-3 py-2 space-y-2">
                            <div className="text-[10px] uppercase text-emerald-200/50">Payout Percentages</div>
                            {editPotForm.prize_table.map((row, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <span className="text-[11px] text-emerald-200/60 w-8 shrink-0">
                                  {i === 0 ? "1st" : i === 1 ? "2nd" : i === 2 ? "3rd" : `${i + 1}th`}
                                </span>
                                <NumberField
                                  allowDecimal
                                  min={0}
                                  max={100}
                                  nullable={false}
                                  fallback={0}
                                  value={row.pct}
                                  onValueChange={(v) => {
                                    const updated = editPotForm.prize_table.map((r, j) =>
                                      j === i ? { ...r, pct: v ?? 0 } : r
                                    );
                                    setEditPotForm((f) => f && { ...f, prize_table: updated });
                                  }}
                                  className="w-20 rounded-lg border border-emerald-900/60 bg-[#0b3b21]/60 px-2 py-1 text-sm text-emerald-50 text-center focus:outline-none"
                                />
                                <span className="text-[11px] text-emerald-200/40">%</span>
                                <button
                                  type="button"
                                  onClick={() => setEditPotForm((f) => f && { ...f, prize_table: f.prize_table.filter((_, j) => j !== i) })}
                                  className="ml-auto text-emerald-200/30 hover:text-red-400 text-sm"
                                >✕</button>
                              </div>
                            ))}
                            {(() => {
                              const total = editPotForm.prize_table.reduce((s, r) => s + r.pct, 0);
                              const remainder = 100 - total;
                              return (
                                <div className={`text-[10px] font-semibold ${total <= 100 ? "text-emerald-400" : "text-red-400"}`}>
                                  Paying out: {total}%{remainder > 0 ? ` · ${remainder}% retained by group` : ""}
                                  {total > 100 && " (over 100%)"}
                                </div>
                              );
                            })()}
                            <button
                              type="button"
                              onClick={() => setEditPotForm((f) => f && { ...f, prize_table: [...f.prize_table, { position: f.prize_table.length + 1, pct: 0 }] })}
                              className="text-[11px] text-emerald-300/60 hover:text-emerald-300"
                            >
                              + Add position
                            </button>
                          </div>
                        )}

                        {(editPotForm.distribution_type === "metric_weighted" || editPotForm.distribution_type === "metric_equal") && (
                          <select
                            value={editPotForm.metric_type}
                            onChange={(e) => setEditPotForm((f) => f && { ...f, metric_type: e.target.value })}
                            className={inputCls}
                          >
                            <option value="">Select metric type…</option>
                            <option value="twos">Two&apos;s Club (auto-calculated from scores)</option>
                            <option value="nearest_pin">Nearest Pin (manually recorded)</option>
                            <option value="longest_drive">Longest Drive (manually recorded)</option>
                            <option value="season_points">Season Points</option>
                            <option value="custom">Custom (manually recorded)</option>
                          </select>
                        )}

                        {editPotForm.distribution_type === "non_monetary" && (
                          <input
                            type="text"
                            placeholder="Prize description (e.g. Callaway Driver, £50 Voucher)"
                            value={editPotForm.prize_description}
                            onChange={(e) => setEditPotForm((f) => f && { ...f, prize_description: e.target.value, is_monetary: false })}
                            className={inputCls}
                          />
                        )}

                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="number"
                            placeholder="Entry fee per player (£, optional)"
                            value={editPotForm.entry_fee_amount}
                            onChange={(e) => setEditPotForm((f) => f && { ...f, entry_fee_amount: e.target.value })}
                            className={inputCls}
                            min="0"
                            step="0.01"
                          />
                          <input
                            type="text"
                            placeholder="Entry fee notes (optional)"
                            value={editPotForm.entry_fee_notes}
                            onChange={(e) => setEditPotForm((f) => f && { ...f, entry_fee_notes: e.target.value })}
                            className={inputCls}
                          />
                        </div>
                        <input
                          type="text"
                          placeholder="Description (optional)"
                          value={editPotForm.description}
                          onChange={(e) => setEditPotForm((f) => f && { ...f, description: e.target.value })}
                          className={inputCls}
                        />
                        <button
                          type="button"
                          onClick={() => setEditPotForm((f) => f && { ...f, is_mandatory: !f.is_mandatory })}
                          className="flex items-center justify-between w-full py-2 px-2 rounded-lg border border-emerald-900/40 hover:bg-emerald-900/20"
                        >
                          <div className="text-left">
                            <div className="text-[11px] font-semibold text-emerald-100">Mandatory</div>
                            <div className="text-[10px] text-emerald-200/40">Players are auto-enrolled when joining this event</div>
                          </div>
                          <div className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${editPotForm.is_mandatory ? "bg-emerald-600" : "bg-emerald-900/50"}`}>
                            <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${editPotForm.is_mandatory ? "translate-x-5" : ""}`} />
                          </div>
                        </button>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => { setEditPotId(null); setEditPotForm(null); setPotError(null); }}
                            className="flex-1 py-1.5 rounded-full border border-emerald-900/60 text-[11px] text-emerald-200/60"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={handleSavePot}
                            disabled={
                              savingPot ||
                              !editPotForm.name.trim() ||
                              (editPotForm.distribution_type === "position_based" && editPotForm.prize_table.reduce((s, r) => s + r.pct, 0) > 100)
                            }
                            className="flex-1 py-1.5 rounded-full bg-emerald-700 text-[11px] font-semibold text-white disabled:opacity-50"
                          >
                            {savingPot ? "Saving…" : "Save Changes"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Proposed distribution banner */}
                    {proposedDistribution?.potId === pot.id && (
                      <div className="border-t border-emerald-900/50 px-3 py-3 space-y-2 bg-amber-950/20">
                        <div className="text-[10px] font-semibold text-amber-200/80 uppercase tracking-wider">
                          Proposed Distribution — {currencySymbol}{proposedDistribution.total_pot.toFixed(2)} total
                        </div>
                        <div className="space-y-1">
                          {proposedDistribution.proposed.map((p, i) => (
                            <div key={i} className="flex items-center justify-between text-[11px]">
                              <span className="text-emerald-200/80">
                                {p.position ? `${p.position}. ` : ""}{p.profile?.name ?? p.profile_id}
                              </span>
                              <div className="text-right">
                                <span className="text-[#f5e6b0] font-semibold">
                                  {p.amount != null ? `${currencySymbol}${p.amount.toFixed(2)}` : pot.prize_description ?? "Prize"}
                                </span>
                                <span className="text-emerald-200/30 ml-1.5 text-[9px]">{p.note}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setProposedDistribution(null)}
                            className="flex-1 py-1.5 rounded-full border border-emerald-900/60 text-[11px] text-emerald-200/60"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleConfirmDistribution(pot.id)}
                            disabled={potActionLoading === pot.id + ":confirm"}
                            className="flex-1 py-1.5 rounded-full bg-amber-700/80 text-[11px] font-semibold text-white disabled:opacity-50"
                          >
                            {potActionLoading === pot.id + ":confirm" ? "Paying out…" : "Confirm & Pay Out"}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Expanded: entries + payouts */}
                    {isExpanded && (
                      <div className="border-t border-emerald-900/50 px-3 py-2.5 space-y-2">
                        {pot.entries.length > 0 && (
                          <>
                            <div className="text-[10px] text-emerald-200/40 font-semibold uppercase tracking-wider">Enrolled ({pot.entries.length})</div>
                            <div className="space-y-1">
                              {pot.entries.map((e) => (
                                <div key={e.id} className="flex items-center justify-between text-[11px]">
                                  <span className="text-emerald-200/80">{e.profile.name}</span>
                                  <div className="flex items-center gap-2 text-right">
                                    {e.metric_value != null && (
                                      <span className="text-purple-300/70">{e.metric_value} {pot.metric_type === "twos" ? "two's" : "pts"}</span>
                                    )}
                                    {pot.entry_fee_amount && pot.entry_fee_amount > 0 && (
                                      <span className="text-emerald-200/50">{currencySymbol}{e.amount_contributed.toFixed(2)}</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                        {pot.payouts.length > 0 && (
                          <>
                            <div className="text-[10px] text-emerald-200/40 font-semibold uppercase tracking-wider mt-2">Payouts</div>
                            <div className="space-y-1">
                              {pot.payouts.map((p) => (
                                <div key={p.id} className="flex items-center justify-between text-[11px]">
                                  <span className="text-emerald-200/80">{p.position ? `${p.position}. ` : ""}{p.profile.name}</span>
                                  <span className="text-[#f5e6b0] font-semibold">
                                    {p.amount != null ? `${currencySymbol}${p.amount.toFixed(2)}` : (pot.prize_description ?? "Prize")}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Add Prize Pot form */}
              {addPotForm && (
                <div className="rounded-xl border border-emerald-700/40 bg-[#0b3b21]/50 px-3 py-3 space-y-2">
                  <div className="text-[11px] font-semibold text-emerald-200">New Prize Pot</div>
                  <input
                    type="text"
                    placeholder="Name (e.g. Two's Club, Season FedEx Pot)"
                    value={addPotForm.name}
                    onChange={(e) => setAddPotForm((f) => f && { ...f, name: e.target.value })}
                    className={inputCls}
                  />
                  <select
                    value={addPotForm.distribution_type}
                    onChange={(e) => setAddPotForm((f) => f && { ...f, distribution_type: e.target.value as PrizePotDistributionType | "winner_takes_all" })}
                    className={inputCls}
                  >
                    <option value="winner_takes_all">Winner Takes All</option>
                    <option value="position_based">By finishing position (custom splits)</option>
                    <option value="metric_weighted">Proportional to metric (e.g. number of twos)</option>
                    <option value="metric_equal">Equal split among qualifiers (e.g. anyone with a two)</option>
                    <option value="equal_split">Equal split (all enrolled players)</option>
                    <option value="non_monetary">Non-cash prize (trophy, voucher, etc.)</option>
                    <option value="entry_only">Entry collected, no payout</option>
                  </select>

                  {/* Winner Takes All info */}
                  {addPotForm.distribution_type === "winner_takes_all" && (
                    <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 px-3 py-2">
                      <div className="text-[11px] text-emerald-200/60">100% of the pot goes to 1st place.</div>
                    </div>
                  )}

                  {/* Position-based prize table editor */}
                  {addPotForm.distribution_type === "position_based" && (
                    <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 px-3 py-2 space-y-2">
                      <div className="text-[10px] uppercase text-emerald-200/50">Payout Percentages</div>
                      {addPotForm.prize_table.map((row, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="text-[11px] text-emerald-200/60 w-8 shrink-0">
                            {i === 0 ? "1st" : i === 1 ? "2nd" : i === 2 ? "3rd" : `${i + 1}th`}
                          </span>
                          <NumberField
                            allowDecimal
                            min={0}
                            max={100}
                            nullable={false}
                            fallback={0}
                            value={row.pct}
                            onValueChange={(v) => {
                              const updated = addPotForm.prize_table.map((r, j) =>
                                j === i ? { ...r, pct: v ?? 0 } : r
                              );
                              setAddPotForm((f) => f && { ...f, prize_table: updated });
                            }}
                            className="w-20 rounded-lg border border-emerald-900/60 bg-[#0b3b21]/60 px-2 py-1 text-sm text-emerald-50 text-center focus:outline-none"
                          />
                          <span className="text-[11px] text-emerald-200/40">%</span>
                          <button
                            type="button"
                            onClick={() => setAddPotForm((f) => f && { ...f, prize_table: f.prize_table.filter((_, j) => j !== i) })}
                            className="ml-auto text-emerald-200/30 hover:text-red-400 text-sm"
                          >✕</button>
                        </div>
                      ))}
                      {(() => {
                        const total = addPotForm.prize_table.reduce((s, r) => s + r.pct, 0);
                        const remainder = 100 - total;
                        return (
                          <div className={`text-[10px] font-semibold ${total <= 100 ? "text-emerald-400" : "text-red-400"}`}>
                            Paying out: {total}%{remainder > 0 ? ` · ${remainder}% retained by group` : ""}
                            {total > 100 && " (over 100%)"}
                          </div>
                        );
                      })()}
                      <button
                        type="button"
                        onClick={() => setAddPotForm((f) => f && { ...f, prize_table: [...f.prize_table, { position: f.prize_table.length + 1, pct: 0 }] })}
                        className="text-[11px] text-emerald-300/60 hover:text-emerald-300"
                      >
                        + Add position
                      </button>
                    </div>
                  )}

                  {(addPotForm.distribution_type === "metric_weighted" || addPotForm.distribution_type === "metric_equal") && (
                    <select
                      value={addPotForm.metric_type}
                      onChange={(e) => setAddPotForm((f) => f && { ...f, metric_type: e.target.value })}
                      className={inputCls}
                    >
                      <option value="">Select metric type…</option>
                      <option value="twos">Two's Club (auto-calculated from scores)</option>
                      <option value="nearest_pin">Nearest Pin (manually recorded)</option>
                      <option value="longest_drive">Longest Drive (manually recorded)</option>
                      <option value="season_points">Season Points</option>
                      <option value="custom">Custom (manually recorded)</option>
                    </select>
                  )}

                  {addPotForm.distribution_type === "non_monetary" && (
                    <input
                      type="text"
                      placeholder="Prize description (e.g. Callaway Driver, £50 Voucher)"
                      value={addPotForm.prize_description}
                      onChange={(e) => setAddPotForm((f) => f && { ...f, prize_description: e.target.value, is_monetary: false })}
                      className={inputCls}
                    />
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      placeholder="Entry fee per player (£, optional)"
                      value={addPotForm.entry_fee_amount}
                      onChange={(e) => setAddPotForm((f) => f && { ...f, entry_fee_amount: e.target.value })}
                      className={inputCls}
                      min="0"
                      step="0.01"
                    />
                    <input
                      type="text"
                      placeholder="Entry fee notes (optional)"
                      value={addPotForm.entry_fee_notes}
                      onChange={(e) => setAddPotForm((f) => f && { ...f, entry_fee_notes: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Description (optional)"
                    value={addPotForm.description}
                    onChange={(e) => setAddPotForm((f) => f && { ...f, description: e.target.value })}
                    className={inputCls}
                  />
                  {/* Mandatory toggle */}
                  <button
                    type="button"
                    onClick={() => setAddPotForm((f) => f && { ...f, is_mandatory: !f.is_mandatory })}
                    className="flex items-center justify-between w-full py-2 px-2 rounded-lg border border-emerald-900/40 hover:bg-emerald-900/20"
                  >
                    <div className="text-left">
                      <div className="text-[11px] font-semibold text-emerald-100">Mandatory</div>
                      <div className="text-[10px] text-emerald-200/40">Players are auto-enrolled when joining this event</div>
                    </div>
                    <div className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${addPotForm.is_mandatory ? "bg-emerald-600" : "bg-emerald-900/50"}`}>
                      <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${addPotForm.is_mandatory ? "translate-x-5" : ""}`} />
                    </div>
                  </button>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setAddPotForm(null); setPotError(null); }}
                      className="flex-1 py-1.5 rounded-full border border-emerald-900/60 text-[11px] text-emerald-200/60">
                      Cancel
                    </button>
                    <button type="button" onClick={handleAddPot} disabled={addingPot}
                      className="flex-1 py-1.5 rounded-full bg-emerald-700 text-[11px] font-semibold text-white disabled:opacity-50">
                      {addingPot ? "Creating…" : "Create Prize Pot"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      );
    })(),

    winnings: (
      <div className="space-y-4">
        {/* Admin: propose / confirm winnings */}
        {isAdminOrOwner && event?.majors_status === "completed" && (event as any).prize_table && (
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

  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <div className="text-sm text-emerald-100/60">Loading…</div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-4">
        <div className="text-sm text-emerald-100/60">Event not found.</div>
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
        <button
          type="button"
          onClick={() => {
            if (fromHome && event?.group_id) {
              router.replace(`/majors/groups/${event.group_id}`);
            } else {
              router.back();
            }
          }}
          className="text-[11px] text-emerald-100/70 hover:text-emerald-50"
        >
          ← Back
        </button>
        <div className="w-14" />
      </div>

      {/* Hero section */}
      <div className="px-4 mb-4 space-y-2">
        {event.group && (
          <button
            type="button"
            onClick={() => router.push(`/majors/groups/${event.group!.id}`)}
            className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-emerald-200/55 hover:text-emerald-200 border border-emerald-900/50 rounded-full px-2.5 py-1 transition-colors"
          >
            {event.group.name}
            {event.group.ciaga_tag !== "none" && (
              <span className="text-amber-300/70 ml-1">{event.group.ciaga_tag}</span>
            )}
          </button>
        )}
        <h1 className="text-xl font-bold text-[#f5e6b0] leading-tight">{event.name}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] font-medium px-2.5 py-1 rounded-full border capitalize ${statusColour}`}>
            {event.majors_status}
          </span>
          {event.event_date && (
            <span className="text-[11px] text-emerald-100/60">
              {new Date(event.event_date).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
            </span>
          )}
          {event.course && (
            <span className="text-[11px] text-emerald-100/60">· {event.course.name}</span>
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

      {showSetupSheet && event && (
        <EventSetupSheet
          event={event}
          eventRounds={eventRounds}
          teeTimes={teeTimes}
          hasEntries={participants.length > 0}
          onClose={() => setShowSetupSheet(false)}
          onSaved={(updated) => {
            setCompetition(updated);
            setShowSetupSheet(false);
            refreshTeeTimes();
          }}
        />
      )}

      {showAddTeeTime && (
        <AddTeeTimeSheet
          eventId={eventId}
          courseId={event.course_id ?? null}
          groupMembers={groupMembers}
          entrantProfileIds={new Set(participants.map((p) => p.profile_id))}
          entryFeeAmount={(event as any).entry_fee_amount ?? null}
          entryFeeCurrency={(event as any).entry_fee_currency ?? "GBP"}
          teeTimes={teeTimes}
          eventRounds={eventRounds}
          onClose={() => setShowAddTeeTime(false)}
          onCreated={refreshTeeTimes}
        />
      )}

      {editingTeeTime && (
        <EditTeeTimeSheet
          eventId={eventId}
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
          eventId={eventId}
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
                <div className="text-sm font-semibold text-red-100">Withdraw from {event.name}?</div>
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
