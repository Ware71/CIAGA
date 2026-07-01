"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getViewerSession } from "@/lib/auth/viewerSession";
import { resolvePlayingHandicapPreview } from "@/lib/rounds/playingHandicapPreview";
import type { PlayingHandicapMode } from "@/components/rounds/PlayingHandicapSettings";

type ProfileEmbed = { name: string | null; email: string | null; avatar_url: string | null };

export type RoundFormatType =
  | "strokeplay" | "stableford" | "matchplay" | "pairs_stableford"
  | "team_strokeplay" | "team_stableford" | "team_bestball"
  | "scramble" | "greensomes" | "foursomes"
  | "skins" | "wolf";

export type Team = { id: string; round_id: string; name: string; team_number: number; playing_handicap_used?: number | null };

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

export type WolfMode = "partner" | "lone" | "blind";
export type WolfPick = {
  wolf_participant_id: string | null;
  partner_participant_id: string | null;
  wolf_mode: WolfMode;
};

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

  const [eventTeeTimeId, setEventTeeTimeId] = useState<string | null>(null);

  // Round settings surfaced for display (hamburger menu) and live preview.
  const [defaultTeeName, setDefaultTeeName] = useState<string | null>(null);
  const [playingHandicapMode, setPlayingHandicapMode] = useState<string | null>(null);
  const [playingHandicapValue, setPlayingHandicapValue] = useState<number | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  // True until the (non-live) preview scorecard has been built or we've confirmed
  // there's no tee. Gates a scorecard skeleton so the "Round not started" panel
  // never flashes while preview holes are loading. Only ever set false.
  const [previewLoading, setPreviewLoading] = useState<boolean>(true);

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teeSnapshotId, setTeeSnapshotId] = useState<string | null>(null);
  const [holes, setHoles] = useState<Hole[]>([]);
  const [scoresByKey, setScoresByKey] = useState<Record<string, Score>>({});

  // B: hole states keyed by `${participant_id}:${hole_number}`
  const [holeStatesByKey, setHoleStatesByKey] = useState<Record<string, HoleState>>({});

  // Wolf game: per-hole picks keyed by hole_number
  const [wolfPicksByHole, setWolfPicksByHole] = useState<Record<number, WolfPick>>({});

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
    setEventTeeTimeId((r.event_tee_time_id as string) ?? null);

    // Build extras map from participant_extras
    const extrasMap: Record<string, { playing_handicap_used: number | null; team_id: string | null; handicap_index_direct: number | null }> = {};
    for (const row of (snap.participant_extras ?? []) as any[]) {
      extrasMap[row.id] = {
        playing_handicap_used: toNumOrNull(row.playing_handicap_used),
        team_id: row.team_id ?? null,
        handicap_index_direct: toNumOrNull(row.handicap_index),
      };
    }

    // Default tee name for display (live/finished — preview fills this below).
    setDefaultTeeName(snap.tee_snapshot?.name ?? null);

    // Build tee meta for CH computation fallback
    const teeMeta = snap.tee_snapshot
      ? {
          rating: toNumOrNull(snap.tee_snapshot.rating),
          slope: toNumOrNull(snap.tee_snapshot.slope),
          par_total: toNumOrNull(snap.tee_snapshot.par_total),
          holes_count: (snap.tee_snapshot.holes_count as number | null) ?? 18,
        }
      : null;

    const computeCH = (hi: number | null): number | null => {
      if (hi === null || !teeMeta || teeMeta.rating === null || teeMeta.slope === null || teeMeta.par_total === null) return null;
      // For 9-hole rounds: halve the handicap index before applying the WHS formula
      const effectiveHi = teeMeta.holes_count === 9 ? hi / 2 : hi;
      return Math.round(effectiveHi * (teeMeta.slope! / 113) + (teeMeta.rating! - teeMeta.par_total!));
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
    // Only replace holes when the snapshot actually has some. Preview rounds have
    // no snapshot holes (the preview effect builds them from the pending tee); and
    // a just-activated round's hole snapshots may lag a beat. Preserving the
    // existing holes in those windows avoids a flash of the "not started" panel.
    const snapHoles = (snap.holes ?? []) as Hole[];
    if (snapHoles.length) {
      setHoles([...snapHoles].sort((a, b) => a.hole_number - b.hole_number));
    }

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
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || `Failed to load round (${res.status})`);
    }
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

  // Wolf picks: initial load + realtime. Not part of the snapshot RPC, so fetched directly.
  useEffect(() => {
    if (!roundId) return;
    let cancelled = false;

    const applyRow = (row: any) =>
      setWolfPicksByHole((prev) => ({
        ...prev,
        [row.hole_number as number]: {
          wolf_participant_id: row.wolf_participant_id ?? null,
          partner_participant_id: row.partner_participant_id ?? null,
          wolf_mode: (row.wolf_mode as WolfMode) ?? "partner",
        },
      }));

    (async () => {
      const { data } = await supabase
        .from("round_wolf_picks")
        .select("hole_number, wolf_participant_id, partner_participant_id, wolf_mode")
        .eq("round_id", roundId);
      if (cancelled || !data) return;
      const map: Record<number, WolfPick> = {};
      for (const row of data as any[]) {
        map[row.hole_number] = {
          wolf_participant_id: row.wolf_participant_id ?? null,
          partner_participant_id: row.partner_participant_id ?? null,
          wolf_mode: (row.wolf_mode as WolfMode) ?? "partner",
        };
      }
      setWolfPicksByHole(map);
    })();

    const channel = supabase
      .channel(`round-wolf-picks:${roundId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "round_wolf_picks", filter: `round_id=eq.${roundId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old: any = payload.old;
            if (old?.hole_number == null) return;
            setWolfPicksByHole((prev) => {
              const next = { ...prev };
              delete next[old.hole_number];
              return next;
            });
            return;
          }
          const row: any = payload.new;
          if (row?.hole_number == null) return;
          applyRow(row);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
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

  // Round settings + live preview. For not-yet-live rounds there are no snapshots,
  // so we build the scorecard from the *current* pending tee and compute CH/PH
  // live (dynamic until the round starts). Also surfaces the default tee name +
  // handicap allowance for the scorecard menu on live rounds.
  const participantIdsKey = useMemo(
    () => participants.map((p) => p.id).sort().join(","),
    [participants]
  );
  const previewBuiltRef = useRef<string>("");

  useEffect(() => {
    if (!roundId) return;
    let cancelled = false;

    (async () => {
      try {
        const { data: round } = await supabase
          .from("rounds")
          .select("course_id, pending_tee_box_id, default_playing_handicap_mode, default_playing_handicap_value")
          .eq("id", roundId)
          .maybeSingle();
        if (cancelled || !round) return;

        setCourseId(((round as any).course_id as string) ?? null);
        const mode = ((round as any).default_playing_handicap_mode as PlayingHandicapMode) ?? null;
        const value = toNumOrNull((round as any).default_playing_handicap_value);
        setPlayingHandicapMode(mode);
        setPlayingHandicapValue(value);

        const notLive = status === "draft" || status === "scheduled";
        if (!notLive) return; // live/finished render from the snapshot

        // Already built for this exact field + we have holes → nothing to do.
        if (previewBuiltRef.current === participantIdsKey && holes.length > 0) return;
        if (!participantIdsKey) return;

        const defaultTeeBoxId = ((round as any).pending_tee_box_id as string) ?? null;
        if (!defaultTeeBoxId) {
          setDefaultTeeName(null);
          return; // no tee chosen yet → "Go to setup"
        }

        const { data: partRows } = await supabase
          .from("round_participants")
          .select("id, pending_tee_box_id, handicap_index, assigned_playing_handicap")
          .eq("round_id", roundId);

        const teeIds = Array.from(
          new Set([
            defaultTeeBoxId,
            ...((partRows ?? []).map((p: any) => p.pending_tee_box_id).filter(Boolean) as string[]),
          ])
        );

        const [{ data: teeBoxes }, { data: holeRows }] = await Promise.all([
          supabase
            .from("course_tee_boxes")
            .select("id, name, rating, slope, par, holes_count")
            .in("id", teeIds),
          supabase
            .from("course_tee_holes")
            .select("hole_number, par, yardage, handicap")
            .eq("tee_box_id", defaultTeeBoxId)
            .order("hole_number", { ascending: true }),
        ]);
        if (cancelled) return;

        const teeById = new Map((teeBoxes ?? []).map((t: any) => [t.id, t]));
        const defaultTee = teeById.get(defaultTeeBoxId);
        const partById = new Map((partRows ?? []).map((p: any) => [p.id, p]));

        const chWith = (hi: number | null, tee: any): number | null => {
          if (hi == null || !tee || tee.rating == null || tee.slope == null || tee.par == null) return null;
          const hc = tee.holes_count ?? 18;
          const eff = hc === 9 ? hi / 2 : hi;
          return Math.round(eff * (tee.slope / 113) + (tee.rating - tee.par));
        };

        // First pass: CH per participant (needed for compare_against_lowest).
        const chById = new Map<string, number | null>();
        for (const p of participants) {
          const row = partById.get(p.id);
          const hi = p.handicap_index ?? toNumOrNull(row?.handicap_index);
          const tee = row?.pending_tee_box_id ? teeById.get(row.pending_tee_box_id) : defaultTee;
          chById.set(p.id, chWith(hi, tee));
        }
        const chVals = Array.from(chById.values()).filter((v): v is number => v != null);
        const lowestCH = chVals.length ? Math.min(...chVals) : null;

        const previewHoles: Hole[] = (holeRows ?? [])
          .map((h: any) => ({
            hole_number: h.hole_number,
            par: h.par,
            yardage: h.yardage,
            stroke_index: h.handicap,
          }))
          .sort((a, b) => a.hole_number - b.hole_number);

        setHoles(previewHoles);
        setDefaultTeeName(defaultTee?.name ?? null);
        setParticipants((prev) =>
          prev.map((p) => {
            const row = partById.get(p.id);
            const ch = chById.get(p.id) ?? null;
            const override = toNumOrNull(row?.assigned_playing_handicap);
            const ph =
              override != null
                ? override
                : resolvePlayingHandicapPreview({
                    courseHandicap: ch,
                    mode,
                    value,
                    lowestCourseHandicap: lowestCH,
                  });
            return { ...p, course_handicap: ch, playing_handicap_used: ph };
          })
        );
        previewBuiltRef.current = participantIdsKey;
      } finally {
        // Preview has resolved (built holes, no tee, or live) — stop gating the
        // skeleton. Never set back to true, so later rebuilds don't re-flash it.
        if (!cancelled) setPreviewLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId, status, participantIdsKey, holes.length]);

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

    defaultTeeName,
    playingHandicapMode,
    playingHandicapValue,
    courseId,
    previewLoading,

    eventTeeTimeId,

    scoresByKey,
    setScoresByKey,

    // B
    holeStatesByKey,
    setHoleStatesByKey,

    // Wolf
    wolfPicksByHole,
    setWolfPicksByHole,

    fetchAll,
    canScore,
  };
}
