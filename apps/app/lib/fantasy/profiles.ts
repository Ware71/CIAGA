import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { lengthBand, siBand, splitKey } from "@/lib/fantasy/simulation/holeModel";
import type { HoleSplits, SimPlayerProfile } from "@/lib/fantasy/simulation/types";

/**
 * Player performance profiles — built from historical per-hole scoring
 * (the hole_scoring_source view: latest score event per hole, joined to
 * hole snapshots for par/yardage/stroke index) and stored per (group, player).
 *
 * Sampling: the most recent MAX_ROUNDS finished rounds with ≥ MIN_HOLES holes
 * scored, rounds submitted to this group's events first, padded with the
 * player's other rounds when the group sample is thin. Partial (9-hole)
 * rounds are scaled to 18-hole equivalents for round-level aggregates.
 */

const MAX_ROUNDS = 20;
const MIN_HOLES = 9;
const GROUP_SAMPLE_TARGET = 8;
const RECENT_FORM_WINDOW = 5;

export type StoredFantasyProfile = {
  id: string;
  group_id: string;
  profile_id: string;
  handicap_index: number | null;
  avg_gross: number | null;
  avg_net: number | null;
  score_stddev: number | null;
  recent_form: number | null;
  birdies_per_round: number | null;
  pars_per_round: number | null;
  bogeys_per_round: number | null;
  doubles_plus_per_round: number | null;
  par3_avg_vs_par: number | null;
  par4_avg_vs_par: number | null;
  par5_avg_vs_par: number | null;
  hole_splits: HoleSplits | null;
  sample_size: number;
  confidence: "low" | "medium" | "high";
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
  // Recent per-hole history (newest first; ~40 rounds of headroom).
  const { data: holeData, error: holeErr } = await supabaseAdmin
    .from("hole_scoring_source")
    .select("round_id, played_at, hole_number, par, yardage, stroke_index, strokes, to_par, net_to_par")
    .eq("profile_id", profileId)
    .order("played_at", { ascending: false })
    .limit(800);
  if (holeErr) throw holeErr;

  const rows = (holeData ?? []) as HoleRow[];
  const byRound = new Map<string, HoleRow[]>();
  for (const row of rows) {
    if (row.par == null || row.strokes == null) continue;
    const list = byRound.get(row.round_id);
    if (list) list.push(row);
    else byRound.set(row.round_id, [row]);
  }

  const roundIds = [...byRound.keys()];

  // Only finished rounds count toward the profile.
  const finishedIds = new Set<string>();
  if (roundIds.length > 0) {
    const { data: roundRows, error: roundErr } = await supabaseAdmin
      .from("rounds")
      .select("id")
      .in("id", roundIds)
      .eq("status", "finished");
    if (roundErr) throw roundErr;
    for (const r of (roundRows ?? []) as { id: string }[]) finishedIds.add(r.id);
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
    if (!finishedIds.has(roundId)) continue;
    if (holes.length < MIN_HOLES) continue;
    candidates.push({
      roundId,
      playedAt: holes[0].played_at,
      isGroupRound: groupRoundIds.has(roundId),
      holes,
    });
  }
  candidates.sort((a, b) => (a.playedAt < b.playedAt ? 1 : -1));

  const groupRounds = candidates.filter((r) => r.isGroupRound).slice(0, MAX_ROUNDS);
  const padded = groupRounds.length < GROUP_SAMPLE_TARGET;
  const sample = padded
    ? [
        ...groupRounds,
        ...candidates.filter((r) => !r.isGroupRound).slice(0, MAX_ROUNDS - groupRounds.length),
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

  const sampleSize = sample.length;
  const base = {
    group_id: groupId,
    profile_id: profileId,
    handicap_index: handicapIndex,
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
      pars_per_round: null,
      bogeys_per_round: null,
      doubles_plus_per_round: null,
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
  const perRound = { birdies: [] as number[], pars: [] as number[], bogeys: [] as number[], doubles: [] as number[] };

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
    gross18.push((grossSum - parSum) * scale + 72);
    if (netHoles >= MIN_HOLES) net18.push((netToParSum / netHoles) * 18 + 72);
    perRound.birdies.push(birdies * scale);
    perRound.pars.push(pars * scale);
    perRound.bogeys.push(bogeys * scale);
    perRound.doubles.push(doubles * scale);
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
    pars_per_round: round2(mean(perRound.pars)),
    bogeys_per_round: round2(mean(perRound.bogeys)),
    doubles_plus_per_round: round2(mean(perRound.doubles)),
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

  for (const profileId of profileIds) {
    if (!out.has(profileId)) {
      out.set(profileId, await refreshPlayerProfile(groupId, profileId));
    }
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
    recentForm: numOrNull(merged.recent_form),
    birdiesPerRound: numOrNull(merged.birdies_per_round),
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
