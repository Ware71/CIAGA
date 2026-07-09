import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getMarketDefinition } from "@/lib/fantasy/markets/registry";
import type {
  FantasyMarket,
  FinalPlayerScore,
  FinalScoringData,
  SettlementOutcome,
} from "@/lib/fantasy/markets/types";
import { marketRound } from "@/lib/fantasy/markets/roundUtil";
import {
  loadPlacementContext,
  resolvePlayingHandicapDetails,
  type EntryRow,
} from "@/lib/fantasy/odds";
import { holeKey } from "@/lib/fantasy/simulation/types";
import { createNotification } from "@/lib/notifications/notify";

/**
 * Event settlement — registry-driven, idempotent, best-effort at every entry
 * point (reconcileEventStatus hook, daily cron safety net, admin route).
 *
 * Outcomes are computed here from final scoring data; the atomic application
 * (pick transitions + payout/refund ledger rows + is_final) happens in the
 * ciaga_fantasy_apply_settlement RPC, which only touches 'open' picks so
 * re-runs are no-ops. Round-scoped markets of multi-round events settle early
 * via settleFantasyRoundMarkets (p_final=false keeps the event live).
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
        .select(
          "profile_id, entry_status, assigned_handicap_index, assigned_course_handicap, assigned_playing_handicap"
        )
        .eq("event_id", eventId),
      supabaseAdmin
        .from("event_leaderboard_entries")
        .select("profile_id, position, gross_score, net_score")
        .eq("event_id", eventId),
      loadPlacementContext(eventId),
    ]);
  if (entryErr) throw entryErr;
  if (lbErr) throw lbErr;

  const entries = (entryData ?? []) as (EntryRow & { entry_status: string })[];

  // Playing handicaps (per round) — same resolution the pricing uses, so
  // round nets match the leaderboard's per-submission handicap sum.
  const profileHi = new Map<string, number | null>();
  if (placement.event.group_id && entries.length > 0) {
    const { data: hiRows } = await supabaseAdmin
      .from("fantasy_player_profiles")
      .select("profile_id, handicap_index")
      .eq("group_id", placement.event.group_id)
      .in("profile_id", entries.map((e) => e.profile_id));
    for (const r of (hiRows ?? []) as { profile_id: string; handicap_index: number | null }[]) {
      profileHi.set(r.profile_id, r.handicap_index != null ? Number(r.handicap_index) : null);
    }
  }
  const phDetails = resolvePlayingHandicapDetails(placement.event, entries, profileHi);

  const holes = placement.holes.map((h) => ({
    holeNumber: h.holeNumber,
    par: h.par,
    round: h.round ?? 1,
  }));
  const parByKey = new Map<number, number>(holes.map((h) => [holeKey(h.round, h.holeNumber), h.par]));
  const roundNumbers = [...new Set(holes.map((h) => h.round))].sort((a, b) => a - b);

  const anyAce = { seen: false };
  const anyAlbatross = { seen: false };
  const anyEagle = { seen: false };
  let anyHoleData = false;

  const buildCounts = (profileId: string) => {
    const completed = placement.liveData.completedByProfile.get(profileId);
    const holeStrokes = completed && Object.keys(completed).length > 0 ? completed : null;
    let birdies: number | null = null;
    let eagles: number | null = null;
    const roundScores: FinalPlayerScore["roundScores"] = {};
    const ph = phDetails.get(profileId)?.value ?? 0;

    if (holeStrokes) {
      anyHoleData = true;
      birdies = 0;
      eagles = 0;
      const perRound = new Map<number, { gross: number; birdies: number; holesRecorded: number }>();
      for (const [key, strokes] of Object.entries(holeStrokes)) {
        const numKey = Number(key);
        const round = Math.floor(numKey / 100);
        const par = parByKey.get(numKey);
        const agg = perRound.get(round) ?? { gross: 0, birdies: 0, holesRecorded: 0 };
        agg.gross += strokes;
        agg.holesRecorded += 1;
        if (par != null) {
          if (strokes <= par - 1) {
            birdies += 1;
            agg.birdies += 1;
          }
          if (strokes <= par - 2) {
            eagles += 1;
            anyEagle.seen = true;
          }
          if (strokes <= par - 3) anyAlbatross.seen = true;
        }
        if (strokes === 1) anyAce.seen = true;
        perRound.set(round, agg);
      }
      for (const r of roundNumbers) {
        const agg = perRound.get(r);
        roundScores[r] = agg
          ? { gross: agg.gross, net: agg.gross - ph, birdies: agg.birdies }
          : { gross: null, net: null, birdies: null };
      }
    } else {
      for (const r of roundNumbers) roundScores[r] = { gross: null, net: null, birdies: null };
    }

    return { birdies, eagles, roundScores, holeStrokes };
  };

  const players: Record<string, FinalPlayerScore> = {};
  for (const e of entries) {
    const counts = buildCounts(e.profile_id);
    players[e.profile_id] = {
      profileId: e.profile_id,
      position: null,
      grossScore: null,
      netScore: null,
      birdieCount: counts.birdies,
      eagleCount: counts.eagles,
      roundScores: counts.roundScores,
      holeStrokes: counts.holeStrokes,
      withdrawn: WITHDRAWN_STATUSES.includes(e.entry_status),
    };
  }
  for (const lb of (lbData ?? []) as {
    profile_id: string; position: number | null; gross_score: number | null; net_score: number | null;
  }[]) {
    let player = players[lb.profile_id];
    if (!player) {
      const counts = buildCounts(lb.profile_id);
      player = {
        profileId: lb.profile_id,
        position: null,
        grossScore: null,
        netScore: null,
        birdieCount: counts.birdies,
        eagleCount: counts.eagles,
        roundScores: counts.roundScores,
        holeStrokes: counts.holeStrokes,
        withdrawn: false,
      };
    }
    player.position = lb.position;
    player.grossScore = lb.gross_score;
    player.netScore = lb.net_score;
    players[lb.profile_id] = player;
  }

  return {
    players,
    fieldSize: Object.keys(players).length,
    holes,
    field: anyHoleData
      ? { ace: anyAce.seen, albatross: anyAlbatross.seen, eagle: anyEagle.seen }
      : { ace: null, albatross: null, eagle: null },
  };
}

function computeOutcomes(
  markets: FantasyMarket[],
  final: FinalScoringData,
  picks: { id: string; market_id: string; selection_key: string }[]
): {
  pickOutcomes: { pick_id: string; outcome: SettlementOutcome }[];
  outcomesByMarket: Map<string, Map<string, SettlementOutcome>>;
} {
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
  return { pickOutcomes, outcomesByMarket };
}

/**
 * Resolve accumulator legs riding on the just-settled markets, finalize any
 * parlays with no open legs left (payout math in the RPC), and notify owners.
 */
