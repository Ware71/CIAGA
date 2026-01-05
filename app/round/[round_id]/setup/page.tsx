"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Button } from "@/components/ui/button";

type Round = {
  id: string;
  name: string | null;
  status: "draft" | "live" | "finished";
  course_id: string | null;
  pending_tee_box_id: string | null;
  started_at: string | null;
  courses?: { name: string | null }[] | { name: string | null } | null;
};

type ProfileJoin = {
  id?: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

// ✅ IMPORTANT: Supabase can return join as OBJECT or ARRAY depending on relationship inference.
// So we accept both and normalize.
type Participant = {
  id: string;
  profile_id: string | null;
  is_guest: boolean;
  display_name: string | null;
  role: "owner" | "scorer" | "player";
  profiles?: ProfileJoin | ProfileJoin[] | null;
};

type ProfileLite = {
  id: string;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
};

function courseNameFromJoin(round: any): string | null {
  const c = round?.courses;
  if (!c) return null;
  if (Array.isArray(c)) return c?.[0]?.name ?? null;
  return c?.name ?? null;
}

function niceNameFromEmail(email?: string | null) {
  if (!email) return null;
  const left = email.split("@")[0]?.trim();
  return left || null;
}

function pickNickname(p: { name?: string | null; email?: string | null } | null | undefined) {
  return p?.name || niceNameFromEmail(p?.email) || p?.email || "User";
}

function getProfile(p: Participant): ProfileJoin | null {
  const pr = p.profiles;
  if (!pr) return null;
  return Array.isArray(pr) ? pr[0] ?? null : pr;
}

function Avatar({
  name,
  url,
  size = 36,
}: {
  name: string;
  url: string | null | undefined;
  size?: number;
}) {
  const initials = useMemo(() => {
    const parts = (name || "").trim().split(/\s+/).filter(Boolean);
    const a = parts[0]?.[0] ?? "U";
    const b = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
    return (a + b).toUpperCase();
  }, [name]);

  return (
    <div
      className="rounded-full overflow-hidden flex items-center justify-center border border-emerald-900/70 bg-[#042713]"
      style={{ width: size, height: size }}
      aria-label={name}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name} className="w-full h-full object-cover" />
      ) : (
        <div className="text-[11px] font-semibold text-emerald-100/80">{initials}</div>
      )}
    </div>
  );
}

// ✅ Robust resolver: handles follows storing either profiles.id OR auth.users.id
async function resolveProfilesForFollowIds(ids: string[]) {
  if (!ids.length) return [];

  // First try as profiles.id
  const byProfileId = await supabase.from("profiles").select("id,name,email,avatar_url").in("id", ids);
  if (!byProfileId.error && (byProfileId.data?.length ?? 0) > 0) {
    return (byProfileId.data ?? []) as ProfileLite[];
  }

  // If none, treat ids as auth.users.id and match on owner_user_id
  const byOwner = await supabase
    .from("profiles")
    .select("id,name,email,avatar_url,owner_user_id")
    .in("owner_user_id", ids);

  if (byOwner.error) throw byOwner.error;

  // Keep follow order
  const map = new Map((byOwner.data ?? []).map((p: any) => [p.owner_user_id, p]));
  const ordered = ids.map((authId) => map.get(authId)).filter(Boolean);

  return ordered.map((p: any) => ({
    id: p.id,
    name: p.name,
    email: p.email,
    avatar_url: p.avatar_url,
  })) as ProfileLite[];
}

