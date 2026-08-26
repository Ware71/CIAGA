/**
 * A leaderboard row's `holes_completed` is cumulative across the whole event,
 * so "R2 thru 7" has to be recovered from it. That was done with
 * `Math.floor(holes / 18)`, which silently mislabels every round after a
 * 9-hole leg.
 *
 * `roundHoles` comes from `ciaga_event_round_holes` — the same source the SQL
 * freeze thresholds use — so the label can't drift from the clip.
 */
export function splitCumulativeHoles(
  holesShown: number,
  roundHoles: number[] | null | undefined,
  numRoundsFallback: number,
): { completedRounds: number; holesInRound: number; holesPerRound: number } {
  // No per-round data (legacy payload): the old uniform-18 behaviour.
  const rounds =
    roundHoles && roundHoles.length > 0
      ? roundHoles
      : Array.from({ length: Math.max(1, numRoundsFallback) }, () => 18);

  let remaining = holesShown;
  let completedRounds = 0;

  for (const holes of rounds) {
    if (remaining < holes) break;
    remaining -= holes;
    completedRounds += 1;
  }

  // Which round the player is in now — clamped for a card that ran past the
  // planned rounds (an extra leg added mid-event).
  const currentRoundHoles =
    rounds[Math.min(completedRounds, rounds.length - 1)] ?? 18;

  return {
    completedRounds,
    holesInRound: remaining,
    holesPerRound: currentRoundHoles,
  };
}
