"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type {
  MajorGroup,
  MajorGroupMembershipWithProfile,
  GroupStandingWithProfile,
  CompetitionWithGroup,
  CompetitionSeries,
  SeriesEventTemplate,
} from "@/lib/majors/types";
import { competitionStatusLabel } from "@/lib/majors/labels";

type CompetitionSeriesWithEventCount = CompetitionSeries & {
  event_templates: Pick<SeriesEventTemplate, "id">[];
};

type Tab = "overview" | "competitions" | "standings" | "schedule" | "history" | "members" | "series" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "competitions", label: "Competitions" },
  { id: "standings", label: "Standings" },
  { id: "members", label: "Members" },
  { id: "series", label: "Series" },
  { id: "settings", label: "Settings" },
];

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

export default function GroupDetailClient({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [group, setGroup] = useState<GroupData | null>(null);
  const [competitions, setCompetitions] = useState<CompetitionWithGroup[]>([]);
  const [standings, setStandings] = useState<GroupStandingWithProfile[]>([]);
  const [members, setMembers] = useState<MajorGroupMembershipWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinedStatus, setJoinedStatus] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [series, setSeries] = useState<CompetitionSeriesWithEventCount[]>([]);
  const [showCreateSeriesModal, setShowCreateSeriesModal] = useState(false);
  const [newSeriesName, setNewSeriesName] = useState("");
  const [newSeriesDesc, setNewSeriesDesc] = useState("");
  const [newSeriesMonth, setNewSeriesMonth] = useState("");
  const [newSeriesHandicapPct, setNewSeriesHandicapPct] = useState("100");
  const [newSeriesHandicapMax, setNewSeriesHandicapMax] = useState("");
  const [creatingSeries, setCreatingSeries] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const session = await getViewerSession();
        if (!session || cancelled) return;
        setMyProfileId(session.profileId);
        const headers = { Authorization: `Bearer ${session.accessToken}` };

        const [groupRes, compsRes, standingsRes, membersRes, seriesRes] = await Promise.all([
          fetch(`/api/majors/groups/${groupId}`, { headers }),
          fetch(`/api/majors/competitions?group_id=${groupId}`, { headers }),
          fetch(`/api/majors/leaderboard?group_id=${groupId}`, { headers }),
          fetch(`/api/majors/groups/${groupId}/members`, { headers }),
          fetch(`/api/majors/series?group_id=${groupId}`, { headers }),
        ]);

        if (cancelled) return;
        if (groupRes.ok) {
          const j = await groupRes.json();
          setGroup(j.group);
        }
        if (compsRes.ok) {
          const j = await compsRes.json();
          setCompetitions(j.competitions ?? []);
        }
        if (standingsRes.ok) {
          const j = await standingsRes.json();
          setStandings(j.rows ?? []);
        }
        if (membersRes.ok) {
          const j = await membersRes.json();
          const mems: MajorGroupMembershipWithProfile[] = j.members ?? [];
          setMembers(mems);
          const own = mems.find((m) => m.profile_id === session.profileId);
          setMyRole(own?.role ?? null);
          setJoinedStatus(own?.status ?? null);
        }
        if (seriesRes.ok) {
          const j = await seriesRes.json();
          setSeries(j.series ?? []);
        }

      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [groupId]);

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

  const handleCreateSeries = async () => {
    if (!newSeriesName.trim()) return;
    setCreatingSeries(true);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch("/api/majors/series", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          group_id: groupId,
          name: newSeriesName.trim(),
          description: newSeriesDesc.trim() || null,
          recur_annually: true,
          typical_month: newSeriesMonth ? parseInt(newSeriesMonth, 10) : null,
          template_settings: {
            handicap_allowance_pct: parseInt(newSeriesHandicapPct, 10) || 100,
            max_handicap: newSeriesHandicapMax ? parseInt(newSeriesHandicapMax, 10) : null,
          },
        }),
      });
      if (res.ok) {
        const j = await res.json();
        setSeries((prev) => [...prev, j.series]);
        setShowCreateSeriesModal(false);
        setNewSeriesName("");
        setNewSeriesDesc("");
        setNewSeriesMonth("");
        setNewSeriesHandicapPct("100");
        setNewSeriesHandicapMax("");
      }
    } finally {
      setCreatingSeries(false);
    }
  };

  const isAdminOrOwner = myRole === "owner" || myRole === "admin";
  const upcomingComps = competitions.filter((c) => c.majors_status === "upcoming" || c.majors_status === "live");
  const completedComps = competitions.filter((c) => c.majors_status === "completed");

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
      : "border-emerald-900/70 bg-[#0b3b21]/80";

  const compStatusBadge = (status: string) =>
    status === "live"
      ? "bg-amber-900/50 text-amber-300 border-amber-800/50"
      : status === "completed"
      ? "bg-emerald-900/60 text-emerald-300 border-emerald-800/50"
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
      <div className="space-y-4">
        {group.description && (
          <p className="text-[13px] text-emerald-100/75 leading-relaxed">{group.description}</p>
        )}

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Type", value: group.type.replace(/_/g, " ") },
            { label: "Privacy", value: group.privacy.replace(/_/g, " ") },
            { label: "Members", value: String(group.member_count) },
            { label: "Competitions", value: String(competitions.length) },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5">
              <div className="text-[10px] text-emerald-200/50 uppercase tracking-wider mb-0.5">{item.label}</div>
              <div className="text-sm font-semibold text-emerald-50 capitalize">{item.value}</div>
            </div>
          ))}
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

    competitions: (
      <div className="space-y-3">
        {isAdminOrOwner && (
          <button
            type="button"
            onClick={() => router.push(`/majors/competitions/create?group_id=${groupId}`)}
            className="w-full py-2.5 rounded-full border border-emerald-700/60 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/30"
          >
            + New Competition
          </button>
        )}
        {competitions.length === 0 && (
          <div className="text-sm text-emerald-100/60 text-center py-8">No competitions yet.</div>
        )}
        {competitions.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => router.push(`/majors/competitions/${c.id}`)}
            className={`w-full text-left rounded-2xl border p-4 space-y-1 hover:brightness-110 transition-all ${compStatusColour(c.majors_status)}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-emerald-50 truncate">{c.name}</span>
              <span className={`shrink-0 text-[9px] font-semibold px-2 py-0.5 rounded-full border capitalize ${compStatusBadge(c.majors_status)}`}>
                {competitionStatusLabel(c)}
              </span>
            </div>
            <div className="text-[11px] text-emerald-100/60 flex items-center gap-2">
              {c.competition_date && <span>{new Date(c.competition_date).toLocaleDateString([], { month: "short", day: "numeric" })}</span>}
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

    standings: (
      <div className="space-y-2">
        {standings.length === 0 && (
          <div className="text-sm text-emerald-100/60 text-center py-8">
            Standings will appear once competitions are completed.
          </div>
        )}
        {standings.map((s) => (
          <div
            key={s.id}
            className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
              s.position === 1
                ? "border-[#f5e6b0]/25 bg-[#f5e6b0]/5"
                : s.position === 2
                ? "border-[#c0c0c0]/20 bg-[#c0c0c0]/5"
                : s.position === 3
                ? "border-[#cd7f32]/20 bg-[#cd7f32]/5"
                : "border-emerald-900/50 bg-[#0b3b21]/60"
            }`}
          >
            <PositionBadge position={s.position ?? null} />
            {s.profile?.avatar_url ? (
              <img src={s.profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" />
            ) : (
              <div className="h-7 w-7 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">
                {s.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
              </div>
            )}
            <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{s.profile?.name ?? "Unknown"}</span>
            <div className="text-right shrink-0 space-y-0.5">
              <div className="text-xs font-extrabold text-[#f5e6b0]">{s.season_points} pts</div>
              <div className="flex gap-1 justify-end">
                <span className="text-[9px] text-emerald-100/50 bg-emerald-900/40 rounded px-1">{s.events_played} evts</span>
                {s.wins > 0 && (
                  <span className="text-[9px] text-[#f5e6b0]/70 bg-[#f5e6b0]/10 rounded px-1">{s.wins}W</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    ),

    // Keep schedule/history accessible via competitions tab filtering
    schedule: (
      <div className="space-y-3">
        {upcomingComps.length === 0 && (
          <div className="text-sm text-emerald-100/60 text-center py-8">No upcoming competitions.</div>
        )}
        {upcomingComps.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => router.push(`/majors/competitions/${c.id}`)}
            className={`w-full text-left rounded-2xl border p-4 space-y-1 hover:brightness-110 transition-all ${compStatusColour(c.majors_status)}`}
          >
            <div className="text-sm font-semibold text-emerald-50">{c.name}</div>
            <div className="text-[11px] text-emerald-100/60 flex gap-2">
              {c.competition_date && <span>{new Date(c.competition_date).toLocaleDateString([], { month: "short", day: "numeric" })}</span>}
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
            onClick={() => router.push(`/majors/competitions/${c.id}`)}
            className="w-full text-left rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-1 hover:border-emerald-700/70"
          >
            <div className="text-sm font-semibold text-emerald-50">{c.name}</div>
            <div className="text-[11px] text-emerald-100/60">
              {c.competition_date && new Date(c.competition_date).toLocaleDateString()}
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
            <div key={m.id} className="flex items-center gap-3 rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2.5">
              <button
                type="button"
                className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                onClick={() => router.push(`/player/${m.profile_id}`)}
              >
                {m.profile?.avatar_url ? (
                  <img src={m.profile.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200 shrink-0">
                    {m.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
                  </div>
                )}
                <span className="flex-1 text-sm font-semibold text-emerald-50 truncate text-left">{m.profile?.name ?? m.profile_id}</span>
              </button>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-full border capitalize ${roleBadge(m.role)}`}>
                  {m.role}
                </span>
                {/* Admin can promote/demote members (not owner) */}
                {isAdminOrOwner && m.role !== "owner" && m.profile_id !== myProfileId && myRole === "owner" && (
                  <button
                    type="button"
                    onClick={() => handleMemberAction(m.id, { role: m.role === "admin" ? "member" : "admin" })}
                    className="text-[9px] text-emerald-200/50 hover:text-emerald-200 transition-colors"
                  >
                    {m.role === "admin" ? "↓" : "↑"}
                  </button>
                )}
              </div>
            </div>
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

    series: (
      <div className="space-y-3">
        {isAdminOrOwner && (
          <button
            type="button"
            onClick={() => setShowCreateSeriesModal(true)}
            className="w-full py-2.5 rounded-full border border-emerald-700/60 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/30"
          >
            + Create Series Template
          </button>
        )}
        {series.length === 0 ? (
          <div className="text-sm text-emerald-100/60 text-center py-8">
            {isAdminOrOwner
              ? "No series yet. Create a series template to generate competitions each year."
              : "No series templates for this group."}
          </div>
        ) : (
          series.map((s) => {
            const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
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
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {s.recur_annually && (
                      <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full border border-emerald-700/50 bg-emerald-900/30 text-emerald-300">
                        Annual
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => router.push(`/majors/series/${s.id}`)}
                      className="text-[11px] text-emerald-300/70 hover:text-emerald-200"
                    >
                      Manage →
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="text-[10px] text-emerald-200/55 border border-emerald-900/50 rounded-full px-2 py-0.5 capitalize">
                    {s.template_competition_type}
                  </span>
                  <span className="text-[10px] text-emerald-200/55 border border-emerald-900/50 rounded-full px-2 py-0.5 capitalize">
                    {s.template_scoring_model}
                  </span>
                  {s.typical_month != null && (
                    <span className="text-[10px] text-emerald-200/55 border border-emerald-900/50 rounded-full px-2 py-0.5">
                      Usually {monthNames[(s.typical_month ?? 1) - 1]}
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
                        // Series has named events — go to series detail to create season
                        router.push(`/majors/series/${s.id}`);
                      } else {
                        // Legacy single-event series — create competition directly
                        router.push(
                          `/majors/competitions/create?group_id=${groupId}&series_id=${s.id}&year=${new Date().getFullYear()}`
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

  const visibleTabs = isAdminOrOwner
    ? TABS
    : TABS.filter((t) => t.id !== "settings" && t.id !== "series");

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

      {/* Create Series Modal */}
      {showCreateSeriesModal && (
        <div className="fixed inset-0 bg-black/70 flex items-end justify-center z-50 pb-[env(safe-area-inset-bottom)]">
          <div className="w-full max-w-sm bg-[#0c2e18] rounded-t-2xl p-6 space-y-4 max-h-[85dvh] overflow-y-auto">
            <div className="text-sm font-semibold text-emerald-50">New Series Template</div>
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Series Name *</label>
                <input
                  type="text"
                  value={newSeriesName}
                  onChange={(e) => setNewSeriesName(e.target.value)}
                  placeholder="e.g. The Club Masters"
                  className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-2.5 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Description (optional)</label>
                <textarea
                  value={newSeriesDesc}
                  onChange={(e) => setNewSeriesDesc(e.target.value)}
                  rows={2}
                  placeholder="Brief description of this recurring competition"
                  className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-2.5 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600 resize-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Typical Month (optional)</label>
                <select
                  value={newSeriesMonth}
                  onChange={(e) => setNewSeriesMonth(e.target.value)}
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
                  value={newSeriesHandicapPct}
                  onChange={(e) => setNewSeriesHandicapPct(e.target.value)}
                  className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-2.5 text-sm text-emerald-50 focus:outline-none focus:border-emerald-600"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] uppercase tracking-wider text-emerald-200/60">Max Handicap (optional)</label>
                <input
                  type="number"
                  min={0}
                  value={newSeriesHandicapMax}
                  onChange={(e) => setNewSeriesHandicapMax(e.target.value)}
                  placeholder="Leave blank for no limit"
                  className="w-full rounded-xl border border-emerald-900/60 bg-[#0b3b21]/60 px-4 py-2.5 text-sm text-emerald-50 placeholder:text-emerald-100/35 focus:outline-none focus:border-emerald-600"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => { setShowCreateSeriesModal(false); setNewSeriesName(""); setNewSeriesDesc(""); setNewSeriesMonth(""); setNewSeriesHandicapPct("100"); setNewSeriesHandicapMax(""); }}
                className="flex-1 py-2.5 rounded-full border border-emerald-800 text-sm text-emerald-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateSeries}
                disabled={!newSeriesName.trim() || creatingSeries}
                className="flex-1 py-2.5 rounded-full bg-emerald-700 text-sm font-semibold text-white disabled:opacity-40"
              >
                {creatingSeries ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
