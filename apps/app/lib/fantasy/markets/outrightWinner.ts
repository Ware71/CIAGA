import type {
  FantasyMarket,
  FinalScoringData,
  GenerateCtx,
  LiveMarketCtx,
  MarketDefinition,
  MarketSpec,
  SettlementOutcome,
} from "@/lib/fantasy/markets/types";
import { playerName } from "@/lib/fantasy/markets/types";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";

/** Outright winner — one market per event, selections are the field. */
export const outrightWinner: MarketDefinition = {
  type: "outright_winner",
  group: "winner",
  eligibleForCashout: true,

  displayName() {
    return "Outright Winner";
  },

  selectionLabel(_market, selectionKey, names) {
    return playerName(names, selectionKey);
  },

  generateMarkets(ctx: GenerateCtx): MarketSpec[] {
    if (ctx.players.length < 2) return [];
    return [{ market_type: "outright_winner", params: {} }];
  },

  selections(): string[] {
    // Selections are the event field; enumerated by the odds service from the
    // sim result rather than stored on the market row.
    return [];
  },

  simulate(sim: SimulationResult): Map<string, number> {
    const out = new Map<string, number>();
    for (const p of sim.players) out.set(p.profileId, p.winProb);
    return out;
  },

  settle(final: FinalScoringData): Map<string, SettlementOutcome> {
    const out = new Map<string, SettlementOutcome>();
    for (const p of Object.values(final.players)) {
      if (p.withdrawn) out.set(p.profileId, "void");
      else if (p.position == null) out.set(p.profileId, "void");
      else out.set(p.profileId, p.position === 1 ? "won" : "lost");
    }
    return out;
  },

  placementAllowed(_market, selectionKey, ctx: LiveMarketCtx): boolean {
    // In-play picks allowed; a player whose round is done is a dead pick, so
    // block backing them (their odds are frozen while others still move).
    return !ctx.eventCompleted && !ctx.roundComplete(selectionKey);
  },

  isSelfDependent(): boolean {
    // Spec: outright picks on yourself are allowed and cash-out eligible.
    return false;
  },

  cashoutCutoff(_market, selectionKey, ctx: LiveMarketCtx) {
    if (ctx.eventCompleted) return { eligible: false, reason: "Event is complete" };
    if (ctx.roundComplete(selectionKey)) {
      return { eligible: false, reason: "Player's round is complete" };
    }
    return { eligible: true };
  },
};
