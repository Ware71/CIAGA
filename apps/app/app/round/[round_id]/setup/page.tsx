// /app/round/[round_id]/setup/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";
import { Button } from "@/components/ui/button";
import { RoundFormatSectionEnhanced } from "@/components/rounds/RoundFormatSectionEnhanced";
import { ParticipantsList } from "@/components/rounds/ParticipantsList";
import { CourseAndTeeSection } from "@/components/rounds/CourseAndTeeSection";
import type { RoundFormatType } from "@/components/rounds/FormatSelector";
import type { PlayingHandicapMode } from "@/components/rounds/PlayingHandicapSettings";
import {
  courseNameFromJoin,
  pickNickname,
  getProfile,
  calcCourseHandicap,
} from "@/lib/rounds/setupHelpers";
import type { Round, Participant, ProfileJoin, ProfileLite } from "@/lib/rounds/setupHelpers";
import { round1 } from "@/lib/stats/helpers";

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

/**
 * Public-safe resolvers:
 * - make unclaimed profiles findable (following + search more)
 * - do not rely on direct SELECT on profiles (RLS may block unclaimed)
 *
 * Requires RPCs:
 * - get_profiles_public(ids uuid[])
 * - get_profiles_public_by_owner_ids(owner_ids uuid[])
 * - search_profiles_public(q text, lim int)
 */

