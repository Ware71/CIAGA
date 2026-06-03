"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { supabase } from "@/lib/supabaseClient";
import { InvitePlayerSheet } from "@/app/majors/groups/InvitePlayerSheet";
import type {
  MajorGroup,
  MajorGroupMembershipWithProfile,
  EventWithGroup,
  Competition,
  CompetitionEventTemplate,
  MemberBalanceSummary,
  GroupBalanceTransactionWithDetails,
} from "@/lib/majors/types";
import type { LiveGroupStandingEntry, LiveGroupStandingsResponse } from "@/app/api/majors/groups/[id]/live-standings/route";
import type { CompetitionResultsResponse } from "@/app/api/majors/groups/[id]/event-results/route";
import type { PlayerBreakdownEntry } from "@/app/api/majors/group-seasons/[id]/player-breakdown/route";
import type { SeasonStandingEntry } from "@/app/api/majors/group-seasons/[id]/standings/route";
import type { GroupScoringPrefs } from "@/lib/majors/types";
import { eventStatusLabel } from "@/lib/majors/labels";
import { formatHI } from "@/lib/rounds/handicapUtils";
import { EVENT_TYPES, FORMAT_DEFAULT_SCORING, FORMAT_ALLOWS_SCORING_CHOICE } from "@/lib/events/constants";
import type { MajorGroupType, EventTypeV2 } from "@/lib/majors/types";

type CompetitionSeriesWithEventCount = Competition & {
  event_templates: Pick<CompetitionEventTemplate, "id">[];
  current_holder: { name: string | null; avatar_url: string | null } | null;
  latest_season: { id: string; season_label: string; status: string } | null;
};

type Tab = "overview" | "events" | "standings" | "seasons" | "schedule" | "history" | "competitions" | "members" | "finances" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "standings", label: "Standings" },
  { id: "events", label: "Events" },
  { id: "competitions", label: "Competitions" },
  { id: "seasons", label: "Seasons" },
  { id: "members", label: "Members" },
  { id: "finances", label: "Finances" },
  { id: "settings", label: "Settings" },
];


type GroupData = MajorGroup & { member_count: number };

const ACCESS_OPTIONS = [
  { value: "open",    label: "Open",            desc: "Anyone can find and join instantly.",          privacy: "public" as const,      join_method: "open" as const },
  { value: "request", label: "Request to Join", desc: "Discoverable, but joining requires approval.", privacy: "request" as const,     join_method: "request" as const },
  { value: "private", label: "Private",         desc: "Join by invitation or shared code only.",      privacy: "invite_only" as const, join_method: "code" as const },
];

const MATCHPLAY_GROUP_TYPES = new Set<MajorGroupType>(["matchplay_series", "matchplay_knockout"]);

function getFormatsForGroupType(type: MajorGroupType) {
  if (MATCHPLAY_GROUP_TYPES.has(type))
    return EVENT_TYPES.filter((t) => t.value === "matchplay");
  return EVENT_TYPES.filter((t) =>
    ["stroke", "stableford", "skins", "scramble", "bestball", "custom"].includes(t.value)
  );
}

function deriveAccess(g: GroupData): string {
  if (g.privacy === "public") return "open";
  if (g.privacy === "request") return "request";
  return "private";
}

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

const TEE_PRESETS = ["White", "Yellow", "Red", "Blue", "Gold", "Black", "Ladies", "Junior"];

