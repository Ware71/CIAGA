"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { one, chunk } from "@/lib/stats/helpers";
import {
  isFinishedStatus, parseDateMs,
  toNumberMaybe, shortDate,
} from "@/lib/profile/helpers";
import ProfileFeedTab from "@/components/profile/ProfileFeedTab";
import AcceptableRoundsTab from "@/components/profile/AcceptableRoundsTab";
import NonAcceptableRoundsTab from "@/components/profile/NonAcceptableRoundsTab";

type User = {
  id: string; // auth.users.id
  email?: string;
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
  };
};

type ProfileRow = {
  id: string;
  owner_user_id?: string | null;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

type HandicapRow = {
  profile_id: string;
  handicap_index: number;
  as_of_date: string; // date
};


type RoundRow = {
  id: string;
  name: string | null;
  status: "draft" | "scheduled" | "starting" | "live" | "finished" | string;
  started_at: string | null;
  created_at: string | null;
  course_id: string | null;
  courses?: { name: string | null }[] | { name: string | null } | null;
};

type TeeSnap = { id: string; name: string | null };

type ParticipantRow = {
  id: string; // participant_id (round_participants.id)
  round_id: string;
  tee_snapshot_id: string | null;
  rounds?: RoundRow[] | RoundRow | null;
};

type Props = {
  mode: "public" | "self";
  profileId: string;
  initialProfile?: ProfileRow | null; // passed by /profile wrapper for self-mode
};

const AVATAR_BUCKET = "avatars";

export default function ProfileScreen({ mode, profileId, initialProfile }: Props) {
  const router = useRouter();
  const targetProfileId = profileId;

  // -------- Auth / viewer state --------
  const [loading, setLoading] = useState(true);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [myProfileId, setMyProfileId] = useState<string | null>(null);

  const isMe = mode === "self" || (!!myProfileId && myProfileId === targetProfileId);

  // -------- Profile header state --------
  const [profile, setProfile] = useState<ProfileRow | null>(initialProfile ?? null);
  const [followersCount, setFollowersCount] = useState<number>(0);
  const [followingCount, setFollowingCount] = useState<number>(0);
  const [isFollowing, setIsFollowing] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  const [handicap, setHandicap] = useState<HandicapRow | null>(null);

  // -------- Self-only: name editor --------
  const [editingName, setEditingName] = useState(false);
  const [displayName, setDisplayName] = useState<string>((initialProfile?.name ?? "").trim());
  const [savingName, setSavingName] = useState(false);

  // -------- Self-only: avatar upload --------
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  // -------- Followers/Following modal state --------
  const [listOpen, setListOpen] = useState(false);
  const [listMode, setListMode] = useState<"followers" | "following">("followers");
  const [listLoading, setListLoading] = useState(false);
  const [listRows, setListRows] = useState<ProfileRow[]>([]);
  const [myFollowingSet, setMyFollowingSet] = useState<Set<string>>(new Set()); // profile ids I follow
  const [busyUserId, setBusyUserId] = useState<string | null>(null); // profile id being followed/unfollowed

  // -------- Self-only: Search users modal --------
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<ProfileRow[]>([]);

  // -------- Round history state (for THIS player) --------
  const [historyLoading, setHistoryLoading] = useState<boolean>(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [teeNameByRoundId, setTeeNameByRoundId] = useState<Record<string, string>>({});
  const [totalByRoundId, setTotalByRoundId] = useState<Record<string, number>>({});
  const [agsByRoundId, setAgsByRoundId] = useState<Record<string, number>>({});
  const [scoreDiffByRoundId, setScoreDiffByRoundId] = useState<Record<string, number>>({});
  const [hiUsedByRoundId, setHiUsedByRoundId] = useState<Record<string, number>>({});

  const initialsFor = (p: { name?: string | null; email?: string | null }) => {
    const label = p.name || p.email || "P";
    return label
      .split(" ")
      .map((n) => n?.[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase();
  };

  /**
   * Public-safe profile fetcher
   * Requires RPC: get_profiles_public(ids uuid[])
   */
  const fetchProfilePublic = async (id: string) => {
    const { data, error } = await supabase.rpc("get_profiles_public", { ids: [id] });
    if (error) throw error;
    const rows = ((data as any) ?? []) as ProfileRow[];
    return rows[0] ?? null;
  };

  const fetchProfilesByIdsPublic = async (ids: string[]) => {
    if (!ids.length) return [];
    const { data, error } = await supabase.rpc("get_profiles_public", { ids });
    if (error) throw error;
    return ((data as any) ?? []) as ProfileRow[];
  };

  const searchProfilesPublic = async (q: string, lim = 25) => {
    const { data, error } = await supabase.rpc("search_profiles_public", { q, lim });
    if (error) throw error;
    return ((data as any) ?? []) as ProfileRow[];
  };

  const fetchCounts = async (pid: string) => {
    const followersRes = await supabase.from("follows").select("id", { count: "exact", head: true }).eq("following_id", pid);

    const followingRes = await supabase.from("follows").select("id", { count: "exact", head: true }).eq("follower_id", pid);

    setFollowersCount(followersRes.count ?? 0);
    setFollowingCount(followingRes.count ?? 0);
  };

  const refreshFollowState = async (myPid: string, targetPid: string) => {
    const { data, error } = await supabase.from("follows").select("id").eq("follower_id", myPid).eq("following_id", targetPid).maybeSingle();

    if (error) {
      console.warn("Follow state load error:", error);
      setIsFollowing(false);
      return;
    }

    setIsFollowing(!!data);
  };

  const refreshMyFollowingSet = async (myPid: string) => {
    const { data, error } = await supabase.from("follows").select("following_id").eq("follower_id", myPid);

    if (error) {
      console.warn("Failed loading my following set:", error);
      setMyFollowingSet(new Set());
      return;
    }

    const ids = (((data as any) ?? []) as any[]).map((r) => String(r.following_id)).filter(Boolean);
    setMyFollowingSet(new Set(ids));
  };

  const fetchHandicap = async (id: string) => {
    // requires RPC: get_current_handicaps(ids uuid[])
    const { data, error } = await supabase.rpc("get_current_handicaps", { ids: [id] });
    if (error) throw error;
    const rows = ((data as any) ?? []) as HandicapRow[];
    setHandicap(rows[0] ?? null);
  };

  const canFollow = !!authUserId && !!myProfileId && !!profile?.id && myProfileId !== profile.id && !isMe;

  const follow = async () => {
    if (!canFollow || !myProfileId || !profile?.id) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("follows").insert({
        follower_id: myProfileId,
        following_id: profile.id,
      });
      if (error) throw error;

      setIsFollowing(true);
      setMyFollowingSet((prev) => {
        const n = new Set(prev);
        n.add(profile.id);
        return n;
      });

      await fetchCounts(profile.id);
    } catch (e) {
      console.warn("Follow failed:", e);
    } finally {
      setBusy(false);
    }
  };

  const unfollow = async () => {
    if (!canFollow || !myProfileId || !profile?.id) return;
    setBusy(true);
    try {
      const { error } = await supabase.from("follows").delete().eq("follower_id", myProfileId).eq("following_id", profile.id);
      if (error) throw error;

      setIsFollowing(false);
      setMyFollowingSet((prev) => {
        const n = new Set(prev);
        n.delete(profile.id);
        return n;
      });

      await fetchCounts(profile.id);
    } catch (e) {
      console.warn("Unfollow failed:", e);
    } finally {
      setBusy(false);
    }
  };

  // -------- Followers/Following list modal handlers --------
  const openList = async (mode2: "followers" | "following") => {
    if (!profile?.id) return;

    setListMode(mode2);
    setListOpen(true);
    setListLoading(true);
    setListRows([]);

    try {
      if (mode2 === "followers") {
        const { data, error } = await supabase.from("follows").select("follower_id").eq("following_id", profile.id);
        if (error) throw error;

        const ids = Array.from(new Set((data ?? []).map((r: any) => String(r.follower_id)).filter(Boolean)));
        if (!ids.length) return;

        const profs = await fetchProfilesByIdsPublic(ids);
        setListRows(profs);
      } else {
        const { data, error } = await supabase.from("follows").select("following_id").eq("follower_id", profile.id);
        if (error) throw error;

        const ids = Array.from(new Set((data ?? []).map((r: any) => String(r.following_id)).filter(Boolean)));
        if (!ids.length) return;

        const profs = await fetchProfilesByIdsPublic(ids);
        setListRows(profs);
      }
    } catch (e) {
      console.warn("Failed to load follow list:", e);
    } finally {
      setListLoading(false);
    }
  };

  const closeList = () => {
    setListOpen(false);
    setListRows([]);
  };

  const followUserFromList = async (targetPid: string) => {
    if (!myProfileId) return;
    if (targetPid === myProfileId) return;

    setBusyUserId(targetPid);
    try {
      const { error } = await supabase.from("follows").insert({
        follower_id: myProfileId,
        following_id: targetPid,
      });
      if (error) throw error;

      setMyFollowingSet((prev) => {
        const n = new Set(prev);
        n.add(targetPid);
        return n;
      });

      // if following the profile being viewed (rare), sync button state
      if (profile?.id === targetPid) setIsFollowing(true);

      // refresh list if open
      if (listOpen) await openList(listMode);
    } catch (e) {
      console.warn("Follow failed:", e);
    } finally {
      setBusyUserId(null);
    }
  };

  const unfollowUserFromList = async (targetPid: string) => {
    if (!myProfileId) return;
    if (targetPid === myProfileId) return;

    setBusyUserId(targetPid);
    try {
      const { error } = await supabase.from("follows").delete().eq("follower_id", myProfileId).eq("following_id", targetPid);

      if (error) throw error;

      setMyFollowingSet((prev) => {
        const n = new Set(prev);
        n.delete(targetPid);
        return n;
      });

      if (profile?.id === targetPid) setIsFollowing(false);

      if (listOpen) await openList(listMode);
    } catch (e) {
      console.warn("Unfollow failed:", e);
    } finally {
      setBusyUserId(null);
    }
  };

  // -------- Self-only: save name (UPDATED: uses /api/profiles/update) --------
  const saveDisplayName = async () => {
    if (!isMe) return;
    const trimmed = displayName.trim();
    if (!trimmed) return;

    setSavingName(true);
    try {
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) throw sessionErr;

      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not logged in");

      const res = await fetch("/api/profiles/update", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: trimmed }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Failed to save name");

      const updated = j?.profile as ProfileRow | undefined;
      if (updated?.id) {
        setProfile((prev) => (prev ? { ...prev, name: updated.name ?? trimmed } : prev));
      } else {
        setProfile((prev) => (prev ? { ...prev, name: trimmed } : prev));
      }
    } catch (e) {
      console.warn("Save display name failed:", e);
    } finally {
      setSavingName(false);
    }
  };

  // -------- Self-only: avatar upload (UPDATED: uses /api/profiles/update) --------
  const onPickFile = () => fileRef.current?.click();

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (!isMe) return;
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) return;

      setUploading(true);

      const ext = file.name.split(".").pop() || "jpg";
      const folder = targetProfileId;
      const path = `${folder}/${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, {
        cacheControl: "3600",
        upsert: true,
        contentType: file.type,
      });
      if (uploadError) throw uploadError;

      const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      // update auth metadata (nice-to-have)
      if (authUser?.id) {
        const { error: updateAuthError } = await supabase.auth.updateUser({
          data: { avatar_url: publicUrl },
        });
        if (updateAuthError) console.warn("auth metadata avatar update failed:", updateAuthError);
      }

      // update profiles.avatar_url via server route
      const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr) throw sessionErr;

      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not logged in");

      const res = await fetch("/api/profiles/update", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ avatar_url: publicUrl }),
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || "Failed to update avatar");

      setProfile((prev) => (prev ? { ...prev, avatar_url: publicUrl } : prev));
    } catch (err) {
      console.error("Avatar upload failed:", err);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  // -------- Self-only: search modal --------
  const runSearch = async () => {
    if (!isMe || !targetProfileId) return;
    const q = search.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    try {
      const rows = await searchProfilesPublic(q, 25);
      setSearchResults(rows.filter((r) => r.id !== targetProfileId));
    } catch (e) {
      console.warn("Search failed:", e);
    } finally {
      setSearchLoading(false);
    }
  };

  // -------- Load auth + myProfileId (viewer) + viewed profile --------
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        if (!targetProfileId) return;

        setLoading(true);

        const { data: auth } = await supabase.auth.getUser();
        const user = (auth.user as any) ?? null;
        if (!alive) return;

        setAuthUser(user);
        setAuthUserId(user?.id ?? null);

        if (user?.id) {
          try {
            const myPid = await getMyProfileIdByAuthUserId(user.id);
            if (!alive) return;
            setMyProfileId(myPid);
            if (myPid) await refreshMyFollowingSet(myPid);
          } catch (e) {
            console.warn("Could not load my profile id:", e);
            setMyProfileId(null);
            setMyFollowingSet(new Set());
          }
        } else {
          setMyProfileId(null);
          setMyFollowingSet(new Set());
        }

        // Use initialProfile when provided (self route), otherwise use public RPC
        let p = initialProfile ?? null;
        if (!p) {
          p = await fetchProfilePublic(targetProfileId);
        }

        if (!alive) return;
        setProfile(p);

        // self: prime displayName when we have profile
        if ((mode === "self" || isMe) && p?.name != null) {
          setDisplayName(p.name ?? "");
        }

        if (p?.id) {
          await fetchCounts(p.id);
          await fetchHandicap(p.id);

          if (user?.id) {
            const myPid = await getMyProfileIdByAuthUserId(user.id);
            if (!alive) return;
            setMyProfileId(myPid);
            if (myPid) await refreshMyFollowingSet(myPid);

            if (myPid && myPid !== p.id) {
              await refreshFollowState(myPid, p.id);
            } else {
              setIsFollowing(false);
            }
          }
        }
      } catch (e) {
        console.warn("ProfileScreen load error:", e);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
    // IMPORTANT: initialProfile only used as a one-time seed for /profile wrapper
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetProfileId, mode]);

  // -------- Load round history for THIS player --------
  useEffect(() => {
    let cancelled = false;

    async function loadHistory(pid: string) {
      setHistoryLoading(true);
      setHistoryError(null);

      try {
        // 1) Load participant rows for *target* profile
        const { data, error: qErr } = await supabase
          .from("round_participants")
          .select(
            `
              id,
              round_id,
              tee_snapshot_id,
              rounds:rounds!round_id (
                id,
                name,
                status,
                started_at,
                created_at,
                course_id,
                courses:courses ( name )
              )
            `
          )
          .eq("profile_id", pid);

        if (qErr) throw qErr;

        const rows = (data ?? []) as ParticipantRow[];

        const extractedAll: RoundRow[] = rows.map((r) => one(r.rounds)).filter(Boolean) as RoundRow[];
        const extracted = extractedAll.filter((r) => isFinishedStatus(r.status));

        const pidMap: Record<string, string> = {};
        const teeSnapIdByRound: Record<string, string> = {};

        for (const pr of rows) {
          const round = one(pr.rounds);
          if (!round) continue;
          if (!isFinishedStatus(round.status)) continue;

          pidMap[round.id] = pr.id;
          if (pr.tee_snapshot_id) teeSnapIdByRound[round.id] = pr.tee_snapshot_id;
        }

        extracted.sort((a, b) => {
          const ad = parseDateMs(a.started_at ?? a.created_at);
          const bd = parseDateMs(b.started_at ?? b.created_at);
          return bd - ad;
        });

        if (cancelled) return;

        setRounds(extracted);

        // 2) Tee names
        const teeIds = Array.from(new Set(Object.values(teeSnapIdByRound).filter(Boolean)));
        const teeNameMap: Record<string, string> = {};

        if (teeIds.length) {
          const teeSnaps: TeeSnap[] = [];
          for (const ids of chunk(teeIds, 150)) {
            const { data: tees, error: tErr } = await supabase.from("round_tee_snapshots").select("id,name").in("id", ids);
            if (tErr) continue;
            teeSnaps.push(...((tees ?? []) as TeeSnap[]));
          }

          const byId: Record<string, string> = {};
          for (const t of teeSnaps) byId[t.id] = t.name?.trim() || "—";

          for (const roundId of Object.keys(teeSnapIdByRound)) {
            const tid = teeSnapIdByRound[roundId];
            teeNameMap[roundId] = byId[tid] ?? "—";
          }
        }

        if (!cancelled) setTeeNameByRoundId(teeNameMap);

        // 3) Totals from round_current_scores (by pair)
        const participantIds = Array.from(new Set(Object.values(pidMap).filter(Boolean)));
        const totalsByParticipant: Record<string, number> = {};
        const countsByParticipant: Record<string, number> = {};

        if (participantIds.length) {
          const pairs = Object.keys(pidMap).map((roundId) => ({
            roundId,
            participantId: pidMap[roundId],
          }));

          for (const batch of chunk(pairs, 25)) {
            const orExpr = batch.map((p) => `and(round_id.eq.${p.roundId},participant_id.eq.${p.participantId})`).join(",");

            const { data: scores, error: sErr } = await supabase.from("round_current_scores").select("round_id, participant_id, strokes").or(orExpr);

            if (sErr) continue;

            for (const row of (scores ?? []) as any[]) {
              const p = row.participant_id as string;
              const n = toNumberMaybe(row.strokes);
              if (n == null) continue;

              totalsByParticipant[p] = (totalsByParticipant[p] ?? 0) + n;
              countsByParticipant[p] = (countsByParticipant[p] ?? 0) + 1;
            }
          }
        }

        const totalByRound: Record<string, number> = {};
        for (const roundId of Object.keys(pidMap)) {
          const participantId = pidMap[roundId];
          const count = countsByParticipant[participantId] ?? 0;
          if (count > 0) totalByRound[roundId] = totalsByParticipant[participantId] ?? 0;
        }
        if (!cancelled) setTotalByRoundId(totalByRound);

        // 4) Handicap round results (AGS + SD)
        const agsMap: Record<string, number> = {};
        const sdMap: Record<string, number> = {};
        const hiUsedMap: Record<string, number> = {};

        if (participantIds.length) {
          for (const ids of chunk(participantIds, 150)) {
            const { data: hrr, error: hErr } = await supabase
              .from("handicap_round_results")
              .select("round_id, participant_id, adjusted_gross_score, score_differential, handicap_index_used")
              .in("participant_id", ids);

            if (hErr) continue;

            for (const row of (hrr ?? []) as any[]) {
              const rid = row.round_id as string;
              const ags = toNumberMaybe(row.adjusted_gross_score);
              const sd = toNumberMaybe(row.score_differential);
              const hiUsed = toNumberMaybe(row.handicap_index_used);
              if (ags != null) agsMap[rid] = ags;
              if (sd != null) sdMap[rid] = sd;
              if (hiUsed != null) hiUsedMap[rid] = hiUsed;
            }
          }
        }

        if (!cancelled) {
          setAgsByRoundId(agsMap);
          setScoreDiffByRoundId(sdMap);
          setHiUsedByRoundId(hiUsedMap);
        }

      } catch (e: any) {
        console.warn("History load error:", e);
        if (!cancelled) setHistoryError("Could not load round history for this player.");
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }

    if (targetProfileId) loadHistory(targetProfileId);

    return () => {
      cancelled = true;
    };
  }, [targetProfileId]);

  const titleName = profile?.name || profile?.email || "Player";
  const avatarUrl = (isMe ? authUser?.user_metadata?.avatar_url : "") || profile?.avatar_url || "";
  const initials = profile ? initialsFor(profile) : "P";

  const hiText = useMemo(() => {
    if (!handicap?.handicap_index && handicap?.handicap_index !== 0) return "No HI yet";
    return Number(handicap.handicap_index).toFixed(1);
  }, [handicap]);

  const hiSub = useMemo(() => {
    if (!handicap?.as_of_date) return "";
    return `As of ${shortDate(handicap.as_of_date)}`;
  }, [handicap]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-sm space-y-4">
          <header className="flex items-center justify-between">
            <Button variant="ghost" size="sm" className="px-2 text-emerald-100 hover:bg-emerald-900/30" onClick={() => router.back()}>
              ← Back
            </Button>
            <div className="text-center flex-1">
              <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">{isMe ? "Profile" : "Player"}</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">{isMe ? "Account" : "Profile"}</div>
            </div>
            <div className="w-[60px]" />
          </header>

          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">Loading…</div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-sm space-y-4">
          <header className="flex items-center justify-between">
            <Button variant="ghost" size="sm" className="px-2 text-emerald-100 hover:bg-emerald-900/30" onClick={() => router.back()}>
              ← Back
            </Button>
            <div className="text-center flex-1">
              <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">{isMe ? "Profile" : "Player"}</div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">{isMe ? "Account" : "Profile"}</div>
            </div>
            <div className="w-[60px]" />
          </header>

          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 text-sm text-emerald-100/80">Player not found.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-sm space-y-4">
        {/* Header */}
        <header className="flex items-center justify-between">
          <Button variant="ghost" size="sm" className="px-2 text-emerald-100 hover:bg-emerald-900/30" onClick={() => router.back()}>
            ← Back
          </Button>
          <div className="text-center flex-1">
            <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">{isMe ? "Profile" : "Player"}</div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">{isMe ? "Account" : "Profile"}</div>
          </div>
          <div className="w-[60px]" />
        </header>

        {/* Profile content */}
        <div className="mt-4 flex flex-col items-center">
          <Avatar className="h-24 w-24 border border-emerald-200/70 shadow-lg">
            <AvatarImage src={avatarUrl} />
            <AvatarFallback className="text-lg">{initials}</AvatarFallback>
          </Avatar>

          {/* NAME: self -> editable, public -> static */}
          {!isMe ? (
            <div className="mt-4 text-base font-semibold text-[#f5e6b0] max-w-[280px] truncate text-center">{titleName}</div>
          ) : !editingName ? (
            <div className="mt-4 flex items-center justify-center gap-2 max-w-[280px]">
              <div className="text-base font-semibold text-[#f5e6b0] truncate text-center">{profile?.name || titleName}</div>
              <button
                type="button"
                className="text-emerald-300 hover:text-emerald-200 text-sm"
                onClick={() => setEditingName(true)}
                title="Edit display name"
                aria-label="Edit display name"
              >
                ✎
              </button>
            </div>
          ) : (
            <div className="mt-3 w-full max-w-sm">
              <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">Display name</div>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Set your display name"
                  maxLength={30}
                  autoFocus
                  className="mt-2 w-full rounded-xl border border-emerald-900/70 bg-[#08341b] px-3 py-2 text-sm outline-none placeholder:text-emerald-200/40"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 px-3 text-emerald-100 hover:bg-emerald-900/30"
                    onClick={() => {
                      setDisplayName(profile?.name || "");
                      setEditingName(false);
                    }}
                  >
                    Cancel
                  </Button>

                  <Button
                    size="sm"
                    onClick={async () => {
                      await saveDisplayName();
                      setEditingName(false);
                    }}
                    disabled={savingName || !displayName.trim()}
                    className="h-8 rounded-xl bg-emerald-700/80 hover:bg-emerald-700"
                  >
                    {savingName ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Follow button (public only) */}
          {canFollow && (
            <Button
              disabled={busy}
              onClick={isFollowing ? unfollow : follow}
              className={
                isFollowing
                  ? "mt-4 rounded-xl border border-red-900 text-red-200 bg-transparent hover:bg-red-950/60"
                  : "mt-4 rounded-xl bg-emerald-700/80 hover:bg-emerald-700"
              }
              variant={isFollowing ? "outline" : "default"}
            >
              {busy ? "…" : isFollowing ? "Unfollow" : "Follow"}
            </Button>
          )}

          {/* Self-only avatar upload */}
          {isMe && (
            <>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />
              <Button onClick={onPickFile} disabled={uploading} className="mt-4 rounded-xl bg-emerald-700/80 hover:bg-emerald-700">
                {uploading ? "Uploading…" : "Change profile picture"}
              </Button>
            </>
          )}

          {/* CLICKABLE COUNTERS */}
          <div className="mt-6 w-full rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4">
            <div className="grid grid-cols-2 divide-x divide-emerald-900/70 text-center">
              <button type="button" className="px-2 hover:bg-emerald-900/30 rounded-xl py-2" onClick={() => openList("followers")}>
                <div className="text-lg font-semibold text-emerald-50">{followersCount}</div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">Followers</div>
              </button>

              <button type="button" className="px-2 hover:bg-emerald-900/30 rounded-xl py-2" onClick={() => openList("following")}>
                <div className="text-lg font-semibold text-emerald-50">{followingCount}</div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">Following</div>
              </button>
            </div>
          </div>

          <div className="mt-4 w-full rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/80 p-4 text-center">
            <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">Handicap Index</div>
            <div className="mt-1 text-2xl font-semibold text-emerald-50">{hiText}</div>
            {hiSub && <div className="mt-1 text-xs text-emerald-100/60">{hiSub}</div>}
          </div>
        </div>

        {/* Tabbed content: Feed / Acceptable / Non-Acceptable */}
        <Tabs defaultValue="feed" className="mt-4">
          <TabsList className="w-full bg-emerald-900/30 border border-emerald-900/70 rounded-xl p-1">
            <TabsTrigger
              value="feed"
              className="flex-1 text-[11px] font-semibold rounded-lg data-[state=active]:bg-[#f5e6b0] data-[state=active]:text-[#042713] text-emerald-100/80 data-[state=active]:shadow-none border-none"
            >
              Feed
            </TabsTrigger>
            <TabsTrigger
              value="acceptable"
              className="flex-1 text-[11px] font-semibold rounded-lg data-[state=active]:bg-[#f5e6b0] data-[state=active]:text-[#042713] text-emerald-100/80 data-[state=active]:shadow-none border-none"
            >
              Acceptable
            </TabsTrigger>
            <TabsTrigger
              value="non-acceptable"
              className="flex-1 text-[11px] font-semibold rounded-lg data-[state=active]:bg-[#f5e6b0] data-[state=active]:text-[#042713] text-emerald-100/80 data-[state=active]:shadow-none border-none"
            >
              Non-Acceptable
            </TabsTrigger>
          </TabsList>

          <TabsContent value="feed">
            <ProfileFeedTab profileId={profile.id} />
          </TabsContent>

          <TabsContent value="acceptable">
            <AcceptableRoundsTab
              rounds={rounds}
              teeNameByRoundId={teeNameByRoundId}
              totalByRoundId={totalByRoundId}
              agsByRoundId={agsByRoundId}
              scoreDiffByRoundId={scoreDiffByRoundId}
              hiUsedByRoundId={hiUsedByRoundId}
              loading={historyLoading}
              error={historyError}
            />
          </TabsContent>

          <TabsContent value="non-acceptable">
            <NonAcceptableRoundsTab
              rounds={rounds}
              teeNameByRoundId={teeNameByRoundId}
              totalByRoundId={totalByRoundId}
              agsByRoundId={agsByRoundId}
              scoreDiffByRoundId={scoreDiffByRoundId}
              hiUsedByRoundId={hiUsedByRoundId}
              loading={historyLoading}
              error={historyError}
            />
          </TabsContent>
        </Tabs>

        <div className="pb-4" />
      </div>

      {/* FOLLOWERS / FOLLOWING LIST MODAL */}
      {listOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 px-4 py-6">
          <div className="mx-auto w-full max-w-sm h-[85vh] rounded-2xl border border-emerald-900/70 bg-[#0b3b21] shadow-xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-emerald-900/70">
              <div>
                <div className="text-sm font-semibold text-[#f5e6b0]">{listMode === "followers" ? "Followers" : "Following"}</div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">
                  {listMode === "followers"
                    ? isMe
                      ? "People following you"
                      : "People following this player"
                    : isMe
                    ? "People you follow"
                    : "People this player follows"}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* ✅ Self-only "+" search (only in Following view) */}
                {isMe && listMode === "following" && (
                  <Button
                    size="sm"
                    className="h-8 px-2 rounded-xl bg-emerald-700/80 hover:bg-emerald-700"
                    onClick={() => {
                      setSearch("");
                      setSearchResults([]);
                      setSearchOpen(true);
                    }}
                    title="Find users to follow"
                  >
                    +
                  </Button>
                )}

                <Button variant="ghost" size="sm" className="h-8 px-2 text-emerald-100 hover:bg-emerald-900/30" onClick={closeList}>
                  Close
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {listLoading ? (
                <div className="p-4 text-sm text-emerald-100/70">Loading…</div>
              ) : listRows.length === 0 ? (
                <div className="p-4 text-sm text-emerald-100/70">No users yet.</div>
              ) : (
                <div className="divide-y divide-emerald-900/70">
                  {listRows.map((p) => {
                    const nm = p.name || p.email || "Player";
                    const targetPid = p.id;
                    const busyRow = busyUserId === targetPid;

                    const following = myFollowingSet.has(targetPid);
                    const canAct = !!myProfileId && myProfileId !== targetPid;

                    return (
                      <div key={p.id} className="flex items-center gap-3 p-4 hover:bg-emerald-900/20">
                        {/* LEFT: clickable area only (prevents row stealing button taps on mobile) */}
                        <button
                          type="button"
                          className="flex flex-1 items-center gap-3 min-w-0 text-left touch-manipulation"
                          onClick={() => router.push(`/player/${p.id}`)}
                        >
                          <Avatar className="h-10 w-10 border border-emerald-200/70 shrink-0">
                            <AvatarImage src={p.avatar_url || ""} />
                            <AvatarFallback>{initialsFor(p)}</AvatarFallback>
                          </Avatar>

                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-emerald-50 truncate">{nm}</div>
                            <div className="text-xs text-emerald-100/60 truncate">{p.email}</div>
                          </div>
                        </button>

                        {/* RIGHT: big thumb-friendly follow/unfollow */}
                        <div className="shrink-0 pl-2 touch-manipulation">
                          {canAct ? (
                            following ? (
                              <Button
                                type="button"
                                disabled={busyRow}
                                className="h-11 min-w-[108px] rounded-xl border border-red-900 bg-transparent px-4 text-red-200 hover:bg-red-950/60"
                                variant="outline"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  unfollowUserFromList(targetPid);
                                }}
                              >
                                {busyRow ? "…" : "Unfollow"}
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                disabled={busyRow}
                                className="h-11 min-w-[108px] rounded-xl bg-emerald-700/80 px-4 hover:bg-emerald-700"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  followUserFromList(targetPid);
                                }}
                              >
                                {busyRow ? "…" : "Follow"}
                              </Button>
                            )
                          ) : (
                            <div className="text-[11px] text-emerald-100/60">{following ? "Following" : ""}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* SEARCH MODAL (self-only) */}
          {isMe && searchOpen && (
            <div className="fixed inset-0 z-[60] bg-black/70 px-4 py-6">
              <div className="mx-auto w-full max-w-sm h-[85vh] rounded-2xl border border-emerald-900/70 bg-[#0b3b21] shadow-xl overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-4 py-3 border-b border-emerald-900/70">
                  <div>
                    <div className="text-sm font-semibold text-[#f5e6b0]">Find users</div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-200/70">Search & follow</div>
                  </div>

                  <Button variant="ghost" size="sm" className="h-8 px-2 text-emerald-100 hover:bg-emerald-900/30" onClick={() => setSearchOpen(false)}>
                    Close
                  </Button>
                </div>

                <div className="p-3 border-b border-emerald-900/70">
                  <div className="flex gap-2">
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by name or email…"
                      className="flex-1 rounded-xl border border-emerald-900/70 bg-[#08341b] px-3 py-2 text-sm outline-none placeholder:text-emerald-200/40"
                    />
                    <Button size="sm" className="rounded-xl bg-emerald-700/80 hover:bg-emerald-700" onClick={runSearch} disabled={searchLoading}>
                      {searchLoading ? "…" : "Search"}
                    </Button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {searchLoading ? (
                    <div className="p-4 text-sm text-emerald-100/70">Searching…</div>
                  ) : searchResults.length === 0 ? (
                    <div className="p-4 text-sm text-emerald-100/70">Type a name/email and press Search.</div>
                  ) : (
                    <div className="divide-y divide-emerald-900/70">
                      {searchResults.map((p) => {
                        const nm = p.name || p.email || "Player";
                        const targetPid = p.id;
                        const following = myFollowingSet.has(targetPid);
                        const busyRow = busyUserId === targetPid;

                        return (
                          <div key={p.id} className="flex items-center gap-3 p-4 hover:bg-emerald-900/20">
                            {/* LEFT clickable */}
                            <button
                              type="button"
                              className="flex flex-1 items-center gap-3 min-w-0 text-left touch-manipulation"
                              onClick={() => router.push(`/player/${p.id}`)}
                            >
                              <Avatar className="h-10 w-10 border border-emerald-200/70 shrink-0">
                                <AvatarImage src={p.avatar_url || ""} />
                                <AvatarFallback>{initialsFor(p)}</AvatarFallback>
                              </Avatar>

                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-emerald-50 truncate">{nm}</div>
                                <div className="text-xs text-emerald-100/60 truncate">{p.email}</div>
                              </div>
                            </button>

                            {/* RIGHT big follow/unfollow */}
                            <div className="shrink-0 pl-2 touch-manipulation">
                              {following ? (
                                <Button
                                  type="button"
                                  disabled={busyRow}
                                  className="h-11 min-w-[108px] rounded-xl border border-red-900 bg-transparent px-4 text-red-200 hover:bg-red-950/60"
                                  variant="outline"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    unfollowUserFromList(targetPid);
                                  }}
                                >
                                  {busyRow ? "…" : "Unfollow"}
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  disabled={busyRow}
                                  className="h-11 min-w-[108px] rounded-xl bg-emerald-700/80 px-4 hover:bg-emerald-700"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    followUserFromList(targetPid);
                                  }}
                                >
                                  {busyRow ? "…" : "Follow"}
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
