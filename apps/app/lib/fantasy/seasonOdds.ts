import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parsePointsAmount, readFantasyConfig } from "@/lib/fantasy/config";
import { PickError } from "@/lib/fantasy/picks";
import { loadJointMatrix } from "@/lib/fantasy/jointSamples";
import { hashSeed } from "@/lib/fantasy/simulation/rng";
import { clampProbability, probabilityToDecimalOdds } from "@/lib/fantasy/simulation/types";
import {
  simulateSeason,
  type RemainingEvent,
  type SeasonSimResult,
} from "@/lib/fantasy/simulation/seasonEngine";
import type { EventPointsConfig } from "@/lib/fantasy/simulation/seasonPoints";
import { generateSeasonNarrative } from "@/lib/fantasy/seasonNarrative";

/**
 * Season odds service. Season markets (winner / top-3 in the standings) are
 * priced by simulating the REMAINING events onto the current standings (reusing
 * each event's joint positions matrix). Lightweight refresh: no debounce-job
 * machinery — season reprices only on constituent-event completion, so an
 * inline compute guarded by `odds_stale` suffices.
 */

const SEASON_SIM_ITERATIONS = 10_000;
export const SEASON_TOP_N = 3;

export type SeasonMarketRow = {
  id: string;
  group_id: string;
  group_season_id: string;
  market_type: "season_outright" | "season_top_n";
  params: Record<string, unknown>;
  status: string;
};

export type SeasonState = {
  group_season_id: string;
  group_id: string;
  version: number;
  odds_stale: boolean;
  is_final: boolean;
  narrative: string | null;
  last_refreshed_at: string | null;
};

export type SeasonContext = {
  groupSeasonId: string;
  groupId: string;
  seasonName: string;
  currentPoints: Record<string, number>;
  standingsPosition: Record<string, number>;
  playerIds: string[];
  names: Record<string, string>;
  remaining: RemainingEvent[];
};

async function readSeasonState(groupSeasonId: string): Promise<SeasonState | null> {
  const { data } = await supabaseAdmin
    .from("fantasy_season_state")
    .select("*")
    .eq("group_season_id", groupSeasonId)
    .maybeSingle();
  return (data as SeasonState | null) ?? null;
}

async function loadSeasonMarkets(groupSeasonId: string): Promise<SeasonMarketRow[]> {
  const { data, error } = await supabaseAdmin
    .from("fantasy_season_markets")
    .select("*")
    .eq("group_season_id", groupSeasonId);
  if (error) throw error;
  return (data ?? []) as SeasonMarketRow[];
}

/** Assemble the season sim inputs: current standings + remaining-event matrices. */
export async function loadSeasonContext(groupSeasonId: string): Promise<SeasonContext | null> {
  const { data: seasonRow } = await supabaseAdmin
    .from("group_seasons")
    .select("id, group_id, name")
    .eq("id", groupSeasonId)
    .maybeSingle();
  if (!seasonRow) return null;
  const season = seasonRow as { id: string; group_id: string; name: string };

  const { data: standRows } = await supabaseAdmin
    .from("group_season_standings_entries")
    .select("profile_id, season_points, position")
    .eq("group_season_id", groupSeasonId);
  const currentPoints: Record<string, number> = {};
  const standingsPosition: Record<string, number> = {};
  const playerSet = new Set<string>();
  for (const s of (standRows ?? []) as {
    profile_id: string; season_points: number | string | null; position: number | null;
  }[]) {
    currentPoints[s.profile_id] = Number(s.season_points ?? 0);
    if (s.position != null) standingsPosition[s.profile_id] = s.position;
    playerSet.add(s.profile_id);
  }

  const { data: evRows } = await supabaseAdmin
    .from("events")
    .select("id, points_model, points_table, points_config, num_rounds")
    .eq("group_season_id", groupSeasonId)
    .in("standings_contribution", ["season", "both"])
    .not("majors_status", "in", '("completed","official","cancelled")');
  const remaining: RemainingEvent[] = [];
  for (const ev of (evRows ?? []) as {
    id: string; points_model: string | null; points_table: unknown; points_config: unknown; num_rounds: number | null;
  }[]) {
    const matrix = await loadJointMatrix(ev.id);
    if (!matrix) continue; // unpriced event → contribution unknown, skip it
    for (const pid of matrix.playerIds) playerSet.add(pid);
    const cfg = (ev.points_config ?? {}) as { num_participants?: number | string };
    const fieldSize = cfg.num_participants != null ? Number(cfg.num_participants) : matrix.playerIds.length;
    const points: EventPointsConfig = {
      pointsModel: ev.points_model ?? "none",
      pointsTable: (ev.points_table ?? null) as Record<string, number | string> | null,
      pointsConfig: (ev.points_config ?? null) as Record<string, number | string> | null,
      numRounds: ev.num_rounds ?? 1,
      fieldSize,
    };
    remaining.push({ matrix, points });
  }

  const playerIds = [...playerSet];
  const names: Record<string, string> = {};
  if (playerIds.length > 0) {
    const { data: profs } = await supabaseAdmin.from("profiles").select("id, name").in("id", playerIds);
    for (const p of (profs ?? []) as { id: string; name: string | null }[]) {
      names[p.id] = p.name ?? "Player";
    }
  }

  return {
    groupSeasonId,
    groupId: season.group_id,
    seasonName: season.name,
    currentPoints,
    standingsPosition,
    playerIds,
    names,
    remaining,
  };
}