function MemberDetailDrawer({
  member,
  isAdminOrOwner,
  myRole,
  myProfileId,
  onRoleToggle,
  onTeePrefSave,
  onTournamentIndexSave,
  onNavigate,
  onClose,
}: {
  member: MajorGroupMembershipWithProfile;
  isAdminOrOwner: boolean;
  myRole: string | null;
  myProfileId: string | null;
  onRoleToggle: () => void;
  onTeePrefSave: (tee: string | null) => Promise<void>;
  onTournamentIndexSave: (index: number | null) => Promise<void>;
  onNavigate: () => void;
  onClose: () => void;
}) {
  const [teeValue, setTeeValue] = useState(member.preferred_tee_name ?? "");
  const [teeSaving, setTeeSaving] = useState(false);
  const [tiValue, setTiValue] = useState(
    member.tournament_index != null ? String(member.tournament_index) : ""
  );
  const [tiSaving, setTiSaving] = useState(false);

  const roleCls =
    member.role === "owner"
      ? "text-[#f5e6b0] border-[#f5e6b0]/30 bg-[#f5e6b0]/10"
      : member.role === "admin"
      ? "text-emerald-300 border-emerald-700/50 bg-emerald-900/30"
      : "text-emerald-200/50 border-emerald-900/50 bg-transparent";

  const handleTeeSave = async () => {
    setTeeSaving(true);
    try {
      await onTeePrefSave(teeValue.trim() || null);
    } finally {
      setTeeSaving(false);
    }
  };

  const handleTiSave = async () => {
    setTiSaving(true);
    try {
      const parsed = tiValue.trim() === "" ? null : parseFloat(tiValue);
      if (parsed !== null && isNaN(parsed)) return;
      await onTournamentIndexSave(parsed);
    } finally {
      setTiSaving(false);
    }
  };

  const memberSince = member.joined_at
    ? new Date(member.joined_at).toLocaleDateString([], { month: "short", year: "numeric" })
    : null;

  const displayedHI =
    member.tournament_index != null
      ? { value: formatHI(member.tournament_index), label: "Tournament Index", isTournament: true }
      : member.handicap_index != null
      ? { value: formatHI(member.handicap_index), label: "Handicap Index", isTournament: false }
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full max-w-sm mx-auto bg-[#071f13] rounded-t-2xl border-t border-emerald-900/70 px-4 pt-5 pb-[env(safe-area-inset-bottom)] space-y-4 max-h-[80dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full bg-emerald-800/60 mx-auto mb-1" />

        {/* Header */}
        <div className="flex items-center gap-3">
          {member.profile?.avatar_url ? (
            <img src={member.profile.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover shrink-0" />
          ) : (
            <div className="h-12 w-12 rounded-full bg-emerald-900/60 grid place-items-center text-sm font-bold text-emerald-200 shrink-0">
              {member.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-emerald-50 truncate">{member.profile?.name ?? member.profile_id}</div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border capitalize ${roleCls}`}>
                {member.role}
              </span>
              {member.has_participated ? (
                memberSince && <span className="text-[10px] text-emerald-200/50">Since {memberSince}</span>
              ) : (
                <span className="text-[10px] text-emerald-200/40 italic">New member</span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 grid place-items-center rounded-full border border-emerald-900/60 text-emerald-200/60 hover:text-emerald-100 shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Handicap card */}
        <div className="w-full rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 text-center">
          <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
            {displayedHI ? displayedHI.label : "Handicap Index"}
          </div>
          <div className="mt-1 text-2xl font-semibold text-emerald-50">
            {displayedHI ? displayedHI.value : "—"}
          </div>
          {displayedHI?.isTournament && (
            <div className="mt-1 text-[10px] text-amber-300/70">Manual adjustment applied</div>
          )}
        </div>

        {/* Tournament index override (admin/owner only) */}
        {isAdminOrOwner && (
          <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-3 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-emerald-200/50">Tournament Index Override</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                step="0.1"
                min="-10"
                max="54"
                placeholder="e.g. 14.2 (blank to clear)"
                value={tiValue}
                onChange={(e) => setTiValue(e.target.value)}
                className="flex-1 rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-200/30 focus:outline-none focus:border-emerald-600 [color-scheme:dark]"
                disabled={tiSaving}
              />
              <button
                type="button"
                onClick={handleTiSave}
                disabled={tiSaving}
                className="px-3 py-2 rounded-xl bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50 shrink-0"
              >
                {tiSaving ? "…" : "Set"}
              </button>
            </div>
          </div>
        )}

        {/* Tee preference */}
        <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-3 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-emerald-200/50">Preferred Tee</div>
          {isAdminOrOwner ? (
            <div className="flex items-center gap-2">
              <select
                value={teeValue}
                onChange={(e) => setTeeValue(e.target.value)}
                className="flex-1 rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-2 py-1.5 text-[11px] text-emerald-50 focus:outline-none focus:border-emerald-600 [color-scheme:dark]"
                disabled={teeSaving}
              >
                <option value="">— not set —</option>
                {TEE_PRESETS.map((t) => <option key={t} value={t}>{t}</option>)}
                {teeValue && !TEE_PRESETS.includes(teeValue) && (
                  <option value={teeValue}>{teeValue}</option>
                )}
              </select>
              <button
                type="button"
                onClick={handleTeeSave}
                disabled={teeSaving}
                className="px-3 py-2 rounded-xl bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50 shrink-0"
              >
                {teeSaving ? "…" : "Save"}
              </button>
            </div>
          ) : (
            <div className="text-sm text-emerald-100/80">
              {member.preferred_tee_name ?? <span className="text-emerald-100/40">Not set</span>}
            </div>
          )}
        </div>

        {/* Role toggle (owner only) */}
        {isAdminOrOwner && member.role !== "owner" && member.profile_id !== myProfileId && myRole === "owner" && (
          <button
            type="button"
            onClick={() => { onRoleToggle(); onClose(); }}
            className="w-full py-2 rounded-full border border-emerald-800/60 text-[11px] text-emerald-300/70 hover:text-emerald-200 hover:border-emerald-700/60"
          >
            {member.role === "admin" ? "Remove Admin" : "Make Admin"}
          </button>
        )}

        {/* View profile */}
        <button
          type="button"
          onClick={onNavigate}
          className="w-full py-2.5 rounded-full border border-emerald-700/50 text-sm text-emerald-200 hover:bg-emerald-900/30"
        >
          View Profile →
        </button>
      </div>
    </div>
  );
}

function MemberRow({
  member,
  isAdminOrOwner,
  myRole,
  myProfileId,
  onRoleToggle,
  onTeePrefSave,
  onTournamentIndexSave,
  onNavigate,
}: {
  member: MajorGroupMembershipWithProfile;
  isAdminOrOwner: boolean;
  myRole: string | null;
  myProfileId: string | null;
  onRoleToggle: () => void;
  onTeePrefSave: (tee: string | null) => Promise<void>;
  onTournamentIndexSave: (index: number | null) => Promise<void>;
  onNavigate: () => void;
}) {
  const [showDrawer, setShowDrawer] = useState(false);

  const roleCls =
    member.role === "owner"
      ? "text-[#f5e6b0] border-[#f5e6b0]/30 bg-[#f5e6b0]/10"
      : member.role === "admin"
      ? "text-emerald-300 border-emerald-700/50 bg-emerald-900/30"
      : "text-emerald-200/50 border-emerald-900/50 bg-transparent";

  const memberSince = member.joined_at
    ? new Date(member.joined_at).toLocaleDateString([], { month: "short", year: "numeric" })
    : null;

  const hiDisplay =
    member.tournament_index != null
      ? { text: formatHI(member.tournament_index), cls: "text-amber-300/80 border-amber-800/40 bg-amber-900/20", label: "T" }
      : member.handicap_index != null
      ? { text: formatHI(member.handicap_index), cls: "text-emerald-200/70 border-emerald-900/50 bg-transparent", label: null }
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setShowDrawer(true)}
        className="w-full rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5 text-left hover:brightness-110 transition-all"
      >
        <div className="flex items-center gap-3">
          {member.profile?.avatar_url ? (
            <img src={member.profile.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover shrink-0" />
          ) : (
            <div className="h-9 w-9 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">
              {member.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-emerald-50 truncate">
              {member.profile?.name ?? member.profile_id}
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              {member.has_participated ? (
                memberSince && <span className="text-[10px] text-emerald-200/40">Since {memberSince}</span>
              ) : (
                <span className="text-[10px] text-emerald-200/35 italic">New member</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {hiDisplay && (
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${hiDisplay.cls}`}>
                {hiDisplay.label && <span className="mr-0.5 opacity-70">{hiDisplay.label}</span>}
                {hiDisplay.text}
              </span>
            )}
            <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border capitalize ${roleCls}`}>
              {member.role}
            </span>
          </div>
        </div>
      </button>

      {showDrawer && (
        <MemberDetailDrawer
          member={member}
          isAdminOrOwner={isAdminOrOwner}
          myRole={myRole}
          myProfileId={myProfileId}
          onRoleToggle={onRoleToggle}
          onTeePrefSave={onTeePrefSave}
          onTournamentIndexSave={onTournamentIndexSave}
          onNavigate={onNavigate}
          onClose={() => setShowDrawer(false)}
        />
      )}
    </>
  );
}

export default function GroupDetailClient({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [compSubTab, setCompSubTab] = useState<"active" | "completed">("active");
  const [showCancelled, setShowCancelled] = useState(false);
  const [group, setGroup] = useState<GroupData | null>(null);
  const [events, setEvents] = useState<EventWithGroup[]>([]);
  const [liveStandingsData, setLiveStandingsData] = useState<LiveGroupStandingsResponse | null>(null);
  const [members, setMembers] = useState<MajorGroupMembershipWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinedStatus, setJoinedStatus] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [competitions, setCompetitions] = useState<CompetitionSeriesWithEventCount[]>([]);
  const [balanceMembers, setBalanceMembers] = useState<MemberBalanceSummary[]>([]);
  const [myBalance, setMyBalance] = useState<{ balance: number; total_charged: number; total_paid: number; transactions: GroupBalanceTransactionWithDetails[] } | null>(null);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  // Payment record modal
  const [paymentModal, setPaymentModal] = useState<{ profileId: string; name: string } | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  // Withdrawal modal
  const [withdrawalModal, setWithdrawalModal] = useState<{ profileId: string; name: string; maxAmount: number } | null>(null);
  const [withdrawalAmount, setWithdrawalAmount] = useState("");
  const [withdrawalSubmitting, setWithdrawalSubmitting] = useState(false);
  // Winnings summary
  const [winningSummaries, setWinningSummaries] = useState<any[]>([]);
  const [winningsLoaded, setWinningsLoaded] = useState(false);
  const [winningsPlayer, setWinningsPlayer] = useState<any | null>(null);
  // Group charges (for settings tab)
  const [groupCharges, setGroupCharges] = useState<any[]>([]);
  const [groupChargesLoaded, setGroupChargesLoaded] = useState(false);
  const [addGroupChargeForm, setAddGroupChargeForm] = useState<{ name: string; amount: string; category: string; description: string; is_mandatory: boolean } | null>(null);
  const [savingGroupCharge, setSavingGroupCharge] = useState(false);
  const [standingsMetric, setStandingsMetric] = useState<"points" | "strokes" | "avg">("points");
  const [sortField, setSortField] = useState<"net" | "gross">("net");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  // Standings tab – historical season view
  const [standingsSeasonId, setStandingsSeasonId] = useState<string | "current">("current");
  const [standingsHistoricalData, setStandingsHistoricalData] = useState<SeasonStandingEntry[]>([]);
  const [standingsHistoricalLoading, setStandingsHistoricalLoading] = useState(false);
  const [competitionResults, setCompetitionResults] = useState<CompetitionResultsResponse | null>(null);
  // Seasons tab
  const [groupSeasons, setGroupSeasons] = useState<any[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | "all">("all");
  const [seasonStandings, setSeasonStandings] = useState<SeasonStandingEntry[]>([]);
  const [seasonStandingsLoading, setSeasonStandingsLoading] = useState(false);
  const [seasonMetric, setSeasonMetric] = useState<"outrights" | "points" | "strokes" | "avg">("outrights");
  // Create season modal
  const [showCreateSeason, setShowCreateSeason] = useState(false);
  const [createSeasonForm, setCreateSeasonForm] = useState<{ season_type: "calendar_year" | "custom"; year: string; name: string; start_date: string; end_date: string; standings_model: string }>({ season_type: "calendar_year", year: String(new Date().getFullYear()), name: "", start_date: "", end_date: "", standings_model: "none" });
  const [creatingSeason, setCreatingSeason] = useState(false);
  const [createSeasonError, setCreateSeasonError] = useState<string | null>(null);
  // League settings
  const [leagueSettingsForm, setLeagueSettingsForm] = useState<GroupScoringPrefs | null>(null);
  const [savingLeagueSettings, setSavingLeagueSettings] = useState(false);
  // Group details
  const [groupDetailsForm, setGroupDetailsForm] = useState<{
    name: string; description: string; access: string; max_members: string;
  } | null>(null);
  const [savingGroupDetails, setSavingGroupDetails] = useState(false);
  // Player detail drawer
  const [selectedPlayerForDrawer, setSelectedPlayerForDrawer] = useState<{ profileId: string; name: string; avatarUrl: string | null; currentSeasonId: string | null; seasonLabel?: string } | null>(null);
  const [playerBreakdownEntries, setPlayerBreakdownEntries] = useState<PlayerBreakdownEntry[]>([]);
  const [playerBreakdownLoading, setPlayerBreakdownLoading] = useState(false);

  const handleSort = (field: "net" | "gross") => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };
  const sortHeader = (label: string, field: "net" | "gross") => (
    <button type="button" onClick={() => handleSort(field)}
      className={`text-[10px] w-12 text-right flex items-center justify-end gap-0.5 ${sortField === field ? "text-emerald-200/70" : "text-emerald-200/30"}`}>
      {label}
      {sortField === field && <span className="text-[9px]">{sortDir === "asc" ? "↑" : "↓"}</span>}
    </button>
  );

  const handleStandingsSeasonChange = async (id: string) => {
    setStandingsSeasonId(id);
    if (id === "current") { setStandingsHistoricalData([]); return; }
    setStandingsHistoricalLoading(true);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/group-seasons/${id}/standings`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (res.ok) {
        const j = await res.json();
        setStandingsHistoricalData(j.standings ?? []);
      }
    } finally {
      setStandingsHistoricalLoading(false);
    }
  };


  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const session = await getViewerSession();
        if (!session || cancelled) return;
        setMyProfileId(session.profileId);
        const headers = { Authorization: `Bearer ${session.accessToken}` };

        const [groupRes, compsRes, standingsRes, membersRes, competitionsRes, seasonsRes, resultsRes] = await Promise.all([
          fetch(`/api/majors/groups/${groupId}`, { headers }),
          fetch(`/api/majors/events?group_id=${groupId}`, { headers }),
          fetch(`/api/majors/groups/${groupId}/live-standings`, { headers }),
          fetch(`/api/majors/groups/${groupId}/members`, { headers }),
          fetch(`/api/majors/competitions?group_id=${groupId}`, { headers }),
          fetch(`/api/majors/groups/${groupId}/seasons`, { headers }),
          fetch(`/api/majors/groups/${groupId}/event-results`, { headers }),
        ]);

        if (cancelled) return;
        if (groupRes.ok) {
          const j = await groupRes.json();
          setGroup(j.group);
        }
        if (compsRes.ok) {
          const j = await compsRes.json();
          setEvents(j.events ?? []);
        }
        if (standingsRes.ok) {
          const j: LiveGroupStandingsResponse = await standingsRes.json();
          setLiveStandingsData(j);
        }
        if (membersRes.ok) {
          const j = await membersRes.json();
          const mems: MajorGroupMembershipWithProfile[] = j.members ?? [];
          setMembers(mems);
          const own = mems.find((m) => m.profile_id === session.profileId);
          setMyRole(own?.role ?? null);
          setJoinedStatus(own?.status ?? null);
        }
        if (competitionsRes.ok) {
          const j = await competitionsRes.json();
          setCompetitions(j.competitions ?? []);
        }
        if (seasonsRes.ok) {
          const j = await seasonsRes.json();
          setGroupSeasons(j.seasons ?? []);
        }
        if (resultsRes.ok) {
          const j: CompetitionResultsResponse = await resultsRes.json();
          setCompetitionResults(j);
        }

      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [groupId]);

  // Lazy-load finances when the tab is first opened
  useEffect(() => {
    if (tab !== "finances") return;
    let cancelled = false;
    (async () => {
      const session = await getViewerSession();
      if (!session || cancelled) return;
      const headers = { Authorization: `Bearer ${session.accessToken}` };
      const isAdmin = myRole === "owner" || myRole === "admin";

      if (isAdmin) {
        const [balRes, winRes] = await Promise.all([
          fetch(`/api/majors/groups/${groupId}/balances`, { headers }),
          fetch(`/api/majors/groups/${groupId}/winnings`, { headers }),
        ]);
        if (!cancelled && balRes.ok) {
          const j = await balRes.json();
          setBalanceMembers(j.members ?? []);
        }
        if (!cancelled && winRes.ok) {
          const j = await winRes.json();
          setWinningSummaries(j.members ?? []);
          setWinningsLoaded(true);
        }
      } else {
        const res = await fetch(`/api/majors/groups/${groupId}/balance`, { headers });
        if (!cancelled && res.ok) {
          const j = await res.json();
          setMyBalance(j);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [tab, groupId, myRole]);

  // Lazy-load group charges when settings tab is first opened
  useEffect(() => {
    if (tab !== "settings" || groupChargesLoaded) return;
    let cancelled = false;
    (async () => {
      const session = await getViewerSession();
      if (!session || cancelled) return;
      const res = await fetch(`/api/majors/groups/${groupId}/group-charges`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (!cancelled && res.ok) {
        const j = await res.json();
        setGroupCharges(j.charges ?? []);
        setGroupChargesLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, groupId, groupChargesLoaded]);

  const refreshMembers = async () => {
    const session = await getViewerSession();
    if (!session) return;
    const res = await fetch(`/api/majors/groups/${groupId}/members`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (res.ok) {
      const j = await res.json();
      setMembers(j.members ?? []);
    }
  };

  const refreshLiveStandings = async () => {
    const session = await getViewerSession();
    if (!session) return;
    const res = await fetch(`/api/majors/groups/${groupId}/live-standings`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (res.ok) {
      const j: LiveGroupStandingsResponse = await res.json();
      setLiveStandingsData(j);
    }
  };

  // Realtime: refresh live standings whenever major_group_standings changes
  // (fired by ciaga_compute_group_standings cascade on round finish / competition complete)
  useEffect(() => {
    let cancelled = false;
    const channel = supabase
      .channel(`group-standings:${groupId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "major_group_standings",
        filter: `group_id=eq.${groupId}`,
      }, () => { if (!cancelled) refreshLiveStandings(); })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: per-hole live updates via round_score_events (debounced 800ms)
  useEffect(() => {
    const ids = liveStandingsData?.liveRoundIds ?? [];
    if (!ids.length) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefresh = () => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { if (!cancelled) refreshLiveStandings(); }, 800);
    };
    const channels = ids.map((roundId) =>
      supabase
        .channel(`live-scores:${groupId}:${roundId}`)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "round_score_events",
          filter: `round_id=eq.${roundId}`,
        }, debouncedRefresh)
        .subscribe()
    );
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      channels.forEach((ch) => supabase.removeChannel(ch));
    };
  }, [liveStandingsData?.liveRoundIds?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: event_leaderboard_entries — catches when a round finishes
  // and ciaga_compute_competition_leaderboard() rewrites entries for a live competition
  useEffect(() => {
    const compIds = liveStandingsData?.liveCompetitionIds ?? [];
    if (!compIds.length) return;
    let cancelled = false;
    const channels = compIds.map((compId) =>
      supabase
        .channel(`live-leaderboard:${groupId}:${compId}`)
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "event_leaderboard_entries",
          filter: `event_id=eq.${compId}`,
        }, () => { if (!cancelled) refreshLiveStandings(); })
        .subscribe()
    );
    return () => {
      cancelled = true;
      channels.forEach((ch) => supabase.removeChannel(ch));
    };
  }, [liveStandingsData?.liveCompetitionIds?.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load player breakdown when drawer opens
  useEffect(() => {
    if (!selectedPlayerForDrawer) { setPlayerBreakdownEntries([]); return; }
    const { profileId, currentSeasonId } = selectedPlayerForDrawer;
    let cancelled = false;
    setPlayerBreakdownLoading(true);
    (async () => {
      const session = await getViewerSession();
      if (!session || cancelled) return;
      const url = currentSeasonId
        ? `/api/majors/group-seasons/${currentSeasonId}/player-breakdown?profile_id=${profileId}`
        : `/api/majors/groups/${groupId}/player-breakdown?profile_id=${profileId}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${session.accessToken}` } });
      if (!cancelled && res.ok) {
        const j = await res.json();
        setPlayerBreakdownEntries(j.entries ?? []);
      }
      if (!cancelled) setPlayerBreakdownLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedPlayerForDrawer?.profileId, selectedPlayerForDrawer?.currentSeasonId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleJoin = async () => {
    setJoining(true);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/groups/${groupId}/join`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const j = await res.json();
        setJoinedStatus(j.membership?.status ?? "active");
        setMyRole("member");
      }
    } finally {
      setJoining(false);
    }
  };

  const handleTournamentIndex = async (profileId: string, index: number | null) => {
    const session = await getViewerSession();
    if (!session) return;
    await fetch(`/api/majors/groups/${groupId}/members`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: profileId, tournament_index: index }),
    });
    await refreshMembers();
  };

  const handleMemberAction = async (memberId: string, updates: { status?: string; role?: string }) => {
    const session = await getViewerSession();
    if (!session) return;
    await fetch(`/api/majors/groups/${groupId}/members/${memberId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    await refreshMembers();
  };

  const handleDeclineMember = async (profileId: string) => {
    const session = await getViewerSession();
    if (!session) return;
    await fetch(`/api/majors/groups/${groupId}/members?profile_id=${profileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    await refreshMembers();
  };

  const handleImageUpload = async (file: File) => {
    setUploadingImage(true);
    try {
      const { supabase } = await import("@/lib/supabaseClient");
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `groups/${groupId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("group-images")
        .upload(path, file, { cacheControl: "3600", upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from("group-images").getPublicUrl(path);
      const session = await getViewerSession();
      if (!session) throw new Error("Not authenticated");
      const res = await fetch(`/api/majors/groups/${groupId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ image_url: urlData.publicUrl }),
      });
      if (!res.ok) throw new Error("Failed to update group");
      const j = await res.json();
      setGroup((prev) => prev ? { ...prev, image_url: j.group.image_url } : prev);
    } catch (err) {
      console.error(err);
    } finally {
      setUploadingImage(false);
    }
  };

  const isAdminOrOwner = myRole === "owner" || myRole === "admin";
  const isMember = !!myRole;
  const sortByDateDesc = (a: EventWithGroup, b: EventWithGroup) => {
    const da = a.event_date ?? "";
    const db = b.event_date ?? "";
    return db < da ? -1 : db > da ? 1 : 0;
  };
  const upcomingComps = events
    .filter((c) => c.majors_status === "upcoming" || c.majors_status === "live")
    .sort(sortByDateDesc);
  const completedComps = events
    .filter((c) => c.majors_status === "completed" || c.majors_status === "cancelled")
    .sort(sortByDateDesc);
  const cancelledCount = completedComps.filter((c) => c.majors_status === "cancelled").length;
  const visibleCompletedComps = showCancelled
    ? completedComps
    : completedComps.filter((c) => c.majors_status !== "cancelled");

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <div className="text-sm text-emerald-100/60">Loading…</div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 px-4">
        <div className="text-sm text-emerald-100/60">Group not found.</div>
        <button type="button" onClick={() => router.push("/majors")} className="text-sm text-emerald-200 underline">
          Back to Hub
        </button>
      </div>
    );
  }

  const compStatusColour = (status: string) =>
    status === "live"
      ? "border-amber-800/50 bg-amber-900/20"
      : status === "completed"
      ? "border-emerald-800/40 bg-emerald-900/20"
      : status === "cancelled"
      ? "border-red-900/40 bg-red-950/20"
      : "border-emerald-900/70 bg-[#0b3b21]/80";

  const compStatusBadge = (status: string) =>
    status === "live"
      ? "bg-amber-900/50 text-amber-300 border-amber-800/50"
      : status === "completed"
      ? "bg-emerald-900/60 text-emerald-300 border-emerald-800/50"
      : status === "cancelled"
      ? "bg-red-950/50 text-red-400/80 border-red-900/50"
      : "bg-emerald-900/40 text-emerald-200/70 border-emerald-900/60";

  const roleBadge = (role: string) =>
    role === "owner"
      ? "text-[#f5e6b0] border-[#f5e6b0]/30 bg-[#f5e6b0]/10"
      : role === "admin"
      ? "text-emerald-300 border-emerald-700/50 bg-emerald-900/30"
      : "text-emerald-200/50 border-emerald-900/50 bg-transparent";

  const pendingMembers = members.filter((m) => m.status === "pending");
  const invitedMembers = members.filter((m) => m.status === "invited");
  const activeMembers = members.filter((m) => m.status === "active");

  const tabContent: Record<Tab, React.ReactNode> = {
    overview: (
      <div className="space-y-3">
        {group.description && (
          <p className="text-[13px] text-emerald-100/75 leading-relaxed">{group.description}</p>
        )}

        {/* Standings preview — current season top 3 */}
        {(liveStandingsData?.rows?.length ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => setTab("standings")}
            className="w-full rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/70 px-3 py-3 text-left hover:bg-emerald-900/30 transition-colors"
          >
            <div className="flex items-center justify-between mb-1">
              <div className="text-[10px] text-emerald-200/50 uppercase tracking-wider">Standings</div>
              <span className="text-[10px] text-emerald-400/80">View all →</span>
            </div>
            {liveStandingsData?.current_season && (
              <div className="text-[10px] text-emerald-300/60 mb-2">
                {liveStandingsData.current_season.season_label}
              </div>
            )}
            <div className="space-y-1.5">
              {(liveStandingsData?.rows ?? []).slice(0, 3).map((s, i) => {
                const pos = s.live_position ?? s.confirmed_position;
                return (
                  <div key={s.profile_id} className="flex items-center gap-2">
                    <span className={`w-5 text-center text-[11px] font-bold ${i === 0 ? "text-[#f5e6b0]" : i === 1 ? "text-[#c0c0c0]" : "text-[#cd7f32]"}`}>{pos}</span>
                    <span className="flex-1 text-[12px] font-semibold text-emerald-100 truncate">{s.profile?.name ?? "—"}</span>
                    <span className="text-[11px] text-emerald-200/60">{s.confirmed_points} pts</span>
                  </div>
                );
              })}
            </div>
          </button>
        )}

        {/* Shortcut cards grid */}
        <div className="grid grid-cols-2 gap-2">
          {/* Type — static */}
          <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5">
            <div className="text-[10px] text-emerald-200/50 uppercase tracking-wider mb-0.5">Type</div>
            <div className="text-sm font-semibold text-emerald-50 capitalize">{group.type.replace(/_/g, " ")}</div>
          </div>
          {/* Privacy — static */}
          <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5">
            <div className="text-[10px] text-emerald-200/50 uppercase tracking-wider mb-0.5">Privacy</div>
            <div className="text-sm font-semibold text-emerald-50 capitalize">{group.privacy.replace(/_/g, " ")}</div>
          </div>
          {/* Members — navigates to members tab */}
          <button
            type="button"
            onClick={() => setTab("members")}
            className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5 text-left hover:bg-emerald-900/30 transition-colors"
          >
            <div className="text-[10px] text-emerald-200/50 uppercase tracking-wider mb-0.5">Members</div>
            <div className="flex items-baseline justify-between">
              <div className="text-sm font-semibold text-emerald-50">{group.member_count}</div>
              <span className="text-[10px] text-emerald-400/70">→</span>
            </div>
          </button>
          {/* Events — navigates to events tab */}
          <button
            type="button"
            onClick={() => setTab("events")}
            className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5 text-left hover:bg-emerald-900/30 transition-colors"
          >
            <div className="text-[10px] text-emerald-200/50 uppercase tracking-wider mb-0.5">Events</div>
            <div className="flex items-baseline justify-between">
              <div className="text-sm font-semibold text-emerald-50">{events.length}</div>
              <span className="text-[10px] text-emerald-400/70">→</span>
            </div>
          </button>
          {/* Competitions — navigates to competitions tab (members only) */}
          {isMember && (
            <button
              type="button"
              onClick={() => setTab("competitions")}
              className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5 text-left hover:bg-emerald-900/30 transition-colors"
            >
              <div className="text-[10px] text-emerald-200/50 uppercase tracking-wider mb-0.5">Competitions</div>
              <div className="flex items-baseline justify-between">
                <div className="text-sm font-semibold text-emerald-50">{competitions.length}</div>
                <span className="text-[10px] text-emerald-400/70">→</span>
              </div>
            </button>
          )}
        </div>

        {/* Season timeline */}
        {(group.season_start || group.season_end) && (
          <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5">
            <div className="text-[10px] text-emerald-200/50 uppercase tracking-wider mb-1">Season</div>
            <div className="text-[12px] text-emerald-100/75">
              {group.season_start
                ? new Date(group.season_start).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })
                : "—"}
              <span className="text-emerald-700 mx-2">→</span>
              {group.season_end
                ? new Date(group.season_end).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })
                : "ongoing"}
            </div>
          </div>
        )}

        {/* Join code for admins */}
        {isAdminOrOwner && group.join_code && (
          <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5 flex items-center justify-between">
            <div>
              <div className="text-[10px] text-emerald-200/50 uppercase tracking-wider mb-0.5">Join Code</div>
              <div className="text-base font-mono font-bold text-[#f5e6b0] tracking-widest">{group.join_code}</div>
            </div>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(group.join_code ?? "")}
              className="text-[10px] text-emerald-400 border border-emerald-700/40 rounded-full px-2.5 py-1 hover:bg-emerald-900/30"
            >
              Copy
            </button>
          </div>
        )}

        {/* Join CTA */}
        {!joinedStatus && (
          <button
            type="button"
            onClick={handleJoin}
            disabled={joining}
            className="w-full py-3 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {joining ? "Joining…" : group.join_method === "request" ? "Request to Join" : "Join Group"}
          </button>
        )}
        {joinedStatus === "pending" && (
          <div className="text-sm text-amber-300/80 text-center py-2 border border-amber-800/30 rounded-xl bg-amber-900/20">
            Request pending approval
          </div>
        )}
      </div>
    ),

    events: (
      <div className="space-y-3">
        {isAdminOrOwner && (
          <button
            type="button"
            onClick={() => router.push(`/majors/events/create?group_id=${groupId}`)}
            className="w-full py-2.5 rounded-full border border-emerald-700/60 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/30"
          >
            + New Competition
          </button>
        )}

        {/* Sub-tabs */}
        <div className="flex gap-1.5">
          {(["active", "completed"] as const).map((st) => {
            const count = st === "active" ? upcomingComps.length : completedComps.length;
            return (
              <button
                key={st}
                type="button"
                onClick={() => setCompSubTab(st)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  compSubTab === st
                    ? "bg-emerald-700 text-white"
                    : "border border-emerald-900/60 text-emerald-200/70 hover:text-emerald-50"
                }`}
              >
                <span className="capitalize">{st === "active" ? "Active" : "Completed"}</span>
                <span className={`text-[10px] ${compSubTab === st ? "text-emerald-200" : "text-emerald-200/50"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Cancelled filter chip */}
        {compSubTab === "completed" && cancelledCount > 0 && (
          <button
            type="button"
            onClick={() => setShowCancelled((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
              showCancelled
                ? "bg-red-950/40 text-red-400/80 border-red-900/50"
                : "border-emerald-900/60 text-emerald-200/50 hover:text-emerald-50"
            }`}
          >
            {showCancelled ? "Hide" : "Show"} cancelled
            <span className="text-[10px]">{cancelledCount}</span>
          </button>
        )}

        {/* Competition list */}
        {compSubTab === "active" && upcomingComps.length === 0 && (
          <div className="text-sm text-emerald-100/60 text-center py-8">No upcoming or live competitions.</div>
        )}
        {compSubTab === "completed" && visibleCompletedComps.length === 0 && (
          <div className="text-sm text-emerald-100/60 text-center py-8">
            {completedComps.length > 0 ? "No non-cancelled competitions." : "No completed competitions yet."}
          </div>
        )}
        {(compSubTab === "active" ? upcomingComps : visibleCompletedComps).map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => router.push(`/majors/events/${c.id}`)}
            className={`w-full text-left rounded-2xl border p-4 space-y-1 hover:brightness-110 transition-all ${compStatusColour(c.majors_status)}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-emerald-50 truncate">{c.name}</span>
              <span className={`shrink-0 text-[9px] font-semibold px-2 py-0.5 rounded-full border capitalize ${compStatusBadge(c.majors_status)}`}>
                {eventStatusLabel(c)}
              </span>
            </div>
            <div className="text-[11px] text-emerald-100/60 flex items-center gap-2">
              {c.event_date && <span>{new Date(c.event_date).toLocaleDateString([], { month: "short", day: "numeric" })}</span>}
              {c.course && (
                <>
                  <span className="text-emerald-800">·</span>
                  <span className="truncate">{c.course.name}</span>
                </>
              )}
            </div>
          </button>
        ))}
      </div>
    ),

    standings: (() => {
      const liveRows = liveStandingsData?.rows ?? [];
      const hasLive = liveStandingsData?.hasLive ?? false;
      const currentSeason = liveStandingsData?.current_season ?? null;
      const isHistorical = standingsSeasonId !== "current";
      const showLiveIndicator = hasLive && !isHistorical;
      const selectedSeasonObj = isHistorical ? groupSeasons.find((s: any) => s.id === standingsSeasonId) : null;

      const standingsSeasonOptions: { value: string; label: string }[] = [
        {
          value: "current",
          label: currentSeason
            ? currentSeason.season_label + (currentSeason.status === "live" ? " · Live" : "")
            : "Current Season",
        },
        ...[...groupSeasons]
          .filter((s: any) => s.id !== currentSeason?.id)
          .sort((a: any, b: any) => (b.season_year ?? 0) - (a.season_year ?? 0))
          .map((s: any) => ({ value: s.id as string, label: s.season_label ?? String(s.season_year ?? "Season") })),
      ];

      // Unified row shape so all sub-tab renderers work identically for live and historical data
      type NRow = {
        profile_id: string;
        profile: { name: string | null; avatar_url: string | null } | null;
        official_position: number | null;
        display_points: number;
        live_points_pending: number;
        events_played: number;
        wins: number;
        total_gross: number | null;
        total_net: number | null;
        avg_gross_to_par: number | null;
        avg_net_to_par: number | null;
      };

      const nRows: NRow[] = isHistorical
        ? standingsHistoricalData.map((s) => ({
            profile_id: s.profile_id,
            profile: s.profile,
            official_position: s.position,
            display_points: s.season_points,
            live_points_pending: 0,
            events_played: s.events_played,
            wins: s.wins,
            total_gross: s.total_gross,
            total_net: s.total_net,
            avg_gross_to_par: s.avg_gross_to_par,
            avg_net_to_par: s.avg_net_to_par,
          }))
        : liveRows.map((s) => ({
            profile_id: s.profile_id,
            profile: s.profile,
            official_position: showLiveIndicator
              ? (s.live_position ?? s.confirmed_position)
              : s.confirmed_position,
            display_points: s.confirmed_points,
            live_points_pending: showLiveIndicator ? s.live_points_pending : 0,
            events_played: s.events_played,
            wins: s.wins,
            total_gross: s.total_gross,
            total_net: s.total_net,
            avg_gross_to_par: s.avg_gross_to_par,
            avg_net_to_par: s.avg_net_to_par,
          }));

      const drawerSeasonId = isHistorical ? standingsSeasonId : (currentSeason?.id ?? null);
      const drawerSeasonLabel = isHistorical ? (selectedSeasonObj?.season_label ?? undefined) : undefined;

      const avatarEl = (profile: { name: string | null; avatar_url: string | null } | null) =>
        profile?.avatar_url ? (
          <img src={profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
        ) : (
          <div className="h-7 w-7 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">
            {profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
          </div>
        );

      const formatToPar = (v: number | null) => {
        if (v == null) return "—";
        if (v === 0) return "E";
        return v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
      };

      const podiumClass = (pos: number | null) =>
        pos === 1 ? "border-[#f5e6b0]/25 bg-[#f5e6b0]/5"
        : pos === 2 ? "border-[#c0c0c0]/20 bg-[#c0c0c0]/5"
        : pos === 3 ? "border-[#cd7f32]/20 bg-[#cd7f32]/5"
        : "border-emerald-900/50 bg-[#0b3b21]/60";

      // ── Points sub-tab ───────────────────────────────────────────────────
      const renderPoints = () => {
        if (nRows.length === 0) {
          return <div className="text-sm text-emerald-100/60 text-center py-8">No standings for this period.</div>;
        }
        return (
          <div className="space-y-2">
            {showLiveIndicator && (
              <div className="flex items-center gap-2 px-1 pb-1">
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                <span className="text-[11px] text-amber-300/80 font-medium">Live competition in progress</span>
              </div>
            )}
            {nRows.map((s) => {
              const liveRow = !isHistorical ? liveRows.find((r) => r.profile_id === s.profile_id) : null;
              const improved = showLiveIndicator && liveRow && liveRow.live_position != null && liveRow.confirmed_position != null && liveRow.live_position < liveRow.confirmed_position;
              const worsened = showLiveIndicator && liveRow && liveRow.live_position != null && liveRow.confirmed_position != null && liveRow.live_position > liveRow.confirmed_position;
              return (
                <button
                  key={s.profile_id}
                  type="button"
                  onClick={() => setSelectedPlayerForDrawer({ profileId: s.profile_id, name: s.profile?.name ?? "Unknown", avatarUrl: s.profile?.avatar_url ?? null, currentSeasonId: drawerSeasonId, seasonLabel: drawerSeasonLabel })}
                  className={`w-full flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left hover:brightness-110 transition-all ${podiumClass(s.official_position)}`}>
                  <div className="w-3 shrink-0 flex justify-center">
                    {improved && <span className="text-[10px] leading-none text-emerald-400">▲</span>}
                    {worsened && <span className="text-[10px] leading-none text-red-400">▼</span>}
                  </div>
                  <PositionBadge position={s.official_position} />
                  {avatarEl(s.profile)}
                  <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{s.profile?.name ?? "Unknown"}</span>
                  <div className="text-right shrink-0 space-y-0.5">
                    <div className="flex items-baseline justify-end gap-1">
                      <span className="text-xs font-extrabold text-[#f5e6b0]">{s.display_points} pts</span>
                      {s.live_points_pending > 0 && (
                        <span className="text-[10px] font-semibold text-amber-400/90">+{s.live_points_pending}</span>
                      )}
                    </div>
                    <div className="flex gap-1 justify-end">
                      <span className="text-[9px] text-emerald-100/50 bg-emerald-900/40 rounded px-1">{s.events_played} evts</span>
                      {s.wins > 0 && <span className="text-[9px] text-[#f5e6b0]/70 bg-[#f5e6b0]/10 rounded px-1">{s.wins}W</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        );
      };

      // ── Strokes sub-tab ──────────────────────────────────────────────────
      const renderStrokes = () => {
        const primaryField = sortField === "net" ? "total_net" : "total_gross";
        const dir = sortDir === "asc" ? 1 : -1;
        const sorted = [...nRows]
          .filter((r) => r.total_net != null || r.total_gross != null)
          .sort((a, b) => dir * ((a[primaryField] as number ?? 9999) - (b[primaryField] as number ?? 9999)));
        if (sorted.length === 0) {
          return <div className="text-sm text-emerald-100/60 text-center py-8">No stroke data for this period.</div>;
        }
        return (
          <div className="space-y-2">
            <div className="flex justify-end gap-4 px-1 pb-0.5">
              {sortHeader("Gross", "gross")}
              {sortHeader("Net", "net")}
            </div>
            {sorted.map((s) => (
              <button
                key={s.profile_id}
                type="button"
                onClick={() => setSelectedPlayerForDrawer({ profileId: s.profile_id, name: s.profile?.name ?? "Unknown", avatarUrl: s.profile?.avatar_url ?? null, currentSeasonId: drawerSeasonId, seasonLabel: drawerSeasonLabel })}
                className={`w-full flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left hover:brightness-110 transition-all ${podiumClass(s.official_position)}`}
              >
                <PositionBadge position={s.official_position} />
                {avatarEl(s.profile)}
                <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{s.profile?.name ?? "Unknown"}</span>
                <div className="flex gap-4 shrink-0">
                  <span className="text-xs font-bold text-emerald-100/80 w-12 text-right">{s.total_gross ?? "—"}</span>
                  <span className="text-xs font-bold text-[#f5e6b0]/80 w-12 text-right">{s.total_net ?? "—"}</span>
                </div>
              </button>
            ))}
          </div>
        );
      };

      // ── Avg to par sub-tab ───────────────────────────────────────────────
      const renderAvgPar = () => {
        const primaryField = sortField === "net" ? "avg_net_to_par" : "avg_gross_to_par";
        const dir = sortDir === "asc" ? 1 : -1;
        const sorted = [...nRows]
          .filter((r) => r.avg_net_to_par != null || r.avg_gross_to_par != null)
          .sort((a, b) => dir * ((a[primaryField] as number ?? 999) - (b[primaryField] as number ?? 999)));
        if (sorted.length === 0) {
          return <div className="text-sm text-emerald-100/60 text-center py-8">No score data for this period.</div>;
        }
        return (
          <div className="space-y-2">
            <div className="flex justify-end gap-4 px-1 pb-0.5">
              {sortHeader("Gross", "gross")}
              {sortHeader("Net", "net")}
            </div>
            {sorted.map((s) => (
              <button
                key={s.profile_id}
                type="button"
                onClick={() => setSelectedPlayerForDrawer({ profileId: s.profile_id, name: s.profile?.name ?? "Unknown", avatarUrl: s.profile?.avatar_url ?? null, currentSeasonId: drawerSeasonId, seasonLabel: drawerSeasonLabel })}
                className={`w-full flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left hover:brightness-110 transition-all ${podiumClass(s.official_position)}`}
              >
                <PositionBadge position={s.official_position} />
                {avatarEl(s.profile)}
                <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{s.profile?.name ?? "Unknown"}</span>
                <div className="flex gap-4 shrink-0">
                  <span className={`text-xs font-bold w-12 text-right ${s.avg_gross_to_par != null && s.avg_gross_to_par < 0 ? "text-emerald-400" : s.avg_gross_to_par != null && s.avg_gross_to_par > 0 ? "text-red-400" : "text-emerald-100/80"}`}>{formatToPar(s.avg_gross_to_par ?? null)}</span>
                  <span className={`text-xs font-bold w-12 text-right ${s.avg_net_to_par != null && s.avg_net_to_par < 0 ? "text-emerald-400" : s.avg_net_to_par != null && s.avg_net_to_par > 0 ? "text-red-400" : "text-emerald-100/80"}`}>{formatToPar(s.avg_net_to_par ?? null)}</span>
                </div>
              </button>
            ))}
          </div>
        );
      };

      return (
        <div className="space-y-3">
          {/* Season selector */}
          <select
            value={standingsSeasonId}
            onChange={(e) => handleStandingsSeasonChange(e.target.value)}
            className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-2 py-1.5 text-[11px] text-emerald-50 focus:outline-none focus:border-emerald-600 [color-scheme:dark]"
          >
            {standingsSeasonOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {/* Live indicator */}
          {showLiveIndicator && (
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
              <span className="text-[11px] text-amber-300/80 font-medium">Live in progress</span>
            </div>
          )}
          {/* Metric selector */}
          <div className="flex gap-1.5">
            {(["points", "strokes", "avg"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setStandingsMetric(m)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors capitalize ${
                  standingsMetric === m
                    ? "bg-emerald-700 text-white"
                    : "border border-emerald-900/60 text-emerald-200/70 hover:text-emerald-50"
                }`}
              >
                {m === "avg" ? "Average" : m === "points" ? "Points" : "Strokes"}
              </button>
            ))}
          </div>

          {/* Content */}
          {standingsHistoricalLoading ? (
            <div className="text-sm text-emerald-100/60 text-center py-8">Loading…</div>
          ) : (
            <>
              {standingsMetric === "points" && renderPoints()}
              {standingsMetric === "strokes" && renderStrokes()}
              {standingsMetric === "avg" && renderAvgPar()}
            </>
          )}
        </div>
      );
    })(),

    // Keep schedule/history accessible via events tab filtering
    schedule: (
      <div className="space-y-3">
        {upcomingComps.length === 0 && (
          <div className="text-sm text-emerald-100/60 text-center py-8">No upcoming competitions.</div>
        )}
        {upcomingComps.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => router.push(`/majors/events/${c.id}`)}
            className={`w-full text-left rounded-2xl border p-4 space-y-1 hover:brightness-110 transition-all ${compStatusColour(c.majors_status)}`}
          >
            <div className="text-sm font-semibold text-emerald-50">{c.name}</div>
            <div className="text-[11px] text-emerald-100/60 flex gap-2">
              {c.event_date && <span>{new Date(c.event_date).toLocaleDateString([], { month: "short", day: "numeric" })}</span>}
              {c.course && <span>· {c.course.name}</span>}
            </div>
          </button>
        ))}
      </div>
    ),

    history: (
      <div className="space-y-3">
        {completedComps.length === 0 && (
          <div className="text-sm text-emerald-100/60 text-center py-8">No completed competitions.</div>
        )}
        {completedComps.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => router.push(`/majors/events/${c.id}`)}
            className="w-full text-left rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-1 hover:border-emerald-700/70"
          >
            <div className="text-sm font-semibold text-emerald-50">{c.name}</div>
            <div className="text-[11px] text-emerald-100/60">
              {c.event_date && new Date(c.event_date).toLocaleDateString()}
            </div>
          </button>
        ))}
      </div>
    ),

    members: (
      <div className="space-y-3">
        {/* Pending requests */}
        {pendingMembers.length > 0 && isAdminOrOwner && (
          <div className="rounded-2xl border border-amber-800/40 bg-amber-900/20 p-3 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-amber-300/80 font-semibold">
              {pendingMembers.length} Pending Request{pendingMembers.length !== 1 ? "s" : ""}
            </div>
            {pendingMembers.map((m) => (
              <div key={m.id} className="flex items-center gap-3">
                <button
                  type="button"
                  className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                  onClick={() => router.push(`/player/${m.profile_id}`)}
                >
                  {m.profile?.avatar_url ? (
                    <img src={m.profile.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-amber-900/60 grid place-items-center text-[10px] font-bold text-amber-200 shrink-0">
                      {m.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
                    </div>
                  )}
                  <span className="flex-1 text-sm text-emerald-50 truncate text-left">{m.profile?.name ?? m.profile_id}</span>
                </button>
                <div className="flex gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleMemberAction(m.id, { status: "active" })}
                    className="text-[10px] font-semibold text-emerald-400 border border-emerald-700/50 rounded-full px-2.5 py-1 hover:bg-emerald-900/40"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeclineMember(m.profile_id)}
                    className="text-[10px] text-red-400/80 border border-red-900/40 rounded-full px-2.5 py-1 hover:bg-red-900/20"
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Invited members — visible to admins */}
        {invitedMembers.length > 0 && isAdminOrOwner && (
          <div className="rounded-2xl border border-emerald-800/30 bg-emerald-950/30 p-3 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-emerald-200/40 font-semibold">
              {invitedMembers.length} Invited
            </div>
            {invitedMembers.map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-1 py-1">
                <div className="h-8 w-8 rounded-full bg-emerald-900/60 flex items-center justify-center text-[10px] font-bold text-emerald-200 shrink-0">
                  {m.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
                </div>
                <span className="flex-1 text-[13px] text-emerald-200/70 truncate">{m.profile?.name ?? m.profile_id}</span>
                <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full border border-amber-700/40 text-amber-300/70 bg-amber-900/20">
                  Invited
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Active members */}
        <div className="space-y-1.5">
          {activeMembers.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              isAdminOrOwner={isAdminOrOwner}
              myRole={myRole}
              myProfileId={myProfileId}
              onRoleToggle={() => handleMemberAction(m.id, { role: m.role === "admin" ? "member" : "admin" })}
              onTeePrefSave={async (tee) => { await handleMemberAction(m.id, { preferred_tee_name: tee } as any); }}
              onTournamentIndexSave={async (index) => { await handleTournamentIndex(m.profile_id, index); }}
              onNavigate={() => router.push(`/player/${m.profile_id}`)}
            />
          ))}
        </div>

        {/* Invite button */}
        {isAdminOrOwner && (
          <button
            type="button"
            className="w-full py-2 rounded-full border border-emerald-700/50 text-sm text-emerald-200/70 hover:text-emerald-200 hover:bg-emerald-900/20 mt-2"
            onClick={() => setShowInvite(true)}
          >
            + Invite Member
          </button>
        )}
      </div>
    ),

    seasons: (() => {
      const seasonWheelOptions: { value: string; label: string }[] = [
        { value: "all", label: "All Time" },
        ...[...groupSeasons]
          .sort((a: any, b: any) => (b.season_year ?? 0) - (a.season_year ?? 0))
          .map((s: any) => ({
            value: s.id as string,
            label: s.season_label ?? String(s.season_year ?? "Season"),
          })),
      ];

      const metricWheelOptions: { value: string; label: string }[] = [
        { value: "outrights", label: "Outrights" },
        { value: "points", label: "Points" },
        { value: "strokes", label: "Strokes" },
        { value: "avg", label: "Average" },
      ];

      const handleSeasonChange = async (id: string) => {
        setSelectedSeasonId(id);
        if (id === "all") { setSeasonStandings([]); return; }
        setSeasonStandingsLoading(true);
        try {
          const session = await getViewerSession();
          if (!session) return;
          const res = await fetch(`/api/majors/group-seasons/${id}/standings`, {
            headers: { Authorization: `Bearer ${session.accessToken}` },
          });
          if (res.ok) {
            const j = await res.json();
            setSeasonStandings(j.standings ?? []);
          }
        } finally {
          setSeasonStandingsLoading(false);
        }
      };

      const ordinal = (n: number) => { const s = ["th","st","nd","rd"]; const v = n % 100; return n + (s[(v-20)%10] ?? s[v] ?? s[0]); };
      const fmtTopar = (v: number | null) => v == null ? "—" : (v > 0 ? `+${v}` : `${v}`);

      const avatarEl = (profile: { name: string | null; avatar_url: string | null } | null) =>
        profile?.avatar_url ? (
          <img src={profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
        ) : (
          <div className="h-7 w-7 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">
            {profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
          </div>
        );

      const podiumClass = (pos: number | null) =>
        pos === 1 ? "border-[#f5e6b0]/25 bg-[#f5e6b0]/5"
        : pos === 2 ? "border-[#c0c0c0]/20 bg-[#c0c0c0]/5"
        : pos === 3 ? "border-[#cd7f32]/20 bg-[#cd7f32]/5"
        : "border-emerald-900/50 bg-[#0b3b21]/60";

      // ── All-Time views ──────────────────────────────────────────────────────
      const renderAllTime = () => {
        if (!competitionResults) return <div className="text-sm text-emerald-100/60 text-center py-8">Loading…</div>;
        const records = competitionResults.player_records;
        if (records.length === 0) return <div className="text-sm text-emerald-100/60 text-center py-8">No event data yet.</div>;

        const openDrawer = (pr: any) => setSelectedPlayerForDrawer({
          profileId: pr.profile_id,
          name: pr.profile.name ?? "Unknown",
          avatarUrl: pr.profile.avatar_url ?? null,
          currentSeasonId: null,
          seasonLabel: "All Time",
        });

        if (seasonMetric === "outrights") {
          const sorted = [...records].sort((a, b) => (b as any).total_wins - (a as any).total_wins);
          return (
            <div className="space-y-2">
              {sorted.map((pr, i) => (
                <button key={pr.profile_id} type="button" onClick={() => openDrawer(pr)} className={`w-full text-left rounded-2xl border p-3 space-y-2 hover:brightness-110 transition-all ${podiumClass(i < 3 ? i + 1 : null)}`}>
                  <div className="flex items-center gap-2">
                    <PositionBadge position={i + 1} />
                    {avatarEl(pr.profile)}
                    <span className="flex-1 text-sm font-semibold text-emerald-100 truncate">{pr.profile.name ?? "Unknown"}</span>
                    <span className="text-[11px] font-bold text-[#f5e6b0]">{pr.total_wins} {pr.total_wins === 1 ? "win" : "wins"}</span>
                  </div>
                  {pr.competition_records.length > 0 && (
                    <div className="space-y-1 pl-9">
                      {pr.competition_records.map((sr: any) => (
                        <div key={sr.competition_id ?? "standalone"} className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-emerald-200/70 truncate">{sr.competition_name ?? "Competition"}</span>
                          <span className="text-[10px] text-emerald-200/55 shrink-0">
                            {sr.wins > 0 ? `${sr.wins}× win${sr.wins !== 1 ? "s" : ""}` : sr.best_finish != null ? `Best: ${ordinal(sr.best_finish)}` : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {pr.standalone_wins.length > 0 && (
                    <div className="space-y-1 pl-9">
                      {pr.standalone_wins.map((w: any) => (
                        <div key={w.event_id} className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-emerald-200/70 truncate">{w.name ?? "Event"}</span>
                          <span className="text-[10px] text-[#f5e6b0]/70 shrink-0">{w.year ?? ""}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {pr.competition_records.length === 0 && pr.standalone_wins.length === 0 && (
                    <div className="pl-9 text-[11px] text-emerald-200/40">No entries yet</div>
                  )}
                </button>
              ))}
            </div>
          );
        }

        if (seasonMetric === "points") {
          const sorted = [...records].sort((a, b) => (b as any).career_points - (a as any).career_points);
          return (
            <div className="space-y-2">
              {sorted.map((pr, i) => (
                <button key={pr.profile_id} type="button" onClick={() => openDrawer(pr)} className={`w-full flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left hover:brightness-110 transition-all ${podiumClass(i < 3 ? i + 1 : null)}`}>
                  <PositionBadge position={i + 1} />
                  {avatarEl(pr.profile)}
                  <span className="flex-1 text-sm font-semibold text-emerald-100 truncate">{pr.profile.name ?? "Unknown"}</span>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-extrabold text-[#f5e6b0]">{(pr as any).career_points} pts</div>
                    <div className="text-[9px] text-emerald-100/40">{(pr as any).career_events_played} evts</div>
                  </div>
                </button>
              ))}
            </div>
          );
        }

        if (seasonMetric === "strokes") {
          const atField = sortField === "net" ? "career_total_net_to_par" : "career_total_gross_to_par";
          const atDir = sortDir === "asc" ? 1 : -1;
          const sorted = [...records].sort((a, b) => atDir * (((a as any)[atField] ?? 9999) - ((b as any)[atField] ?? 9999)));
          return (
            <div className="space-y-2">
              <div className="flex justify-end gap-4 px-1 pb-0.5">
                {sortHeader("Gross", "gross")}
                {sortHeader("Net", "net")}
              </div>
              {sorted.map((pr, i) => (
                <button key={pr.profile_id} type="button" onClick={() => openDrawer(pr)} className={`w-full flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left hover:brightness-110 transition-all ${podiumClass(i < 3 ? i + 1 : null)}`}>
                  <PositionBadge position={i + 1} />
                  {avatarEl(pr.profile)}
                  <span className="flex-1 text-sm font-semibold text-emerald-100 truncate">{pr.profile.name ?? "Unknown"}</span>
                  <div className="flex gap-4 shrink-0">
                    <span className="text-xs font-bold text-emerald-100/80 w-12 text-right">{fmtTopar((pr as any).career_total_gross_to_par)}</span>
                    <span className="text-xs font-bold text-[#f5e6b0]/80 w-12 text-right">{fmtTopar((pr as any).career_total_net_to_par)}</span>
                  </div>
                </button>
              ))}
            </div>
          );
        }

        // avg
        {
          const atField = sortField === "net" ? "career_avg_net_to_par" : "career_avg_gross_to_par";
          const atDir = sortDir === "asc" ? 1 : -1;
          const sorted = [...records].sort((a, b) => atDir * (((a as any)[atField] ?? 999) - ((b as any)[atField] ?? 999)));
          return (
            <div className="space-y-2">
              <div className="flex justify-end gap-4 px-1 pb-0.5">
                {sortHeader("Gross", "gross")}
                {sortHeader("Net", "net")}
              </div>
              {sorted.map((pr, i) => (
                <button key={pr.profile_id} type="button" onClick={() => openDrawer(pr)} className={`w-full flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left hover:brightness-110 transition-all ${podiumClass(i < 3 ? i + 1 : null)}`}>
                  <PositionBadge position={i + 1} />
                  {avatarEl(pr.profile)}
                  <span className="flex-1 text-sm font-semibold text-emerald-100 truncate">{pr.profile.name ?? "Unknown"}</span>
                  <div className="flex gap-4 shrink-0">
                    <span className="text-xs font-bold text-emerald-100/80 w-12 text-right">{fmtTopar((pr as any).career_avg_gross_to_par)}</span>
                    <span className="text-xs font-bold text-[#f5e6b0]/80 w-12 text-right">{fmtTopar((pr as any).career_avg_net_to_par)}</span>
                  </div>
                </button>
              ))}
            </div>
          );
        }
      };

      // ── Individual season views ─────────────────────────────────────────────
      const renderSeasonView = () => {
        if (seasonStandingsLoading) return <div className="text-sm text-emerald-100/60 text-center py-8">Loading…</div>;
        if (seasonStandings.length === 0) return <div className="text-sm text-emerald-100/60 text-center py-8">No standings for this season.</div>;

        const selectedSeasonObj = groupSeasons.find((s: any) => s.id === selectedSeasonId);
        const seasonLabel = selectedSeasonObj?.season_label ?? undefined;

        const openDrawer = (s: SeasonStandingEntry) => setSelectedPlayerForDrawer({
          profileId: s.profile_id,
          name: s.profile?.name ?? "Unknown",
          avatarUrl: s.profile?.avatar_url ?? null,
          currentSeasonId: null,
          seasonLabel,
        });

        const viewFull = selectedSeasonObj && (
          <button type="button" onClick={() => router.push(`/majors/group-seasons/${selectedSeasonId}`)} className="w-full text-right text-[11px] text-emerald-400/70 hover:text-emerald-300 pb-1">
            View full season →
          </button>
        );

        if (seasonMetric === "outrights") {
          const sorted = [...seasonStandings].sort((a, b) => b.wins - a.wins);
          return (
            <div className="space-y-2">
              {viewFull}
              {sorted.map((s) => (
                <button key={s.profile_id} type="button" onClick={() => openDrawer(s)} className={`w-full flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left hover:brightness-110 transition-all ${podiumClass(s.position)}`}>
                  <PositionBadge position={s.position} />
                  {avatarEl(s.profile)}
                  <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{s.profile?.name ?? "Unknown"}</span>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-extrabold text-[#f5e6b0]">{s.wins}W</div>
                    <div className="text-[9px] text-emerald-100/50">{s.events_played} evts</div>
                  </div>
                </button>
              ))}
            </div>
          );
        }

        if (seasonMetric === "points") {
          const sorted = [...seasonStandings].sort((a, b) => b.season_points - a.season_points);
          return (
            <div className="space-y-2">
              {viewFull}
              {sorted.map((s) => (
                <button key={s.profile_id} type="button" onClick={() => openDrawer(s)} className={`w-full flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left hover:brightness-110 transition-all ${podiumClass(s.position)}`}>
                  <PositionBadge position={s.position} />
                  {avatarEl(s.profile)}
                  <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{s.profile?.name ?? "Unknown"}</span>
                  <div className="text-right shrink-0">
                    <div className="text-xs font-extrabold text-[#f5e6b0]">{s.season_points} pts</div>
                    <div className="flex gap-1 justify-end">
                      <span className="text-[9px] text-emerald-100/50 bg-emerald-900/40 rounded px-1">{s.events_played} evts</span>
                      {s.wins > 0 && <span className="text-[9px] text-[#f5e6b0]/70 bg-[#f5e6b0]/10 rounded px-1">{s.wins}W</span>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          );
        }

        if (seasonMetric === "strokes") {
          const seaStrokesField = sortField === "net" ? "total_net" : "total_gross";
          const seaDir = sortDir === "asc" ? 1 : -1;
          const sorted = [...seasonStandings]
            .filter((s) => s.total_net != null || s.total_gross != null)
            .sort((a, b) => seaDir * ((a[seaStrokesField] as number ?? 9999) - (b[seaStrokesField] as number ?? 9999)));
          if (sorted.length === 0) return <div className="text-sm text-emerald-100/60 text-center py-8">No stroke data for this season.</div>;
          return (
            <div className="space-y-2">
              {viewFull}
              <div className="flex justify-end gap-4 px-1 pb-0.5">
                {sortHeader("Gross", "gross")}
                {sortHeader("Net", "net")}
              </div>
              {sorted.map((s) => (
                <button key={s.profile_id} type="button" onClick={() => openDrawer(s)} className={`w-full flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left hover:brightness-110 transition-all ${podiumClass(s.position)}`}>
                  <PositionBadge position={s.position} />
                  {avatarEl(s.profile)}
                  <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{s.profile?.name ?? "Unknown"}</span>
                  <div className="flex gap-4 shrink-0">
                    <span className="text-xs font-bold text-emerald-100/80 w-12 text-right">{s.total_gross ?? "—"}</span>
                    <span className="text-xs font-bold text-[#f5e6b0]/80 w-12 text-right">{s.total_net ?? "—"}</span>
                  </div>
                </button>
              ))}
            </div>
          );
        }

        // avg
        {
          const seaAvgField = sortField === "net" ? "avg_net_to_par" : "avg_gross_to_par";
          const seaDir = sortDir === "asc" ? 1 : -1;
          const sorted = [...seasonStandings]
            .filter((s) => s.avg_net_to_par != null || s.avg_gross_to_par != null)
            .sort((a, b) => seaDir * ((a[seaAvgField] as number ?? 999) - (b[seaAvgField] as number ?? 999)));
          if (sorted.length === 0) return <div className="text-sm text-emerald-100/60 text-center py-8">No score data for this season.</div>;
          return (
            <div className="space-y-2">
              {viewFull}
              <div className="flex justify-end gap-4 px-1 pb-0.5">
                {sortHeader("Gross", "gross")}
                {sortHeader("Net", "net")}
              </div>
              {sorted.map((s) => (
                <button key={s.profile_id} type="button" onClick={() => openDrawer(s)} className={`w-full flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left hover:brightness-110 transition-all ${podiumClass(s.position)}`}>
                  <PositionBadge position={s.position} />
                  {avatarEl(s.profile)}
                  <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{s.profile?.name ?? "Unknown"}</span>
                  <div className="flex gap-4 shrink-0">
                    <span className="text-xs font-bold text-emerald-100/80 w-12 text-right">{fmtTopar(s.avg_gross_to_par)}</span>
                    <span className="text-xs font-bold text-[#f5e6b0]/80 w-12 text-right">{fmtTopar(s.avg_net_to_par)}</span>
                  </div>
                </button>
              ))}
            </div>
          );
        }
      };

      const handleCreateSeason = async () => {
        setCreatingSeason(true); setCreateSeasonError(null);
        try {
          const session = await getViewerSession();
          if (!session) return;
          const res = await fetch(`/api/majors/groups/${groupId}/seasons`, {
            method: "POST",
            headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify(createSeasonForm),
          });
          const j = await res.json();
          if (!res.ok) { setCreateSeasonError(j.error ?? "Failed to create season"); return; }
          setGroupSeasons((prev) => [...prev, j.season]);
          setShowCreateSeason(false);
          setCreateSeasonForm({ season_type: "calendar_year", year: String(new Date().getFullYear()), name: "", start_date: "", end_date: "", standings_model: "none" });
        } finally { setCreatingSeason(false); }
      };

      const inputCls = "w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600 [color-scheme:dark]";

      return (
        <div className="space-y-4">
          {/* Create season button + modal */}
          {isAdminOrOwner && !showCreateSeason && (
            <button
              type="button"
              onClick={() => setShowCreateSeason(true)}
              className="w-full py-2.5 rounded-full border border-emerald-700/60 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/30"
            >
              + Create Season
            </button>
          )}
          {showCreateSeason && (
            <div className="rounded-xl border border-emerald-700/40 bg-[#0b3b21]/50 px-3 py-3 space-y-2">
              <div className="text-[11px] font-semibold text-emerald-200">New Season</div>
              <select
                value={createSeasonForm.season_type}
                onChange={(e) => setCreateSeasonForm((f) => ({ ...f, season_type: e.target.value as "calendar_year" | "custom" }))}
                className={inputCls}
              >
                <option value="calendar_year">Calendar Year (Jan – Dec)</option>
                <option value="custom">Custom Date Range</option>
              </select>
              {createSeasonForm.season_type === "calendar_year" ? (
                <input type="number" placeholder="Year (e.g. 2026)" value={createSeasonForm.year}
                  onChange={(e) => setCreateSeasonForm((f) => ({ ...f, year: e.target.value }))}
                  className={inputCls} min="2020" max="2099" />
              ) : (
                <>
                  <input type="text" placeholder="Season name" value={createSeasonForm.name}
                    onChange={(e) => setCreateSeasonForm((f) => ({ ...f, name: e.target.value }))}
                    className={inputCls} />
                  <div className="flex gap-2">
                    <input type="date" value={createSeasonForm.start_date}
                      onChange={(e) => setCreateSeasonForm((f) => ({ ...f, start_date: e.target.value }))}
                      className={inputCls} />
                    <input type="date" value={createSeasonForm.end_date}
                      onChange={(e) => setCreateSeasonForm((f) => ({ ...f, end_date: e.target.value }))}
                      className={inputCls} />
                  </div>
                </>
              )}
              <select value={createSeasonForm.standings_model}
                onChange={(e) => setCreateSeasonForm((f) => ({ ...f, standings_model: e.target.value }))}
                className={inputCls}>
                <option value="none">No season standings</option>
                <option value="season_points">Season Points</option>
              </select>
              {createSeasonError && (
                <div className="text-[11px] text-red-400">{createSeasonError}</div>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => { setShowCreateSeason(false); setCreateSeasonError(null); }}
                  className="flex-1 py-1.5 rounded-full border border-emerald-900/60 text-[11px] text-emerald-200/60">Cancel</button>
                <button type="button" onClick={handleCreateSeason} disabled={creatingSeason}
                  className="flex-1 py-1.5 rounded-full bg-emerald-700 text-[11px] font-semibold text-white disabled:opacity-50">
                  {creatingSeason ? "Creating…" : "Create"}
                </button>
              </div>
            </div>
          )}

          {/* Season + metric selectors */}
          <div className="flex gap-2">
            <select
              value={selectedSeasonId}
              onChange={(e) => handleSeasonChange(e.target.value)}
              className="flex-1 rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-2 py-1.5 text-[11px] text-emerald-50 focus:outline-none focus:border-emerald-600 [color-scheme:dark]"
            >
              {seasonWheelOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={seasonMetric}
              onChange={(e) => setSeasonMetric(e.target.value as typeof seasonMetric)}
              className="flex-1 rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-2 py-1.5 text-[11px] text-emerald-50 focus:outline-none focus:border-emerald-600 [color-scheme:dark]"
            >
              {metricWheelOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {selectedSeasonId === "all" ? renderAllTime() : renderSeasonView()}
        </div>
      );
    })(),

    competitions: (
      <div className="space-y-3">
        {isAdminOrOwner && (
          <button
            type="button"
            onClick={() => router.push(`/majors/competitions/create?group_id=${groupId}`)}
            className="w-full py-2.5 rounded-full border border-emerald-700/60 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/30"
          >
            + Create Competition Template
          </button>
        )}
        {competitions.length === 0 ? (
          <div className="text-sm text-emerald-100/60 text-center py-8">
            {isAdminOrOwner
              ? "No competitions yet. Create a competition template to generate events each year."
              : "No competition templates for this group."}
          </div>
        ) : (
          competitions.map((s) => {
            const settings = (s.template_settings ?? {}) as Record<string, unknown>;
            const handicapPct = settings.handicap_allowance_pct as number | undefined;
            const maxHandicap = settings.max_handicap as number | null | undefined;
            return (
              <div key={s.id} className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-emerald-50">{s.name}</div>
                    {s.description && (
                      <div className="text-[11px] text-emerald-100/55 mt-0.5">{s.description}</div>
                    )}
                    {/* Current holder */}
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {s.current_holder ? (
                        <>
                          {s.current_holder.avatar_url ? (
                            <img src={s.current_holder.avatar_url} alt="" className="h-4 w-4 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="h-4 w-4 rounded-full bg-emerald-900/60 grid place-items-center text-[8px] font-bold text-emerald-200 shrink-0">
                              {s.current_holder.name?.slice(0, 1).toUpperCase() ?? "?"}
                            </div>
                          )}
                          <span className="text-[10px] text-emerald-200/70">Holder: <span className="text-[#f5e6b0]/80 font-semibold">{s.current_holder.name}</span></span>
                        </>
                      ) : (
                        <span className="text-[10px] text-emerald-200/35">No current holder</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {s.recur_annually && (
                      <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full border border-emerald-700/50 bg-emerald-900/30 text-emerald-300">
                        Annual
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => router.push(`/majors/competitions/${s.id}`)}
                      className="text-[11px] text-emerald-300/70 hover:text-emerald-200"
                    >
                      {isAdminOrOwner ? "Manage →" : "View →"}
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="text-[10px] text-emerald-200/55 border border-emerald-900/50 rounded-full px-2 py-0.5 capitalize">
                    {s.template_event_type}
                  </span>
                  <span className="text-[10px] text-emerald-200/55 border border-emerald-900/50 rounded-full px-2 py-0.5 capitalize">
                    {s.template_scoring_model}
                  </span>
                  {s.latest_season && (
                    <span className="text-[10px] text-emerald-200/55 border border-emerald-900/50 rounded-full px-2 py-0.5">
                      {s.latest_season.season_label}
                    </span>
                  )}
                  {handicapPct != null && handicapPct !== 100 && (
                    <span className="text-[10px] text-emerald-200/55 border border-emerald-900/50 rounded-full px-2 py-0.5">
                      {handicapPct}% HCP
                    </span>
                  )}
                  {maxHandicap != null && (
                    <span className="text-[10px] text-emerald-200/55 border border-emerald-900/50 rounded-full px-2 py-0.5">
                      Max HCP {maxHandicap}
                    </span>
                  )}
                  {(s.event_templates?.length ?? 0) > 0 && (
                    <span className="text-[10px] text-emerald-200/55 border border-emerald-900/50 rounded-full px-2 py-0.5">
                      {s.event_templates.length} event{s.event_templates.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                {isAdminOrOwner && (
                  <button
                    type="button"
                    onClick={() => router.push(`/majors/events/create?group_id=${groupId}&competition_id=${s.id}`)}
                    className="w-full py-2 rounded-full bg-emerald-700/80 text-[11px] font-semibold text-white hover:bg-emerald-600"
                  >
                    + Add Event
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    ),

    finances: (() => {
      const isAdmin = myRole === "owner" || myRole === "admin";
      const currencySymbol = "£"; // extend if needed

      const txTypeLabel = (type: string) => {
        const labels: Record<string, string> = {
          entry_fee: "Entry Fee",
          green_fee: "Green Fee",
          extra_charge: "Extra Charge",
          payment: "Payment",
          winnings: "Winnings",
          adjustment: "Adjustment",
          withdrawal: "Withdrawal",
        };
        return labels[type] ?? type.replace(/_/g, " ");
      };

      if (isAdmin) {
        // Group-level financial summary
        const totalCharged = balanceMembers.reduce((s, m) => s + m.total_charged, 0);
        const totalPaid = balanceMembers.reduce((s, m) => s + m.total_paid, 0);
        const totalOutstanding = balanceMembers.filter((m) => m.balance > 0).reduce((s, m) => s + m.balance, 0);
        const totalCredit = balanceMembers.filter((m) => m.balance < 0).reduce((s, m) => s + Math.abs(m.balance), 0);

        return (
          <div className="space-y-4">
            {/* Export CSV */}
            <a
              href={`/api/majors/groups/${groupId}/balances/export`}
              className="block w-full py-2.5 rounded-full border border-emerald-700/60 text-sm font-semibold text-emerald-200 text-center hover:bg-emerald-900/30"
            >
              Export CSV
            </a>

            {/* Group financial summary */}
            {balanceMembers.length > 0 && (
              <div className="rounded-2xl border border-emerald-900/50 bg-[#0b3b21]/60 px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-emerald-200/50 font-semibold mb-2">Group Summary</div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-[#0b3b21]/60 border border-emerald-900/40 px-2 py-2 text-center">
                    <div className="text-[9px] text-emerald-200/40 uppercase">Total Charged</div>
                    <div className="text-sm font-bold text-emerald-100">{currencySymbol}{totalCharged.toFixed(2)}</div>
                  </div>
                  <div className="rounded-xl bg-[#0b3b21]/60 border border-emerald-900/40 px-2 py-2 text-center">
                    <div className="text-[9px] text-emerald-200/40 uppercase">Total Collected</div>
                    <div className="text-sm font-bold text-emerald-400">{currencySymbol}{totalPaid.toFixed(2)}</div>
                  </div>
                  {totalOutstanding > 0 && (
                    <div className="rounded-xl bg-red-950/30 border border-red-900/30 px-2 py-2 text-center">
                      <div className="text-[9px] text-red-300/50 uppercase">Outstanding</div>
                      <div className="text-sm font-bold text-red-400">{currencySymbol}{totalOutstanding.toFixed(2)}</div>
                    </div>
                  )}
                  {totalCredit > 0 && (
                    <div className="rounded-xl bg-emerald-900/20 border border-emerald-800/30 px-2 py-2 text-center">
                      <div className="text-[9px] text-emerald-300/50 uppercase">In Credit</div>
                      <div className="text-sm font-bold text-emerald-400">{currencySymbol}{totalCredit.toFixed(2)}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* All member balances */}
            {balanceMembers.length === 0 ? (
              <div className="text-sm text-emerald-100/60 text-center py-8">No financial activity yet.</div>
            ) : (
              <div className="space-y-2">
                {balanceMembers.map((m) => {
                  const isExpanded = expandedMember === m.profile_id;
                  const balanceColor = m.balance > 0 ? "text-red-400" : m.balance < 0 ? "text-emerald-400" : "text-emerald-200/60";

                  return (
                    <div key={m.profile_id} className="rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/70 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setExpandedMember(isExpanded ? null : m.profile_id)}
                        className="w-full flex items-center gap-3 px-3 py-3 text-left"
                      >
                        {m.profile?.avatar_url ? (
                          <img src={m.profile.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">
                            {m.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
                          </div>
                        )}
                        <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{m.profile?.name ?? "Unknown"}</span>
                        <div className="text-right shrink-0">
                          <div className={`text-sm font-bold ${balanceColor}`}>
                            {m.balance > 0 ? `Owes ${currencySymbol}${m.balance.toFixed(2)}` :
                             m.balance < 0 ? `Credit ${currencySymbol}${Math.abs(m.balance).toFixed(2)}` : "Settled"}
                          </div>
                          <div className="text-[10px] text-emerald-200/40">
                            {currencySymbol}{m.total_charged.toFixed(2)} charged · {currencySymbol}{m.total_paid.toFixed(2)} paid
                          </div>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="border-t border-emerald-900/50 px-3 py-3 space-y-2">
                          {m.transactions.length === 0 ? (
                            <div className="text-[11px] text-emerald-200/40">No transactions.</div>
                          ) : (
                            m.transactions.map((tx: any) => (
                              <div key={tx.id} className="flex items-start justify-between gap-2 text-[11px]">
                                <div>
                                  <div className="text-emerald-100/80">{txTypeLabel(tx.type)}</div>
                                  {(tx.event?.name ?? tx.competition?.name) && (
                                    <div className="text-emerald-200/40">{tx.event?.name ?? tx.competition?.name}</div>
                                  )}
                                  {tx.note && <div className="text-emerald-200/40 italic">{tx.note}</div>}
                                  <div className="text-emerald-200/30">{new Date(tx.created_at).toLocaleDateString()}</div>
                                </div>
                                <span className={`font-semibold shrink-0 ${tx.amount > 0 ? "text-red-400" : "text-emerald-400"}`}>
                                  {tx.amount > 0 ? "+" : ""}{currencySymbol}{Math.abs(tx.amount).toFixed(2)}
                                </span>
                              </div>
                            ))
                          )}
                          {/* Record payment / Withdraw buttons */}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setPaymentAmount("");
                                setPaymentNote("");
                                setPaymentModal({ profileId: m.profile_id, name: m.profile?.name ?? "Player" });
                              }}
                              className="flex-1 py-1.5 rounded-full border border-emerald-700/50 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-900/30"
                            >
                              + Record Payment
                            </button>
                            {(() => {
                              const ws = winningSummaries.find((w: any) => w.profile_id === m.profile_id);
                              const undrawn = ws?.undrawn_winnings ?? 0;
                              if (undrawn <= 0) return null;
                              return (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setWithdrawalAmount(undrawn.toFixed(2));
                                    setWithdrawalModal({ profileId: m.profile_id, name: m.profile?.name ?? "Player", maxAmount: undrawn });
                                  }}
                                  className="flex-1 py-1.5 rounded-full border border-amber-700/50 text-[11px] font-semibold text-amber-200 hover:bg-amber-900/20"
                                >
                                  Withdraw {currencySymbol}{undrawn.toFixed(2)}
                                </button>
                              );
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Prize Pot P&L — Winnings Summary */}
            {winningsLoaded && winningSummaries.length > 0 && (
              <div className="rounded-2xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-3 space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-emerald-200/50 font-semibold">Prize Pot P&L</div>
                <div className="space-y-1">
                  {winningSummaries
                    .filter((w: any) => w.all_time_spent > 0 || w.all_time_won > 0)
                    .map((w: any) => (
                      <button
                        key={w.profile_id}
                        type="button"
                        onClick={() => setWinningsPlayer(w)}
                        className="w-full flex items-center justify-between py-2 px-2 rounded-xl hover:bg-emerald-900/20 text-left"
                      >
                        <span className="text-sm text-emerald-100">{w.profile?.name ?? "Unknown"}</span>
                        <div className="flex gap-4 text-[11px]">
                          <span className="text-emerald-200/50">In: {currencySymbol}{w.all_time_spent.toFixed(2)}</span>
                          <span className="text-emerald-400">Won: {currencySymbol}{w.all_time_won.toFixed(2)}</span>
                          <span className={w.all_time_net >= 0 ? "text-emerald-300 font-semibold" : "text-red-400 font-semibold"}>
                            Net: {w.all_time_net >= 0 ? "+" : ""}{currencySymbol}{w.all_time_net.toFixed(2)}
                          </span>
                        </div>
                      </button>
                    ))}
                </div>
              </div>
            )}

            {/* Payment record modal */}
            {paymentModal && (
              <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setPaymentModal(null)}>
                <div className="w-full max-w-sm rounded-t-2xl bg-[#0b3b21] border border-emerald-800/60 px-4 py-5 space-y-3" onClick={(e) => e.stopPropagation()}>
                  <div className="text-sm font-semibold text-emerald-100">Record Payment — {paymentModal.name}</div>
                  <div>
                    <label className="text-[10px] uppercase text-emerald-200/50">Amount ({currencySymbol})</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      className="mt-1 w-full rounded-lg bg-emerald-950/60 border border-emerald-800/50 text-emerald-100 px-3 py-2 text-sm focus:outline-none"
                      placeholder="0.00"
                      autoFocus
                    />
                    {(() => {
                      const amt = parseFloat(paymentAmount);
                      const member = balanceMembers.find((m) => m.profile_id === paymentModal.profileId);
                      if (!isNaN(amt) && amt > 0 && member) {
                        const newBal = member.balance - amt;
                        return (
                          <div className="mt-1 text-[11px] text-emerald-200/60">
                            Balance: {currencySymbol}{member.balance.toFixed(2)} → <span className={newBal < 0 ? "text-emerald-400" : "text-emerald-200"}>{currencySymbol}{newBal.toFixed(2)}</span>
                            {newBal < 0 && <span className="text-emerald-400 ml-1">(credit)</span>}
                          </div>
                        );
                      }
                    })()}
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-emerald-200/50">Note (optional)</label>
                    <input
                      type="text"
                      value={paymentNote}
                      onChange={(e) => setPaymentNote(e.target.value)}
                      className="mt-1 w-full rounded-lg bg-emerald-950/60 border border-emerald-800/50 text-emerald-100 px-3 py-2 text-sm focus:outline-none"
                      placeholder="e.g. Cash received at club"
                    />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button type="button" onClick={() => setPaymentModal(null)} className="flex-1 py-2 rounded-full border border-emerald-800/50 text-sm text-emerald-200">Cancel</button>
                    <button
                      type="button"
                      disabled={paymentSubmitting || !paymentAmount || parseFloat(paymentAmount) <= 0}
                      onClick={async () => {
                        const amt = parseFloat(paymentAmount);
                        if (isNaN(amt) || amt <= 0) return;
                        setPaymentSubmitting(true);
                        const session = await getViewerSession();
                        if (!session) { setPaymentSubmitting(false); return; }
                        await fetch(`/api/majors/groups/${groupId}/transactions`, {
                          method: "POST",
                          headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
                          body: JSON.stringify({ profile_id: paymentModal.profileId, type: "payment", amount: -amt, note: paymentNote || null }),
                        });
                        const [balRes, winRes] = await Promise.all([
                          fetch(`/api/majors/groups/${groupId}/balances`, { headers: { Authorization: `Bearer ${session.accessToken}` } }),
                          fetch(`/api/majors/groups/${groupId}/winnings`, { headers: { Authorization: `Bearer ${session.accessToken}` } }),
                        ]);
                        if (balRes.ok) { const j = await balRes.json(); setBalanceMembers(j.members ?? []); }
                        if (winRes.ok) { const j = await winRes.json(); setWinningSummaries(j.members ?? []); }
                        setPaymentSubmitting(false);
                        setPaymentModal(null);
                      }}
                      className="flex-1 py-2 rounded-full bg-emerald-700 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {paymentSubmitting ? "Saving…" : "Record"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Withdrawal modal */}
            {withdrawalModal && (
              <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setWithdrawalModal(null)}>
                <div className="w-full max-w-sm rounded-t-2xl bg-[#0b3b21] border border-emerald-800/60 px-4 py-5 space-y-3" onClick={(e) => e.stopPropagation()}>
                  <div className="text-sm font-semibold text-emerald-100">Mark Winnings as Withdrawn — {withdrawalModal.name}</div>
                  <p className="text-[11px] text-emerald-200/60">Records that winnings have been physically handed to the player. Reduces their balance but does not affect their winnings stats.</p>
                  <div>
                    <label className="text-[10px] uppercase text-emerald-200/50">Amount ({currencySymbol}) — Max: {currencySymbol}{withdrawalModal.maxAmount.toFixed(2)}</label>
                    <input
                      type="number"
                      min="0.01"
                      max={withdrawalModal.maxAmount}
                      step="0.01"
                      value={withdrawalAmount}
                      onChange={(e) => setWithdrawalAmount(e.target.value)}
                      className="mt-1 w-full rounded-lg bg-emerald-950/60 border border-emerald-800/50 text-emerald-100 px-3 py-2 text-sm focus:outline-none"
                      autoFocus
                    />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button type="button" onClick={() => setWithdrawalModal(null)} className="flex-1 py-2 rounded-full border border-emerald-800/50 text-sm text-emerald-200">Cancel</button>
                    <button
                      type="button"
                      disabled={withdrawalSubmitting || !withdrawalAmount || parseFloat(withdrawalAmount) <= 0}
                      onClick={async () => {
                        const amt = parseFloat(withdrawalAmount);
                        if (isNaN(amt) || amt <= 0) return;
                        setWithdrawalSubmitting(true);
                        const session = await getViewerSession();
                        if (!session) { setWithdrawalSubmitting(false); return; }
                        await fetch(`/api/majors/groups/${groupId}/withdraw`, {
                          method: "POST",
                          headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
                          body: JSON.stringify({ profile_id: withdrawalModal.profileId, amount: amt, note: "Winnings withdrawn" }),
                        });
                        const [balRes, winRes] = await Promise.all([
                          fetch(`/api/majors/groups/${groupId}/balances`, { headers: { Authorization: `Bearer ${session.accessToken}` } }),
                          fetch(`/api/majors/groups/${groupId}/winnings`, { headers: { Authorization: `Bearer ${session.accessToken}` } }),
                        ]);
                        if (balRes.ok) { const j = await balRes.json(); setBalanceMembers(j.members ?? []); }
                        if (winRes.ok) { const j = await winRes.json(); setWinningSummaries(j.members ?? []); }
                        setWithdrawalSubmitting(false);
                        setWithdrawalModal(null);
                      }}
                      className="flex-1 py-2 rounded-full bg-amber-700 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {withdrawalSubmitting ? "Saving…" : "Confirm Withdrawal"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Invite member sheet */}
            {showInvite && group && (
              <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setShowInvite(false)}>
                <div className="w-full max-w-sm rounded-t-2xl bg-[#0b3b21] border border-emerald-800/60 px-4 py-5 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                  <InvitePlayerSheet
                    groupId={group.id}
                    excludedProfileIds={new Set(members.map((m) => m.profile_id))}
                    onInvited={() => refreshMembers()}
                    onClose={() => setShowInvite(false)}
                  />
                </div>
              </div>
            )}

            {/* Winnings detail drawer */}
            {winningsPlayer && (
              <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setWinningsPlayer(null)}>
                <div className="w-full max-w-sm rounded-t-2xl bg-[#0b3b21] border border-emerald-800/60 px-4 py-5 space-y-3 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold text-emerald-100">{winningsPlayer.profile?.name} — Prize Pot History</div>
                    <button type="button" onClick={() => setWinningsPlayer(null)} className="text-emerald-200/40 text-xl">✕</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-xl bg-emerald-950/40 border border-emerald-900/40 py-2">
                      <div className="text-[9px] text-emerald-200/40 uppercase">Spent</div>
                      <div className="text-sm font-bold text-emerald-200">{currencySymbol}{winningsPlayer.all_time_spent.toFixed(2)}</div>
                    </div>
                    <div className="rounded-xl bg-emerald-950/40 border border-emerald-900/40 py-2">
                      <div className="text-[9px] text-emerald-200/40 uppercase">Won</div>
                      <div className="text-sm font-bold text-emerald-400">{currencySymbol}{winningsPlayer.all_time_won.toFixed(2)}</div>
                    </div>
                    <div className={`rounded-xl border py-2 ${winningsPlayer.all_time_net >= 0 ? "bg-emerald-900/20 border-emerald-700/30" : "bg-red-950/30 border-red-900/30"}`}>
                      <div className="text-[9px] text-emerald-200/40 uppercase">Net</div>
                      <div className={`text-sm font-bold ${winningsPlayer.all_time_net >= 0 ? "text-emerald-300" : "text-red-400"}`}>
                        {winningsPlayer.all_time_net >= 0 ? "+" : ""}{currencySymbol}{winningsPlayer.all_time_net.toFixed(2)}
                      </div>
                    </div>
                  </div>
                  {winningsPlayer.by_season?.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase text-emerald-200/40 mb-1">By Season</div>
                      {winningsPlayer.by_season.map((s: any, i: number) => (
                        <div key={i} className="flex justify-between text-[11px] py-1 border-b border-emerald-900/30">
                          <span className="text-emerald-200/70">{s.season_name}</span>
                          <span className="text-emerald-200/50">In: {currencySymbol}{s.spent.toFixed(2)} · Won: <span className="text-emerald-400">{currencySymbol}{s.won.toFixed(2)}</span></span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div>
                    <div className="text-[10px] uppercase text-emerald-200/40 mb-1">Pot History</div>
                    {winningsPlayer.pot_history?.length === 0 ? (
                      <div className="text-[11px] text-emerald-200/30 py-2">No prize pot transactions yet</div>
                    ) : winningsPlayer.pot_history?.map((ph: any, i: number) => (
                      <div key={i} className="py-2 border-b border-emerald-900/20 space-y-0.5">
                        <div className="flex justify-between">
                          <span className="text-sm text-emerald-100">{ph.pot_name}</span>
                          {ph.payout_amount != null && (
                            <span className="text-sm font-semibold text-emerald-400">+{currencySymbol}{ph.payout_amount.toFixed(2)}</span>
                          )}
                        </div>
                        <div className="text-[10px] text-emerald-200/40">
                          {ph.event_name ?? ph.season_name ?? "Group"} · Entry: {currencySymbol}{ph.entry_fee.toFixed(2)}
                          {ph.payout_position && ` · ${ph.payout_position === 1 ? "1st" : ph.payout_position === 2 ? "2nd" : ph.payout_position === 3 ? "3rd" : `${ph.payout_position}th`}`}
                          {" · "}{new Date(ph.date).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Financial settings */}
            <div className="rounded-2xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-3 space-y-3">
              <div className="text-[10px] uppercase tracking-wider text-emerald-200/50 font-semibold">Financial Settings</div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-emerald-50">Allow Credit Balances</div>
                  <div className="text-[10px] text-emerald-200/50">Players can owe money before settling</div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (!group) return;
                    const session = await getViewerSession();
                    if (!session) return;
                    const newVal = !((group as any).allow_credit ?? true);
                    await fetch(`/api/majors/groups/${groupId}`, {
                      method: "PATCH",
                      headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
                      body: JSON.stringify({ allow_credit: newVal }),
                    });
                    setGroup((prev) => prev ? { ...prev, allow_credit: newVal } as any : prev);
                  }}
                  className={`relative inline-flex items-center w-10 h-6 rounded-full transition-colors ${
                    ((group as any)?.allow_credit ?? true) ? "bg-emerald-600" : "bg-emerald-900/50 border border-emerald-900/70"
                  }`}
                >
                  <span className={`absolute left-0 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    ((group as any)?.allow_credit ?? true) ? "translate-x-5" : "translate-x-1"
                  }`} />
                </button>
              </div>
            </div>
          </div>
        );
      }

      // Player view — own balance only
      return (
        <div className="space-y-4">
          {myBalance == null ? (
            <div className="text-sm text-emerald-100/60 text-center py-8">Loading…</div>
          ) : (
            <>
              <div className="rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/70 px-4 py-4 text-center space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-emerald-200/50">Your Balance</div>
                <div className={`text-2xl font-extrabold ${myBalance.balance > 0 ? "text-red-400" : myBalance.balance < 0 ? "text-emerald-400" : "text-emerald-200/60"}`}>
                  {myBalance.balance > 0 ? `Owes ${currencySymbol}${myBalance.balance.toFixed(2)}` :
                   myBalance.balance < 0 ? `Credit ${currencySymbol}${Math.abs(myBalance.balance).toFixed(2)}` : "Settled"}
                </div>
                <div className="text-[11px] text-emerald-200/40">
                  {currencySymbol}{myBalance.total_charged.toFixed(2)} charged · {currencySymbol}{myBalance.total_paid.toFixed(2)} paid
                </div>
              </div>

              <div className="space-y-2">
                {myBalance.transactions.length === 0 ? (
                  <div className="text-sm text-emerald-100/60 text-center py-4">No transactions yet.</div>
                ) : (
                  myBalance.transactions.map((tx: any) => (
                    <div key={tx.id} className="flex items-start justify-between gap-2 rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5">
                      <div>
                        <div className="text-sm text-emerald-100/80">{txTypeLabel(tx.type)}</div>
                        {(tx.event?.name ?? tx.competition?.name) && (
                          <div className="text-[11px] text-emerald-200/50">{tx.event?.name ?? tx.competition?.name}</div>
                        )}
                        {tx.note && <div className="text-[10px] text-emerald-200/40 italic">{tx.note}</div>}
                        <div className="text-[10px] text-emerald-200/30">{new Date(tx.created_at).toLocaleDateString()}</div>
                      </div>
                      <span className={`text-sm font-bold shrink-0 ${tx.amount > 0 ? "text-red-400" : "text-emerald-400"}`}>
                        {tx.amount > 0 ? "+" : ""}{currencySymbol}{Math.abs(tx.amount).toFixed(2)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      );
    })(),

    settings: isAdminOrOwner ? (
      <div className="space-y-4">
        {/* Group Details */}
        {(() => {
          const details = groupDetailsForm ?? {
            name: group.name,
            description: group.description ?? "",
            access: deriveAccess(group),
            max_members: group.max_members ? String(group.max_members) : "",
          };
          const setDetails = (patch: Partial<typeof details>) =>
            setGroupDetailsForm({ ...details, ...patch });
          const activeAccess = ACCESS_OPTIONS.find((a) => a.value === details.access) ?? ACCESS_OPTIONS[0];

          return (
            <div className="space-y-3">
              <div className="text-[10px] uppercase tracking-wider text-emerald-200/50">Group Details</div>
              <div className="space-y-3 rounded-2xl border border-emerald-900/50 bg-[#0b3b21]/60 p-4">
                <div className="space-y-1.5">
                  <div className="text-[10px] text-emerald-200/50">Name</div>
                  <input
                    type="text"
                    value={details.name}
                    onChange={(e) => setDetails({ name: e.target.value })}
                    className="w-full rounded-xl bg-[#042713] border border-emerald-900/60 px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-200/30 focus:outline-none focus:border-emerald-600"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="text-[10px] text-emerald-200/50">Description</div>
                  <textarea
                    rows={3}
                    value={details.description}
                    onChange={(e) => setDetails({ description: e.target.value })}
                    placeholder="What is this group about?"
                    className="w-full rounded-xl bg-[#042713] border border-emerald-900/60 px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-200/30 focus:outline-none focus:border-emerald-600 resize-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="text-[10px] text-emerald-200/50">Access</div>
                  <div className="space-y-1.5">
                    {ACCESS_OPTIONS.map((a) => (
                      <button
                        key={a.value}
                        type="button"
                        onClick={() => setDetails({ access: a.value })}
                        className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          activeAccess.value === a.value
                            ? "border-emerald-500 bg-emerald-900/50"
                            : "border-emerald-900/50 bg-[#0b3b21]/40 hover:border-emerald-700/50"
                        }`}
                      >
                        <div className="text-sm font-semibold text-emerald-50">{a.label}</div>
                        <div className="text-[11px] text-emerald-200/55">{a.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="text-[10px] text-emerald-200/50">Max Members (optional)</div>
                  <input
                    type="number"
                    min={2}
                    value={details.max_members}
                    onChange={(e) => setDetails({ max_members: e.target.value })}
                    placeholder="Unlimited"
                    className="w-full rounded-xl bg-[#042713] border border-emerald-900/60 px-3 py-2 text-sm text-emerald-50 placeholder:text-emerald-200/30 focus:outline-none focus:border-emerald-600"
                  />
                </div>
                <button
                  type="button"
                  disabled={!groupDetailsForm || savingGroupDetails}
                  onClick={async () => {
                    if (!groupDetailsForm) return;
                    setSavingGroupDetails(true);
                    try {
                      const session = await getViewerSession();
                      if (!session) return;
                      const access = ACCESS_OPTIONS.find((a) => a.value === groupDetailsForm.access) ?? ACCESS_OPTIONS[0];
                      const res = await fetch(`/api/majors/groups/${groupId}`, {
                        method: "PATCH",
                        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: groupDetailsForm.name.trim(),
                          description: groupDetailsForm.description.trim() || null,
                          privacy: access.privacy,
                          join_method: access.join_method,
                          max_members: groupDetailsForm.max_members ? parseInt(groupDetailsForm.max_members, 10) : null,
                        }),
                      });
                      if (res.ok) {
                        const j = await res.json();
                        setGroup((g) => g ? { ...g, ...j.group } : g);
                        setGroupDetailsForm(null);
                      }
                    } finally {
                      setSavingGroupDetails(false);
                    }
                  }}
                  className="w-full py-2.5 rounded-full bg-emerald-700 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {savingGroupDetails ? "Saving…" : "Save Group Details"}
                </button>
              </div>
            </div>
          );
        })()}

        {/* Group Image */}
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-emerald-200/50">Group Image</div>
          <div className="flex items-center gap-3">
            {group.image_url ? (
              <img src={group.image_url} alt={group.name} className="h-16 w-16 rounded-2xl object-cover border border-emerald-700/40 shrink-0" />
            ) : (
              <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-emerald-800 to-emerald-950 flex items-center justify-center text-xl font-bold text-emerald-200 shrink-0">
                {group.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <label className="cursor-pointer flex-1">
              <div className={`w-full py-2.5 rounded-full border border-emerald-700/60 text-sm font-semibold text-emerald-200 text-center hover:bg-emerald-900/30 transition-colors ${uploadingImage ? "opacity-50" : ""}`}>
                {uploadingImage ? "Uploading…" : group.image_url ? "Change Image" : "Add Image"}
              </div>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploadingImage}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImageUpload(file);
                }}
              />
            </label>
          </div>
        </div>
        {/* League Settings */}
        <div className="space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-emerald-200/50">League Settings</div>
          {(() => {
            const prefs = leagueSettingsForm ?? group.default_scoring_prefs ?? {};
            const competitionType = (prefs as any).competition_type ?? null;
            const scoringModel = (prefs as any).scoring_model ?? null;
            const pointsModel = (prefs as any).points_model ?? null;
            const handicapMode = (prefs as any).handicap_rules?.mode ?? "allowance_pct";
            const allowancePct = (prefs as any).handicap_rules?.allowance_pct ?? null;
            const maxHandicap = (prefs as any).handicap_rules?.max_handicap ?? null;
            const availableFormats = getFormatsForGroupType(group.type as MajorGroupType);
            const scoringLocked = competitionType && !FORMAT_ALLOWS_SCORING_CHOICE(competitionType as EventTypeV2);

            const setPrefs = (patch: Record<string, unknown>) => {
              const base = leagueSettingsForm ?? (group.default_scoring_prefs as any) ?? {};
              setLeagueSettingsForm({ ...base, ...patch } as any);
            };

            return (
              <div className="space-y-4 rounded-2xl border border-emerald-900/50 bg-[#0b3b21]/60 p-4">
                {/* Default Format */}
                <div className="space-y-1.5">
                  <div className="text-[10px] text-emerald-200/50">Default Format</div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setPrefs({ competition_type: null, scoring_model: null })}
                      className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${competitionType === null ? "bg-emerald-700 text-white border-emerald-600" : "border-emerald-900/60 text-emerald-200/60 hover:text-emerald-100"}`}
                    >
                      None
                    </button>
                    {availableFormats.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setPrefs({ competition_type: t.value, scoring_model: FORMAT_DEFAULT_SCORING[t.value as EventTypeV2] ?? "net" })}
                        className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${competitionType === t.value ? "bg-emerald-700 text-white border-emerald-600" : "border-emerald-900/60 text-emerald-200/60 hover:text-emerald-100"}`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Scoring model */}
                <div className="space-y-1.5">
                  <div className="text-[10px] text-emerald-200/50">Default Scoring</div>
                  {scoringLocked ? (
                    <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/40 px-3 py-1.5 text-[11px] text-emerald-200/55">
                      {scoringModel === "stableford_points" ? "Stableford Points" : "Match Result"} — determined by format
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      {(["net", "gross", "stableford_points"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setPrefs({ scoring_model: m })}
                          className={`flex-1 py-1.5 rounded-full text-[11px] font-semibold transition-colors ${scoringModel === m ? "bg-emerald-700 text-white" : "border border-emerald-900/60 text-emerald-200/60 hover:text-emerald-100"}`}
                        >
                          {m === "net" ? "Net" : m === "gross" ? "Gross" : "Stableford"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Points model */}
                <div className="space-y-1.5">
                  <div className="text-[10px] text-emerald-200/50">Points System</div>
                  <div className="flex gap-2 flex-wrap">
                    {([
                      { v: null, label: "None" },
                      { v: "fedex_style", label: "Fedex" },
                      { v: "position_based", label: "Position" },
                      { v: "custom_table", label: "Custom" },
                    ] as const).map(({ v, label }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setPrefs({ points_model: v })}
                        className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors ${(pointsModel ?? null) === v ? "bg-emerald-700 text-white" : "border border-emerald-900/60 text-emerald-200/60 hover:text-emerald-100"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Handicap rules */}
                <div className="space-y-2">
                  <div className="text-[10px] text-emerald-200/50">Handicap Mode</div>
                  <select
                    value={handicapMode}
                    onChange={(e) => {
                      const hr = { ...((prefs as any).handicap_rules ?? {}), mode: e.target.value };
                      setPrefs({ handicap_rules: hr });
                    }}
                    className="w-full bg-[#042713] border border-emerald-900/60 rounded-lg px-2 py-1.5 text-[12px] text-emerald-100 focus:outline-none [color-scheme:dark]"
                  >
                    <option value="allowance_pct">Percentage Allowance</option>
                    <option value="compare_against_lowest">Off the Lowest</option>
                    <option value="fixed">Fixed Handicap</option>
                    <option value="none">No Handicap</option>
                  </select>
                  {(handicapMode === "allowance_pct" || handicapMode === "compare_against_lowest") && (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 space-y-1.5">
                        <div className="text-[10px] text-emerald-200/50">Allowance %</div>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={allowancePct ?? ""}
                            onChange={(e) => {
                              const v = e.target.value ? parseInt(e.target.value, 10) : null;
                              const hr = { ...((prefs as any).handicap_rules ?? {}), mode: handicapMode, allowance_pct: v };
                              setPrefs({ handicap_rules: hr });
                            }}
                            placeholder="100"
                            className="w-16 bg-[#042713] border border-emerald-900/60 rounded-lg px-2 py-1 text-[12px] text-emerald-100 text-center"
                          />
                          <span className="text-[11px] text-emerald-200/50">%</span>
                        </div>
                      </div>
                      {handicapMode !== "none" && (
                        <div className="flex-1 space-y-1.5">
                          <div className="text-[10px] text-emerald-200/50">Max Handicap</div>
                          <input
                            type="number"
                            min={0}
                            value={maxHandicap ?? ""}
                            onChange={(e) => {
                              const v = e.target.value ? parseInt(e.target.value, 10) : null;
                              const hr = { ...((prefs as any).handicap_rules ?? {}), mode: handicapMode, max_handicap: v };
                              setPrefs({ handicap_rules: hr });
                            }}
                            placeholder="No limit"
                            className="w-full bg-[#042713] border border-emerald-900/60 rounded-lg px-2 py-1 text-[12px] text-emerald-100 text-center"
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {handicapMode !== "none" && handicapMode !== "allowance_pct" && handicapMode !== "compare_against_lowest" && (
                    <div className="space-y-1.5">
                      <div className="text-[10px] text-emerald-200/50">Max Handicap</div>
                      <input
                        type="number"
                        min={0}
                        value={maxHandicap ?? ""}
                        onChange={(e) => {
                          const v = e.target.value ? parseInt(e.target.value, 10) : null;
                          const hr = { ...((prefs as any).handicap_rules ?? {}), mode: handicapMode, max_handicap: v };
                          setPrefs({ handicap_rules: hr });
                        }}
                        placeholder="No limit"
                        className="w-full bg-[#042713] border border-emerald-900/60 rounded-lg px-2 py-1 text-[12px] text-emerald-100 text-center"
                      />
                    </div>
                  )}
                </div>

                <div className="text-[9px] text-emerald-200/30 text-center">Applies to new events only — past seasons unaffected.</div>

                <button
                  type="button"
                  disabled={savingLeagueSettings}
                  onClick={async () => {
                    if (!leagueSettingsForm) return;
                    setSavingLeagueSettings(true);
                    try {
                      const session = await getViewerSession();
                      if (!session) return;
                      const res = await fetch(`/api/majors/groups/${groupId}`, {
                        method: "PATCH",
                        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
                        body: JSON.stringify({ default_scoring_prefs: leagueSettingsForm }),
                      });
                      if (res.ok) {
                        const j = await res.json();
                        setGroup((g) => g ? { ...g, default_scoring_prefs: j.group.default_scoring_prefs } : g);
                        setLeagueSettingsForm(null);
                      }
                    } finally {
                      setSavingLeagueSettings(false);
                    }
                  }}
                  className="w-full py-2.5 rounded-full bg-emerald-700 text-sm font-semibold text-white disabled:opacity-40"
                >
                  {savingLeagueSettings ? "Saving…" : "Save League Settings"}
                </button>
              </div>
            );
          })()}
        </div>

        {/* Group Charges */}
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-emerald-200/50">Group Charges</div>
          <p className="text-[10px] text-emerald-200/40">Charges that appear in the event join drawer. Mandatory charges are auto-applied; optional charges can be selected by the player.</p>
          <div className="rounded-2xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-3 space-y-2">
            {groupCharges.length === 0 && !addGroupChargeForm ? (
              <div className="text-[11px] text-emerald-200/40 text-center py-2">No group charges defined</div>
            ) : (
              groupCharges.map((gc: any) => (
                <div key={gc.id} className="flex items-center justify-between py-1.5 border-b border-emerald-900/20">
                  <div>
                    <div className="text-sm text-emerald-100">{gc.name}</div>
                    <div className="text-[10px] text-emerald-200/40">
                      {gc.is_mandatory ? "Mandatory" : "Optional"} · {gc.is_active ? "Active" : "Inactive"}
                      {gc.description && ` · ${gc.description}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-emerald-200">£{Number(gc.amount).toFixed(2)}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        const session = await getViewerSession();
                        if (!session) return;
                        await fetch(`/api/majors/groups/${groupId}/group-charges/${gc.id}`, {
                          method: "PATCH",
                          headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
                          body: JSON.stringify({ is_active: !gc.is_active }),
                        });
                        setGroupCharges((prev) => prev.map((c) => c.id === gc.id ? { ...c, is_active: !c.is_active } : c));
                      }}
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${gc.is_active ? "border-emerald-700/50 text-emerald-300" : "border-emerald-900/40 text-emerald-200/30"}`}
                    >
                      {gc.is_active ? "Active" : "Inactive"}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const session = await getViewerSession();
                        if (!session) return;
                        await fetch(`/api/majors/groups/${groupId}/group-charges/${gc.id}`, {
                          method: "DELETE",
                          headers: { Authorization: `Bearer ${session.accessToken}` },
                        });
                        setGroupCharges((prev) => prev.filter((c) => c.id !== gc.id));
                      }}
                      className="text-red-400/50 hover:text-red-400 text-sm"
                    >✕</button>
                  </div>
                </div>
              ))
            )}

            {addGroupChargeForm ? (
              <div className="space-y-2 pt-2">
                <input
                  type="text"
                  placeholder="Charge name"
                  value={addGroupChargeForm.name}
                  onChange={(e) => setAddGroupChargeForm((f) => f && { ...f, name: e.target.value })}
                  className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2 text-sm text-emerald-50 focus:outline-none"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    placeholder="Amount (£)"
                    min="0"
                    step="0.01"
                    value={addGroupChargeForm.amount}
                    onChange={(e) => setAddGroupChargeForm((f) => f && { ...f, amount: e.target.value })}
                    className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2 text-sm text-emerald-50 focus:outline-none"
                  />
                  <select
                    value={addGroupChargeForm.category}
                    onChange={(e) => setAddGroupChargeForm((f) => f && { ...f, category: e.target.value })}
                    className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2 text-sm text-emerald-50 focus:outline-none"
                  >
                    <option value="other">Other</option>
                    <option value="green_fee">Green Fee</option>
                    <option value="membership">Membership</option>
                    <option value="admin">Admin Fee</option>
                  </select>
                </div>
                <input
                  type="text"
                  placeholder="Description (optional)"
                  value={addGroupChargeForm.description}
                  onChange={(e) => setAddGroupChargeForm((f) => f && { ...f, description: e.target.value })}
                  className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-3 py-2 text-sm text-emerald-50 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setAddGroupChargeForm((f) => f && { ...f, is_mandatory: !f.is_mandatory })}
                  className="flex items-center gap-2 w-full py-2 px-2 rounded-lg border border-emerald-900/40 hover:bg-emerald-900/20"
                >
                  <div className={`relative w-8 h-5 rounded-full transition-colors ${addGroupChargeForm.is_mandatory ? "bg-emerald-600" : "bg-emerald-900/50"}`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${addGroupChargeForm.is_mandatory ? "translate-x-3.5" : "translate-x-0.5"}`} />
                  </div>
                  <div className="text-left">
                    <div className="text-[11px] font-semibold text-emerald-100">Mandatory</div>
                    <div className="text-[10px] text-emerald-200/40">Auto-charged to all players when joining an event</div>
                  </div>
                </button>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setAddGroupChargeForm(null)}
                    className="flex-1 py-1.5 rounded-full border border-emerald-900/60 text-[11px] text-emerald-200/60">
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={savingGroupCharge || !addGroupChargeForm.name || !addGroupChargeForm.amount}
                    onClick={async () => {
                      const amt = parseFloat(addGroupChargeForm.amount);
                      if (!addGroupChargeForm.name || isNaN(amt) || amt <= 0) return;
                      setSavingGroupCharge(true);
                      const session = await getViewerSession();
                      if (!session) { setSavingGroupCharge(false); return; }
                      const res = await fetch(`/api/majors/groups/${groupId}/group-charges`, {
                        method: "POST",
                        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: addGroupChargeForm.name.trim(),
                          amount: amt,
                          category: addGroupChargeForm.category,
                          description: addGroupChargeForm.description.trim() || null,
                          is_mandatory: addGroupChargeForm.is_mandatory,
                        }),
                      });
                      if (res.ok) {
                        const j = await res.json();
                        setGroupCharges((prev) => [...prev, j.charge]);
                        setAddGroupChargeForm(null);
                      }
                      setSavingGroupCharge(false);
                    }}
                    className="flex-1 py-1.5 rounded-full bg-emerald-700 text-[11px] font-semibold text-white disabled:opacity-50"
                  >
                    {savingGroupCharge ? "Saving…" : "Add Charge"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddGroupChargeForm({ name: "", amount: "", category: "other", description: "", is_mandatory: false })}
                className="w-full py-1.5 rounded-full border border-emerald-700/50 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-900/30"
              >
                + Add Group Charge
              </button>
            )}
          </div>
        </div>

        {/* Danger zone — owner only */}
        {myRole === "owner" && (
          <div className="rounded-2xl border border-red-900/40 bg-red-900/10 p-4 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-red-400/70 font-semibold">Danger Zone</div>
            <button
              type="button"
              onClick={async () => {
                if (!confirm("Delete this group? This cannot be undone.")) return;
                const session = await getViewerSession();
                if (!session) return;
                await fetch(`/api/majors/groups/${groupId}`, {
                  method: "DELETE",
                  headers: { Authorization: `Bearer ${session.accessToken}` },
                });
                router.push("/majors");
              }}
              className="w-full py-2 rounded-full border border-red-800/60 text-sm text-red-400 hover:bg-red-900/30"
            >
              Delete Group
            </button>
          </div>
        )}
      </div>
    ) : (
      <div className="text-sm text-emerald-100/60 text-center py-8">
        Only owners and admins can access settings.
      </div>
    ),
  };

  const visibleTabs = TABS.filter((t) => {
    if (t.id === "settings" || t.id === "finances") return isAdminOrOwner;
    return true;
  });

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] max-w-sm mx-auto">
      {/* Header */}
      <div className="px-4 pt-8 flex items-center justify-between mb-3">
        <button type="button" onClick={() => router.push("/majors")} className="text-[11px] text-emerald-100/70 hover:text-emerald-50">
          ← Hub
        </button>
        <div className="w-14" />
      </div>

      {/* Group hero */}
      <div className="px-4 mb-4 flex items-start gap-3">
        {group.image_url ? (
          <img src={group.image_url} alt={group.name} className="h-14 w-14 rounded-2xl object-cover border border-emerald-700/40 shrink-0" />
        ) : (
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-800 to-emerald-950 flex items-center justify-center text-lg font-bold text-emerald-200 shrink-0">
            {group.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 pt-0.5">
          <h1 className="text-xl font-bold text-[#f5e6b0] leading-tight truncate">{group.name}</h1>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            <span className="text-[10px] text-emerald-200/55 border border-emerald-900/50 rounded-full px-2 py-0.5 capitalize">
              {group.type.replace(/_/g, " ")}
            </span>
            {group.ciaga_tag !== "none" && (
              <span className="text-[10px] text-amber-300/80 border border-amber-800/40 rounded-full px-2 py-0.5 capitalize">
                {group.ciaga_tag}
              </span>
            )}
          </div>
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
              {t.id === "members" && (pendingMembers.length + invitedMembers.length) > 0 && isAdminOrOwner && (
                <span className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded-full bg-amber-500 text-[9px] font-bold text-white">
                  {pendingMembers.length + invitedMembers.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-8">{tabContent[tab]}</div>

      {/* Player detail drawer */}
      {selectedPlayerForDrawer && (
        <div
          className="fixed inset-0 z-50 flex items-end"
          onClick={() => setSelectedPlayerForDrawer(null)}
        >
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative w-full max-w-md mx-auto bg-[#0c2e18] rounded-t-2xl p-5 space-y-4 max-h-[80dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              {selectedPlayerForDrawer.avatarUrl ? (
                <img src={selectedPlayerForDrawer.avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover shrink-0" />
              ) : (
                <div className="h-10 w-10 rounded-full bg-emerald-900/60 grid place-items-center text-sm font-bold text-emerald-200 shrink-0">
                  {selectedPlayerForDrawer.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-emerald-50 truncate">{selectedPlayerForDrawer.name}</div>
                <div className="text-[10px] text-emerald-200/50">
                  {selectedPlayerForDrawer.seasonLabel ?? liveStandingsData?.current_season?.season_label ?? "Current Season"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPlayerForDrawer(null)}
                className="h-7 w-7 grid place-items-center rounded-full border border-emerald-900/60 text-emerald-200/60 hover:text-emerald-100 shrink-0"
              >
                ✕
              </button>
            </div>
            {playerBreakdownLoading ? (
              <div className="text-sm text-emerald-100/60 text-center py-4">Loading…</div>
            ) : playerBreakdownEntries.length === 0 ? (
              <div className="text-sm text-emerald-100/60 text-center py-4">No events played this season.</div>
            ) : (
              <div className="space-y-2">
                <div className="text-[10px] text-emerald-200/50 uppercase tracking-wider">Event Breakdown</div>
                {playerBreakdownEntries.map((e) => (
                  <div key={e.event_id} className="flex items-center gap-2 rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2">
                    <PositionBadge position={e.position} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold text-emerald-100 truncate">{e.event_name}</div>
                      {e.event_date && (
                        <div className="text-[10px] text-emerald-200/50">
                          {new Date(e.event_date).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0 space-y-0.5">
                      {e.points_earned != null && (
                        <div className="text-[11px] font-bold text-[#f5e6b0]">{e.points_earned} pts</div>
                      )}
                      {e.gross_score != null && (
                        <div className="text-[10px] text-emerald-200/55">{e.gross_score} gross</div>
                      )}
                      {e.net_score != null && (
                        <div className="text-[10px] text-emerald-200/40">{e.net_score} net</div>
                      )}
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1 border-t border-emerald-900/40">
                  <span className="text-[11px] text-emerald-200/50">{playerBreakdownEntries.length} event{playerBreakdownEntries.length !== 1 ? "s" : ""}</span>
                  <span className="text-[11px] font-bold text-[#f5e6b0]">
                    {playerBreakdownEntries.reduce((sum, e) => sum + (e.points_earned ?? 0), 0)} pts total
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
