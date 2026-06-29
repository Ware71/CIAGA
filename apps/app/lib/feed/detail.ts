import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { FeedItemVM, FeedItemDetail, RoundDetailPlayer } from "@/lib/feed/types";

/**
 * Compute the type-specific detail shown below the summary card on the
 * feed-item detail page. All data is sourced from existing tables/views:
 * - get_round_detail_snapshot (per-hole scores, pars, participants)
 * - v_course_record_rounds (gross history per profile/course/tee)
 * - round_current_scores (per-hole strokes across rounds, for hole stats)
 *
 * Best-effort: returns null on missing data rather than throwing.
 */
export async function getFeedItemDetail(item: FeedItemVM): Promise<FeedItemDetail | null> {
  try {
    const p: any = item.payload ?? {};

    if (item.type === "round_played") {
      const isMatchplay = typeof p.format_type === "string" && p.format_type.startsWith("matchplay");
      return isMatchplay ? await matchplayDetail(item) : await roundDetail(item);
    }
    if (item.type === "hole_event") return await holeEventDetail(item);
    if (item.type === "pb") return await pbDetail(item);
    if (item.type === "course_record") return await courseRecordDetail(item);
    return null;
  } catch {
    return null;
  }
}

// ── Round progression (strokeplay) ───────────────────────────────────

async function roundDetail(item: FeedItemVM): Promise<FeedItemDetail | null> {
  const roundId = (item.payload as any)?.round_id;
  if (typeof roundId !== "string") return null;

  const { data, error } = await supabaseAdmin.rpc("get_round_detail_snapshot", { _round_id: roundId });
  if (error || !data?.round) return null;

  const holesCount: number = data.tee_snapshot?.holes_count ?? (data.holes?.length || 18);

  const parByHole = new Map<number, number | null>();
  for (const h of (data.holes ?? []) as any[]) parByHole.set(h.hole_number, h.par ?? null);

  // participant_id → { hole_number → strokes }
  const scoresByPart = new Map<string, Map<number, number>>();
  for (const s of (data.scores ?? []) as any[]) {
    const pid = s.participant_id as string;
    const hn = s.hole_number as number;
    const strokes = typeof s.strokes === "number" ? s.strokes : null;
    if (!pid || !hn || strokes === null) continue;
    if (!scoresByPart.has(pid)) scoresByPart.set(pid, new Map());
    scoresByPart.get(pid)!.set(hn, strokes);
  }

  const participants = ((data.participants ?? []) as any[]).filter(
    (rp) => scoresByPart.has(rp.id), // only players with scores
  );
  if (!participants.length) return null;

  const players: RoundDetailPlayer[] = participants.map((rp, i) => ({
    key: `p${i}`,
    name: rp.name ?? rp.display_name ?? "Player",
    avatar_url: rp.avatar_url ?? null,
  }));

  // Cumulative to-par per player per hole + rank at each hole.
  const cumGross = new Map<string, number>(); // partId → running gross over completed holes
  const cumPar = new Map<string, number>();
  const completed = new Map<string, number>();

  const rows: Array<Record<string, number | null> & { hole: number }> = [];

  for (let hole = 1; hole <= holesCount; hole++) {
    const par = parByHole.get(hole) ?? null;

    // advance cumulative for players who completed this hole
    participants.forEach((rp) => {
      const strokes = scoresByPart.get(rp.id)?.get(hole);
      if (typeof strokes === "number") {
        cumGross.set(rp.id, (cumGross.get(rp.id) ?? 0) + strokes);
        if (par !== null) cumPar.set(rp.id, (cumPar.get(rp.id) ?? 0) + par);
        completed.set(rp.id, (completed.get(rp.id) ?? 0) + 1);
      }
    });

    // rank players by cumulative gross thru this hole (only those with progress)
    const ranked = participants
      .filter((rp) => (completed.get(rp.id) ?? 0) > 0)
      .map((rp) => ({ id: rp.id, gross: cumGross.get(rp.id) ?? 0 }))
      .sort((a, b) => a.gross - b.gross);

    const rankById = new Map<string, number>();
    let lastGross: number | null = null;
    let lastRank = 0;
    ranked.forEach((r, idx) => {
      const rank = lastGross !== null && r.gross === lastGross ? lastRank : idx + 1;
      rankById.set(r.id, rank);
      lastGross = r.gross;
      lastRank = rank;
    });

    const row: Record<string, number | null> & { hole: number } = { hole };
    participants.forEach((rp, i) => {
      const hasProgress = (completed.get(rp.id) ?? 0) > 0;
      const toPar = hasProgress ? (cumGross.get(rp.id) ?? 0) - (cumPar.get(rp.id) ?? 0) : null;
      row[`p${i}`] = toPar;
      row[`p${i}_rank`] = hasProgress ? (rankById.get(rp.id) ?? null) : null;
    });
    rows.push(row);
  }

  return { kind: "round", holes_count: holesCount, players, rows };
}

