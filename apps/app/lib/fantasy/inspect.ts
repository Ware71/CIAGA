import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  ACTIVE_ENTRY_STATUSES,
  allowancePct,
  loadSimInputs,
  resolvePlayingHandicapDetails,
  simulateEvent,
  type EntryRow,
} from "@/lib/fantasy/odds";
import { holeMu, holeSigma } from "@/lib/fantasy/simulation/holeModel";
import { getMarketDefinition } from "@/lib/fantasy/markets/registry";
import type { FantasyMarket } from "@/lib/fantasy/markets/types";
import type { StoredFantasyProfile } from "@/lib/fantasy/profiles";

/**
 * Odds inspector — "look under the hood" of one event's pricing.
 *
 * Dev tool (sandbox-gated at the route): assembles every input the simulation
 * consumed and re-runs it with the live seed, so what it reports is exactly
 * what priced the board. Read-only; the rebuild-profiles route is the
 * companion write action.
 */

function percentiles(totals: Int16Array): Record<string, number> {
  const sorted = Array.from(totals).sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.round((sorted.length - 1) * q))];
  return { p5: at(0.05), p25: at(0.25), p50: at(0.5), p75: at(0.75), p95: at(0.95) };
}

export async function inspectEvent(eventId: string) {
  // loadSimInputs ensures profiles exist/are fresh — first call on a new
  // event does the builds, exactly like generation would.
  const ctx = await loadSimInputs(eventId);

  const [stateRes, jobsRes, entriesRes, storedRes, marketsRes, snapsRes] = await Promise.all([
    supabaseAdmin.from("fantasy_event_state").select("*").eq("event_id", eventId).maybeSingle(),
    supabaseAdmin
      .from("fantasy_refresh_jobs")
      .select("id, status, reason, debounce_until, attempts, locked_at, last_error, created_at, updated_at")
      .eq("event_id", eventId)
      .order("updated_at", { ascending: false })
      .limit(20),
    supabaseAdmin
      .from("event_entries")
      .select(
        "profile_id, entry_status, assigned_handicap_index, assigned_course_handicap, assigned_playing_handicap"
      )
      .eq("event_id", eventId)
      .in("entry_status", ACTIVE_ENTRY_STATUSES),
    supabaseAdmin
      .from("fantasy_player_profiles")
      .select("*")
      .eq("group_id", ctx.groupId)
      .in("profile_id", ctx.players.map((p) => p.profileId)),
    supabaseAdmin.from("fantasy_markets").select("*").eq("event_id", eventId),
    supabaseAdmin
      .from("fantasy_odds_snapshots")
      .select("id, market_id, selection_key, probability, decimal_odds, event_version, computed_at")
      .eq("event_id", eventId)
      .eq("status", "active"),
  ]);

  const state = (stateRes.data as { version?: number } | null) ?? null;
  const version = state?.version ?? 0;
  const entries = (entriesRes.data ?? []) as EntryRow[];
  const stored = (storedRes.data ?? []) as StoredFantasyProfile[];
  const storedByProfile = new Map(stored.map((r) => [r.profile_id, r]));

  const profileHi = new Map<string, number | null>();
  for (const r of stored) profileHi.set(r.profile_id, r.handicap_index);
  const phDetails = resolvePlayingHandicapDetails(ctx.event, entries, profileHi);

  // Same seed the live refresh used for this version → identical numbers.
  const sim = simulateEvent(ctx, version);

  const players = ctx.players.map((p) => {
    const res = sim.players[sim.playerIndex[p.profileId]];
    const detail = phDetails.get(p.profileId);
    return {
      profileId: p.profileId,
      name: p.displayName,
      playingHandicap: p.playingHandicap,
      playingHandicapSource: detail?.source ?? "no_data",
      completedHoles: Object.keys(p.completedHoles).length,
      roundComplete: p.roundComplete,
      profile: storedByProfile.get(p.profileId) ?? null,
      model: {
        sigmaPerHole: Math.round(holeSigma(p.profile) * 1000) / 1000,
        muByHole: ctx.holes.map((h) => Math.round(holeMu(p.profile, h) * 1000) / 1000),
      },
      sim: {
        meanGross: Math.round(res.meanGross * 100) / 100,
        meanNet: Math.round(res.meanNet * 100) / 100,
        winProb: Math.round(res.winProb * 10000) / 10000,
        topNProb: res.topNProb,
        grossPercentiles: percentiles(res.grossTotals),
        netPercentiles: percentiles(res.netTotals),
      },
    };
  });

  const snaps = (snapsRes.data ?? []) as {
    id: string; market_id: string; selection_key: string;
    probability: number; decimal_odds: number; event_version: number; computed_at: string;
  }[];
  const snapsByMarket = new Map<string, typeof snaps>();
  for (const s of snaps) {
    const list = snapsByMarket.get(s.market_id);
    if (list) list.push(s);
    else snapsByMarket.set(s.market_id, [s]);
  }

  const markets = ((marketsRes.data ?? []) as FantasyMarket[]).map((m) => {
    const def = getMarketDefinition(m.market_type);
    const selections = (snapsByMarket.get(m.id) ?? [])
      .map((s) => ({
        key: s.selection_key,
        label: def ? def.selectionLabel(m, s.selection_key, ctx.names) : s.selection_key,
        probability: Number(s.probability),
        decimalOdds: Number(s.decimal_odds),
        eventVersion: s.event_version,
        computedAt: s.computed_at,
      }))
      .sort((a, b) => b.probability - a.probability);
    return {
      id: m.id,
      marketType: m.market_type,
      displayName: def ? def.displayName(m, ctx.names) : m.market_type,
      status: m.status,
      params: m.params,
      subjectProfileId: m.subject_profile_id,
      opponentProfileId: m.opponent_profile_id,
      selections,
      probabilitySum: Math.round(selections.reduce((s, sel) => s + sel.probability, 0) * 1000) / 1000,
    };
  });

  return {
    event: {
      id: ctx.event.id,
      name: ctx.event.name,
      status: ctx.event.majors_status,
      eventDate: ctx.event.event_date,
      numRounds: ctx.event.num_rounds,
      scoringModel: ctx.event.scoring_model,
      handicapRules: ctx.event.handicap_rules,
      allowancePct: allowancePct(ctx.event),
      rankingBasis: ctx.rankingBasis,
    },
    state: stateRes.data ?? null,
    jobs: jobsRes.data ?? [],
    simMeta: { version, simulationCount: sim.simulationCount },
    holes: ctx.holes,
    players,
    markets,
    generatedAt: new Date().toISOString(),
  };
}
