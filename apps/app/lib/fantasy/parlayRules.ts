/**
 * Pure accumulator rules shared by server (placement lib/RPC mirror) and
 * client (slip pre-checks). No server imports allowed here.
 */

export const MIN_LEGS = 2;
export const MAX_LEGS = 8;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Correlation identities for a leg — no two legs may share a subject key
 * within one event ("X wins" + "X top 3"). Cross-event legs on the same
 * player are fine.
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

/** Returns the offending subject key, or null when the combo is allowed. */
export function findCorrelation(
  legs: { eventId: string; subjectKeys: string[] }[]
): string | null {
  const seen = new Set<string>();
  for (const leg of legs) {
    for (const key of leg.subjectKeys) {
      const pair = `${leg.eventId}|${key}`;
      if (seen.has(pair)) return key;
      seen.add(pair);
    }
  }
  return null;
}

export function combinedOdds(legOdds: number[]): number {
  return Math.round(legOdds.reduce((product, odds) => product * odds, 1) * 100) / 100;
}
