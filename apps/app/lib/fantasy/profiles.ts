import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { lengthBand, siBand, splitKey, strokesReceived } from "@/lib/fantasy/simulation/holeModel";
import { recencyWeightedDifferentialStats } from "@/lib/fantasy/simulation/differentials";
import type { HoleSplits, SimPlayerProfile } from "@/lib/fantasy/simulation/types";

/**
 * Player performance profiles — built from historical per-hole scoring and
 * stored per (group, player).
 *
 * Data comes from direct, indexed table queries (round_participants →
 * rounds → round_score_events + round_hole_snapshots + handicap_round_results)
 * rather than the hole_scoring_source view: the view's DISTINCT ON spans the
 * entire score-event table and its computed played_at ordering defeats every
 * index, which made first-time market generation take minutes per player.
 *
 * Sampling: the most recent SHAPE_MAX_ROUNDS finished rounds with ≥ MIN_HOLES holes
 * scored, rounds submitted to this group's events first, padded with the
 * player's other rounds when the group sample is thin. Partial (9-hole)
 * rounds are scaled to 18-hole equivalents for round-level aggregates.
 */

/**
 * Performance cap on the per-hole SHAPE sample (par-type/SI splits, birdie/eagle
 * rates, gross average). NOT an ability cap: the differential mean/variance that
 * sets the model LEVEL is recency-weighted over the player's FULL history
 * (ciaga_scoring_record_stream), uncapped.
 */
const SHAPE_MAX_ROUNDS = 20;
/** Recent finished rounds fetched before sampling (headroom over SHAPE_MAX_ROUNDS). */
const CANDIDATE_ROUNDS = 30;
const MIN_HOLES = 9;
const GROUP_SAMPLE_TARGET = 8;
const RECENT_FORM_WINDOW = 5;
/** Stored rounds powering info popups + the narrative engine. */
const RECENT_ROUNDS_STORED = 10;
/** Profiles older than this are rebuilt on the next ensureProfiles call. */
export const PROFILE_TTL_HOURS = 24;
/**
 * Bump whenever the profile computation changes (new inputs, formula tweaks).
 * ensureProfiles rebuilds any stored profile with a lower model_version, so a
 * model change takes effect immediately instead of waiting out the 24h TTL.
 *   v1: gross-average model. v2: WHS score-differential inputs.
 */
export const PROFILE_MODEL_VERSION = 2;

/** One sampled round, kept on the profile for popups/narrative. */
export type RecentRound = {
  playedAt: string;
  roundId: string;
  courseId: string | null;
  holes: number;
  /** 18-hole-equivalent gross (par-72 normalized, matches avg_gross). */
  gross18: number;
  /** Raw counts for the holes actually played. */
  birdies: number;
  eagles: number;
};

export type StoredFantasyProfile = {
  id: string;
  group_id: string;
  profile_id: string;
  handicap_index: number | null;
  avg_gross: number | null;
  avg_net: number | null;
  score_stddev: number | null;
  /** WHS score-differential distribution over full history (recency-weighted). */
  avg_differential: number | null;
  differential_stddev: number | null;
  differential_sample_size: number;
  differential_effective_n: number | null;
  recent_form: number | null;
  birdies_per_round: number | null;
  eagles_per_round: number | null;
  pars_per_round: number | null;
  bogeys_per_round: number | null;
  doubles_plus_per_round: number | null;
  recent_rounds: RecentRound[] | null;
  par3_avg_vs_par: number | null;
  par4_avg_vs_par: number | null;
  par5_avg_vs_par: number | null;
  hole_splits: HoleSplits | null;
  sample_size: number;
  confidence: "low" | "medium" | "high";
  model_version: number;
  overrides: Partial<StoredFantasyProfile> | null;
  computed_at: string;
};

type HoleRow = {
  round_id: string;
  played_at: string;
  hole_number: number;
  par: number | null;
  yardage: number | null;
  stroke_index: number | null;
  strokes: number;
  to_par: number | null;
  net_to_par: number | null;
};

