"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getViewerSession } from "@/lib/auth/viewerSession";

type ProfileEmbed = { name: string | null; email: string | null; avatar_url: string | null };

export type RoundFormatType =
  | "strokeplay" | "stableford" | "matchplay" | "pairs_stableford"
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
export type SideGame = { name: string; enabled: boolean; config: Record<string, any> };

export function useRoundDetail(roundId: string, initialSnapshot?: any) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [meId, setMeId] = useState<string | null>(null);

  const [roundName, setRoundName] = useState<string>("Round");
  const [status, setStatus] = useState<string>("draft");
  const [courseLabel, setCourseLabel] = useState<string>("");
  const [playedOnIso, setPlayedOnIso] = useState<string | null>(null);
  const [formatType, setFormatType] = useState<RoundFormatType>("strokeplay");
  const [formatConfig, setFormatConfig] = useState<Record<string, any>>({});
  const [sideGames, setSideGames] = useState<SideGame[]>([]);

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teeSnapshotId, setTeeSnapshotId] = useState<string | null>(null);
  const [holes, setHoles] = useState<Hole[]>([]);
  const [scoresByKey, setScoresByKey] = useState<Record<string, Score>>({});

  // B: hole states keyed by `${participant_id}:${hole_number}`
  const [holeStatesByKey, setHoleStatesByKey] = useState<Record<string, HoleState>>({});

  const toNumOrNull = (v: any) => {
    if (v == null) return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  // Hydrate all state from a snapshot API response
  const hydrateFromSnapshot = useCallback((snap: any) => {
    const r = snap.round ?? {};
    const courseName = r.course_name ?? "";

    setRoundName(r.name || courseName || "Round");
    setStatus(r.status ?? "draft");
    setCourseLabel(courseName);
    setPlayedOnIso(r.started_at ?? r.created_at ?? null);
    setFormatType((r.format_type as RoundFormatType) || "strokeplay");
    setFormatConfig((r.format_config as Record<string, any>) || {});
    setSideGames((r.side_games as SideGame[]) || []);

    // Build extras map from participant_extras
    const extrasMap: Record<string, { playing_handicap_used: number | null; team_id: string | null; handicap_index_direct: number | null }> = {};
    for (const row of (snap.participant_extras ?? []) as any[]) {
      extrasMap[row.id] = {
        playing_handicap_used: toNumOrNull(row.playing_handicap_used),
        team_id: row.team_id ?? null,
        handicap_index_direct: toNumOrNull(row.handicap_index),
      };
    }

    // Build tee meta for CH computation fallback
    const teeMeta = snap.tee_snapshot
      ? {
          rating: toNumOrNull(snap.tee_snapshot.rating),
          slope: toNumOrNull(snap.tee_snapshot.slope),
          par_total: toNumOrNull(snap.tee_snapshot.par_total),
        }
      : null;

    const computeCH = (hi: number | null): number | null => {
      if (hi === null || !teeMeta || teeMeta.rating === null || teeMeta.slope === null || teeMeta.par_total === null) return null;
      return Math.round(hi * (teeMeta.slope! / 113) + (teeMeta.rating! - teeMeta.par_total!));
    };

    const mappedParticipants = ((snap.participants ?? []) as any[]).map((row: any) => {
      const hiResolved =
        toNumOrNull(row.handicap_index) ??
        toNumOrNull(row.handicap_index_computed) ??
        toNumOrNull(extrasMap[row.id]?.handicap_index_direct);
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
        handicap_index_computed: toNumOrNull(row.handicap_index_computed),
        course_handicap_computed: toNumOrNull(row.course_handicap_computed),
        handicap_index_used: toNumOrNull(row.handicap_index_used),
        course_handicap_used: toNumOrNull(row.course_handicap_used),
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
    setTeams((snap.teams ?? []) as Team[]);
    setHoles(((snap.holes ?? []) as Hole[]).sort((a, b) => a.hole_number - b.hole_number));

    const scoreMap: Record<string, Score> = {};
    for (const s of (snap.scores ?? []) as Score[]) scoreMap[`${s.participant_id}:${s.hole_number}`] = s;
    setScoresByKey(scoreMap);

    const hsMap: Record<string, HoleState> = {};
    for (const row of (snap.hole_states ?? []) as HoleStateRow[]) {
      hsMap[`${row.participant_id}:${row.hole_number}`] = row.status;
    }
    setHoleStatesByKey(hsMap);

    setMeId(snap.viewer_profile_id ?? null);
  }, []);

  const fetchAll = useCallback(async () => {
    if (!roundId) return;

    setErr(null);

    const session = await getViewerSession();
    if (!session) { setMeId(null); return; }

    const res = await fetch(`/api/rounds/${roundId}/snapshot`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!res.ok) throw new Error("Failed to load round");
    const snap = await res.json();
    hydrateFromSnapshot(snap);
  }, [roundId, hydrateFromSnapshot]);

  // initial load — use server-provided snapshot when available
  useEffect(() => {
    if (initialSnapshot) {
      hydrateFromSnapshot(initialSnapshot);
      setLoading(false);
      return;
    }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // realtime: meta changes (refetch all, debounced to prevent burst reloads)
  const metaDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedFetchAll = useCallback(() => {
    if (metaDebounceRef.current) clearTimeout(metaDebounceRef.current);
    metaDebounceRef.current = setTimeout(() => fetchAll(), 300);
  }, [fetchAll]);

  useEffect(() => {
    if (!roundId) return;
    const chan = supabase
      .channel(`round-meta:${roundId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "round_participants", filter: `round_id=eq.${roundId}` },
        () => debouncedFetchAll()
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rounds", filter: `id=eq.${roundId}` },
        () => debouncedFetchAll()
      )
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "round_hole_snapshots" }, () => debouncedFetchAll())
      .subscribe();

    return () => {
      if (metaDebounceRef.current) clearTimeout(metaDebounceRef.current);
      supabase.removeChannel(chan);
    };
  }, [roundId, debouncedFetchAll]);

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
    sideGames,

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