// ✅ Robust resolver: handles follows storing either profiles.id OR auth.users.id
async function resolveProfilesForFollowIds(ids: string[]) {
  if (!ids.length) return [];

  // First try as profiles.id (via RPC)
  const byProfileId = await supabase.rpc("get_profiles_public", { ids });
  if (!byProfileId.error && (byProfileId.data?.length ?? 0) > 0) {
    return (byProfileId.data ?? []) as ProfileLite[];
  }

  // If none, treat ids as auth.users.id and match on owner_user_id (via RPC)
  const byOwner = await supabase.rpc("get_profiles_public_by_owner_ids", { owner_ids: ids });
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

// RPC return type for get_round_setup_participants
type SetupParticipantRow = {
  id: string;
  profile_id: string | null;
  is_guest: boolean;
  display_name: string | null;
  role: "owner" | "scorer" | "player" | string;
  profile_name: string | null;
  profile_email: string | null;
  profile_avatar_url: string | null;
  // Handicap fields
  handicap_index?: number | null;
  assigned_playing_handicap?: number | null;
  assigned_handicap_index?: number | null;
  playing_handicap_used?: number | null;
  course_handicap_used?: number | null;
};

/* ---------------- Swipe Row (participants) ---------------- */

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function SwipeToRemoveRow(props: {
  disabled?: boolean;
  revealWidth?: number; // px
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  onRemove: () => void | Promise<void>;
  children: React.ReactNode;
}) {
  const { disabled, revealWidth = 92, isOpen, setOpen, onRemove, children } = props;

  const [dx, setDx] = useState(0); // negative = swiped left
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startDxRef = useRef(0);
  const decidedRef = useRef<"h" | "v" | null>(null);

  // Keep visual state in sync with open/close
  useEffect(() => {
    if (draggingRef.current) return;
    setDx(isOpen ? -revealWidth : 0);
  }, [isOpen, revealWidth]);

  function onPointerDown(e: React.PointerEvent) {
    if (disabled) return;

    draggingRef.current = true;
    decidedRef.current = null;
    startXRef.current = e.clientX;
    startYRef.current = e.clientY;
    startDxRef.current = dx;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (disabled) return;
    if (!draggingRef.current) return;

    const mx = e.clientX - startXRef.current;
    const my = e.clientY - startYRef.current;

    // Decide gesture direction once
    if (!decidedRef.current) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      decidedRef.current = Math.abs(mx) > Math.abs(my) ? "h" : "v";
    }

    if (decidedRef.current === "v") return; // allow page scroll

    // Horizontal swipe
    e.preventDefault();

    const next = clamp(startDxRef.current + mx, -revealWidth, 0);
    setDx(next);
  }

  function finishSwipe() {
    draggingRef.current = false;
    decidedRef.current = null;

    const openThreshold = -revealWidth * 0.6;
    const shouldOpen = dx <= openThreshold;

    setOpen(shouldOpen);
    setDx(shouldOpen ? -revealWidth : 0);
  }

  function onPointerUp() {
    if (disabled) return;
    if (!draggingRef.current) return;
    finishSwipe();
  }

  function onPointerCancel() {
    if (disabled) return;
    if (!draggingRef.current) return;
    finishSwipe();
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-emerald-900/70">
      {/* Underlay */}
      <div className="absolute inset-0 bg-red-950/40">
        <div className="absolute right-0 top-0 bottom-0 flex items-center pr-3">
          <button
            type="button"
            className="h-9 px-3 rounded-xl bg-red-600/90 text-white text-[12px] font-semibold hover:bg-red-600 disabled:opacity-60"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            disabled={!!disabled}
          >
            Remove
          </button>
        </div>
      </div>

      {/* Foreground row (✅ NOT transparent anymore) */}
      <div
        className="relative bg-[#042713]"
        style={{
          transform: `translateX(${dx}px)`,
          transition: draggingRef.current ? "none" : "transform 180ms ease-out",
          touchAction: "pan-y",
          willChange: "transform",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={() => {
          if (disabled) return;
          if (isOpen) setOpen(false);
        }}
      >
        {children}
      </div>
    </div>
  );
}

/* ---------------- Page ---------------- */

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
  const [nameEdit, setNameEdit] = useState<string>("");
  const [nameSaving, setNameSaving] = useState(false);
  const [scheduledEdit, setScheduledEdit] = useState<string>("");
  const detailsUpdatingRef = useRef(false);

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

  // swipe state (only one open at a time)
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  const removingRef = useRef<Set<string>>(new Set());

  // ✅ HI + CH (display only)
  const [hiByProfileId, setHiByProfileId] = useState<Record<string, number>>({});
  const [chByProfileId, setChByProfileId] = useState<Record<string, number>>({});

  const participantProfileIds = useMemo(() => {
    return new Set(participants.map((p) => p.profile_id).filter(Boolean) as string[]);
  }, [participants]);

  const isOwner = useMemo(() => {
    if (!meId) return false;
    const me = participants.find((p) => p.profile_id === meId);
    return me?.role === "owner";
  }, [participants, meId]);

  // Sync name and scheduled date from round state (skip during saves to prevent reset loops)
  useEffect(() => {
    if (!detailsUpdatingRef.current) {
      setNameEdit(round?.name ?? "");
    }
  }, [round?.name]);

  useEffect(() => {
    if (!detailsUpdatingRef.current) {
      if (round?.scheduled_at) {
        const dt = new Date(round.scheduled_at);
        const local = new Date(dt.getTime() - dt.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
        setScheduledEdit(local);
      } else {
        setScheduledEdit("");
      }
    }
  }, [round?.scheduled_at]);

  async function saveNameOnBlur() {
    const trimmed = nameEdit.trim();
    if (trimmed === (round?.name ?? "")) return;
    detailsUpdatingRef.current = true;
    setNameSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/rounds/update-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ round_id: roundId, name: trimmed }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to update name");
      await fetchAll();
    } catch (e: any) {
      setErr(e?.message || "Failed to save name");
    } finally {
      setNameSaving(false);
      setTimeout(() => { detailsUpdatingRef.current = false; }, 500);
    }
  }

  async function saveSchedule(localValue: string) {
    detailsUpdatingRef.current = true;
    const iso = localValue ? new Date(localValue).toISOString() : null;
    const currentIso = round?.scheduled_at ?? null;
    if (iso === currentIso) {
      detailsUpdatingRef.current = false;
      return;
    }

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/rounds/update-settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ round_id: roundId, scheduled_at: iso }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to schedule round");
      await fetchAll();
    } catch (e: any) {
      setErr(e?.message || "Failed to schedule round");
    } finally {
      setTimeout(() => { detailsUpdatingRef.current = false; }, 500);
    }
  }

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
    // Only show loading spinner on initial load (no round data yet).
    // Background refreshes (realtime, post-save) update data silently
    // so components stay mounted and don't lose local state.
    const isInitial = !round;
    if (isInitial) setLoading(true);

    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      router.replace("/auth");
      return;
    }

    const myProfileId = await getMyProfileIdByAuthUserId(auth.user.id);
    setMeId(myProfileId);

    const rRes = await supabase
      .from("rounds")
      .select(`
        id,
        name,
        status,
        course_id,
        pending_tee_box_id,
        started_at,
        format_type,
        format_config,
        side_games,
        scheduled_at,
        default_playing_handicap_mode,
        default_playing_handicap_value,
        courses(name)
      `)
      .eq("id", roundId)
      .single();

    if (rRes.error) {
      setErr(rRes.error.message);
      if (isInitial) setLoading(false);
      return;
    }

    // If round is already live, bail to scorecard
    if ((rRes.data as any)?.status === "live") {
      router.replace(`/round/${roundId}`);
      return;
    }

    // ✅ Use RPC for setup participants (RLS-safe)
    const pRes = await supabase.rpc("get_round_setup_participants", { _round_id: roundId });
    if (pRes.error) {
      setErr(pRes.error.message);
      if (isInitial) setLoading(false);
      return;
    }

    const rows = (pRes.data ?? []) as SetupParticipantRow[];

    // Handicap data is now included in RPC response - no separate query needed!
    const mapped = rows.map((row) => {
      const role = (row.role as any) as "owner" | "scorer" | "player";
      return {
        id: row.id,
        profile_id: row.profile_id,
        is_guest: !!row.is_guest,
        display_name: row.display_name,
        role,
        profiles: row.profile_id
          ? {
              id: row.profile_id ?? undefined,
              name: row.profile_name,
              email: row.profile_email,
              avatar_url: row.profile_avatar_url,
            }
          : null,
        // Include handicap fields
        handicap_index: row.handicap_index,
        assigned_playing_handicap: row.assigned_playing_handicap,
        assigned_handicap_index: row.assigned_handicap_index ?? row.assigned_playing_handicap ?? null,
        playing_handicap_used: row.playing_handicap_used,
        course_handicap_used: row.course_handicap_used,
      } as Participant;
    });

    setRound(rRes.data as any);
    setParticipants(mapped);
    if (isInitial) setLoading(false);
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

  // ✅ Load latest HI + compute CH for players in the "Players" list (display only)
  useEffect(() => {
    const ids = participants
      .filter((p) => !p.is_guest && p.profile_id)
      .map((p) => p.profile_id!) as string[];

    if (!ids.length) {
      setHiByProfileId({});
      setChByProfileId({});
      return;
    }

    let alive = true;

    (async () => {
      try {
        // 1) Newest HI per profile in one query (sorted desc)
        const { data, error } = await supabase
          .from("handicap_index_history")
          .select("profile_id, as_of_date, handicap_index")
          .in("profile_id", ids)
          .not("handicap_index", "is", null)
          .order("as_of_date", { ascending: false });

        if (error) throw error;

        const newest: Record<string, number> = {};
        for (const r of (data ?? []) as any[]) {
          const pid = r.profile_id as string;
          if (newest[pid] != null) continue;
          const hi = Number(r.handicap_index);
          if (Number.isFinite(hi)) newest[pid] = hi;
        }

        const hiMap: Record<string, number> = {};
        for (const pid of ids) {
          const hi = newest[pid];
          if (Number.isFinite(hi)) hiMap[pid] = round1(hi);
        }

        // 2) Tee meta (for CH)
        let chMap: Record<string, number> = {};
        if (round?.pending_tee_box_id) {
          const teeRes = await supabase
            .from("course_tee_boxes")
            .select("par, rating, slope")
            .eq("id", round.pending_tee_box_id)
            .single();

          if (!teeRes.error && teeRes.data) {
            const par = Number((teeRes.data as any).par);
            const rating = Number((teeRes.data as any).rating);
            const slope = Number((teeRes.data as any).slope);

            if (Number.isFinite(par) && Number.isFinite(rating) && Number.isFinite(slope)) {
              const out: Record<string, number> = {};
              for (const pid of ids) {
                const hi = newest[pid];
                if (!Number.isFinite(hi)) continue;
                out[pid] = calcCourseHandicap(hi, slope, rating, par);
              }
              chMap = out;
            }
          }
        }

        if (!alive) return;
        setHiByProfileId(hiMap);
        setChByProfileId(chMap);
      } catch (e) {
        // Non-fatal; keep setup usable
        console.warn("HI/CH load failed", e);
        if (!alive) return;
        setHiByProfileId({});
        setChByProfileId({});
      }
    })();

    return () => {
      alive = false;
    };
  }, [participants, round?.pending_tee_box_id]);

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

  // ✅ Swipe-to-remove participants (draft only)
  async function removeParticipant(participant: Participant) {
    if (!isOwner) return;
    if (starting) return;
    if (round?.status === "live") return;

    // protect owner row + "me"
    if (participant.role === "owner") return;
    if (participant.profile_id && participant.profile_id === meId) return;

    if (removingRef.current.has(participant.id)) return;

    const label = displayParticipant(participant).name;
    const ok = window.confirm(`Remove ${label} from this round?`);
    if (!ok) return;

    removingRef.current.add(participant.id);
    setErr(null);

    // Optimistic UI
    setParticipants((prev) => prev.filter((p) => p.id !== participant.id));
    setOpenSwipeId(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Not authenticated.");

      // ✅ IMPORTANT: this is NOT delete-draft. It is remove-participant.
      const res = await fetch("/api/rounds/remove-participant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          round_id: roundId,
          participant_id: participant.id,
          requester_profile_id: meId,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `Failed (${res.status})`);

      await fetchAll();
    } catch (e: any) {
      setErr(e?.message || "Failed to remove player");
      await fetchAll();
    } finally {
      removingRef.current.delete(participant.id);
    }
  }

  async function startRound() {
    if (starting) return;
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
      const res = await supabase.rpc("search_profiles_public", { q, lim: 20 });
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
  const roundFull = participants.length >= 4;
  const canAdd = canEdit && !roundFull;

  return (
    <div className="min-h-screen bg-[#042713] text-slate-100 px-4 pt-8 pb-[calc(env(safe-area-inset-bottom)+3rem)]">
      <div className="mx-auto w-full max-w-sm space-y-4">
        {/* Header */}
        <header className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="px-2 text-emerald-100 hover:bg-emerald-900/30"
            onClick={() => router.push("/round")}
            disabled={starting}
          >
            ← Back
          </Button>

          <div className="text-center flex-1">
            <div className="text-lg font-semibold tracking-wide text-[#f5e6b0]">Round setup</div>
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

        {/* Round Details */}
        {!loading && round && round.status !== "live" ? (
          <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 space-y-4">
            <div className="text-sm font-semibold text-emerald-50">Round Details</div>

            {/* Round Name */}
            <div>
              <label className="text-[11px] text-emerald-100/70 block mb-1">Round name</label>
              <div className="relative">
                <input
                  value={nameEdit}
                  onChange={(e) => setNameEdit(e.target.value)}
                  onBlur={() => saveNameOnBlur()}
                  placeholder={courseNameFromJoin(round) || "Round name"}
                  className="w-full px-3 py-2 rounded-xl bg-[#042713] border border-emerald-900/70 text-sm text-emerald-100 outline-none focus:border-emerald-600 transition-colors"
                  disabled={!canEdit}
                />
                {nameSaving ? (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-emerald-100/50">Saving...</span>
                ) : null}
              </div>
            </div>

            {/* Scheduled Date */}
            <div>
              <label className="text-[11px] text-emerald-100/70 block mb-1">Scheduled date & time</label>
              <div className="overflow-hidden rounded-xl border border-emerald-900/70 bg-[#042713]">
                <input
                  type="datetime-local"
                  value={scheduledEdit}
                  onChange={(e) => {
                    setScheduledEdit(e.target.value);
                    saveSchedule(e.target.value);
                  }}
                  className="w-full px-3 py-2 bg-transparent text-sm text-emerald-100 outline-none [color-scheme:dark]"
                  disabled={!canEdit}
                />
              </div>
              {scheduledEdit ? (
                <button
                  type="button"
                  onClick={() => {
                    setScheduledEdit("");
                    saveSchedule("");
                  }}
                  className="mt-1 text-[10px] text-emerald-100/50 hover:text-emerald-100/80"
                  disabled={!canEdit}
                >
                  Clear schedule (revert to draft)
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Course & Tee Selection */}
        {!loading && round && round.status !== "live" ? (
          <CourseAndTeeSection
            roundId={roundId}
            courseId={round.course_id}
            pendingTeeBoxId={round.pending_tee_box_id}
            isOwner={isOwner}
            isEditable={round.status === "draft" || round.status === "scheduled"}
            onUpdate={fetchAll}
          />
        ) : null}

        {/* Round Format & Handicap Settings */}
        {!loading && round && round.status !== "live" ? (
          <RoundFormatSectionEnhanced
            roundId={roundId}
            initialFormat={(round.format_type as any) || "strokeplay"}
            initialFormatConfig={round.format_config || {}}
            initialSideGames={round.side_games || []}
            initialHandicapMode={(round.default_playing_handicap_mode as any) || "allowance_pct"}
            initialHandicapValue={round.default_playing_handicap_value || 100}
            isOwner={isOwner}
            isEditable={round.status === "draft" || round.status === "scheduled"}
            onUpdate={fetchAll}
            participants={participants.map((p) => ({
              id: p.id,
              displayName: displayParticipant(p).name,
            }))}
          />
        ) : null}

        {/* ====== Players Section ====== */}
        {!loading && round && round.status !== "live" ? (
          <div className="space-y-3">
            {/* Section heading */}
            <div className="px-1">
              <div className="text-sm font-semibold text-[#f5e6b0]">Players</div>
              <div className="text-[10px] text-emerald-100/50">
                {participants.length}/4 player{participants.length !== 1 ? "s" : ""} in this round
                {participants.length >= 4 ? (
                  <span className="ml-1 text-amber-200/80">· Round is full</span>
                ) : null}
              </div>
            </div>

            {/* Roster */}
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4">
              <div className="text-[11px] font-medium text-emerald-100/80 uppercase tracking-wider mb-2">Roster</div>

              <div className="space-y-2">
                {participants.map((p) => {
                  const d = displayParticipant(p);

                  const removable =
                    isOwner &&
                    !starting &&
                    round?.status !== "live" &&
                    p.role !== "owner" &&
                    !(p.profile_id && p.profile_id === meId);

                  const hi = p.profile_id ? hiByProfileId[p.profile_id] : null;
                  const ch = p.profile_id ? chByProfileId[p.profile_id] : null;

                  return (
                    <SwipeToRemoveRow
                      key={p.id}
                      disabled={!removable}
                      isOpen={openSwipeId === p.id}
                      setOpen={(open) => setOpenSwipeId(open ? p.id : null)}
                      onRemove={() => removeParticipant(p)}
                    >
                      <div className="p-3 flex items-center gap-3">
                        <Avatar name={d.name} url={d.avatar_url} size={36} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-emerald-50 truncate">{d.name}</div>
                          <div className="text-[11px] text-emerald-100/60">
                            {p.is_guest ? "Guest" : p.profile_id === meId ? "You" : "Player"} · {p.role}
                            {!p.is_guest ? (
                              <span className="ml-2 text-[10px] text-emerald-100/70 tabular-nums">
                                HI {typeof hi === "number" ? hi.toFixed(1) : "—"} · CH {typeof ch === "number" ? ch : "—"}
                              </span>
                            ) : null}
                            {removable ? (
                              <span className="ml-2 text-[10px] text-emerald-100/50">Swipe to remove</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </SwipeToRemoveRow>
                  );
                })}

                {participants.length === 0 ? (
                  <div className="text-[11px] text-emerald-100/60 mt-2">No players yet.</div>
                ) : null}
              </div>
            </div>

            {/* Add Players */}
            <div className="rounded-2xl border border-emerald-900/70 bg-[#0b3b21]/70 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-medium text-emerald-100/80 uppercase tracking-wider">Add Players</div>
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
                disabled={!canAdd}
              />

              <div className="max-h-[220px] overflow-y-auto overscroll-contain pr-1">
                <div className="space-y-2">
                  {filteredFollowing.map((p) => {
                    const name = pickNickname(p);
                    return (
                      <button
                        key={p.id}
                        onClick={() => addProfile(p.id)}
                        disabled={!canAdd}
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
                </div>
              </div>

              <div className="pt-2 flex gap-2">
                <Button
                  variant="ghost"
                  className="flex-1 rounded-2xl border border-emerald-900/70 text-emerald-100 hover:bg-emerald-900/20"
                  onClick={() => setShowSearchMore((v) => !v)}
                  disabled={!canAdd}
                >
                  {showSearchMore ? "Hide search" : "Search more"}
                </Button>

                <Button
                  variant="ghost"
                  className="flex-1 rounded-2xl border border-emerald-900/70 text-emerald-100 hover:bg-emerald-900/20"
                  onClick={() => setShowGuest((v) => !v)}
                  disabled={!canAdd}
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
                    disabled={!canAdd}
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
                          disabled={!canAdd}
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
                      disabled={!canAdd || addingGuest}
                    />
                    <Button
                      className="rounded-xl bg-[#f5e6b0] text-[#042713] hover:bg-[#e9d79c]"
                      onClick={addGuest}
                      disabled={!canAdd || addingGuest || !guestName.trim()}
                    >
                      {addingGuest ? "…" : "Add"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Player Handicaps */}
            {participants.length > 0 ? (
              <ParticipantsList
                roundId={roundId}
                participants={participants}
                myProfileId={meId}
                isOwner={isOwner}
                isEditable={round.status === "draft" || round.status === "scheduled"}
                onUpdate={fetchAll}
                getDisplayName={displayParticipant as any}
              />
            ) : null}

            {!isOwner ? (
              <div className="text-center text-[10px] text-emerald-100/60">
                Only the round owner can add players and start the round.
              </div>
            ) : null}
          </div>
        ) : null}

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
