import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getMarketDefinition } from "@/lib/fantasy/markets/registry";
import type {
  FantasyMarket,
  FinalPlayerScore,
  FinalScoringData,
  SettlementOutcome,
} from "@/lib/fantasy/markets/types";
import { loadPlacementContext } from "@/lib/fantasy/odds";
import { createNotification } from "@/lib/notifications/notify";

/**
 * Event settlement — registry-driven, idempotent, best-effort at every entry
 * point (reconcileEventStatus hook, daily cron safety net, admin route).
 *
 * Outcomes are computed here from final scoring data; the atomic application
 * (pick transitions + payout/refund ledger rows + is_final) happens in the
 * ciaga_fantasy_apply_settlement RPC, which only touches 'open' picks so
 * re-runs are no-ops.
 */

const WITHDRAWN_STATUSES = ["withdrawn", "no_show", "rejected"];

export type SettleResult =
  | { settled: true; won: number; lost: number; void: number }
  | { settled: false; reason: string };

async function loadFinalScoringData(eventId: string): Promise<FinalScoringData> {
  const [{ data: entryData, error: entryErr }, { data: lbData, error: lbErr }, placement] =
    await Promise.all([
      supabaseAdmin
        .from("event_entries")
        .select("profile_id, entry_status")
        .eq("event_id", eventId),
      supabaseAdmin
        .from("event_leaderboard_entries")
        .select("profile_id, position, gross_score, net_score")
        .eq("event_id", eventId),
      loadPlacementContext(eventId),
    ]);
  if (entryErr) throw entryErr;
  if (lbErr) throw lbErr;

  const parByHole = new Map<number, number>(placement.holes.map((h) => [h.holeNumber, h.par]));
  const birdieCount = (profileId: string): number | null => {
    const completed = placement.liveData.completedByProfile.get(profileId);
    if (!completed || Object.keys(completed).length === 0) return null;
    let birdies = 0;
    for (const [holeNumber, strokes] of Object.entries(completed)) {
      const par = parByHole.get(Number(holeNumber));
      if (par != null && strokes <= par - 1) birdies += 1;
    }
    return birdies;
  };

  const players: Record<string, FinalPlayerScore> = {};
  for (const e of (entryData ?? []) as { profile_id: string; entry_status: string }[]) {
    players[e.profile_id] = {
      profileId: e.profile_id,
      position: null,
      grossScore: null,
      netScore: null,
      birdieCount: birdieCount(e.profile_id),
      withdrawn: WITHDRAWN_STATUSES.includes(e.entry_status),
    };
  }
  for (const lb of (lbData ?? []) as {
    profile_id: string; position: number | null; gross_score: number | null; net_score: number | null;
  }[]) {
    const player = players[lb.profile_id] ?? {
      profileId: lb.profile_id,
      position: null,
      grossScore: null,
      netScore: null,
      birdieCount: birdieCount(lb.profile_id),
      withdrawn: false,
    };
    player.position = lb.position;
    player.grossScore = lb.gross_score;
    player.netScore = lb.net_score;
    players[lb.profile_id] = player;
  }

  return { players, fieldSize: Object.keys(players).length };
}

export async function settleFantasyEvent(
  eventId: string,
  opts: { force?: boolean } = {}
): Promise<SettleResult> {
  const { data: stateRow } = await supabaseAdmin
    .from("fantasy_event_state")
    .select("event_id, is_final")
    .eq("event_id", eventId)
    .maybeSingle();
  if (!stateRow) return { settled: false, reason: "fantasy not active for this event" };
  if ((stateRow as { is_final: boolean }).is_final) {
    return { settled: false, reason: "already settled" };
  }

  const { data: eventRow, error: eventErr } = await supabaseAdmin
    .from("events")
    .select("id, name, majors_status")
    .eq("id", eventId)
    .single();
  if (eventErr) throw eventErr;
  const event = eventRow as { id: string; name: string; majors_status: string };
  if (event.majors_status !== "completed" && !opts.force) {
    return { settled: false, reason: `event is ${event.majors_status}, not completed` };
  }

  const [{ data: marketData, error: marketErr }, { data: pickData, error: pickErr }] =
    await Promise.all([
      supabaseAdmin.from("fantasy_markets").select("*").eq("event_id", eventId),
      supabaseAdmin.from("fantasy_picks").select("*").eq("event_id", eventId).eq("status", "open"),
    ]);
  if (marketErr) throw marketErr;
  if (pickErr) throw pickErr;

  const markets = (marketData ?? []) as FantasyMarket[];
  const picks = (pickData ?? []) as {
    id: string; market_id: string; profile_id: string; selection_key: string;
    stake: number; potential_return: number;
  }[];

  const final = await loadFinalScoringData(eventId);

  // Per-market settlement maps from the registry.
  const outcomesByMarket = new Map<string, Map<string, SettlementOutcome>>();
  for (const market of markets) {
    const def = getMarketDefinition(market.market_type);
    if (!def) continue;
    try {
      outcomesByMarket.set(market.id, def.settle(final, market));
    } catch {
      outcomesByMarket.set(market.id, new Map());
    }
  }

  const pickOutcomes = picks.map((pick) => ({
    pick_id: pick.id,
    // A selection the settler can't resolve (e.g. player missing from final
    // data) voids rather than loses — spec: void invalid picks.
    outcome: outcomesByMarket.get(pick.market_id)?.get(pick.selection_key) ?? "void",
  }));

  const { data: counts, error: applyErr } = await supabaseAdmin.rpc(
    "ciaga_fantasy_apply_settlement",
    {
      p_event_id: eventId,
      p_outcomes: pickOutcomes,
      p_market_ids: markets.map((m) => m.id),
    }
  );
  if (applyErr) throw applyErr;

  // Notify each bettor per pick (aggregated per event by group_key).
  const settledPicks = await getSettledPickLabels(eventId, picks.map((p) => p.id));
  await Promise.allSettled(
    settledPicks.map((p) =>
      createNotification({
        recipientProfileId: p.profile_id,
        type: `fantasy_pick_${p.status}`,
        payload: {
          event_id: eventId,
          event_name: event.name,
          market_label: p.label,
          stake: p.stake,
          payout: p.status === "won" ? p.potential_return : undefined,
        },
      })
    )
  );

  const c = (counts ?? {}) as { won?: number; lost?: number; void?: number };
  return { settled: true, won: c.won ?? 0, lost: c.lost ?? 0, void: c.void ?? 0 };
}

async function getSettledPickLabels(
  eventId: string,
  pickIds: string[]
): Promise<
  { profile_id: string; status: "won" | "lost" | "void"; label: string; stake: number; potential_return: number }[]
> {
  if (pickIds.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("fantasy_picks")
    .select("id, profile_id, status, stake, potential_return, selection_key, market:fantasy_markets(*)")
    .eq("event_id", eventId)
    .in("id", pickIds)
    .in("status", ["won", "lost", "void"]);
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
    const label = def
      ? `${def.selectionLabel(market, row.selection_key, names)} — ${def.displayName(market, names)}`
      : market.market_type;
    return {
      profile_id: row.profile_id,
      status: row.status,
      label,
      stake: Number(row.stake),
      potential_return: Number(row.potential_return),
    };
  });
}