async function settleParlayLegs(
  eventId: string,
  marketIds: string[],
  outcomesByMarket: Map<string, Map<string, SettlementOutcome>>
): Promise<void> {
  if (marketIds.length === 0) return;
  const { data: legData, error: legErr } = await supabaseAdmin
    .from("fantasy_parlay_legs")
    .select("id, market_id, selection_key")
    .eq("event_id", eventId)
    .eq("status", "open")
    .in("market_id", marketIds);
  if (legErr) throw legErr;
  const legs = (legData ?? []) as { id: string; market_id: string; selection_key: string }[];
  if (legs.length === 0) return;

  const legOutcomes = legs.map((leg) => ({
    leg_id: leg.id,
    outcome: outcomesByMarket.get(leg.market_id)?.get(leg.selection_key) ?? "void",
  }));

  const { data: result, error: rpcErr } = await supabaseAdmin.rpc(
    "ciaga_fantasy_settle_parlay_legs",
    { p_leg_outcomes: legOutcomes }
  );
  if (rpcErr) throw rpcErr;

  const finalizedIds = ((result as { parlay_ids?: string[] } | null)?.parlay_ids ?? []) as string[];
  if (finalizedIds.length === 0) return;

  const { data: parlayData } = await supabaseAdmin
    .from("fantasy_parlays")
    .select("id, profile_id, status, stake, potential_return")
    .in("id", finalizedIds)
    .in("status", ["won", "lost", "void"]);
  await Promise.allSettled(
    ((parlayData ?? []) as {
      id: string; profile_id: string; status: string; stake: number; potential_return: number;
    }[]).map((p) =>
      createNotification({
        recipientProfileId: p.profile_id,
        type: `fantasy_parlay_${p.status}`,
        payload: {
          parlay_id: p.id,
          stake: Number(p.stake),
          payout: p.status === "won" ? Number(p.potential_return) : undefined,
        },
      })
    )
  );
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
  const { pickOutcomes, outcomesByMarket } = computeOutcomes(markets, final, picks);

  const { data: counts, error: applyErr } = await supabaseAdmin.rpc(
    "ciaga_fantasy_apply_settlement",
    {
      p_event_id: eventId,
      p_outcomes: pickOutcomes,
      p_market_ids: markets.map((m) => m.id),
      p_final: true,
    }
  );
  if (applyErr) throw applyErr;

  await settleParlayLegs(eventId, markets.map((m) => m.id), outcomesByMarket).catch(() => {});
  await notifySettledPicks(eventId, event.name, picks.map((p) => p.id));

  const c = (counts ?? {}) as { won?: number; lost?: number; void?: number };
  return { settled: true, won: c.won ?? 0, lost: c.lost ?? 0, void: c.void ?? 0 };
}

