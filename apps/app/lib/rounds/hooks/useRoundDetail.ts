"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getMyProfileIdByAuthUserId } from "@/lib/myProfile";

type ProfileEmbed = { name: string | null; email: string | null; avatar_url: string | null };

export type RoundFormatType =
  | "strokeplay" | "stableford" | "matchplay"
  | "team_strokeplay" | "team_stableford" | "team_bestball"
  | "scramble" | "greensomes" | "foursomes"
  | "skins" | "wolf";

export type Team = { id: string; round_id: string; name: string; team_number: number };

export type Participant = {
  id: string;
  profile_id: string | null;
  is_guest: boolean;
  display_name: string | null;
  role: "owner" | "scorer" | "player";
  tee_snapshot_id: string | null;
  team_id?: string | null;

  // Resolved for UI usage (live => computed, finished => used fallback)
  handicap_index?: number | null;
  course_handicap?: number | null;

  // Both (UI can show both)
  handicap_index_computed?: number | null;
  course_handicap_computed?: number | null;
  handicap_index_used?: number | null;
  course_handicap_used?: number | null;

  // Format scoring
  playing_handicap_used?: number | null;

  profiles?: ProfileEmbed | ProfileEmbed[] | null;
};

export type Hole = { hole_number: number; par: number | null; yardage: number | null; stroke_index: number | null };
export type Score = { participant_id: string; hole_number: number; strokes: number | null; created_at: string };

// B: Hole states
export type HoleState = "completed" | "picked_up" | "not_started";
export type HoleStateRow = { participant_id: string; hole_number: number; status: HoleState };

function getCourseNameFromJoin(r: any): string {
  const c = r?.course;
  if (!c) return "";
  if (Array.isArray(c)) return c?.[0]?.name || "";
  return c?.name || "";
}

