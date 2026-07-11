import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parsePointsAmount, readFantasyConfig } from "@/lib/fantasy/config";
import { getMarketDefinition } from "@/lib/fantasy/markets/registry";
import type { FantasyMarket } from "@/lib/fantasy/markets/types";
import { loadPlacementContext } from "@/lib/fantasy/odds";
import { findSelfRestriction } from "@/lib/fantasy/selfRestriction";
import {
  ensureBudgetGrant,
  getGroupFantasyContext,
  resolveWalletScope,
} from "@/lib/fantasy/wallet";

/**
 * Pick placement orchestration. Game rules (placement eligibility per market)
 * run here in TypeScript via the registry; the money invariants (balance,
 * stale-odds rejection, atomicity) are enforced inside ciaga_fantasy_place_pick.
 */

export class PickError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function placePick(params: {
  profileId: string;
  marketId: string;
  selectionKey: string;
  snapshotId: string;
  stake: unknown;
}): Promise<{ pickId: string }> {
  const stake = parsePointsAmount(params.stake);
  if (stake === null) throw new PickError("Stake must be a whole number of points (min 1)");

  const { data: marketRow, error: marketErr } = await supabaseAdmin
    .from("fantasy_markets")
    .select("*")
    .eq("id", params.marketId)
    .maybeSingle();
  if (marketErr) throw marketErr;
  const market = marketRow as FantasyMarket | null;
  if (!market) throw new PickError("Market not found", 404);
  if (market.status !== "open") throw new PickError("Market is not open");

  const def = getMarketDefinition(market.market_type);
  if (!def) throw new PickError("Unknown market type");

  const ctx = await getGroupFantasyContext(market.group_id);
  const config = ctx ? readFantasyConfig(ctx.fantasyConfig) : null;
  if (!config) throw new PickError("Fantasy picks are not enabled for this group");

  const { live } = await loadPlacementContext(market.event_id);
  if (!def.placementAllowed(market, params.selectionKey, live)) {
    throw new PickError("This selection can no longer be backed");
  }

  const selfBlocked = findSelfRestriction(params.profileId, market, params.selectionKey);
  if (selfBlocked) throw new PickError(selfBlocked);

  const scope = await resolveWalletScope(market.group_id, config, market.event_id);
  await ensureBudgetGrant(market.group_id, params.profileId, config, scope);

  const { data: pickId, error: rpcErr } = await supabaseAdmin.rpc("ciaga_fantasy_place_pick", {
    p_profile_id: params.profileId,
    p_market_id: params.marketId,
    p_selection_key: params.selectionKey,
    p_stake: stake,
    p_snapshot_id: params.snapshotId,
    p_group_season_id: scope.kind === "season" ? scope.groupSeasonId : null,
    p_scope_event: scope.kind === "event",
  });
  if (rpcErr) {
    // Business-rule rejections from the RPC read cleanly as 400s.
    throw new PickError(rpcErr.message.replace(/^.*?: /, ""), 400);
  }

  return { pickId: pickId as string };
}

export type MyPick = {
  id: string;
  market_id: string;
  event_id: string;
  group_id: string;
  selection_key: string;
  stake: number;
  decimal_odds: number;
  potential_return: number;
  status: "open" | "cashed_out" | "won" | "lost" | "void";
  cashout_value: number | null;
  placed_at: string;
  settled_at: string | null;
  market_label: string;
  selection_label: string;
  event_name: string;
  event_status: string;
  group_name: string;
};

export async function getMyPicks(profileId: string): Promise<MyPick[]> {
  const { data, error } = await supabaseAdmin
    .from("fantasy_picks")
    .select(
      "*, market:fantasy_markets(*), event:events(id, name, majors_status), group:major_groups(id, name)"
    )
    .eq("profile_id", profileId)
    .order("placed_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = (data ?? []) as any[];

  const nameIds = new Set<string>();
  for (const row of rows) {
    const m = row.market as FantasyMarket | null;
    if (m?.subject_profile_id) nameIds.add(m.subject_profile_id);
    if (m?.opponent_profile_id) nameIds.add(m.opponent_profile_id);
    if (/^[0-9a-f-]{36}$/i.test(row.selection_key)) nameIds.add(row.selection_key);
  }
  const names: Record<string, string> = {};
  if (nameIds.size > 0) {
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, name")
      .in("id", [...nameIds]);
    for (const p of (profs ?? []) as { id: string; name: string | null }[]) {
      names[p.id] = p.name ?? "Player";
    }
  }

  return rows.map((row) => {
    const market = row.market as FantasyMarket;
    const def = getMarketDefinition(market.market_type);
    return {
      id: row.id,
      market_id: row.market_id,
      event_id: row.event_id,
      group_id: row.group_id,
      selection_key: row.selection_key,
      stake: Number(row.stake),
      decimal_odds: Number(row.decimal_odds),
      potential_return: Number(row.potential_return),
      status: row.status,
      cashout_value: row.cashout_value != null ? Number(row.cashout_value) : null,
      placed_at: row.placed_at,
      settled_at: row.settled_at,
      market_label: def ? def.displayName(market, names) : market.market_type,
      selection_label: def ? def.selectionLabel(market, row.selection_key, names) : row.selection_key,
      event_name: row.event?.name ?? "Event",
      event_status: row.event?.majors_status ?? "unknown",
      group_name: row.group?.name ?? "",
    };
  });
}