type RoundSample = {
  roundId: string;
  playedAt: string;
  isGroupRound: boolean;
  holes: HoleRow[];
};

export async function buildPlayerProfile(
  groupId: string,
  profileId: string
): Promise<Omit<StoredFantasyProfile, "id" | "overrides">> {
  // My participations, then their finished rounds. Kept as two plain queries:
  // rounds ↔ round_participants embeds are ambiguous to PostgREST because
  // tables like round_hole_states reference both and get treated as
  // many-to-many junctions ("more than one relationship was found").
  const { data: partData, error: partErr } = await supabaseAdmin
    .from("round_participants")
    .select("id, round_id, tee_snapshot_id")
    .eq("profile_id", profileId);
  if (partErr) throw partErr;
  const parts = (partData ?? []) as {
    id: string;
    round_id: string;
    tee_snapshot_id: string | null;
  }[];

  // Finished rounds for those participations, chunked to keep URLs bounded.
  const playedAtByRound = new Map<string, string>();
  const courseByRound = new Map<string, string | null>();
  for (let i = 0; i < parts.length; i += 100) {
    const chunk = [...new Set(parts.slice(i, i + 100).map((p) => p.round_id))];
    const { data: roundRows, error: roundErr } = await supabaseAdmin
      .from("rounds")
      .select("id, finished_at, started_at, created_at, course_id")
      .in("id", chunk)
      .eq("status", "finished");
    if (roundErr) throw roundErr;
    for (const r of (roundRows ?? []) as {
      id: string; finished_at: string | null; started_at: string | null; created_at: string;
      course_id: string | null;
    }[]) {
      playedAtByRound.set(r.id, r.finished_at ?? r.started_at ?? r.created_at);
      courseByRound.set(r.id, r.course_id);
    }
  }

  const participations = parts
    .filter((p) => playedAtByRound.has(p.round_id))
    .map((p) => ({
      participantId: p.id,
      roundId: p.round_id,
      teeSnapshotId: p.tee_snapshot_id,
      playedAt: playedAtByRound.get(p.round_id)!,
    }))
    .sort((a, b) => (a.playedAt < b.playedAt ? 1 : -1))
    .slice(0, CANDIDATE_ROUNDS);

  const roundIds = participations.map((p) => p.roundId);
  const participantIds = participations.map((p) => p.participantId);
  const teeSnapshotIds = participations
    .map((p) => p.teeSnapshotId)
    .filter((id): id is string => !!id);
  const partByRound = new Map(participations.map((p) => [p.roundId, p]));

  const byRound = new Map<string, HoleRow[]>();

  if (roundIds.length > 0) {
    const [scoreRes, snapRes, hrrRes] = await Promise.all([
      supabaseAdmin
        .from("round_score_events")
        .select("round_id, participant_id, hole_number, strokes, created_at, id")
        .in("round_id", roundIds)
        .in("participant_id", participantIds)
        .not("strokes", "is", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      teeSnapshotIds.length > 0
        ? supabaseAdmin
            .from("round_hole_snapshots")
            .select("round_tee_snapshot_id, hole_number, par, yardage, stroke_index")
            .in("round_tee_snapshot_id", teeSnapshotIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      supabaseAdmin
        .from("handicap_round_results")
        .select("round_id, participant_id, course_handicap_used, is_9_hole")
        .in("round_id", roundIds)
        .in("participant_id", participantIds),
    ]);
    if (scoreRes.error) throw scoreRes.error;
    if (snapRes.error) throw snapRes.error;
    if (hrrRes.error) throw hrrRes.error;

    // Latest score per (round, hole) — score events are append-only and
    // fetched ascending, so the last write wins.
    const latest = new Map<string, number>();
    for (const ev of (scoreRes.data ?? []) as {
      round_id: string; hole_number: number; strokes: number;
    }[]) {
      latest.set(`${ev.round_id}|${ev.hole_number}`, ev.strokes);
    }

    // Hole setup (par / yardage / SI) per tee snapshot.
    const holeSetup = new Map<
      string,
      { par: number | null; yardage: number | null; stroke_index: number | null }
    >();
    for (const s of (snapRes.data ?? []) as {
      round_tee_snapshot_id: string; hole_number: number;
      par: number | null; yardage: number | null; stroke_index: number | null;
    }[]) {
      holeSetup.set(`${s.round_tee_snapshot_id}|${s.hole_number}`, {
        par: s.par,
        yardage: s.yardage,
        stroke_index: s.stroke_index,
      });
    }

    const hrrByRound = new Map<string, { ch: number; holes: number }>();
    for (const h of (hrrRes.data ?? []) as {
      round_id: string; course_handicap_used: number | null; is_9_hole: boolean | null;
    }[]) {
      if (h.course_handicap_used == null) continue;
      hrrByRound.set(h.round_id, {
        ch: Math.round(Number(h.course_handicap_used)),
        holes: h.is_9_hole ? 9 : 18,
      });
    }

    for (const [key, strokes] of latest) {
      const sep = key.lastIndexOf("|");
      const roundId = key.slice(0, sep);
      const holeNumber = Number(key.slice(sep + 1));
      const part = partByRound.get(roundId);
      if (!part) continue;
      const setup = part.teeSnapshotId
        ? holeSetup.get(`${part.teeSnapshotId}|${holeNumber}`)
        : undefined;
      const par = setup?.par ?? null;
      if (par == null) continue;
      const toPar = strokes - par;
      const hrr = hrrByRound.get(roundId);
      // Same net formula the leaderboard uses: course handicap allocated by
      // stroke index (ciaga_strokes_received_on_hole ≡ strokesReceived).
      const netToPar =
        hrr && setup?.stroke_index != null
          ? toPar - strokesReceived(hrr.ch, setup.stroke_index, hrr.holes)
          : null;
      const row: HoleRow = {
        round_id: roundId,
        played_at: part.playedAt,
        hole_number: holeNumber,
        par,
        yardage: setup?.yardage ?? null,
        stroke_index: setup?.stroke_index ?? null,
        strokes,
        to_par: toPar,
        net_to_par: netToPar,
      };
      const list = byRound.get(roundId);
      if (list) list.push(row);
      else byRound.set(roundId, [row]);
    }
  }

  // Rounds submitted to this group's events get priority in the sample.
  const groupRoundIds = new Set<string>();
  if (roundIds.length > 0) {
    const { data: subRows, error: subErr } = await supabaseAdmin
      .from("event_round_submissions")
      .select("round_id, events!inner(group_id)")
      .eq("profile_id", profileId)
      .in("round_id", roundIds)
      .eq("events.group_id", groupId);
    if (subErr) throw subErr;
    for (const s of (subRows ?? []) as { round_id: string }[]) groupRoundIds.add(s.round_id);
  }

  const candidates: RoundSample[] = [];
  for (const [roundId, holes] of byRound) {
    // All loaded rounds are already status = 'finished'.
    if (holes.length < MIN_HOLES) continue;
    candidates.push({
      roundId,
      playedAt: holes[0].played_at,
      isGroupRound: groupRoundIds.has(roundId),
      holes,
    });
  }
  candidates.sort((a, b) => (a.playedAt < b.playedAt ? 1 : -1));

  const groupRounds = candidates.filter((r) => r.isGroupRound).slice(0, SHAPE_MAX_ROUNDS);
  const padded = groupRounds.length < GROUP_SAMPLE_TARGET;
  const sample = padded
    ? [
        ...groupRounds,
        ...candidates.filter((r) => !r.isGroupRound).slice(0, SHAPE_MAX_ROUNDS - groupRounds.length),
      ]
    : groupRounds;
  sample.sort((a, b) => (a.playedAt < b.playedAt ? 1 : -1));

  // Current handicap index (latest history row).
  const { data: hiRow } = await supabaseAdmin
    .from("handicap_index_history")
    .select("handicap_index")
    .eq("profile_id", profileId)
    .order("as_of_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const handicapIndex =
    hiRow && (hiRow as { handicap_index: number | null }).handicap_index != null
      ? Number((hiRow as { handicap_index: number }).handicap_index)
      : null;

  // Full-history score differentials (course-normalised) from the canonical WHS
  // stream — accepted rounds only, 9-hole rounds already reduced to 18-hole
  // equivalents. Independent of the SHAPE sample above and NOT capped, so a
  // 200-round history informs the model level; recency-weighted so it still
  // tracks form. Global to the player (course-normalised → group-independent).
  // Paged explicitly: PostgREST silently truncates un-limited queries at its
  // max-rows default (1000), which would drop the OLDEST rounds unnoticed.
  const DIFF_PAGE = 1000;
  const diffRowsAll: { differential: number | string | null }[] = [];
  for (let from = 0; ; from += DIFF_PAGE) {
    const { data: diffRows, error: diffErr } = await supabaseAdmin
      .from("ciaga_scoring_record_stream")
      .select("differential, played_at")
      .eq("profile_id", profileId)
      .not("differential", "is", null)
      .order("played_at", { ascending: false })
      .range(from, from + DIFF_PAGE - 1);
    if (diffErr) throw diffErr;
    const page = (diffRows ?? []) as { differential: number | string | null }[];
    diffRowsAll.push(...page);
    if (page.length < DIFF_PAGE) break;
  }
  const differentials = diffRowsAll
    .map((r) => Number(r.differential))
    .filter((d) => Number.isFinite(d));
  const diffStats = recencyWeightedDifferentialStats(differentials);

  const sampleSize = sample.length;
  const base = {
    group_id: groupId,
    profile_id: profileId,
    handicap_index: handicapIndex,
    avg_differential: diffStats ? round2(diffStats.mean) : null,
    differential_stddev: diffStats?.stddev != null ? round2(diffStats.stddev) : null,
    differential_sample_size: diffStats?.sampleSize ?? 0,
    differential_effective_n: diffStats ? round2(diffStats.effectiveN) : null,
    model_version: PROFILE_MODEL_VERSION,
    computed_at: new Date().toISOString(),
  };

  if (sampleSize === 0) {
    return {
      ...base,
      avg_gross: null,
      avg_net: null,
      score_stddev: null,
      recent_form: null,
      birdies_per_round: null,
      eagles_per_round: null,
      pars_per_round: null,
      bogeys_per_round: null,
      doubles_plus_per_round: null,
      recent_rounds: null,
      par3_avg_vs_par: null,
      par4_avg_vs_par: null,
      par5_avg_vs_par: null,
      hole_splits: null,
      sample_size: 0,
      confidence: "low",
    };
  }

  // Round-level aggregates (scaled to 18-hole equivalents).
  const gross18: number[] = [];
  const net18: number[] = [];
  const perRound = {
    birdies: [] as number[],
    eagles: [] as number[],
    pars: [] as number[],
    bogeys: [] as number[],
    doubles: [] as number[],
  };
  const recentRounds: RecentRound[] = [];

  // Hole-level aggregates.
  const byParType: Record<number, { sum: number; n: number }> = {
    3: { sum: 0, n: 0 },
    4: { sum: 0, n: 0 },
    5: { sum: 0, n: 0 },
  };
  const splitAgg = new Map<string, { toParSum: number; birdies: number; bogeyPlus: number; n: number }>();
  let overallToParSum = 0;
  let overallHoleCount = 0;

  for (const round of sample) {
    const holes = round.holes;
    const scale = 18 / holes.length;
    let grossSum = 0;
    let netToParSum = 0;
    let netHoles = 0;
    let parSum = 0;
    let birdies = 0;
    let eagles = 0;
    let pars = 0;
    let bogeys = 0;
    let doubles = 0;

    for (const hole of holes) {
      const par = hole.par as number;
      const toPar = hole.to_par ?? hole.strokes - par;
      grossSum += hole.strokes;
      parSum += par;
      if (hole.net_to_par != null) {
        netToParSum += hole.net_to_par;
        netHoles += 1;
      }
      if (toPar <= -2) eagles += 1;
      if (toPar <= -1) birdies += 1;
      else if (toPar === 0) pars += 1;
      else if (toPar === 1) bogeys += 1;
      else doubles += 1;

      overallToParSum += toPar;
      overallHoleCount += 1;

      const parType = par <= 3 ? 3 : par === 4 ? 4 : 5;
      byParType[parType].sum += toPar;
      byParType[parType].n += 1;

      const band = lengthBand(par, hole.yardage);
      const keys = band ? [splitKey(par, band)] : [];
      if (hole.stroke_index != null && hole.stroke_index >= 1 && hole.stroke_index <= 18) {
        keys.push(siBand(hole.stroke_index));
      }
      for (const key of keys) {
        const agg = splitAgg.get(key) ?? { toParSum: 0, birdies: 0, bogeyPlus: 0, n: 0 };
        agg.toParSum += toPar;
        if (toPar <= -1) agg.birdies += 1;
        if (toPar >= 1) agg.bogeyPlus += 1;
        agg.n += 1;
        splitAgg.set(key, agg);
      }
    }

    // 18-hole-equivalent gross assuming par-72 shape for partial rounds.
    const roundGross18 = (grossSum - parSum) * scale + 72;
    gross18.push(roundGross18);
    if (netHoles >= MIN_HOLES) net18.push((netToParSum / netHoles) * 18 + 72);
    perRound.birdies.push(birdies * scale);
    perRound.eagles.push(eagles * scale);
    perRound.pars.push(pars * scale);
    perRound.bogeys.push(bogeys * scale);
    perRound.doubles.push(doubles * scale);

    // Sample is newest-first, so the first N rounds are the recent ones.
    if (recentRounds.length < RECENT_ROUNDS_STORED) {
      recentRounds.push({
        playedAt: round.playedAt,
        roundId: round.roundId,
        courseId: courseByRound.get(round.roundId) ?? null,
        holes: holes.length,
        gross18: round2(roundGross18),
        birdies,
        eagles,
      });
    }
  }

  const overallPerHole = overallHoleCount > 0 ? overallToParSum / overallHoleCount : 0;

  const holeSplits: HoleSplits = {};
  for (const [key, agg] of splitAgg) {
    const avg = agg.toParSum / agg.n;
    holeSplits[key] = {
      // SI bands store deviation from the player's overall per-hole average
      // (the model applies them as a tilt); par-type×length bands store the
      // absolute avg-vs-par for that bucket.
      avgVsPar: key.startsWith("si_") ? round3(avg - overallPerHole) : round3(avg),
      birdieRate: round3(agg.birdies / agg.n),
      bogeyPlusRate: round3(agg.bogeyPlus / agg.n),
      sample: agg.n,
    };
  }

  const recentSlice = gross18.slice(0, RECENT_FORM_WINDOW);
  const confidence: StoredFantasyProfile["confidence"] =
    !padded && sampleSize >= 10 ? "high" : sampleSize >= 5 ? "medium" : "low";

  return {
    ...base,
    avg_gross: round2(mean(gross18)),
    avg_net: net18.length > 0 ? round2(mean(net18)) : null,
    score_stddev: gross18.length >= 2 ? round2(stddev(gross18)) : null,
    recent_form:
      gross18.length > RECENT_FORM_WINDOW ? round2(mean(recentSlice) - mean(gross18)) : null,
    birdies_per_round: round2(mean(perRound.birdies)),
    eagles_per_round: round2(mean(perRound.eagles)),
    pars_per_round: round2(mean(perRound.pars)),
    bogeys_per_round: round2(mean(perRound.bogeys)),
    doubles_plus_per_round: round2(mean(perRound.doubles)),
    recent_rounds: recentRounds.length > 0 ? recentRounds : null,
    par3_avg_vs_par: byParType[3].n > 0 ? round3(byParType[3].sum / byParType[3].n) : null,
    par4_avg_vs_par: byParType[4].n > 0 ? round3(byParType[4].sum / byParType[4].n) : null,
    par5_avg_vs_par: byParType[5].n > 0 ? round3(byParType[5].sum / byParType[5].n) : null,
    hole_splits: Object.keys(holeSplits).length > 0 ? holeSplits : null,
    sample_size: sampleSize,
    confidence,
  };
}

/** Build and persist a profile; returns the stored row. */
export async function refreshPlayerProfile(
  groupId: string,
  profileId: string
): Promise<StoredFantasyProfile> {
  const computed = await buildPlayerProfile(groupId, profileId);
  const { data, error } = await supabaseAdmin
    .from("fantasy_player_profiles")
    .upsert(computed, { onConflict: "group_id,profile_id" })
    .select("*")
    .single();
  if (error) throw error;
  return data as StoredFantasyProfile;
}

/** Load stored profiles for a group's players, refreshing missing ones. */
export async function ensureProfiles(
  groupId: string,
  profileIds: string[]
): Promise<Map<string, StoredFantasyProfile>> {
  const out = new Map<string, StoredFantasyProfile>();
  if (profileIds.length === 0) return out;

  const { data, error } = await supabaseAdmin
    .from("fantasy_player_profiles")
    .select("*")
    .eq("group_id", groupId)
    .in("profile_id", profileIds);
  if (error) throw error;
  for (const row of (data ?? []) as StoredFantasyProfile[]) out.set(row.profile_id, row);

  // Build missing profiles and rebuild stale ones a few at a time — staleness
  // triggers bump the event version, but the profile INPUTS only follow when
  // rebuilt, so without a TTL form data freezes at first generation. A profile
  // built under an older model_version is also rebuilt, so a model change takes
  // effect immediately rather than waiting out the 24h TTL.
  const cutoff = Date.now() - PROFILE_TTL_HOURS * 60 * 60 * 1000;
  const missing = profileIds.filter((id) => {
    const row = out.get(id);
    return (
      !row ||
      (row.model_version ?? 0) < PROFILE_MODEL_VERSION ||
      new Date(row.computed_at).getTime() < cutoff
    );
  });
  const CONCURRENCY = 5;
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const chunk = missing.slice(i, i + CONCURRENCY);
    const built = await Promise.all(
      chunk.map((profileId) => refreshPlayerProfile(groupId, profileId))
    );
    built.forEach((row) => out.set(row.profile_id, row));
  }
  return out;
}

/** Admin overrides win over computed values; map a stored row to sim input. */
export function toSimProfile(row: StoredFantasyProfile): SimPlayerProfile {
  const merged = { ...row, ...(row.overrides ?? {}) };
  return {
    profileId: row.profile_id,
    handicapIndex: numOrNull(merged.handicap_index),
    avgGross: numOrNull(merged.avg_gross),
    scoreStddev: numOrNull(merged.score_stddev),
    avgDifferential: numOrNull(merged.avg_differential),
    differentialStddev: numOrNull(merged.differential_stddev),
    differentialEffectiveN: numOrNull(merged.differential_effective_n),
    recentForm: numOrNull(merged.recent_form),
    birdiesPerRound: numOrNull(merged.birdies_per_round),
    eaglesPerRound: numOrNull(merged.eagles_per_round),
    parsPerRound: numOrNull(merged.pars_per_round),
    bogeysPerRound: numOrNull(merged.bogeys_per_round),
    doublesPlusPerRound: numOrNull(merged.doubles_plus_per_round),
    par3AvgVsPar: numOrNull(merged.par3_avg_vs_par),
    par4AvgVsPar: numOrNull(merged.par4_avg_vs_par),
    par5AvgVsPar: numOrNull(merged.par5_avg_vs_par),
    holeSplits: merged.hole_splits ?? null,
    sampleSize: merged.sample_size ?? 0,
    confidence: merged.confidence ?? "low",
  };
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mean(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

function stddev(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