export function useRoundDetail(roundId: string) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [meId, setMeId] = useState<string | null>(null);

  const [roundName, setRoundName] = useState<string>("Round");
  const [status, setStatus] = useState<string>("draft");
  const [courseLabel, setCourseLabel] = useState<string>("");
  const [playedOnIso, setPlayedOnIso] = useState<string | null>(null);
  const [formatType, setFormatType] = useState<RoundFormatType>("strokeplay");
  const [formatConfig, setFormatConfig] = useState<Record<string, any>>({});

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teeSnapshotId, setTeeSnapshotId] = useState<string | null>(null);
  const [holes, setHoles] = useState<Hole[]>([]);
  const [scoresByKey, setScoresByKey] = useState<Record<string, Score>>({});

  // B: hole states keyed by `${participant_id}:${hole_number}`
  const [holeStatesByKey, setHoleStatesByKey] = useState<Record<string, HoleState>>({});

  const fetchAll = useCallback(async () => {
    if (!roundId) return;

    setErr(null);

    // Me profile id
    let myProfileId: string | null = null;
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (auth?.user) myProfileId = await getMyProfileIdByAuthUserId(auth.user.id);
    } catch {
      myProfileId = null;
    }
    setMeId(myProfileId);

    // Round meta
    const roundRes = await supabase
      .from("rounds")
      .select("id,name,status,started_at,created_at,format_type,format_config,course:courses(name)")
      .eq("id", roundId)
      .single();
    if (roundRes.error) throw roundRes.error;

    const r = roundRes.data as any;
    const courseName = getCourseNameFromJoin(r);

    setRoundName(r.name || courseName || "Round");
    setStatus(r.status);
    setCourseLabel(courseName);
    setPlayedOnIso((r.started_at as string | null) ?? (r.created_at as string | null) ?? null);
    setFormatType((r.format_type as RoundFormatType) || "strokeplay");
    setFormatConfig((r.format_config as Record<string, any>) || {});

    // Participants via RPC
    const partRes = await supabase.rpc("get_round_participants", { _round_id: roundId });
    if (partRes.error) throw partRes.error;

    const toNumOrNull = (v: any) => {
      if (v == null) return null;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    };

    // Fetch playing_handicap_used, team_id, and the directly-stored handicap_index from round_participants
    const rpExtras = await supabase
      .from("round_participants")
      .select("id,playing_handicap_used,team_id,handicap_index")
      .eq("round_id", roundId);
    const extrasMap: Record<string, { playing_handicap_used: number | null; team_id: string | null; handicap_index_direct: number | null }> = {};
    for (const row of (rpExtras.data ?? []) as any[]) {
      extrasMap[row.id] = {
        playing_handicap_used: toNumOrNull(row.playing_handicap_used),
        team_id: row.team_id ?? null,
        handicap_index_direct: toNumOrNull(row.handicap_index),
      };
    }

    // Fetch tee snapshot metadata so we can compute course handicap as a fallback
    const firstTeeId = ((partRes.data ?? []) as any[]).find((r: any) => r.tee_snapshot_id)?.tee_snapshot_id ?? null;
    let teeMeta: { rating: number; slope: number; par_total: number } | null = null;
    if (firstTeeId) {
      const teeMetaRes = await supabase
        .from("round_tee_snapshots")
        .select("rating,slope,par_total")
        .eq("id", firstTeeId)
        .single();
      if (teeMetaRes.data) {
        const { rating, slope, par_total } = teeMetaRes.data as any;
        const r = toNumOrNull(rating), s = toNumOrNull(slope), p = toNumOrNull(par_total);
        if (r !== null && s !== null && p !== null) teeMeta = { rating: r, slope: s, par_total: p };
      }
    }

    const computeCH = (hi: number | null): number | null => {
      if (hi === null || teeMeta === null) return null;
      return Math.round(hi * (teeMeta.slope / 113) + (teeMeta.rating - teeMeta.par_total));
    };

    const mappedParticipants = ((partRes.data ?? []) as any[]).map((row) => {
      // HI: prefer RPC "used/computed" resolved value, then direct stored value on round_participants
      const hiResolved =
        toNumOrNull(row.handicap_index) ??
        toNumOrNull(row.handicap_index_computed) ??
        toNumOrNull(extrasMap[row.id]?.handicap_index_direct);
      // CH: prefer RPC resolved value, then compute from the resolved HI + tee snapshot
      const chResolved =
        toNumOrNull(row.course_handicap) ??
        toNumOrNull(row.course_handicap_computed) ??
        computeCH(hiResolved);
      return {
      id: row.id,
      profile_id: row.profile_id,
      is_guest: row.is_guest,
      display_name: row.display_name,
      role: row.role,
      tee_snapshot_id: row.tee_snapshot_id,
      team_id: extrasMap[row.id]?.team_id ?? null,

      handicap_index: hiResolved,
      course_handicap: chResolved,

      // both
      handicap_index_computed: toNumOrNull(row.handicap_index_computed),
      course_handicap_computed: toNumOrNull(row.course_handicap_computed),
      handicap_index_used: toNumOrNull(row.handicap_index_used),
      course_handicap_used: toNumOrNull(row.course_handicap_used),

      // format scoring
      playing_handicap_used: extrasMap[row.id]?.playing_handicap_used ?? null,

      profiles: {
        name: row.name,
        email: row.email,
        avatar_url: row.avatar_url,
      },
    };
    }) as Participant[];

    setParticipants(mappedParticipants);

    const teeId = mappedParticipants.find((p: any) => p.tee_snapshot_id)?.tee_snapshot_id ?? null;
    setTeeSnapshotId(teeId);

    // Teams (for team formats)
    const teamsRes = await supabase
      .from("round_teams")
      .select("id,round_id,name,team_number")
      .eq("round_id", roundId)
      .order("team_number", { ascending: true });
    setTeams((teamsRes.data ?? []) as Team[]);

    // Holes snapshot
    if (teeId) {
      const holesRes = await supabase
        .from("round_hole_snapshots")
        .select("hole_number,par,yardage,stroke_index")
        .eq("round_tee_snapshot_id", teeId)
        .order("hole_number", { ascending: true });
      if (holesRes.error) throw holesRes.error;
      setHoles((holesRes.data ?? []) as Hole[]);
    } else {
      setHoles([]);
    }

    // Current scores
    const scoreRes = await supabase
      .from("round_current_scores")
      .select("participant_id,hole_number,strokes,created_at")
      .eq("round_id", roundId);
    if (scoreRes.error) throw scoreRes.error;

    const map: Record<string, Score> = {};
    for (const s of (scoreRes.data ?? []) as Score[]) map[`${s.participant_id}:${s.hole_number}`] = s;
    setScoresByKey(map);

    // B: Hole states
    const hsRes = await supabase
      .from("round_hole_states")
      .select("participant_id,hole_number,status")
      .eq("round_id", roundId);
    if (hsRes.error) throw hsRes.error;

    const hsMap: Record<string, HoleState> = {};
    for (const row of (hsRes.data ?? []) as HoleStateRow[]) {
      hsMap[`${row.participant_id}:${row.hole_number}`] = row.status;
    }
    setHoleStatesByKey(hsMap);
  }, [roundId]);

  // initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await fetchAll();
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load round");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchAll]);

  // realtime: score events
  useEffect(() => {
    if (!roundId) return;

    const channel = supabase
      .channel(`round:${roundId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "round_score_events", filter: `round_id=eq.${roundId}` },
        (payload) => {
          const row = payload.new as any;
          const key = `${row.participant_id}:${row.hole_number}`;
          setScoresByKey((prev) => ({
            ...prev,
            [key]: {
              participant_id: row.participant_id,
              hole_number: row.hole_number,
              strokes: row.strokes,
              created_at: row.created_at,
            },
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roundId]);

  // B: realtime hole state changes
  useEffect(() => {
    if (!roundId) return;

    const channel = supabase
      .channel(`round-hole-states:${roundId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "round_hole_states", filter: `round_id=eq.${roundId}` },
        (payload) => {
          const row: any = (payload.new ?? payload.old) as any;
          if (!row?.participant_id || !row?.hole_number) return;

          const key = `${row.participant_id}:${row.hole_number}`;

          if (payload.eventType === "DELETE") {
            setHoleStatesByKey((prev) => {
              const next = { ...prev };
              delete next[key];
              return next;
            });
            return;
          }

          setHoleStatesByKey((prev) => ({
            ...prev,
            [key]: row.status as HoleState,
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roundId]);

  // realtime: meta changes (refetch all)
  useEffect(() => {
    if (!roundId) return;
    const chan = supabase
      .channel(`round-meta:${roundId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "round_participants", filter: `round_id=eq.${roundId}` },
        () => fetchAll()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rounds", filter: `id=eq.${roundId}` },
        () => fetchAll()
      )
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "round_hole_snapshots" }, () => fetchAll())
      .subscribe();

    return () => {
      supabase.removeChannel(chan);
    };
  }, [roundId, fetchAll]);

  // Permission: any participant can score (you already changed this; keep it)
  const canScore = useMemo(() => {
    if (!meId) return false;
    return participants.some((p) => p.profile_id === meId);
  }, [participants, meId]);

  return {
    loading,
    err,
    setErr,

    meId,

    roundName,
    status,
    setStatus,
    courseLabel,
    playedOnIso,
    formatType,
    formatConfig,

    participants,
    teams,
    teeSnapshotId,
    holes,

    scoresByKey,
    setScoresByKey,

    // B
    holeStatesByKey,
    setHoleStatesByKey,

    fetchAll,
    canScore,
  };
}
