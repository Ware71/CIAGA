"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { supabase } from "@/lib/supabaseClient";
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
import type { PlayerBreakdownEntry } from "@/app/api/majors/seasons/[id]/player-breakdown/route";
import { eventStatusLabel } from "@/lib/majors/labels";

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
  { id: "seasons", label: "Seasons" },
  { id: "competitions", label: "Competitions" },
  { id: "members", label: "Members" },
  { id: "finances", label: "Finances" },
  { id: "settings", label: "Settings" },
];

// ── Reusable dropdown selector ──────────────────────────────────────────────
function DropdownSelector<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = options.find((o) => o.value === value);
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 text-[12px] font-semibold text-emerald-100 hover:bg-emerald-900/40 transition-colors"
      >
        {selected?.label ?? value}
        <span className="text-[9px] text-emerald-400/60">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-40 min-w-[140px] rounded-2xl border border-emerald-800/60 bg-[#0c2e18] shadow-lg overflow-hidden">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-4 py-2.5 text-[12px] font-semibold transition-colors ${
                opt.value === value
                  ? "bg-emerald-700/50 text-white"
                  : "text-emerald-100/80 hover:bg-emerald-900/50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
type GroupData = MajorGroup & { member_count: number };

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

function MemberRow({
  member,
  isAdminOrOwner,
  myRole,
  myProfileId,
  onRoleToggle,
  onTeePrefSave,
  onNavigate,
}: {
  member: MajorGroupMembershipWithProfile;
  isAdminOrOwner: boolean;
  myRole: string | null;
  myProfileId: string | null;
  onRoleToggle: () => void;
  onTeePrefSave: (tee: string | null) => Promise<void>;
  onNavigate: () => void;
}) {
  const [editingTee, setEditingTee] = useState(false);
  const [teeValue, setTeeValue] = useState(member.preferred_tee_name ?? "");
  const [teeSaving, setTeeSaving] = useState(false);

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
      setEditingTee(false);
    } finally {
      setTeeSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5 space-y-1.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
          onClick={onNavigate}
        >
          {member.profile?.avatar_url ? (
            <img src={member.profile.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
          ) : (
            <div className="h-8 w-8 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">
              {member.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
            </div>
          )}
          <span className="flex-1 text-sm font-semibold text-emerald-50 truncate text-left">
            {member.profile?.name ?? member.profile_id}
          </span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border capitalize ${roleCls}`}>
            {member.role}
          </span>
          {isAdminOrOwner && member.role !== "owner" && member.profile_id !== myProfileId && myRole === "owner" && (
            <button
              type="button"
              onClick={onRoleToggle}
              className="text-[9px] text-emerald-200/50 hover:text-emerald-200 transition-colors"
            >
              {member.role === "admin" ? "↓" : "↑"}
            </button>
          )}
        </div>
      </div>

      {/* Tee preference — admins can set/edit */}
      {isAdminOrOwner && (
        <div className="flex items-center gap-2 pl-11">
          {!editingTee ? (
            <>
              <span className="text-[10px] text-emerald-200/50">Tee pref:</span>
              <span className="text-[10px] text-emerald-100/80">
                {member.preferred_tee_name ?? <span className="text-emerald-100/40">not set</span>}
              </span>
              <button
                type="button"
                onClick={() => { setTeeValue(member.preferred_tee_name ?? ""); setEditingTee(true); }}
                className="text-[9px] text-emerald-200/40 hover:text-emerald-200/80 underline"
              >
                {member.preferred_tee_name ? "change" : "set"}
              </button>
            </>
          ) : (
            <div className="flex items-center gap-1.5 flex-wrap">
              <select
                value={teeValue}
                onChange={(e) => setTeeValue(e.target.value)}
                className="rounded border border-emerald-900/70 bg-[#042713] px-2 py-0.5 text-[10px] text-emerald-50 focus:outline-none"
                disabled={teeSaving}
              >
                <option value="">— none —</option>
                {TEE_PRESETS.map((t) => <option key={t} value={t}>{t}</option>)}
                {teeValue && !TEE_PRESETS.includes(teeValue) && (
                  <option value={teeValue}>{teeValue}</option>
                )}
              </select>
              <button
                onClick={handleTeeSave}
                disabled={teeSaving}
                className="px-2 py-0.5 text-[10px] rounded bg-emerald-700 text-white hover:bg-emerald-600 disabled:opacity-50"
              >
                {teeSaving ? "..." : "Save"}
              </button>
              <button
                onClick={() => setEditingTee(false)}
                disabled={teeSaving}
                className="px-2 py-0.5 text-[10px] rounded border border-emerald-900/70 text-emerald-200 hover:bg-emerald-900/20 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function GroupDetailClient({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [compSubTab, setCompSubTab] = useState<"active" | "completed">("active");
  const [showCancelled, setShowCancelled] = useState(true);
  const [group, setGroup] = useState<GroupData | null>(null);
  const [events, setEvents] = useState<EventWithGroup[]>([]);
  const [liveStandingsData, setLiveStandingsData] = useState<LiveGroupStandingsResponse | null>(null);
  const [members, setMembers] = useState<MajorGroupMembershipWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinedStatus, setJoinedStatus] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [competitions, setCompetitions] = useState<CompetitionSeriesWithEventCount[]>([]);
  const [balanceMembers, setBalanceMembers] = useState<MemberBalanceSummary[]>([]);
  const [myBalance, setMyBalance] = useState<{ balance: number; total_charged: number; total_paid: number; transactions: GroupBalanceTransactionWithDetails[] } | null>(null);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [standingsSubTab, setStandingsSubTab] = useState<"points" | "strokes" | "avgpar">("points");
  const [showNet, setShowNet] = useState(true);
  const [competitionResults, setCompetitionResults] = useState<CompetitionResultsResponse | null>(null);
  // Seasons tab
  const [groupSeasons, setGroupSeasons] = useState<any[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | "all">("all");
  const [seasonStandings, setSeasonStandings] = useState<any[]>([]);
  const [seasonStandingsLoading, setSeasonStandingsLoading] = useState(false);
  // Player detail drawer
  const [selectedPlayerForDrawer, setSelectedPlayerForDrawer] = useState<{ profileId: string; name: string; avatarUrl: string | null; currentSeasonId: string | null } | null>(null);
  const [playerBreakdownEntries, setPlayerBreakdownEntries] = useState<PlayerBreakdownEntry[]>([]);
  const [playerBreakdownLoading, setPlayerBreakdownLoading] = useState(false);

  const [showCreateCompetitionModal, setShowCreateCompetitionModal] = useState(false);
  const [newCompetitionName, setNewCompetitionName] = useState("");
  const [newCompetitionDesc, setNewCompetitionDesc] = useState("");
  const [newCompetitionMonth, setNewCompetitionMonth] = useState("");
  const [newCompetitionHandicapPct, setNewCompetitionHandicapPct] = useState("100");
  const [newCompetitionHandicapMax, setNewCompetitionHandicapMax] = useState("");
  const [creatingCompetition, setCreatingCompetition] = useState(false);

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
          fetch(`/api/majors/seasons?group_id=${groupId}`, { headers }),
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
        const res = await fetch(`/api/majors/groups/${groupId}/balances`, { headers });
        if (!cancelled && res.ok) {
          const j = await res.json();
          setBalanceMembers(j.members ?? []);
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
    if (!currentSeasonId) { setPlayerBreakdownEntries([]); return; }
    let cancelled = false;
    setPlayerBreakdownLoading(true);
    (async () => {
      const session = await getViewerSession();
      if (!session || cancelled) return;
      const res = await fetch(
        `/api/majors/seasons/${currentSeasonId}/player-breakdown?profile_id=${profileId}`,
        { headers: { Authorization: `Bearer ${session.accessToken}` } }
      );
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

  const handleCreateCompetition = async () => {
    if (!newCompetitionName.trim()) return;
    setCreatingCompetition(true);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch("/api/majors/competitions", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          group_id: groupId,
          name: newCompetitionName.trim(),
          description: newCompetitionDesc.trim() || null,
          recur_annually: true,
          typical_month: newCompetitionMonth ? parseInt(newCompetitionMonth, 10) : null,
          template_settings: {
            handicap_allowance_pct: parseInt(newCompetitionHandicapPct, 10) || 100,
            max_handicap: newCompetitionHandicapMax ? parseInt(newCompetitionHandicapMax, 10) : null,
          },
        }),
      });
      if (res.ok) {
        const j = await res.json();
        setCompetitions((prev) => [...prev, j.competition]);
        setShowCreateCompetitionModal(false);
        setNewCompetitionName("");
        setNewCompetitionDesc("");
        setNewCompetitionMonth("");
        setNewCompetitionHandicapPct("100");
        setNewCompetitionHandicapMax("");
      }
    } finally {
      setCreatingCompetition(false);
    }
  };

  const isAdminOrOwner = myRole === "owner" || myRole === "admin";
  const isMember = !!myRole;
  const upcomingComps = events.filter((c) => c.majors_status === "upcoming" || c.majors_status === "live");
  const completedComps = events.filter(
    (c) => c.majors_status === "completed" || c.majors_status === "cancelled"
  );
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
      const rows = liveStandingsData?.rows ?? [];
      const hasLive = liveStandingsData?.hasLive ?? false;
      const showLiveIndicator = hasLive;
      const currentSeason = liveStandingsData?.current_season ?? null;

      const avatarEl = (profile: LiveGroupStandingEntry["profile"]) =>
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

      const ordinal = (n: number) => {
        const s = ["th", "st", "nd", "rd"];
        const v = n % 100;
        return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
      };

      // ── Points sub-tab ───────────────────────────────────────────────────
      const renderPoints = () => {
        if (rows.length === 0) {
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
            {rows.map((s) => {
              const improved = showLiveIndicator && s.live_position != null && s.confirmed_position != null && s.live_position < s.confirmed_position;
              const worsened = showLiveIndicator && s.live_position != null && s.confirmed_position != null && s.live_position > s.confirmed_position;
              const displayPos = showLiveIndicator ? s.live_position : s.confirmed_position;
              return (
                <button
                  key={s.profile_id}
                  type="button"
                  onClick={() => setSelectedPlayerForDrawer({ profileId: s.profile_id, name: s.profile?.name ?? "Unknown", avatarUrl: s.profile?.avatar_url ?? null, currentSeasonId: currentSeason?.id ?? null })}
                  className={`w-full flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left hover:brightness-110 transition-all ${displayPos === 1 ? "border-[#f5e6b0]/25 bg-[#f5e6b0]/5" : displayPos === 2 ? "border-[#c0c0c0]/20 bg-[#c0c0c0]/5" : displayPos === 3 ? "border-[#cd7f32]/20 bg-[#cd7f32]/5" : "border-emerald-900/50 bg-[#0b3b21]/60"}`}>
                  <div className="w-3 shrink-0 flex justify-center">
                    {improved && <span className="text-[10px] leading-none text-emerald-400">▲</span>}
                    {worsened && <span className="text-[10px] leading-none text-red-400">▼</span>}
                  </div>
                  <PositionBadge position={displayPos ?? null} />
                  {avatarEl(s.profile)}
                  <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{s.profile?.name ?? "Unknown"}</span>
                  <div className="text-right shrink-0 space-y-0.5">
                    <div className="flex items-baseline justify-end gap-1">
                      <span className="text-xs font-extrabold text-[#f5e6b0]">{s.confirmed_points} pts</span>
                      {showLiveIndicator && s.live_points_pending > 0 && (
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
        const field = showNet ? "total_net" : "total_gross";
        const sorted = [...rows]
          .filter((r) => r[field] != null)
          .sort((a, b) => (a[field] as number) - (b[field] as number));
        if (sorted.length === 0) {
          return <div className="text-sm text-emerald-100/60 text-center py-8">No stroke data for this period.</div>;
        }
        return (
          <div className="space-y-2">
            {sorted.map((s, i) => (
              <button
                key={s.profile_id}
                type="button"
                onClick={() => setSelectedPlayerForDrawer({ profileId: s.profile_id, name: s.profile?.name ?? "Unknown", avatarUrl: s.profile?.avatar_url ?? null, currentSeasonId: currentSeason?.id ?? null })}
                className={`w-full flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left hover:brightness-110 transition-all ${i === 0 ? "border-[#f5e6b0]/25 bg-[#f5e6b0]/5" : i === 1 ? "border-[#c0c0c0]/20 bg-[#c0c0c0]/5" : i === 2 ? "border-[#cd7f32]/20 bg-[#cd7f32]/5" : "border-emerald-900/50 bg-[#0b3b21]/60"}`}
              >
                <PositionBadge position={i + 1} />
                {avatarEl(s.profile)}
                <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{s.profile?.name ?? "Unknown"}</span>
                <div className="text-right shrink-0">
                  <div className="text-xs font-extrabold text-emerald-100">{s[field]}</div>
                  <div className="text-[9px] text-emerald-100/50">{s.events_played} evts</div>
                </div>
              </button>
            ))}
          </div>
        );
      };

      // ── Avg to par sub-tab ───────────────────────────────────────────────
      const renderAvgPar = () => {
        const field = showNet ? "avg_net_to_par" : "avg_gross_to_par";
        const sorted = [...rows]
          .filter((r) => r[field] != null)
          .sort((a, b) => (a[field] as number) - (b[field] as number));
        if (sorted.length === 0) {
          return <div className="text-sm text-emerald-100/60 text-center py-8">No score data for this period.</div>;
        }
        return (
          <div className="space-y-2">
            {sorted.map((s, i) => {
              const val = s[field] as number;
              const colour = val < 0 ? "text-emerald-400" : val > 0 ? "text-red-400" : "text-emerald-100/80";
              return (
                <button
                  key={s.profile_id}
                  type="button"
                  onClick={() => setSelectedPlayerForDrawer({ profileId: s.profile_id, name: s.profile?.name ?? "Unknown", avatarUrl: s.profile?.avatar_url ?? null, currentSeasonId: currentSeason?.id ?? null })}
                  className={`w-full flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left hover:brightness-110 transition-all ${i === 0 ? "border-[#f5e6b0]/25 bg-[#f5e6b0]/5" : i === 1 ? "border-[#c0c0c0]/20 bg-[#c0c0c0]/5" : i === 2 ? "border-[#cd7f32]/20 bg-[#cd7f32]/5" : "border-emerald-900/50 bg-[#0b3b21]/60"}`}
                >
                  <PositionBadge position={i + 1} />
                  {avatarEl(s.profile)}
                  <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{s.profile?.name ?? "Unknown"}</span>
                  <div className="text-right shrink-0">
                    <div className={`text-xs font-extrabold ${colour}`}>{formatToPar(val)}</div>
                    <div className="text-[9px] text-emerald-100/50">{s.events_played} evts</div>
                  </div>
                </button>
              );
            })}
          </div>
        );
      };

      return (
        <div className="space-y-3">
          {/* Current season label */}
          <div className="flex items-center justify-between">
            {currentSeason ? (
              <div className="text-[11px] text-emerald-300/60">
                {currentSeason.season_label}
                {currentSeason.status === "live" && (
                  <span className="ml-1.5 inline-flex items-center gap-1 text-amber-400/80">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse inline-block" />
                    Live
                  </span>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-emerald-200/40">No active season</div>
            )}
            {/* Metric selector dropdown */}
            <DropdownSelector
              options={[
                { value: "points" as const, label: "Points" },
                { value: "strokes" as const, label: "Strokes" },
                { value: "avgpar" as const, label: "Avg to Par" },
              ]}
              value={standingsSubTab}
              onChange={setStandingsSubTab}
            />
          </div>

          {/* Net/Gross toggle for strokes + avgpar */}
          {(standingsSubTab === "strokes" || standingsSubTab === "avgpar") && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-emerald-200/50 uppercase tracking-wider">Scoring:</span>
              <button
                type="button"
                onClick={() => setShowNet(true)}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${showNet ? "bg-emerald-700 text-white" : "border border-emerald-900/60 text-emerald-200/60"}`}
              >Net</button>
              <button
                type="button"
                onClick={() => setShowNet(false)}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${!showNet ? "bg-emerald-700 text-white" : "border border-emerald-900/60 text-emerald-200/60"}`}
              >Gross</button>
            </div>
          )}

          {/* Sub-tab content */}
          {standingsSubTab === "points" && renderPoints()}
          {standingsSubTab === "strokes" && renderStrokes()}
          {standingsSubTab === "avgpar" && renderAvgPar()}
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
              onNavigate={() => router.push(`/player/${m.profile_id}`)}
            />
          ))}
        </div>

        {/* Invite button */}
        {isAdminOrOwner && (
          <button
            type="button"
            className="w-full py-2 rounded-full border border-emerald-700/50 text-sm text-emerald-200/70 hover:text-emerald-200 hover:bg-emerald-900/20 mt-2"
            onClick={() => {/* TODO: open invite sheet */}}
          >
            + Invite Member
          </button>
        )}
      </div>
    ),

    seasons: (() => {
      const seasonOptions: { value: string; label: string }[] = [
        { value: "all", label: "All Time" },
        ...groupSeasons.map((s: any) => ({
          value: s.id as string,
          label: s.season_label ?? String(s.season_year ?? "Season"),
        })),
      ];

      const handleSeasonChange = async (id: string) => {
        setSelectedSeasonId(id);
        if (id === "all") { setSeasonStandings([]); return; }
        setSeasonStandingsLoading(true);
        try {
          const session = await getViewerSession();
          if (!session) return;
          const res = await fetch(`/api/majors/seasons/${id}/standings`, {
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

      const renderAllTime = () => {
        if (!competitionResults) return <div className="text-sm text-emerald-100/60 text-center py-8">Loading…</div>;
        const records = competitionResults.player_records;
        if (records.length === 0) return <div className="text-sm text-emerald-100/60 text-center py-8">No event data yet.</div>;
        const ordinal = (n: number) => { const s = ["th","st","nd","rd"]; const v = n % 100; return n + (s[(v-20)%10] ?? s[v] ?? s[0]); };
        return (
          <div className="space-y-2">
            {records.map((pr) => (
              <div key={pr.profile_id} className="rounded-2xl border border-emerald-900/60 bg-[#0b3b21]/70 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  {pr.profile.avatar_url ? (
                    <img src={pr.profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">{pr.profile.name?.slice(0,2).toUpperCase() ?? "?"}</div>
                  )}
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
                        <span className="text-[11px] text-emerald-200/70 truncate">{w.name ?? "Competition"}</span>
                        <span className="text-[10px] text-[#f5e6b0]/70 shrink-0">{w.year ?? ""}</span>
                      </div>
                    ))}
                  </div>
                )}
                {pr.competition_records.length === 0 && pr.standalone_wins.length === 0 && (
                  <div className="pl-9 text-[11px] text-emerald-200/40">No entries yet</div>
                )}
              </div>
            ))}
          </div>
        );
      };

      const renderSeasonStandings = () => {
        if (seasonStandingsLoading) return <div className="text-sm text-emerald-100/60 text-center py-8">Loading…</div>;
        if (seasonStandings.length === 0) return <div className="text-sm text-emerald-100/60 text-center py-8">No standings for this season.</div>;
        const selectedSeason = groupSeasons.find((s: any) => s.id === selectedSeasonId);
        return (
          <div className="space-y-2">
            {selectedSeason && (
              <button
                type="button"
                onClick={() => router.push(`/majors/seasons/${selectedSeasonId}`)}
                className="w-full text-right text-[11px] text-emerald-400/70 hover:text-emerald-300 pb-1"
              >
                View full season →
              </button>
            )}
            {seasonStandings.map((s: any) => (
              <div key={s.profile_id} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${s.position === 1 ? "border-[#f5e6b0]/25 bg-[#f5e6b0]/5" : s.position === 2 ? "border-[#c0c0c0]/20 bg-[#c0c0c0]/5" : s.position === 3 ? "border-[#cd7f32]/20 bg-[#cd7f32]/5" : "border-emerald-900/50 bg-[#0b3b21]/60"}`}>
                <PositionBadge position={s.position} />
                {s.profile?.avatar_url ? (
                  <img src={s.profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">{s.profile?.name?.slice(0,2).toUpperCase() ?? "?"}</div>
                )}
                <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{s.profile?.name ?? "Unknown"}</span>
                <div className="text-right shrink-0">
                  <div className="text-xs font-extrabold text-[#f5e6b0]">{s.season_points} pts</div>
                  <div className="flex gap-1 justify-end">
                    <span className="text-[9px] text-emerald-100/50 bg-emerald-900/40 rounded px-1">{s.events_played} evts</span>
                    {s.wins > 0 && <span className="text-[9px] text-[#f5e6b0]/70 bg-[#f5e6b0]/10 rounded px-1">{s.wins}W</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      };

      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] text-emerald-200/50 uppercase tracking-wider">Season History</div>
            <DropdownSelector
              options={seasonOptions as { value: string; label: string }[]}
              value={selectedSeasonId}
              onChange={handleSeasonChange}
            />
          </div>
          {selectedSeasonId === "all" ? renderAllTime() : renderSeasonStandings()}
        </div>
      );
    })(),

    competitions: (
      <div className="space-y-3">
        {isAdminOrOwner && (
          <button
            type="button"
            onClick={() => setShowCreateCompetitionModal(true)}
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
                    onClick={() => {
                      if ((s.event_templates?.length ?? 0) > 0) {
                        router.push(`/majors/competitions/${s.id}`);
                      } else {
                        router.push(
                          `/majors/events/create?group_id=${groupId}&competition_id=${s.id}&year=${new Date().getFullYear()}`
                        );
                      }
                    }}
                    className="w-full py-2 rounded-full bg-emerald-700/80 text-[11px] font-semibold text-white hover:bg-emerald-600"
                  >
                    {(s.event_templates?.length ?? 0) > 0
                      ? `+ Create ${new Date().getFullYear()} Season`
                      : `+ New ${new Date().getFullYear()} Instance`}
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

      if (isAdmin) {
        return (
          <div className="space-y-4">
            {/* Export CSV */}
            <a
              href={`/api/majors/groups/${groupId}/balances/export`}
              className="block w-full py-2.5 rounded-full border border-emerald-700/60 text-sm font-semibold text-emerald-200 text-center hover:bg-emerald-900/30"
            >
              Export CSV
            </a>

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
                                  <div className="text-emerald-100/80 capitalize">{tx.type.replace(/_/g, " ")}</div>
                                  {tx.competition?.name && <div className="text-emerald-200/40">{tx.competition.name}</div>}
                                  {tx.note && <div className="text-emerald-200/40 italic">{tx.note}</div>}
                                  <div className="text-emerald-200/30">{new Date(tx.created_at).toLocaleDateString()}</div>
                                </div>
                                <span className={`font-semibold shrink-0 ${tx.amount > 0 ? "text-red-400" : "text-emerald-400"}`}>
                                  {tx.amount > 0 ? "+" : ""}{currencySymbol}{Math.abs(tx.amount).toFixed(2)}
                                </span>
                              </div>
                            ))
                          )}
                          {/* Record payment button */}
                          <button
                            type="button"
                            onClick={async () => {
                              const amtStr = prompt(`Record payment from ${m.profile?.name ?? "player"} (enter amount in £):`);
                              if (!amtStr) return;
                              const amt = parseFloat(amtStr);
                              if (isNaN(amt) || amt <= 0) return;
                              const session = await getViewerSession();
                              if (!session) return;
                              await fetch(`/api/majors/groups/${groupId}/transactions`, {
                                method: "POST",
                                headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
                                body: JSON.stringify({ profile_id: m.profile_id, type: "payment", amount: -amt }),
                              });
                              // Refresh
                              const res = await fetch(`/api/majors/groups/${groupId}/balances`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
                              if (res.ok) { const j = await res.json(); setBalanceMembers(j.members ?? []); }
                            }}
                            className="w-full py-1.5 rounded-full border border-emerald-700/50 text-[11px] font-semibold text-emerald-200 hover:bg-emerald-900/30"
                          >
                            + Record Payment
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
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
                  className={`relative w-10 h-6 rounded-full transition-colors ${
                    ((group as any)?.allow_credit ?? true) ? "bg-emerald-600" : "bg-emerald-900/50 border border-emerald-900/70"
                  }`}
                >
                  <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${
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
                        <div className="text-sm text-emerald-100/80 capitalize">{tx.type.replace(/_/g, " ")}</div>
                        {tx.competition?.name && <div className="text-[11px] text-emerald-200/50">{tx.competition.name}</div>}
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
    if (t.id === "competitions") return isMember;
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
              {t.id === "members" && pendingMembers.length > 0 && isAdminOrOwner && (
                <span className="ml-1 inline-flex items-center justify-center h-4 w-4 rounded-full bg-amber-500 text-[9px] font-bold text-white">
                  {pendingMembers.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-8">{tabContent[tab]}</div>

      {/* Create Competition Modal */}
      {showCreateCompetitionModal && (
        <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50 pb-[env(safe-area-inset-bottom)]">
          <div className="w-full max-w-sm bg-[#0c2e18] rounded-t-2xl p-6 space-y-4 max-h-[85dvh] overflow-y-auto">
            <div className="text-sm font-semibold text-emerald-50">New Competition Template</div>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Competition Name *</label>
                <input
                  type="text"
                  value={newCompetitionName}
                  onChange={(e) => setNewCompetitionName(e.target.value)}
                  placeholder="e.g. The Club Masters"
                  className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-2.5 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Description (optional)</label>
                <textarea
                  value={newCompetitionDesc}
                  onChange={(e) => setNewCompetitionDesc(e.target.value)}
                  rows={2}
                  placeholder="Brief description of this recurring competition"
                  className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-2.5 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600 resize-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Typical Month (optional)</label>
                <select
                  value={newCompetitionMonth}
                  onChange={(e) => setNewCompetitionMonth(e.target.value)}
                  className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-2.5 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600"
                >
                  <option value="">— Select month —</option>
                  {["January","February","March","April","May","June","July","August","September","October","November","December"].map((m, i) => (
                    <option key={i+1} value={String(i+1)}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Default Handicap Allowance %</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={newCompetitionHandicapPct}
                  onChange={(e) => setNewCompetitionHandicapPct(e.target.value)}
                  className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-2.5 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Max Handicap (optional)</label>
                <input
                  type="number"
                  min={0}
                  value={newCompetitionHandicapMax}
                  onChange={(e) => setNewCompetitionHandicapMax(e.target.value)}
                  placeholder="Leave blank for no limit"
                  className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-2.5 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => { setShowCreateCompetitionModal(false); setNewCompetitionName(""); setNewCompetitionDesc(""); setNewCompetitionMonth(""); setNewCompetitionHandicapPct("100"); setNewCompetitionHandicapMax(""); }}
                className="flex-1 py-2.5 rounded-full border border-emerald-800 text-sm text-emerald-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateCompetition}
                disabled={!newCompetitionName.trim() || creatingCompetition}
                className="flex-1 py-2.5 rounded-full bg-emerald-700 text-sm font-semibold text-white disabled:opacity-40"
              >
                {creatingCompetition ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

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
                  {liveStandingsData?.current_season?.season_label ?? "Current Season"}
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
                    <div className="text-right shrink-0">
                      {e.points_earned != null && (
                        <div className="text-[11px] font-bold text-[#f5e6b0]">{e.points_earned} pts</div>
                      )}
                      {e.net_score != null && (
                        <div className="text-[10px] text-emerald-200/60">{e.net_score} net</div>
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
