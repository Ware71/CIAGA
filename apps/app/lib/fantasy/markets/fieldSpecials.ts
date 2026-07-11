import type {
  FinalScoringData,
  FantasyMarket,
  GenerateCtx,
  LiveMarketCtx,
  MarketDefinition,
  MarketSpec,
  SettlementOutcome,
} from "@/lib/fantasy/markets/types";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";

type SpecialKind = "hio" | "albatross" | "field_eagle";

/**
 * Amateur base rates per player-hole. The discretized-normal bins massively
 * overprice these tails (a ~2% per-hole ace!), so HIO/albatross price off
 * empirical rates instead; the field eagle uses the calibrated eagle bins.
 * ~1/12,500 per par-3 attempt is the commonly cited average-amateur ace rate
 * (pros ~1/2,500); an amateur albatross is a ~1-in-a-million hole.
 */
const HIO_RATE_PER_PAR3_PLAYER_HOLE = 1 / 12500;
const ALBATROSS_RATE_PER_PLAYER_HOLE = 1 / 1_000_000;

function marketKind(market: FantasyMarket): SpecialKind {
  const kind = (market.params as { kind?: unknown }).kind;
  return kind === "albatross" || kind === "field_eagle" ? kind : "hio";
}

const KIND_LABEL: Record<SpecialKind, string> = {
  hio: "A hole-in-one at the event",
  albatross: "An albatross at the event",
  field_eagle: "Anyone to make an eagle",
};

/**
 * Field-wide novelty specials: hole-in-one / albatross / any eagle. Back-only
 * longshots (odds capped at 1000/1 by the snapshot clamp); no cash-out.
 */
export const fieldSpecial: MarketDefinition = {
  type: "field_special",
  group: "specials",
  eligibleForCashout: false,

  displayName(market) {
    return KIND_LABEL[marketKind(market)];
  },

  selectionLabel() {
    return "Yes";
  },

  generateMarkets(ctx: GenerateCtx): MarketSpec[] {
    if (ctx.players.length < 2 || ctx.holes.length === 0) return [];
    return (["hio", "albatross", "field_eagle"] as SpecialKind[]).map((kind) => ({
      market_type: "field_special" as const,
      params: { kind },
    }));
  },

  selections(): string[] {
    return ["yes"];
  },

  simulate(sim: SimulationResult, market): Map<string, number> {
    const out = new Map<string, number>();
    const kind = marketKind(market);
    const playerCount = sim.players.length;

    if (kind === "field_eagle") {
      let none = 1;
      for (const player of sim.players) {
        for (const bins of player.holeOutcomes) {
          none *= 1 - bins[0] / sim.simulationCount;
        }
      }
      out.set("yes", 1 - none);
      return out;
    }

    const par3s = sim.holes.filter((h) => h.par <= 3).length;
    const par45s = sim.holes.length - par3s;
    const exposures = kind === "hio" ? par3s * playerCount : par45s * playerCount;
    const rate = kind === "hio" ? HIO_RATE_PER_PAR3_PLAYER_HOLE : ALBATROSS_RATE_PER_PLAYER_HOLE;
    out.set("yes", 1 - Math.pow(1 - rate, Math.max(0, exposures)));
    return out;
  },

  settle(final: FinalScoringData, market): Map<string, SettlementOutcome> {
    const out = new Map<string, SettlementOutcome>();
    const kind = marketKind(market);
    const flag =
      kind === "hio" ? final.field.ace : kind === "albatross" ? final.field.albatross : final.field.eagle;
    if (flag == null) out.set("yes", "void");
    else out.set("yes", flag ? "won" : "lost");
    return out;
  },

  placementAllowed(_market, _selectionKey, ctx: LiveMarketCtx): boolean {
    return !ctx.eventCompleted;
  },

  isSelfDependent(): boolean {
    // The bettor could technically resolve it themselves, but the market is
    // not cash-out eligible, so the self-dependency gate never applies.
    return false;
  },

  cashoutCutoff() {
    return { eligible: false as const, reason: "Specials can't be cashed out" };
  },
};
