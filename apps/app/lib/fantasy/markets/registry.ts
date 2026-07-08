import type { FantasyMarketType, MarketDefinition } from "@/lib/fantasy/markets/types";
import { outrightWinner } from "@/lib/fantasy/markets/outrightWinner";
import { topN } from "@/lib/fantasy/markets/topN";
import { grossOverUnder, netOverUnder } from "@/lib/fantasy/markets/overUnder";
import { birdies } from "@/lib/fantasy/markets/birdies";
import { headToHead } from "@/lib/fantasy/markets/headToHead";

/**
 * The market registry — the only place market behavior lives. Add a market
 * type by writing a MarketDefinition and registering it here (plus extending
 * the fantasy_markets market_type CHECK in a migration).
 */
export const MARKET_REGISTRY: Record<FantasyMarketType, MarketDefinition> = {
  outright_winner: outrightWinner,
  top_n: topN,
  gross_ou: grossOverUnder,
  net_ou: netOverUnder,
  birdies,
  h2h: headToHead,
};

export function getMarketDefinition(type: string): MarketDefinition | null {
  return (MARKET_REGISTRY as Record<string, MarketDefinition>)[type] ?? null;
}

/** Display order for the market board. */
export const MARKET_TYPE_ORDER: FantasyMarketType[] = [
  "outright_winner",
  "top_n",
  "h2h",
  "gross_ou",
  "net_ou",
  "birdies",
];