/**
 * Early settlement for round-scoped markets of a multi-round event: any open
 * market with params.round pointing at a completed event round settles now;
 * event-wide markets stay open and is_final stays false.
 */
export async function settleFantasyRoundMarkets(
  eventId: string
): Promise<{ settled: number }> {
  const { data: stateRow } = await supabaseAdmin
    .from("fantasy_event_state")
    .select("event_id, is_final")
    .eq("event_id", eventId)
    .maybeSingle();
  if (!stateRow || (stateRow as { is_final: boolean }).is_final) return { settled: 0 };

  const { data: eventRow, error: eventErr } = await supabaseAdmin
    .from("events")
    .select("id, name, majors_status, num_rounds")
    .eq("id", eventId)
    .maybeSingle();
  if (eventErr) throw eventErr;
  const event = eventRow as { id: string; name: string; majors_status: string; num_rounds: number | null } | null;
  // Completed events go through the full settlement path instead.
  if (!event || (event.num_rounds ?? 1) <= 1 || event.majors_status === "completed") {
    return { settled: 0 };
  }

  const { data: erRows } = await supabaseAdmin
    .from("event_rounds")
    .select("round_number, status")
    .eq("event_id", eventId)
    .eq("status", "completed");
  const completedRounds = new Set(
    ((erRows ?? []) as { round_number: number }[]).map((r) => r.round_number)
  );
  if (completedRounds.size === 0) return { settled: 0 };

  const { data: marketData, error: marketErr } = await supabaseAdmin
    .from("fantasy_markets")
    .select("*")
    .eq("event_id", eventId)
    .in("status", ["open", "suspended"]);
  if (marketErr) throw marketErr;
  const roundMarkets = ((marketData ?? []) as FantasyMarket[]).filter((m) => {
    const round = marketRound(m);
    return round != null && completedRounds.has(round);
  });
  if (roundMarkets.length === 0) return { settled: 0 };

  const marketIds = roundMarkets.map((m) => m.id);
  const { data: pickData, error: pickErr } = await supabaseAdmin
    .from("fantasy_picks")
    .select("id, market_id, profile_id, selection_key, stake, potential_return")
    .eq("event_id", eventId)
    .eq("status", "open")
    .in("market_id", marketIds);
  if (pickErr) throw pickErr;
  const picks = (pickData ?? []) as {
    id: string; market_id: string; profile_id: string; selection_key: string;
    stake: number; potential_return: number;
  }[];

  const final = await loadFinalScoringData(eventId);
  const { pickOutcomes, outcomesByMarket } = computeOutcomes(roundMarkets, final, picks);

  const { error: applyErr } = await supabaseAdmin.rpc("ciaga_fantasy_apply_settlement", {
    p_event_id: eventId,
    p_outcomes: pickOutcomes,
    p_market_ids: marketIds,
    p_final: false,
  });
  if (applyErr) throw applyErr;

  await settleParlayLegs(eventId, marketIds, outcomesByMarket).catch(() => {});
  await notifySettledPicks(eventId, event.name, picks.map((p) => p.id));
  return { settled: roundMarkets.length };
}

async function notifySettledPicks(
  eventId: string,
  eventName: string,
  pickIds: string[]
): Promise<void> {
  const settledPicks = await getSettledPickLabels(eventId, pickIds);
  await Promise.allSettled(
    settledPicks.map((p) =>
      createNotification({
        recipientProfileId: p.profile_id,
        type: `fantasy_pick_${p.status}`,
        payload: {
          event_id: eventId,
          event_name: eventName,
          market_label: p.label,
          stake: p.stake,
          payout: p.status === "won" ? p.potential_return : undefined,
        },
      })
    )
  );
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