// ── Matchplay (this match + all-time H2H) ────────────────────────────

async function matchplayDetail(item: FeedItemVM): Promise<FeedItemDetail | null> {
  const p: any = item.payload ?? {};
  const playersRaw: any[] = Array.isArray(p.players) ? p.players : [];
  const players = playersRaw.map((pl) => ({ name: pl.name ?? "Player", avatar_url: pl.avatar_url ?? null }));

  const thisMatch: string | null = typeof p.format_winner === "string" ? p.format_winner : null;

  // All-time H2H only for a clean 1v1.
  const withIds = playersRaw.filter((pl) => typeof pl.profile_id === "string");
  let all_time: { a_name: string; b_name: string; a_wins: number; b_wins: number; draws: number; total: number } | null =
    null;

  if (withIds.length === 2) {
    const a = withIds[0];
    const b = withIds[1];
    all_time = await matchplayHeadToHead(a.profile_id, b.profile_id, a.name ?? "A", b.name ?? "B");
  }

  return { kind: "matchplay", players, this_match: thisMatch, all_time };
}

async function matchplayHeadToHead(
  aId: string,
  bId: string,
  aName: string,
  bName: string,
): Promise<{ a_name: string; b_name: string; a_wins: number; b_wins: number; draws: number; total: number } | null> {
  // Rounds shared by both profiles.
  const { data: partRows } = await supabaseAdmin
    .from("round_participants")
    .select("round_id, profile_id")
    .in("profile_id", [aId, bId]);

  const byRound = new Map<string, Set<string>>();
  for (const r of (partRows ?? []) as any[]) {
    if (!byRound.has(r.round_id)) byRound.set(r.round_id, new Set());
    byRound.get(r.round_id)!.add(r.profile_id);
  }
  const sharedRoundIds = [...byRound.entries()].filter(([, s]) => s.has(aId) && s.has(bId)).map(([rid]) => rid);
  if (!sharedRoundIds.length) return { a_name: aName, b_name: bName, a_wins: 0, b_wins: 0, draws: 0, total: 0 };

  // Stored round_played feed items carry the computed matchplay winner string.
  const groupKeys = sharedRoundIds.map((rid) => `round:${rid}`);
  const { data: feedRows } = await supabaseAdmin
    .from("feed_items")
    .select("payload")
    .in("group_key", groupKeys);

  let aWins = 0;
  let bWins = 0;
  let draws = 0;
  let total = 0;

  for (const row of (feedRows ?? []) as any[]) {
    const pl: any = row.payload ?? {};
    if (typeof pl.format_type !== "string" || !pl.format_type.startsWith("matchplay")) continue;
    total++;
    const winner = String(pl.format_winner ?? "").toLowerCase();
    const halved = !winner || winner.includes("halv") || winner.includes("tie") || winner.includes("all square") || winner.includes(" as");
    if (halved) {
      draws++;
    } else if (winner.includes(aName.toLowerCase())) {
      aWins++;
    } else if (winner.includes(bName.toLowerCase())) {
      bWins++;
    } else {
      draws++; // indeterminate → count as draw rather than dropping the match
    }
  }

  return { a_name: aName, b_name: bName, a_wins: aWins, b_wins: bWins, draws, total };
}

// ── Hole event (par/yardage/SI + crowd stats) ────────────────────────

