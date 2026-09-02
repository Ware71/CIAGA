"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { requireViewerSession } from "@/lib/auth/requireViewerSession";
import { fetchWithCache, invalidateCache, readCache, writeCache, setCacheScope } from "@/lib/cache/clientCache";
import { supabase } from "@/lib/supabaseClient";
import type { MajorGroup } from "@/lib/majors/types";
import { AuthUser } from "@/components/ui/auth-user";
import { MajorsBalance, MajorsSnapshot } from "@/components/majors/MajorsOverview";
import {
  MAJORS_CARD,
  MAJORS_CARD_INTERACTIVE,
  MajorsMasthead,
  MajorsSection,
} from "@/components/majors/majorsChrome";

type GroupSummary = MajorGroup & { member_count: number; role?: string };

type PendingInvite = {
  id: string;
  group_id: string;
  joined_at: string;
  group: { id: string; name: string; type: string; image_url: string | null } | null;
  inviter: { id: string; name: string | null } | null;
};

type HubSnapshot = {
  myGroups: GroupSummary[];
  discoverGroups: GroupSummary[];
  pendingInvites: PendingInvite[];
};

const HUB_CACHE_KEY = "majors:hub";
const HUB_CACHE_OPTS = { ttl: 24 * 60 * 60_000, staleTime: 2 * 60_000 };

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
  const [isAdmin, setIsAdmin] = useState(false);

  const applyGroups = useCallback((data: HubSnapshot) => {
    setMyGroups(data.myGroups);
    setDiscoverGroups(data.discoverGroups);
    setPendingInvites(data.pendingInvites);
  }, []);

  /** Always hits the network — used after a join/accept/decline. */
  const fetchGroupsFresh = useCallback(async (): Promise<HubSnapshot> => {
    const session = await requireViewerSession();
    if (!session) return { myGroups: [], discoverGroups: [], pendingInvites: [] };
    setCacheScope(session.profileId);
    const headers = { Authorization: `Bearer ${session.accessToken}` };
    const [mineRes, discoverRes, invitesRes] = await Promise.all([
      fetch("/api/majors/groups", { headers }),
      fetch("/api/majors/groups?mode=discover", { headers }),
      fetch("/api/majors/groups/invites", { headers }),
    ]);
    return {
      myGroups: mineRes.ok ? ((await mineRes.json()).groups ?? []) : [],
      discoverGroups: discoverRes.ok ? ((await discoverRes.json()).groups ?? []) : [],
      pendingInvites: invitesRes.ok ? ((await invitesRes.json()).invites ?? []) : [],
    };
  }, []);

  const fetchGroups = useCallback(async () => {
    // Membership changes are driven from this screen (and refreshed below), so
    // a repeat visit can paint the last snapshot rather than re-running three
    // requests behind a spinner.
    const data = await fetchWithCache<HubSnapshot>(HUB_CACHE_KEY, fetchGroupsFresh, {
      ...HUB_CACHE_OPTS,
      onFresh: applyGroups,
    });
    applyGroups(data);
  }, [fetchGroupsFresh, applyGroups]);

  /** Post-mutation: bypass the stale window and re-prime the snapshot. */
  const refreshGroups = useCallback(async () => {
    invalidateCache(HUB_CACHE_KEY);
    const data = await fetchGroupsFresh();
    writeCache(HUB_CACHE_KEY, data, HUB_CACHE_OPTS);
    applyGroups(data);
  }, [fetchGroupsFresh, applyGroups]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Only spin on a genuine cold miss — a cached snapshot paints instantly
      // and revalidates behind the content.
      setLoading(readCache<HubSnapshot>(HUB_CACHE_KEY, HUB_CACHE_OPTS) === null);
      try {
        const session = await getViewerSession();
        await fetchGroups();
        if (session && !cancelled) {
          const { data: prof } = await supabase
            .from("profiles")
            .select("is_admin")
            .eq("id", session.profileId)
            .single();
          if (!cancelled) setIsAdmin(!!prof?.is_admin);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchGroups]);

  const handleAcceptInvite = async (invite: PendingInvite) => {
    setAcceptingInviteId(invite.id);
    try {
      const session = await requireViewerSession();
      if (!session) return;
      const res = await fetch(`/api/majors/groups/${invite.group_id}/join`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
        // Membership just changed — the cached hub snapshot is wrong.
        await refreshGroups();
      }
    } finally {
      setAcceptingInviteId(null);
    }
  };

  const handleDeclineInvite = async (invite: PendingInvite) => {
    setDecliningInviteId(invite.id);
    try {
      const session = await requireViewerSession();
      if (!session) return;
      await fetch(`/api/majors/groups/${invite.group_id}/members?profile_id=${session.profileId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      setPendingInvites((prev) => prev.filter((i) => i.id !== invite.id));
      invalidateCache(HUB_CACHE_KEY);
    } finally {
      setDecliningInviteId(null);
    }
  };

  const handleJoin = async (group: GroupSummary) => {
    setJoiningId(group.id);
    try {
      const session = await requireViewerSession();
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
        invalidateCache(HUB_CACHE_KEY);
      }
    } finally {
      setJoiningId(null);
    }
  };

  // Filter out groups already joined from discover list
  const myGroupIds = new Set(myGroups.map((g) => g.id));
  const filteredDiscover = discoverGroups.filter((g) => !myGroupIds.has(g.id));

  return (
    <div className="min-h-[100dvh] bg-[radial-gradient(130%_65%_at_50%_0%,rgba(255,214,102,0.20)_0%,rgba(255,214,102,0.06)_38%,transparent_68%)]">
      <div className="pb-[env(safe-area-inset-bottom)] max-w-sm mx-auto">
      <MajorsMasthead
        subtitle="Groups · Events · Standings"
        left={<MajorsBalance />}
        right={
          /* Same scale as the home header, so the emblem doesn't change size
             as you move between tabs. */
          <div className="scale-[1.4] origin-top-right -translate-y-[4px]">
            <AuthUser />
          </div>
        }
      />

      {loading ? (
        <div className="text-sm text-emerald-100/60 text-center py-20">Loading…</div>
      ) : (
        <div className="px-4 space-y-8 pb-12">
          {/* Season snapshot, Live Now and Upcoming — formerly the swipe-up face. */}
          <MajorsSnapshot />

          {/* Pending Invitations */}
          {pendingInvites.length > 0 && (
            <MajorsSection title="Invitations">
              <div className="space-y-2">
              {pendingInvites.map((invite) => (
                <div
                  key={invite.id}
                  className={`${MAJORS_CARD} px-3 py-3 space-y-2`}
                >
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#0D5E33] to-[#062C17] flex items-center justify-center text-sm font-bold text-[#ffd666] shrink-0 border border-[#ffd666]/25">
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
              </div>
            </MajorsSection>
          )}

          {/* My Groups */}
          <MajorsSection
            title="My Groups"
            action={
              isAdmin ? (
                <button
                  type="button"
                  onClick={() => router.push("/majors/groups/create")}
                  className="text-[11px] font-semibold text-[#ffd666]/80 hover:text-[#ffd666]"
                >
                  + New
                </button>
              ) : undefined
            }
          >

            {myGroups.length === 0 ? (
              <div className={`${MAJORS_CARD} p-6 text-center space-y-3`}>
                <p className="text-2xl">⛳</p>
                <p className="text-sm text-emerald-100/60">You're not in any groups yet.</p>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => router.push("/majors/groups/create")}
                    className="px-5 py-2.5 rounded-full bg-emerald-700 text-sm font-semibold text-white hover:bg-emerald-600"
                  >
                    Create a Group
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {myGroups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => router.push(`/majors/groups/${g.id}`)}
                    className={`${MAJORS_CARD_INTERACTIVE} w-full flex items-center gap-3 px-3 py-3 text-left`}
                  >
                    {g.image_url ? (
                      <img src={g.image_url} alt="" className="h-10 w-10 rounded-xl object-cover shrink-0" loading="lazy" decoding="async" />
                    ) : (
                      <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#0D5E33] to-[#062C17] flex items-center justify-center text-sm font-bold text-[#ffd666] shrink-0 border border-[#ffd666]/25">
                        {g.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-emerald-50 truncate">{g.name}</span>
                        {g.role === "owner" && (
                          <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full border border-[#ffd666]/30 bg-[#ffd666]/10 text-[#ffd666]">
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
          </MajorsSection>

          {/* Discover Groups */}
          <MajorsSection title="Discover Groups">

            {filteredDiscover.length === 0 ? (
              <div className={`${MAJORS_CARD} p-5 text-center`}>
                <p className="text-sm text-emerald-100/50">No public groups to discover right now.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredDiscover.map((g) => {
                  const pendingJoin = joinedIds[g.id] === "pending";
                  return (
                    <div
                      key={g.id}
                      className={`${MAJORS_CARD} flex items-center gap-3 px-3 py-3`}
                    >
                      {g.image_url ? (
                        <img src={g.image_url} alt="" className="h-10 w-10 rounded-xl object-cover shrink-0" loading="lazy" decoding="async" />
                      ) : (
                        <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#0D5E33] to-[#062C17] flex items-center justify-center text-sm font-bold text-[#ffd666] shrink-0 border border-[#ffd666]/25">
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
          </MajorsSection>
        </div>
      )}
      </div>
    </div>
  );
}
