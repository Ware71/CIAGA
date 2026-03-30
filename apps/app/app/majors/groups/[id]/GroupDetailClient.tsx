"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type {
  MajorGroup,
  MajorGroupMembershipWithProfile,
  GroupStandingWithProfile,
  CompetitionWithGroup,
} from "@/lib/majors/types";

type Tab = "overview" | "competitions" | "standings" | "schedule" | "history" | "members" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "competitions", label: "Competitions" },
  { id: "standings", label: "Standings" },
  { id: "schedule", label: "Schedule" },
  { id: "history", label: "History" },
  { id: "members", label: "Members" },
  { id: "settings", label: "Settings" },
];

type GroupData = MajorGroup & { member_count: number };

export default function GroupDetailClient({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [group, setGroup] = useState<GroupData | null>(null);
  const [competitions, setCompetitions] = useState<CompetitionWithGroup[]>([]);
  const [standings, setStandings] = useState<GroupStandingWithProfile[]>([]);
  const [members, setMembers] = useState<MajorGroupMembershipWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [joinedStatus, setJoinedStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const session = await getViewerSession();
        if (!session || cancelled) return;
        const headers = { Authorization: `Bearer ${session.accessToken}` };

        const [groupRes, compsRes, standingsRes, membersRes] = await Promise.all([
          fetch(`/api/majors/groups/${groupId}`, { headers }),
          fetch(`/api/majors/competitions?group_id=${groupId}`, { headers }),
          fetch(`/api/majors/leaderboard?group_id=${groupId}`, { headers }),
          fetch(`/api/majors/groups/${groupId}/members`, { headers }),
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
          // Find own membership
          const own = mems.find((m) => m.profile_id === session.profileId);
          setMyRole(own?.role ?? null);
          setJoinedStatus(own?.status ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [groupId]);

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

  const tabContent: Record<Tab, React.ReactNode> = {
    overview: (
      <div className="space-y-4">
        {group.description && (
          <p className="text-[13px] text-emerald-100/75 leading-relaxed">{group.description}</p>
        )}
        <div className="grid grid-cols-2 gap-3 text-sm">
          {[
            { label: "Type", value: group.type.replace("_", " ") },
            { label: "Privacy", value: group.privacy.replace("_", " ") },
            { label: "Members", value: group.member_count },
            { label: "Tag", value: group.ciaga_tag === "none" ? "—" : group.ciaga_tag },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2">
              <div className="text-[10px] text-emerald-200/55 uppercase tracking-wider">{item.label}</div>
              <div className="text-sm font-semibold text-emerald-50 capitalize">{item.value}</div>
            </div>
          ))}
        </div>
        {group.season_start && (
          <div className="text-[11px] text-emerald-100/55">
            Season: {new Date(group.season_start).toLocaleDateString()} –{" "}
            {group.season_end ? new Date(group.season_end).toLocaleDateString() : "ongoing"}
          </div>
        )}
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
          <div className="text-sm text-amber-300/80 text-center">Request pending approval</div>
        )}
      </div>
    ),
    competitions: (
      <div className="space-y-3">
        {isAdminOrOwner && (
          <button
            type="button"
            onClick={() => router.push(`/majors/competitions/create?group_id=${groupId}`)}
            className="w-full py-2 rounded-full border border-emerald-700/60 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/30"
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
            className="w-full text-left rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-1 hover:border-emerald-700/70"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-emerald-50 truncate">{c.name}</span>
              <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/60 text-emerald-200/70 capitalize">
                {c.majors_status}
              </span>
            </div>
            <div className="text-[11px] text-emerald-100/60 flex gap-3">
              {c.competition_date && <span>{new Date(c.competition_date).toLocaleDateString()}</span>}
              {c.course && <span>{c.course.name}</span>}
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
          <div key={s.id} className="flex items-center gap-3 rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2">
            <span className="w-6 text-center text-xs font-extrabold text-[#f5e6b0]">{s.position ?? "—"}</span>
            {s.profile?.avatar_url ? (
              <img src={s.profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <div className="h-7 w-7 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200">
                {s.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
              </div>
            )}
            <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{s.profile?.name ?? "Unknown"}</span>
            <div className="text-right shrink-0">
              <div className="text-xs font-extrabold text-[#f5e6b0]">{s.season_points} pts</div>
              <div className="text-[10px] text-emerald-100/50">{s.events_played} events · {s.wins} wins</div>
            </div>
          </div>
        ))}
      </div>
    ),
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
            className="w-full text-left rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 space-y-1 hover:border-emerald-700/70"
          >
            <div className="text-sm font-semibold text-emerald-50">{c.name}</div>
            <div className="text-[11px] text-emerald-100/60 flex gap-3">
              {c.competition_date && <span>{new Date(c.competition_date).toLocaleDateString()}</span>}
              {c.course && <span>{c.course.name}</span>}
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
      <div className="space-y-2">
        {members.filter((m) => m.status === "pending").length > 0 && isAdminOrOwner && (
          <div className="rounded-xl border border-amber-900/50 bg-amber-900/20 p-3 mb-2">
            <div className="text-[10px] uppercase text-amber-300/70 mb-2">Pending Requests</div>
            {members.filter((m) => m.status === "pending").map((m) => (
              <div key={m.id} className="flex items-center justify-between py-1">
                <span className="text-sm text-emerald-50">{m.profile?.name ?? m.profile_id}</span>
                {/* Accept/decline would need additional API endpoints */}
              </div>
            ))}
          </div>
        )}
        {members.filter((m) => m.status === "active").map((m) => (
          <div key={m.id} className="flex items-center gap-3 rounded-xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-2">
            {m.profile?.avatar_url ? (
              <img src={m.profile.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <div className="h-7 w-7 rounded-full bg-emerald-900/60 grid place-items-center text-[10px] font-bold text-emerald-200">
                {m.profile?.name?.slice(0, 2).toUpperCase() ?? "?"}
              </div>
            )}
            <span className="flex-1 text-sm font-semibold text-emerald-50 truncate">{m.profile?.name ?? m.profile_id}</span>
            <span className="text-[10px] text-emerald-200/55 capitalize">{m.role}</span>
          </div>
        ))}
      </div>
    ),
    settings: isAdminOrOwner ? (
      <div className="space-y-4">
        <div className="text-sm text-emerald-100/60">
          Group settings are managed via the admin panel. Direct editing coming soon.
        </div>
        <button
          type="button"
          onClick={() => router.push(`/admin/majors`)}
          className="w-full py-2 rounded-full border border-emerald-700/60 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/30"
        >
          Open Admin Tools
        </button>
      </div>
    ) : (
      <div className="text-sm text-emerald-100/60 text-center py-8">
        Only owners and admins can access settings.
      </div>
    ),
  };

  const visibleTabs = isAdminOrOwner ? TABS : TABS.filter((t) => t.id !== "settings");

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] pt-8 max-w-sm mx-auto">
      {/* Header */}
      <div className="px-4 flex items-center justify-between mb-4">
        <button type="button" onClick={() => router.push("/majors")} className="text-[11px] text-emerald-100/70 hover:text-emerald-50">
          ← Hub
        </button>
        <h1 className="text-base font-semibold text-[#f5e6b0] truncate max-w-[180px]">{group.name}</h1>
        <div className="w-14" />
      </div>

      {group.ciaga_tag !== "none" && (
        <div className="px-4 mb-3">
          <span className="text-[10px] uppercase tracking-wider text-amber-300/80 border border-amber-700/40 px-2 py-0.5 rounded-full capitalize">
            {group.ciaga_tag}
          </span>
        </div>
      )}

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
    </div>
  );
}
