"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import type { MajorGroup } from "@/lib/majors/types";

type GroupSummary = MajorGroup & { member_count: number; role?: string };

type PendingInvite = {
  id: string;
  group_id: string;
  joined_at: string;
  group: { id: string; name: string; type: string; image_url: string | null } | null;
  inviter: { id: string; name: string | null } | null;
};

export default function MajorsHubClient() {
  const router = useRouter();
  const [myGroups, setMyGroups] = useState<GroupSummary[]>([]);
  const [discoverGroups, setDiscoverGroups] = useState<GroupSummary[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinedIds, setJoinedIds] = useState<Record<string, "active" | "pending">>({});
  const [acceptingInviteId, setAcceptingInviteId] = useState<string | null>(null);
  const [decliningInviteId, setDecliningInviteId] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    const session = await getViewerSession();
    if (!session) return;
    const headers = { Authorization: `Bearer ${session.accessToken}` };
    const [mineRes, discoverRes, invitesRes] = await Promise.all([
      fetch("/api/majors/groups", { headers }),
      fetch("/api/majors/groups?mode=discover", { headers }),
      fetch("/api/majors/groups/invites", { headers }),
    ]);
    if (mineRes.ok) {
      const j = await mineRes.json();
      setMyGroups(j.groups ?? []);
    }
    if (discoverRes.ok) {
      const j = await discoverRes.json();
      setDiscoverGroups(j.groups ?? []);
    }
    if (invitesRes.ok) {
      const j = await invitesRes.json();
      setPendingInvites(j.invites ?? []);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await fetchGroups();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchGroups]);

  const handleAcceptInvite = async (invite: PendingInvite) => {
    setAcceptingInviteId(invite.id);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/groups/${invite.group_id}/join`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
        await fetchGroups();
      }
    } finally {
      setAcceptingInviteId(null);
    }
  };

  const handleDeclineInvite = async (invite: PendingInvite) => {
    setDecliningInviteId(invite.id);
    try {
      const session = await getViewerSession();
      if (!session) return;
      await fetch(`/api/majors/groups/${invite.group_id}/members?profile_id=${session.profileId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
    } finally {
      setDecliningInviteId(null);
    }
  };

  const handleJoin = async (group: GroupSummary) => {
    setJoiningId(group.id);
    try {
      const session = await getViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/groups/${group.id}/join`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const j = await res.json();
        const status: "active" | "pending" = j.membership?.status ?? "active";
        setJoinedIds((prev) => ({ ...prev, [group.id]: status }));
        if (status === "active") {
          // Move to my groups
          setMyGroups((prev) => [...prev, group]);
          setDiscoverGroups((prev) => prev.filter((g) => g.id !== group.id));
        }
      }
    } finally {
      setJoiningId(null);
    }
  };

  // Filter out groups already joined from discover list
  const myGroupIds = new Set(myGroups.map((g) => g.id));
  const filteredDiscover = discoverGroups.filter((g) => !myGroupIds.has(g.id));

  return (
    <div className="min-h-[100dvh] pb-[env(safe-area-inset-bottom)] max-w-sm mx-auto">
      {/* Header */}
      <div className="px-4 pt-8 flex items-center justify-between mb-6">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="text-[11px] text-emerald-100/70 hover:text-emerald-50 flex items-center gap-1"
        >
          ← Home
        </button>
        <h1 className="text-lg font-bold tracking-wide text-[#f5e6b0]">Majors Hub</h1>
        <button
          type="button"
          onClick={() => router.push("/majors/groups/create")}
          className="text-[11px] text-emerald-400 hover:text-emerald-300"
        >
          + Create
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-emerald-100/60 text-center py-20">Loading…</div>
      ) : (
        <div className="px-4 space-y-8 pb-12">
          {/* Pending Invitations */}
          {pendingInvites.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-[10px] uppercase tracking-[0.18em] text-amber-300/70">Invitations</h2>
              {pendingInvites.map((invite) => (
                <div
                  key={invite.id}
                  className="rounded-2xl border border-amber-700/40 bg-amber-950/20 px-3 py-3 space-y-2"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-amber-800/60 to-amber-950 flex items-center justify-center text-sm font-bold text-amber-200 shrink-0">
                      {invite.group?.name.slice(0, 2).toUpperCase() ?? "?"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-emerald-50 truncate">{invite.group?.name ?? "Unknown Group"}</div>
                      <div className="text-[10px] text-emerald-200/50 mt-0.5">
                        Invited by {invite.inviter?.name ?? "someone"}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => invite.group && router.push(`/majors/groups/${invite.group_id}`)}
                      className="text-[11px] text-amber-300/70 hover:text-amber-300 shrink-0"
                    >
                      View →
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleAcceptInvite(invite)}
                      disabled={acceptingInviteId === invite.id}
                      className="flex-1 py-1.5 rounded-full bg-emerald-700 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                    >
                      {acceptingInviteId === invite.id ? "Joining…" : "Accept"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeclineInvite(invite)}
                      disabled={decliningInviteId === invite.id}
                      className="flex-1 py-1.5 rounded-full border border-emerald-800/50 text-xs text-emerald-200/60 hover:text-emerald-200 disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </section>
          )}

          {/* My Groups */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/55">My Groups</h2>
              <button
                type="button"
                onClick={() => router.push("/majors/groups/create")}
                className="text-[11px] text-emerald-400 hover:text-emerald-300"
              >
                + New
              </button>
            </div>

            {myGroups.length === 0 ? (
              <div className="rounded-2xl border border-emerald-900/50 bg-[#0b3b21]/40 p-6 text-center space-y-3">
                <p className="text-2xl">⛳</p>
                <p className="text-sm text-emerald-100/60">You're not in any groups yet.</p>
                <button
                  type="button"
                  onClick={() => router.push("/majors/groups/create")}
                  className="px-5 py-2.5 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600"
                >
                  Create a Group
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {myGroups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => router.push(`/majors/groups/${g.id}`)}
                    className="w-full flex items-center gap-3 rounded-2xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-3 hover:brightness-110 transition-all text-left"
                  >
                    {g.image_url ? (
                      <img src={g.image_url} alt="" className="h-10 w-10 rounded-xl object-cover shrink-0" />
                    ) : (
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-800 to-emerald-950 flex items-center justify-center text-sm font-bold text-emerald-200 shrink-0">
                        {g.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-emerald-50 truncate">{g.name}</span>
                        {g.role === "owner" && (
                          <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border border-[#f5e6b0]/30 bg-[#f5e6b0]/10 text-[#f5e6b0]">
                            Owner
                          </span>
                        )}
                        {g.role === "admin" && (
                          <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border border-emerald-700/50 bg-emerald-900/30 text-emerald-300">
                            Admin
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-emerald-200/50 capitalize">{g.type.replace(/_/g, " ")}</span>
                        <span className="text-emerald-800">·</span>
                        <span className="text-[10px] text-emerald-200/50">{g.member_count} {g.member_count === 1 ? "member" : "members"}</span>
                      </div>
                    </div>
                    <span className="text-emerald-700 text-sm shrink-0">→</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Discover Groups */}
          <section className="space-y-3">
            <h2 className="text-[10px] uppercase tracking-[0.18em] text-emerald-200/55">Discover Groups</h2>

            {filteredDiscover.length === 0 ? (
              <div className="rounded-2xl border border-emerald-900/40 bg-[#0b3b21]/30 p-5 text-center">
                <p className="text-sm text-emerald-100/50">No public groups to discover right now.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredDiscover.map((g) => {
                  const pendingJoin = joinedIds[g.id] === "pending";
                  return (
                    <div
                      key={g.id}
                      className="flex items-center gap-3 rounded-2xl border border-emerald-900/50 bg-[#0b3b21]/60 px-3 py-3"
                    >
                      {g.image_url ? (
                        <img src={g.image_url} alt="" className="h-10 w-10 rounded-xl object-cover shrink-0" />
                      ) : (
                        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-emerald-800 to-emerald-950 flex items-center justify-center text-sm font-bold text-emerald-200 shrink-0">
                          {g.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-emerald-50 truncate">{g.name}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-emerald-200/50 capitalize">{g.type.replace(/_/g, " ")}</span>
                          {g.member_count > 0 && (
                            <>
                              <span className="text-emerald-800">·</span>
                              <span className="text-[10px] text-emerald-200/50">{g.member_count} {g.member_count === 1 ? "member" : "members"}</span>
                            </>
                          )}
                        </div>
                      </div>
                      {pendingJoin ? (
                        <span className="text-[10px] text-amber-300/80 border border-amber-800/40 rounded-full px-2.5 py-1 shrink-0">
                          Pending
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={joiningId === g.id}
                          onClick={() => handleJoin(g)}
                          className="shrink-0 text-[11px] font-semibold text-emerald-300 border border-emerald-700/50 rounded-full px-3 py-1 hover:bg-emerald-900/40 disabled:opacity-50 transition-colors"
                        >
                          {joiningId === g.id ? "…" : g.join_method === "request" ? "Request" : "Join"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
