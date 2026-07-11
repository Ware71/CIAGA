/**
 * Self-betting integrity rules — you can back yourself to do WELL, never to
 * do badly, and never an exact score/band/position you could steer into.
 * Pure and shared: the boards use it to grey selections out, placement
 * (placePick / placeParlay) enforces it server-side. No server imports.
 *
 * Unrestricted by design: outright winner, top-N, from-1st finishing ranges,
 * birdies, eagles, under score totals, birdie-or-better holes, backing your
 * own h2h side, and the field specials (no target player).
 */

type RestrictableMarket = {
  market_type: string;
  subject_profile_id: string | null;
  opponent_profile_id: string | null;
  params: Record<string, unknown> | null;
};

/**
 * Returns a human reason when the bettor may not back this selection on
 * themselves, or null when it's allowed.
 */
export function findSelfRestriction(
  bettorProfileId: string | null | undefined,
  market: RestrictableMarket,
  selectionKey: string
): string | null {
  if (!bettorProfileId) return null;
  const params = (market.params ?? {}) as {
    outcome?: unknown;
    kind?: unknown;
    from?: unknown;
  };
  const isSubject = market.subject_profile_id === bettorProfileId;

  switch (market.market_type) {
    case "h2h": {
      // Backing the opposite side is betting on yourself to lose; a draw is
      // just as steerable (ease up to tie), so only your own side is open.
      const isOpponent = market.opponent_profile_id === bettorProfileId;
      if (!isSubject && !isOpponent) return null;
      const backingSelf =
        (isSubject && selectionKey === "a") || (isOpponent && selectionKey === "b");
      return backingSelf ? null : "You can only back yourself in your own matchups";
    }
    case "score_total":
      // Under = playing well, fine. Over and Exactly pay for a score you
      // control from above.
      if (!isSubject) return null;
      return selectionKey.startsWith("u_")
        ? null
        : "You can't back over or exact scores on yourself";
    case "score_band":
      // Every band is a target you could manage your score into.
      return isSubject ? "You can't bet on your own score bands" : null;
    case "hole_score":
      return isSubject && params.outcome === "bogey_or_worse"
        ? "You can't back bad holes for yourself"
        : null;
    case "finish_range": {
      // Wooden spoon / bottom or mid ranges pay for finishing badly; ranges
      // anchored at 1st are top-N-shaped and stay open.
      if (selectionKey !== bettorProfileId) return null;
      const from = Number(params.from) || 1;
      return params.kind === "last" || from > 1
        ? "You can't back yourself to finish down the field"
        : null;
    }
    case "finish_position": {
      // "Exactly 1st" is winning; any other exact spot is reachable by easing
      // off.
      if (!isSubject) return null;
      const pos = Number(selectionKey);
      return Number.isFinite(pos) && pos >= 2
        ? "You can't back yourself into an exact finishing spot"
        : null;
    }
    default:
      return null;
  }
}