export default function RoundSetupPage() {
  const router = useRouter();
  const params = useParams<{ round_id: string }>();
  const roundId = params.round_id;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Model B: profiles.id (canonical player id)
  const [meId, setMeId] = useState<string | null>(null);

  const [round, setRound] = useState<Round | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);

  const [starting, setStarting] = useState(false);

  // Following (primary add flow)
  const [following, setFollowing] = useState<ProfileLite[]>([]);
  const [loadingFollowing, setLoadingFollowing] = useState(false);
  const [followFilter, setFollowFilter] = useState("");

  // Search more (secondary)
  const [showSearchMore, setShowSearchMore] = useState(false);
  const [moreQuery, setMoreQuery] = useState("");
  const [moreResults, setMoreResults] = useState<ProfileLite[]>([]);
  const [searchingMore, setSearchingMore] = useState(false);
  const debounceRef = useRef<number | null>(null);

  // Guest add
  const [showGuest, setShowGuest] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [addingGuest, setAddingGuest] = useState(false);

  const participantProfileIds = useMemo(() => {
    return new Set(participants.map((p) => p.profile_id).filter(Boolean) as string[]);
  }, [participants]);

  const isOwner = useMemo(() => {
    if (!meId) return false;
    const me = participants.find((p) => p.profile_id === meId);
    return me?.role === "owner";
  }, [participants, meId]);

  const title = useMemo(() => {
    if (!round) return "Round setup";
    return round.name || courseNameFromJoin(round) || "Round setup";
  }, [round]);

  function displayParticipant(p: Participant) {
    if (p.is_guest) {
      const name = p.display_name?.trim() || "Guest";
      return { name, avatar_url: null as string | null };
    }

    const prof = getProfile(p);
    const name = pickNickname(prof);
    const avatar_url = prof?.avatar_url ?? null;
    return { name, avatar_url };
  }

  async function fetchAll() {
    setErr(null);
    setLoading(true);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      router.replace("/auth");
      return;
    }

    const myProfileId = await getMyProfileIdByAuthUserId(auth.user.id);
    setMeId(myProfileId);

    const rRes = await supabase
      .from("rounds")
      .select("id,name,status,course_id,pending_tee_box_id,started_at, courses(name)")
      .eq("id", roundId)
      .single();

    if (rRes.error) {
      setErr(rRes.error.message);
      setLoading(false);
      return;
    }

    const pRes = await supabase
      .from("round_participants")
      .select("id,profile_id,is_guest,display_name,role, profiles(id,name,email,avatar_url)")
      .eq("round_id", roundId)
      .order("created_at", { ascending: true });

    if (pRes.error) {
      setErr(pRes.error.message);
      setLoading(false);
      return;
    }

    setRound(rRes.data as any);
    setParticipants((pRes.data ?? []) as unknown as Participant[]);
    setLoading(false);
  }

  async function fetchFollowing(myProfileId: string) {
    setLoadingFollowing(true);
    setErr(null);
    try {
      const fRes = await supabase.from("follows").select("following_id").eq("follower_id", myProfileId);
      if (fRes.error) throw fRes.error;

      const ids = (fRes.data ?? []).map((r: any) => r.following_id).filter(Boolean) as string[];
      if (ids.length === 0) {
        setFollowing([]);
        return;
      }

      const resolved = await resolveProfilesForFollowIds(ids);
      setFollowing(resolved);
    } catch (e: any) {
      setErr(e?.message || "Failed to load following");
    } finally {
      setLoadingFollowing(false);
    }
  }

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  useEffect(() => {
    if (!meId) return;
    fetchFollowing(meId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId]);

  // Realtime updates
  useEffect(() => {
    if (!roundId) return;

    const chan = supabase
      .channel(`round-setup:${roundId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "round_participants", filter: `round_id=eq.${roundId}` },
        () => fetchAll()
      )
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "rounds", filter: `id=eq.${roundId}` }, () =>
        fetchAll()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(chan);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  async function addProfile(profileId: string) {
    if (!isOwner) return;
    if (participantProfileIds.has(profileId)) return;

    setErr(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Not authenticated.");

      const res = await fetch("/api/rounds/add-participant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          round_id: roundId,
          kind: "profile",
          profile_id: profileId,
          requester_profile_id: meId,
          role: "player",
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);

      await fetchAll();
    } catch (e: any) {
      setErr(e?.message || "Failed to add player");
    }
  }

  async function addGuest() {
    if (!isOwner) return;
    const name = guestName.trim();
    if (!name) return;

    setAddingGuest(true);
    setErr(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Not authenticated.");

      const res = await fetch("/api/rounds/add-participant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          round_id: roundId,
          kind: "guest",
          display_name: name,
          requester_profile_id: meId,
          role: "player",
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);

      setGuestName("");
      setShowGuest(false);
      await fetchAll();
    } catch (e: any) {
      setErr(e?.message || "Failed to add guest");
    } finally {
      setAddingGuest(false);
    }
  }

  async function startRound() {
    if (!isOwner) {
      setErr("Only the round owner can start the round.");
      return;
    }
    if (!round?.pending_tee_box_id) {
      setErr("No tee selected for this round.");
      return;
    }

    setStarting(true);
    setErr(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Not authenticated.");

      const res = await fetch("/api/rounds/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ round_id: roundId }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Failed (${res.status})`);

      router.replace(`/round/${roundId}`);
    } catch (e: any) {
      setErr(e?.message || "Failed to start round");
    } finally {
      setStarting(false);
    }
  }

  const filteredFollowing = useMemo(() => {
    const q = followFilter.trim().toLowerCase();
    return following
      .filter((p) => (!meId ? true : p.id !== meId))
      .filter((p) => !participantProfileIds.has(p.id))
      .filter((p) => {
        if (!q) return true;
        const name = (p.name ?? "").toLowerCase();
        const email = (p.email ?? "").toLowerCase();
        return name.includes(q) || email.includes(q);
      });
  }, [following, followFilter, participantProfileIds, meId]);

  async function runMoreSearch(qRaw: string) {
    const q = qRaw.trim();
    if (!q) {
      setMoreResults([]);
      return;
    }

    setSearchingMore(true);
    setErr(null);
    try {
      const res = await supabase
        .from("profiles")
        .select("id,name,email,avatar_url")
        .or(`email.ilike.%${q}%,name.ilike.%${q}%`)
        .limit(20);

      if (res.error) throw res.error;

      const cleaned = (res.data ?? []).filter((p: any) => {
        if (meId && p.id === meId) return false;
        if (participantProfileIds.has(p.id)) return false;
        return true;
      });

      setMoreResults(cleaned as any);
    } catch (e: any) {
      setErr(e?.message || "Search failed");
    } finally {
      setSearchingMore(false);
    }
  }

  // Debounce “search more”
  useEffect(() => {
    if (!showSearchMore) return;

    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      runMoreSearch(moreQuery);
    }, 250);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moreQuery, showSearchMore]);

  const canEdit = isOwner && !starting;

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-4">
        {/* Header */}
        <header className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="px-2 text-emerald-100 hover:bg-emerald-900/30"
            onClick={() => router.back()}
            disabled={starting}
          >
            ← Back
          </Button>

          <div className="text-center flex-1">
            <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Round setup</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">{title}</div>
          </div>

          <div className="w-[60px]" />
        </header>

        {loading ? (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
            Loading…
          </div>
        ) : null}

        {err ? (
          <div className="rounded-2xl border border-red-900/50 bg-red-950/30 p-4 text-sm text-red-100">{err}</div>
        ) : null}

        {!loading && round?.status === "live" ? (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">
            This round is already live.
            <div className="mt-3">
              <Button
                className="w-full rounded-2xl bg-[#f5e6b0] text-[#042713] hover:bg-[#e9d79c]"
                onClick={() => router.replace(`/round/${roundId}`)}
              >
                Go to scorecard
              </Button>
            </div>
          </div>
        ) : null}

        {/* Participants */}
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-emerald-50">Players</div>
              <div className="text-[11px] text-emerald-100/70">Added to this round</div>
            </div>
            <div className="text-[11px] text-emerald-100/60">{participants.length}</div>
          </div>

          <div className="mt-3 space-y-2">
            {participants.map((p) => {
              const d = displayParticipant(p);
              return (
                <div
                  key={p.id}
                  className="rounded-2xl border border-emerald-900/70 bg-[#042713]/60 p-3 flex items-center gap-3"
                >
                  <Avatar name={d.name} url={d.avatar_url} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-emerald-50 truncate">{d.name}</div>
                    <div className="text-[11px] text-emerald-100/60">
                      {p.is_guest ? "Guest" : p.profile_id === meId ? "You" : "Player"} · {p.role}
                    </div>
                  </div>
                </div>
              );
            })}
            {participants.length === 0 ? (
              <div className="text-[11px] text-emerald-100/60 mt-2">No players yet.</div>
            ) : null}
          </div>
        </div>

        {/* Add players */}
        <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-emerald-50">Add players</div>
              <div className="text-[11px] text-emerald-100/70">From your following first</div>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="text-emerald-100 hover:bg-emerald-900/30"
              onClick={() => meId && fetchFollowing(meId)}
              disabled={!meId || loadingFollowing}
            >
              {loadingFollowing ? "…" : "Refresh"}
            </Button>
          </div>

          <input
            className="w-full rounded-xl bg-[#042713] border border-emerald-900/70 px-3 py-2 text-sm outline-none"
            placeholder="Search following…"
            value={followFilter}
            onChange={(e) => setFollowFilter(e.target.value)}
            disabled={!canEdit}
          />

          <div className="space-y-2">
            {filteredFollowing.slice(0, 10).map((p) => {
              const name = pickNickname(p);
              return (
                <button
                  key={p.id}
                  onClick={() => addProfile(p.id)}
                  disabled={!canEdit}
                  className="w-full text-left rounded-2xl border border-emerald-900/70 bg-[#042713]/60 p-3 flex items-center gap-3 hover:bg-[#07341c]/70 disabled:opacity-60"
                >
                  <Avatar name={name} url={p.avatar_url} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-emerald-50 truncate">{name}</div>
                    <div className="text-[11px] text-emerald-100/60 truncate">{p.email ?? ""}</div>
                  </div>
                  <div className="text-[12px] text-emerald-100/70">Add</div>
                </button>
              );
            })}

            {filteredFollowing.length === 0 ? (
              <div className="text-[11px] text-emerald-100/60">
                {loadingFollowing ? "Loading…" : "No matches in your following."}
              </div>
            ) : null}

            {filteredFollowing.length > 10 ? (
              <div className="text-[11px] text-emerald-100/60">+ {filteredFollowing.length - 10} more</div>
            ) : null}
          </div>

          <div className="pt-2 flex gap-2">
            <Button
              variant="ghost"
              className="flex-1 rounded-2xl border border-emerald-900/70 text-emerald-100 hover:bg-emerald-900/20"
              onClick={() => setShowSearchMore((v) => !v)}
              disabled={!canEdit}
            >
              {showSearchMore ? "Hide search" : "Search more"}
            </Button>

            <Button
              variant="ghost"
              className="flex-1 rounded-2xl border border-emerald-900/70 text-emerald-100 hover:bg-emerald-900/20"
              onClick={() => setShowGuest((v) => !v)}
              disabled={!canEdit}
            >
              {showGuest ? "Cancel guest" : "Add guest"}
            </Button>
          </div>

          {showSearchMore ? (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/50 p-3 space-y-2">
              <div className="text-[11px] text-emerald-100/70">Search by email or nickname</div>
              <input
                className="w-full rounded-xl bg-[#042713] border border-emerald-900/70 px-3 py-2 text-sm outline-none"
                placeholder="Type to search…"
                value={moreQuery}
                onChange={(e) => setMoreQuery(e.target.value)}
                disabled={!canEdit}
              />

              {searchingMore ? (
                <div className="text-[11px] text-emerald-100/60">Searching…</div>
              ) : moreQuery.trim() && moreResults.length === 0 ? (
                <div className="text-[11px] text-emerald-100/60">No results.</div>
              ) : null}

              <div className="space-y-2">
                {moreResults.map((p) => {
                  const name = pickNickname(p);
                  return (
                    <button
                      key={p.id}
                      onClick={() => addProfile(p.id)}
                      disabled={!canEdit}
                      className="w-full text-left rounded-2xl border border-emerald-900/70 bg-[#042713]/60 p-3 flex items-center gap-3 hover:bg-[#07341c]/70 disabled:opacity-60"
                    >
                      <Avatar name={name} url={p.avatar_url} size={34} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-emerald-50 truncate">{name}</div>
                        <div className="text-[11px] text-emerald-100/60 truncate">{p.email ?? ""}</div>
                      </div>
                      <div className="text-[12px] text-emerald-100/70">Add</div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {showGuest ? (
            <div className="rounded-2xl border border-emerald-900/70 bg-[#042713]/50 p-3 space-y-2">
              <div className="text-[11px] text-emerald-100/70">Guest name</div>
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-xl bg-[#042713] border border-emerald-900/70 px-3 py-2 text-sm outline-none"
                  placeholder="e.g. Dan"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  disabled={!canEdit || addingGuest}
                />
                <Button
                  className="rounded-xl bg-[#f5e6b0] text-[#042713] hover:bg-[#e9d79c]"
                  onClick={addGuest}
                  disabled={!canEdit || addingGuest || !guestName.trim()}
                >
                  {addingGuest ? "…" : "Add"}
                </Button>
              </div>
            </div>
          ) : null}

          {!isOwner ? (
            <div className="text-center text-[10px] text-emerald-100/60">
              Only the round owner can add players and start the round.
            </div>
          ) : null}
        </div>

        <Button
          className="w-full rounded-2xl bg-[#f5e6b0] text-[#042713] hover:bg-[#e9d79c] disabled:opacity-60"
          onClick={startRound}
          disabled={!isOwner || starting || participants.length === 0}
        >
          {starting ? "Starting…" : "Start round"}
        </Button>
      </div>
    </div>
  );
}