function runSeasonSim(ctx: SeasonContext, version: number): SeasonSimResult {
  return simulateSeason({
    currentPoints: ctx.currentPoints,
    playerIds: ctx.playerIds,
    remaining: ctx.remaining,
    iterations: SEASON_SIM_ITERATIONS,
    seed: hashSeed(ctx.groupSeasonId, version),
  });
}

async function ensureSeasonMarkets(ctx: SeasonContext): Promise<void> {
  const specs: { market_type: SeasonMarketRow["market_type"]; params: Record<string, unknown> }[] = [
    { market_type: "season_outright", params: {} },
    { market_type: "season_top_n", params: { n: SEASON_TOP_N } },
  ];
  const { data: existing } = await supabaseAdmin
    .from("fantasy_season_markets")
    .select("market_type, params")
    .eq("group_season_id", ctx.groupSeasonId);
  const key = (m: { market_type: string; params: unknown }) => `${m.market_type}|${JSON.stringify(m.params ?? {})}`;
  const have = new Set(((existing ?? []) as { market_type: string; params: unknown }[]).map(key));
  const missing = specs
    .filter((s) => !have.has(key(s)))
    .map((s) => ({
      group_id: ctx.groupId,
      group_season_id: ctx.groupSeasonId,
      market_type: s.market_type,
      params: s.params,
      status: "open",
    }));
  if (missing.length > 0) {
    const { error } = await supabaseAdmin.from("fantasy_season_markets").insert(missing);
    if (error && error.code !== "23505") throw error;
  }
}

async function writeSeasonSnapshots(
  ctx: SeasonContext,
  sim: SeasonSimResult,
  markets: SeasonMarketRow[],
  version: number
): Promise<void> {
  const byPlayer = new Map(sim.players.map((p) => [p.profileId, p]));
  const rows: Record<string, unknown>[] = [];
  for (const market of markets) {
    if (market.status !== "open") continue;
    for (const player of ctx.playerIds) {
      const pr = byPlayer.get(player);
      const prob = market.market_type === "season_outright" ? pr?.winProb ?? 0 : pr?.top3Prob ?? 0;
      if (prob <= 0) continue; // don't list a mathematically-eliminated player
      rows.push({
        season_market_id: market.id,
        group_season_id: ctx.groupSeasonId,
        group_id: ctx.groupId,
        selection_key: player,
        season_version: version,
        probability: clampProbability(prob),
        decimal_odds: probabilityToDecimalOdds(prob),
        simulation_count: sim.iterations,
        status: "active",
      });
    }
  }
  if (rows.length > 0) {
    const { error } = await supabaseAdmin
      .from("fantasy_season_odds_snapshots")
      .upsert(rows, { onConflict: "season_market_id,selection_key,season_version" });
    if (error) throw error;
  }
  await supabaseAdmin
    .from("fantasy_season_odds_snapshots")
    .update({ status: "superseded" })
    .eq("group_season_id", ctx.groupSeasonId)
    .lt("season_version", version)
    .eq("status", "active");
}

