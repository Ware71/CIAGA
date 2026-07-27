// lib/feed/helpers/holesPlayed.ts
//
// Per-participant gross strokes and holes-played, from the two sources that
// disagree about what a hole is:
//
//  - round_current_scores — DISTINCT ON (round_id, participant_id, hole_number),
//    so at most one row per hole. A picked-up or cleared hole still leaves a row
//    here, with strokes = NULL (both markPickedUp and clearScoreEvent write one).
//    Those are NOT holes played.
//  - round_hole_states rows with status 'picked_up' — holes that WERE played and
//    must be credited the WHS net double bogey.
//
// The two overlap on every pick-up. Counting them independently is what produced
// "Thru 21" on an 18-hole round: 18 score rows (3 of them NULL) plus 3 pick-ups.
// Holes are therefore tracked as a SET of hole numbers, never as a counter.

import { netDoubleBogeyGross } from "@/lib/rounds/handicapUtils";

export type ScoreRow = {
  participant_id: string;
  hole_number: number;
  /** Unknown on purpose: NULL from the view must be rejected, not coerced. */
  strokes: unknown;
};

export type PickedUpRow = { participant_id: string; hole_number: number };

export type HoleMeta = { par: number | null; stroke_index: number | null };

export type HolesPlayedTally = {
  grossByParticipantId: Map<string, number>;
  holesPlayedByParticipantId: Map<string, Set<number>>;
};

export function tallyHolesPlayed(params: {
  scores: ScoreRow[];
  pickedUp: PickedUpRow[];
  holeByNumber: Map<number, HoleMeta>;
  courseHandicapByParticipantId?: Map<string, number | null>;
  /** Defaults to the size of holeByNumber, falling back to 18. */
  holeCount?: number;
}): HolesPlayedTally {
  const { scores, pickedUp, holeByNumber, courseHandicapByParticipantId } = params;
  const holeCount = params.holeCount ?? holeByNumber.size ?? 18;

  const grossByParticipantId = new Map<string, number>();
  const holesPlayedByParticipantId = new Map<string, Set<number>>();

  const addHole = (pid: string, holeNumber: number) => {
    const set = holesPlayedByParticipantId.get(pid) ?? new Set<number>();
    set.add(holeNumber);
    holesPlayedByParticipantId.set(pid, set);
  };

  for (const row of scores) {
    const pid = row.participant_id;
    const holeNumber = row.hole_number;
    if (!pid || typeof holeNumber !== "number") continue;
    // NOTE: `Number(null) === 0`, which is finite — a NULL must be rejected on
    // its type, never routed through Number().
    if (typeof row.strokes !== "number" || !Number.isFinite(row.strokes)) continue;
    grossByParticipantId.set(pid, (grossByParticipantId.get(pid) ?? 0) + row.strokes);
    addHole(pid, holeNumber);
  }

  for (const row of pickedUp) {
    const pid = row.participant_id;
    const holeNumber = row.hole_number;
    const hole = holeByNumber.get(holeNumber);
    if (!pid || !hole || typeof hole.par !== "number") continue;
    // A picked-up hole normally has no numeric score, but if the clear ever
    // failed the hole must still be counted exactly once.
    if (holesPlayedByParticipantId.get(pid)?.has(holeNumber)) continue;
    const penalty = netDoubleBogeyGross(
      hole.par,
      courseHandicapByParticipantId?.get(pid) ?? null,
      hole.stroke_index,
      holeCount || 18
    );
    grossByParticipantId.set(pid, (grossByParticipantId.get(pid) ?? 0) + penalty);
    addHole(pid, holeNumber);
  }

  return { grossByParticipantId, holesPlayedByParticipantId };
}
