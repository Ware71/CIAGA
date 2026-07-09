import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { parsePointsAmount, readFantasyConfig } from "@/lib/fantasy/config";
import { getMarketDefinition } from "@/lib/fantasy/markets/registry";
import type { FantasyMarket } from "@/lib/fantasy/markets/types";
import { loadPlacementContext } from "@/lib/fantasy/odds";
import { PickError } from "@/lib/fantasy/picks";
import {
  ensureBudgetGrant,
  getGroupFantasyContext,
  resolveWalletScope,
} from "@/lib/fantasy/wallet";
import { COMBO_BET } from "@/lib/fantasy/terminology";
import {
  findCorrelation,
  MAX_LEGS,
  MIN_LEGS,
  subjectKeysFor,
} from "@/lib/fantasy/parlayRules";

/**
 * Accumulator (internal: parlay) orchestration. Game rules run here via the
 * registry (+ shared parlayRules); money invariants (balance, per-leg
 * anti-sniping, correlation guard, atomicity) live in
 * ciaga_fantasy_place_parlay.
 */

export type ParlayLegInput = {
  marketId: string;
  selectionKey: string;
  snapshotId: string;
};

export async function placeParlay(params: {
  profileId: string;
  legs: ParlayLegInput[];
  stake: unknown;
}): Promise<{ parlayId: string }> {
  const stake = parsePointsAmount(params.stake);
  if (stake === null) throw new PickError("Stake must be a whole number of points (min 1)");
  if (params.legs.length < MIN_LEGS || params.legs.length > MAX_LEGS) {
    throw new PickError(`An ${COMBO_BET.short} needs between ${MIN_LEGS} and ${MAX_LEGS} legs`);
  }

  const marketIds = [...new Set(params.legs.map((l) => l.marketId))];
  if (marketIds.length !== params.legs.length) {
    throw new PickError("Duplicate legs on the same market are not allowed");
  }
  const { data: marketData, error: marketErr } = await supabaseAdmin
    .from("fantasy_markets")
    .select("*")
    .in("id", marketIds);
  if (marketErr) throw marketErr;
  const markets = new Map(((marketData ?? []) as FantasyMarket[]).map((m) => [m.id, m]));
  if (markets.size !== marketIds.length) throw new PickError("Market not found", 404);

  const groupIds = new Set([...markets.values()].map((m) => m.group_id));
  if (groupIds.size !== 1) {
    throw new PickError(`All ${COMBO_BET.short} legs must come from the same group`);
  }
  const groupId = [...groupIds][0];

  const ctx = await getGroupFantasyContext(groupId);
  const config = ctx ? readFantasyConfig(ctx.fantasyConfig) : null;
  if (!config) throw new PickError("Fantasy picks are not enabled for this group");

  // Per-event placement eligibility via the registry (one context per event).
  const eventIds = [...new Set([...markets.values()].map((m) => m.event_id))];
  if (config.budgetScope === "event" && eventIds.length > 1) {
    throw new PickError(
      `This group budgets per event — ${COMBO_BET.short} legs must all be from one event`
    );
  }
  const liveByEvent = new Map<string, Awaited<ReturnType<typeof loadPlacementContext>>["live"]>();
  for (const eventId of eventIds) {
    const placement = await loadPlacementContext(eventId);
    liveByEvent.set(eventId, placement.live);
  }

  const rpcLegs = params.legs.map((leg) => {
    const market = markets.get(leg.marketId)!;
    const def = getMarketDefinition(market.market_type);
    if (!def) throw new PickError("Unknown market type");
    if (market.status !== "open") throw new PickError("A market in this acca is no longer open");
    const live = liveByEvent.get(market.event_id)!;
    if (!def.placementAllowed(market, leg.selectionKey, live)) {
      throw new PickError("A selection in this acca can no longer be backed");
    }
    return {
      market_id: leg.marketId,
      selection_key: leg.selectionKey,
      snapshot_id: leg.snapshotId,
      subject_keys: subjectKeysFor(market, leg.selectionKey),
    };
  });

  const correlated = findCorrelation(
    rpcLegs.map((l) => ({
      eventId: markets.get(l.market_id)!.event_id,
      subjectKeys: l.subject_keys,
    }))
  );
  if (correlated) {
    throw new PickError(
      `Correlated legs — only one pick per player per event in an ${COMBO_BET.short}`
    );
  }

  const scope = await resolveWalletScope(groupId, config, eventIds[0]);
  await ensureBudgetGrant(groupId, params.profileId, config, scope);

  const { data: parlayId, error: rpcErr } = await supabaseAdmin.rpc("ciaga_fantasy_place_parlay", {
    p_profile_id: params.profileId,
    p_group_id: groupId,
    p_stake: stake,
    p_legs: rpcLegs,
    p_group_season_id: scope.kind === "season" ? scope.groupSeasonId : null,
    p_scope_event: scope.kind === "event",
  });
  if (rpcErr) {
    throw new PickError(rpcErr.message.replace(/^.*?: /, ""), 400);
  }

  return { parlayId: parlayId as string };
}

export type MyParlayLeg = {
  id: string;
  market_id: string;
  event_id: string;
  selection_key: string;
  decimal_odds: number;
  status: "open" | "won" | "lost" | "void";
  market_label: string;
  selection_label: string;
  event_name: string;
};

export type MyParlay = {
  id: string;
  group_id: string;
  stake: number;
  combined_decimal_odds: number;
  potential_return: number;
  status: "open" | "won" | "lost" | "void";
  placed_at: string;
  settled_at: string | null;
  group_name: string;
  legs: MyParlayLeg[];
};

export async function getMyParlays(profileId: string): Promise<MyParlay[]> {
  const { data, error } = await supabaseAdmin
    .from("fantasy_parlays")
    .select(
      "*, group:major_groups(id, name), legs:fantasy_parlay_legs(*, market:fantasy_markets(*), event:events(id, name))"
    )
    .eq("profile_id", profileId)
    .order("placed_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  const rows = (data ?? []) as any[];

  const nameIds = new Set<string>();
  for (const row of rows) {
    for (const leg of row.legs ?? []) {
      const m = leg.market as FantasyMarket | null;
      if (m?.subject_profile_id) nameIds.add(m.subject_profile_id);
      if (m?.opponent_profile_id) nameIds.add(m.opponent_profile_id);
      if (/^[0-9a-f-]{36}$/i.test(leg.selection_key)) nameIds.add(leg.selection_key);
    }
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

  return rows.map((row) => ({
    id: row.id,
    group_id: row.group_id,
    stake: Number(row.stake),
    combined_decimal_odds: Number(row.combined_decimal_odds),
    potential_return: Number(row.potential_return),
    status: row.status,
    placed_at: row.placed_at,
    settled_at: row.settled_at,
    group_name: row.group?.name ?? "",
    legs: ((row.legs ?? []) as any[]).map((leg) => {
      const market = leg.market as FantasyMarket;
      const def = market ? getMarketDefinition(market.market_type) : null;
      return {
        id: leg.id,
        market_id: leg.market_id,
        event_id: leg.event_id,
        selection_key: leg.selection_key,
        decimal_odds: Number(leg.decimal_odds),
        status: leg.status,
        market_label: def && market ? def.displayName(market, names) : market?.market_type ?? "",
        selection_label:
          def && market ? def.selectionLabel(market, leg.selection_key, names) : leg.selection_key,
        event_name: leg.event?.name ?? "Event",
      };
    }),
  }));
}
