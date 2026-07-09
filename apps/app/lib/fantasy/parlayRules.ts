/**
 * Pure accumulator rules shared by server (placement lib/RPC mirror) and
 * client (slip pre-checks). No server imports allowed here.
 */

export const MIN_LEGS = 2;
export const MAX_LEGS = 8;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The finishing-position market family. These share one underlying random
 * variable per player (their finishing position), so legs across DIFFERENT
 * players are correlated and get JOINTLY priced from the simulation; legs
 * outside this set are treated as independent and multiplied in.
 */
export const POSITION_FAMILY_TYPES = new Set([
  "outright_winner",
  "top_n",
  "finish_position",
  "finish_range",
]);

export function isPositionFamily(marketType: string): boolean {
  return POSITION_FAMILY_TYPES.has(marketType);
}

/**
 * Correlation identities for a leg — the player(s) whose finishing position the
 * leg concerns. Field markets (outright/top-N/ranges) put the SELECTED player
 * as the subject; per-player markets carry subject/opponent ids.
 */
export function subjectKeysFor(
  market: {
    market_type: string;
    subject_profile_id: string | null;
    opponent_profile_id: string | null;
  },
  selectionKey: string
): string[] {
  if (market.market_type === "field_special") return ["field"];
  const keys = new Set<string>();
  if (market.subject_profile_id) keys.add(market.subject_profile_id);
  if (market.opponent_profile_id) keys.add(market.opponent_profile_id);
  // Field markets (outright/top-N/ranges): the SELECTED player is the subject.
  if (UUID_RE.test(selectionKey)) keys.add(selectionKey);
  return [...keys];
}

/**
 * A finishing "slot" that only one player can occupy in an event — two legs
 * claiming the same slot can never both land, so they can't combine (e.g. two
 * outright winners, two wooden spoons, two "exactly 3rd"). Returns null when
 * many players can satisfy the selection (top-N, wide finishing ranges): those
 * combine and are priced from the true joint probability.
 */
export function exclusivitySlot(
  market: { market_type: string; params?: Record<string, unknown> | null },
  selectionKey: string
): string | null {
  const params = (market.params ?? {}) as { kind?: unknown };
  switch (market.market_type) {
    case "outright_winner":
      return "winner";
    case "finish_position":
      return `pos:${selectionKey}`; // selection = the exact position
    case "finish_range":
      return params.kind === "last" ? "last" : null; // ranges of width ≥2: many players
    default:
      return null;
  }
}

/**
 * Whether two DIFFERENT selections on the SAME market row can co-occur, i.e.
 * the slip may hold both instead of replacing one. True for field markets where
 * several players can win the same selection (top-N, wide finishing ranges);
 * false for exclusive rows (outright winner, wooden spoon) and per-player rows
 * (finish position, over/unders — one line per player).
 */
export function marketAllowsMultiple(market: {
  market_type: string;
  params?: Record<string, unknown> | null;
}): boolean {
  if (market.market_type === "top_n") return true;
  if (market.market_type === "finish_range") {
    return (market.params as { kind?: unknown } | null)?.kind !== "last";
  }
  return false;
}

export type ParlayLeg = {
  eventId: string;
  marketId: string;
  marketType: string;
  params: Record<string, unknown> | null;
  /** Player identities from subjectKeysFor. */
  subjectKeys: string[];
  selectionKey: string;
};

/**
 * Validate an accumulator's legs. Returns a human message for the first
 * violation, or null when the combination is allowed.
 *
 * Rules (correlated-acca model):
 *  - No duplicate exact (market, selection).
 *  - The finishing-position family is jointly priced, so within one event: at
 *    most ONE position leg per player (X to win + X top-3 is redundant), and no
 *    two legs sharing an exclusive slot (two winners / wooden spoons / "3rd").
 *  - Everything else combines as independent — a player may appear in a
 *    position leg AND own-score legs (X top-3 + X to birdie) freely.
 */
export function findParlayViolation(legs: ParlayLeg[]): string | null {
  const exact = new Set<string>();
  const posSubject = new Set<string>(); // `${eventId}|${player}`
  const slot = new Set<string>(); // `${eventId}|${slot}`
  for (const leg of legs) {
    const exactKey = `${leg.marketId}|${leg.selectionKey}`;
    if (exact.has(exactKey)) return "That selection is already in your acca";
    exact.add(exactKey);

    if (!isPositionFamily(leg.marketType)) continue;

    for (const player of leg.subjectKeys) {
      const key = `${leg.eventId}|${player}`;
      if (posSubject.has(key)) {
        return "A player can only appear once in an event's finishing markets";
      }
      posSubject.add(key);
    }
    const ex = exclusivitySlot(
      { market_type: leg.marketType, params: leg.params },
      leg.selectionKey
    );
    if (ex) {
      const key = `${leg.eventId}|${ex}`;
      if (slot.has(key)) return "Those finishing selections can't both land";
      slot.add(key);
    }
  }
  return null;
}

/** Naive independent-product combined odds (cross-event / no correlated legs). */
export function combinedOdds(legOdds: number[]): number {
  return Math.round(legOdds.reduce((product, odds) => product * odds, 1) * 100) / 100;
}
