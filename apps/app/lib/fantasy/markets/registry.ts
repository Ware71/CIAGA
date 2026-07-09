import type { FantasyMarketType, MarketDefinition } from "@/lib/fantasy/markets/types";
import { outrightWinner } from "@/lib/fantasy/markets/outrightWinner";
import { topN } from "@/lib/fantasy/markets/topN";
import { grossOverUnder, netOverUnder } from "@/lib/fantasy/markets/overUnder";
import { birdies } from "@/lib/fantasy/markets/birdies";
import { headToHead } from "@/lib/fantasy/markets/headToHead";
import { finishPosition } from "@/lib/fantasy/markets/finishPosition";
import { finishRange } from "@/lib/fantasy/markets/finishRange";
import { scoreBand } from "@/lib/fantasy/markets/scoreBand";
import { scoreExact } from "@/lib/fantasy/markets/scoreExact";
import { eagleCount } from "@/lib/fantasy/markets/eagles";
import { holeScore } from "@/lib/fantasy/markets/holeScore";
import { fieldSpecial } from "@/lib/fantasy/markets/fieldSpecials";

/**
 * The market registry — the only place market behavior lives. Add a market
 * type by writing a MarketDefinition and registering it here (plus extending
 * the fantasy_markets market_type CHECK in a migration).
 */
export const MARKET_REGISTRY: Record<FantasyMarketType, MarketDefinition> = {
  outright_winner: outrightWinner,
  top_n: topN,
  finish_position: finishPosition,
  finish_range: finishRange,
  gross_ou: grossOverUnder,
  net_ou: netOverUnder,
  score_band: scoreBand,
  score_exact: scoreExact,
  birdies,
  eagle_count: eagleCount,
  h2h: headToHead,
  hole_score: holeScore,
  field_special: fieldSpecial,
};

export function getMarketDefinition(type: string): MarketDefinition | null {
  return (MARKET_REGISTRY as Record<string, MarketDefinition>)[type] ?? null;
}

/** Display order for the market board. */
export const MARKET_TYPE_ORDER: FantasyMarketType[] = [
  "outright_winner",
  "top_n",
  "finish_position",
  "finish_range",
  "h2h",
  "gross_ou",
  "net_ou",
  "score_band",
  "score_exact",
  "birdies",
  "eagle_count",
  "hole_score",
  "field_special",
];