async function holeEventDetail(item: FeedItemVM): Promise<FeedItemDetail | null> {
  const p: any = item.payload ?? {};
  const holeNumber: number | null = typeof p.hole_number === "number" ? p.hole_number : null;
  const par: number | null = typeof p.par === "number" ? p.par : null;
  const kind: string = String(p.kind ?? "");
  const eventLabel = kind === "hio" ? "Hole in one" : kind === "albatross" ? "Albatross" : kind === "eagle" ? "Eagle" : "Hole event";

  let yardage: number | null = typeof p.yardage === "number" ? p.yardage : null;
  let strokeIndex: number | null = null;

  // Pull SI/yardage from this round's snapshot.
  if (typeof p.round_id === "string" && holeNumber !== null) {
    const { data } = await supabaseAdmin.rpc("get_round_detail_snapshot", { _round_id: p.round_id });
    const hole = ((data?.holes ?? []) as any[]).find((h) => h.hole_number === holeNumber);
    if (hole) {
      strokeIndex = hole.stroke_index ?? null;
      if (yardage === null) yardage = hole.yardage ?? null;
    }
  }

  // Crowd stats: all scores recorded on this hole at this course+tee.
  let avgScore: number | null = null;
  let plays = 0;
  let eventPct: number | null = null;

  const courseId: string | null = typeof p.course_id === "string" ? p.course_id : null;
  if (courseId && holeNumber !== null) {
    const teeName: string | null = typeof p.tee_name === "string" ? p.tee_name : null;
    let crq = supabaseAdmin
      .from("v_course_record_rounds")
      .select("round_id, tee_name")
      .eq("course_id", courseId);
    const { data: crRows } = await crq;
    const roundIds = Array.from(
      new Set(
        (crRows ?? [])
          .filter((r: any) => (r.tee_name ?? null) === teeName)
          .map((r: any) => r.round_id as string)
          .filter(Boolean),
      ),
    );

    if (roundIds.length) {
      const { data: scoreRows } = await supabaseAdmin
        .from("round_current_scores")
        .select("strokes")
        .in("round_id", roundIds)
        .eq("hole_number", holeNumber);

      const strokesList = (scoreRows ?? [])
        .map((r: any) => (typeof r.strokes === "number" ? r.strokes : null))
        .filter((n: number | null): n is number => n !== null);

      plays = strokesList.length;
      if (plays > 0) {
        avgScore = strokesList.reduce((a, b) => a + b, 0) / plays;
        const matches = strokesList.filter((s) => {
          if (kind === "hio") return s === 1;
          if (par === null) return false;
          if (kind === "eagle") return s === par - 2;
          if (kind === "albatross") return s === par - 3;
          return false;
        }).length;
        eventPct = (matches / plays) * 100;
      }
    }
  }

  return {
    kind: "hole_event",
    event_label: eventLabel,
    hole_number: holeNumber,
    par,
    yardage,
    stroke_index: strokeIndex,
    avg_score: avgScore,
    plays,
    event_pct: eventPct,
  };
}

// ── Personal best (previous best at this course+tee) ─────────────────

async function pbDetail(item: FeedItemVM): Promise<FeedItemDetail | null> {
  const p: any = item.payload ?? {};
  const gross = typeof p.gross_total === "number" ? p.gross_total : null;
  const profileId: string | null = typeof p.profile_id === "string" ? p.profile_id : null;
  const courseId: string | null = typeof p.course_id === "string" ? p.course_id : null;
  const teeName: string | null = typeof p.tee_name === "string" ? p.tee_name : null;
  const roundId: string | null = typeof p.round_id === "string" ? p.round_id : null;

  let previousBest: { gross: number; date: string | null } | null = null;

  if (profileId && courseId) {
    const { data: rows } = await supabaseAdmin
      .from("v_course_record_rounds")
      .select("gross_score, played_at, tee_name, round_id, is_complete")
      .eq("profile_id", profileId)
      .eq("course_id", courseId)
      .eq("is_complete", true);

    const prior = (rows ?? [])
      .filter((r: any) => (r.tee_name ?? null) === teeName && r.round_id !== roundId)
      .map((r: any) => ({ gross: r.gross_score as number, date: (r.played_at as string) ?? null }))
      .filter((r) => typeof r.gross === "number")
      .sort((a, b) => a.gross - b.gross);

    previousBest = prior[0] ?? null;
  }

  return { kind: "pb", gross, previous_best: previousBest };
}

// ── Course record (who they beat) ────────────────────────────────────

async function courseRecordDetail(item: FeedItemVM): Promise<FeedItemDetail | null> {
  const p: any = item.payload ?? {};
  const gross = typeof p.gross_total === "number" ? p.gross_total : null;
  const courseId: string | null = typeof p.course_id === "string" ? p.course_id : null;
  const teeName: string | null = typeof p.tee_name === "string" ? p.tee_name : null;
  const roundId: string | null = typeof p.round_id === "string" ? p.round_id : null;

  let beat: { name: string | null; gross: number; date: string | null } | null = null;

  if (courseId) {
    const { data: rows } = await supabaseAdmin
      .from("v_course_record_rounds")
      .select("gross_score, played_at, tee_name, round_id, profile_id, is_complete")
      .eq("course_id", courseId)
      .eq("is_complete", true);

    const prior = (rows ?? [])
      .filter((r: any) => (r.tee_name ?? null) === teeName && r.round_id !== roundId)
      .map((r: any) => ({ gross: r.gross_score as number, date: (r.played_at as string) ?? null, profile_id: r.profile_id as string | null }))
      .filter((r) => typeof r.gross === "number")
      .sort((a, b) => a.gross - b.gross);

    const prev = prior[0];
    if (prev) {
      let name: string | null = null;
      if (prev.profile_id) {
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("name")
          .eq("id", prev.profile_id)
          .maybeSingle();
        name = (prof as any)?.name ?? null;
      }
      beat = { name, gross: prev.gross, date: prev.date };
    }
  }

  return { kind: "course_record", gross, beat };
}