/** Generate (or re-price) season markets. Idempotent. Season-budget groups only. */
export async function generateSeasonFantasy(groupSeasonId: string): Promise<{ markets: number }> {
  const ctx = await loadSeasonContext(groupSeasonId);
  if (!ctx) throw new Error("Season has no standings model");

  const { data: g, error: gErr } = await supabaseAdmin
    .from("major_groups")
    .select("fantasy_config")
    .eq("id", ctx.groupId)
    .single();
  if (gErr) throw gErr;
  const config = readFantasyConfig((g as { fantasy_config: unknown }).fantasy_config);
  if (!config) throw new Error("Fantasy picks are not enabled for this group");
  if (config.budgetScope !== "season") {
    throw new Error("Season markets need a season-budget group");
  }

  const { error: stateErr } = await supabaseAdmin
    .from("fantasy_season_state")
    .insert({ group_season_id: groupSeasonId, group_id: ctx.groupId, changed_reason: "generated" });
  if (stateErr && stateErr.code !== "23505") throw stateErr;

  const state = await readSeasonState(groupSeasonId);
  const version = state?.version ?? 1;

  await ensureSeasonMarkets(ctx);
  const markets = await loadSeasonMarkets(groupSeasonId);
  const sim = runSeasonSim(ctx, version);
  await writeSeasonSnapshots(ctx, sim, markets, version);

  // Best-effort title-race story; a narration failure never fails the reprice.
  const narrative = await generateSeasonNarrative(ctx, sim, version).catch(() => null);

  await supabaseAdmin
    .from("fantasy_season_state")
    .update({
      odds_stale: false,
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(narrative ? { narrative } : {}),
    })
    .eq("group_season_id", groupSeasonId)
    .eq("version", version);

  return { markets: markets.length };
}

/** Place a season pick — the RPC enforces balance + anti-snipe atomically. */
export async function placeSeasonPick(params: {
  profileId: string;
  seasonMarketId: string;
  selectionKey: string;
  snapshotId: string;
  stake: unknown;
}): Promise<{ pickId: string }> {
  const stake = parsePointsAmount(params.stake);
  if (stake === null) throw new PickError("Stake must be a whole number of points (min 1)");
  const { data: pickId, error } = await supabaseAdmin.rpc("ciaga_fantasy_place_season_pick", {
    p_profile_id: params.profileId,
    p_season_market_id: params.seasonMarketId,
    p_selection_key: params.selectionKey,
    p_stake: stake,
    p_snapshot_id: params.snapshotId,
  });
  if (error) throw new PickError(error.message.replace(/^.*?: /, ""), 400);
  return { pickId: pickId as string };
}

/** Re-price if stale (inline; no debounce). Returns whether fresh odds exist. */
export async function refreshSeasonIfStale(groupSeasonId: string): Promise<{ refreshed: boolean }> {
  const state = await readSeasonState(groupSeasonId);
  if (!state || state.is_final || !state.odds_stale) return { refreshed: false };

  const ctx = await loadSeasonContext(groupSeasonId);
  if (!ctx) return { refreshed: false };
  const version = state.version;
  await ensureSeasonMarkets(ctx);
  const markets = await loadSeasonMarkets(groupSeasonId);
  const sim = runSeasonSim(ctx, version);
  await writeSeasonSnapshots(ctx, sim, markets, version);
  const narrative = await generateSeasonNarrative(ctx, sim, version).catch(() => null);
  await supabaseAdmin
    .from("fantasy_season_state")
    .update({
      odds_stale: false,
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(narrative ? { narrative } : {}),
    })
    .eq("group_season_id", groupSeasonId)
    .eq("version", version);
  return { refreshed: true };
}
