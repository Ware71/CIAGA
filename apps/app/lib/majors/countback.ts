import type { CountbackResult, CountbackBreakdown } from "./types";
import { strokesReceivedOnHole } from "@/lib/rounds/handicapUtils";

type HoleScore = {
  hole_number: number;
  strokes: number;
  par: number;
  stroke_index: number;
  course_handicap: number;
};

type PlayerHoles = {
  profile_id: string;
  holes: HoleScore[];
  total_holes: number;  // 9 or 18
};

/**
 * Countback sequence as specified:
 * Last 9 → Last 6 → Last 3 → Final hole
 * → Holes 4-9 → Holes 7-9 → Hole 9
 */
const COUNTBACK_STEPS_18: Array<{ label: string; range: string; from: number; to: number }> = [
  { label: "Last 9",   range: "10-18", from: 10, to: 18 },
  { label: "Last 6",   range: "13-18", from: 13, to: 18 },
  { label: "Last 3",   range: "16-18", from: 16, to: 18 },
  { label: "Last hole", range: "18",   from: 18, to: 18 },
  { label: "Holes 4-9", range: "4-9",  from: 4,  to: 9  },
  { label: "Holes 7-9", range: "7-9",  from: 7,  to: 9  },
  { label: "Hole 9",    range: "9",    from: 9,  to: 9  },
];

const COUNTBACK_STEPS_9: Array<{ label: string; range: string; from: number; to: number }> = [
  { label: "Last 5",   range: "5-9",  from: 5, to: 9 },
  { label: "Last 3",   range: "7-9",  from: 7, to: 9 },
  { label: "Last hole", range: "9",   from: 9, to: 9 },
  { label: "Holes 4-6", range: "4-6", from: 4, to: 6 },
  { label: "Hole 6",    range: "6",   from: 6, to: 6 },
];

function scoreForRange(
  holes: HoleScore[],
  from: number,
  to: number,
  scoringModel: string,
): number | null {
  const inRange = holes.filter((h) => h.hole_number >= from && h.hole_number <= to);
  if (inRange.length === 0) return null;

  let total = 0;
  for (const h of inRange) {
    if (scoringModel === "gross") {
      total += h.strokes;
    } else if (scoringModel === "net") {
      const recv = strokesReceivedOnHole(h.course_handicap, h.stroke_index, holes.length === 9 ? 9 : 18);
      total += h.strokes - recv;
    } else {
      // stableford_points: higher is better — sum stableford points
      const recv = strokesReceivedOnHole(h.course_handicap, h.stroke_index, holes.length === 9 ? 9 : 18);
      const net = h.strokes - recv;
      const pts = Math.max(0, 2 - (net - h.par));
      total += pts;
    }
  }
  return total;
}

function narrowTied(
  remaining: string[],
  scores: Record<string, number | null>,
  higherIsBetter: boolean,
): string[] {
  const valid = remaining.filter((id) => scores[id] != null);
  if (valid.length === 0) return remaining;

  const best = valid.reduce<number>((acc, id) => {
    const s = scores[id]!;
    return higherIsBetter ? Math.max(acc, s) : Math.min(acc, s);
  }, higherIsBetter ? -Infinity : Infinity);

  return valid.filter((id) => scores[id] === best);
}

export function computeCountback(
  playerHoles: PlayerHoles[],
  scoringModel: "gross" | "net" | "stableford_points",
): CountbackResult {
  if (playerHoles.length === 0) {
    return { winner_profile_id: null, step_resolved: null, final_positions: [], breakdown: [] };
  }

  const higherIsBetter = scoringModel === "stableford_points";
  const steps = playerHoles[0].total_holes === 9 ? COUNTBACK_STEPS_9 : COUNTBACK_STEPS_18;
  const breakdown: CountbackBreakdown[] = [];

  let remaining = playerHoles.map((p) => p.profile_id);
  let stepResolved: string | null = null;

  for (const step of steps) {
    if (remaining.length <= 1) break;

    const scores: Record<string, number | null> = {};
    for (const p of playerHoles) {
      if (!remaining.includes(p.profile_id)) continue;
      scores[p.profile_id] = scoreForRange(p.holes, step.from, step.to, scoringModel);
    }

    breakdown.push({
      step: step.label,
      holeRange: step.range,
      scores,
      resolvedAt: false,
    });

    const narrowed = narrowTied(remaining, scores, higherIsBetter);
    if (narrowed.length < remaining.length) {
      remaining = narrowed;
      breakdown[breakdown.length - 1].resolvedAt = true;
      stepResolved = step.label;
    }
  }

  const winner = remaining.length === 1 ? remaining[0] : null;

  // Build final positions: winner = 1, rest keep shared 2nd (T2)
  const allIds = playerHoles.map((p) => p.profile_id);
  const final_positions = allIds.map((id) => ({
    profile_id: id,
    position: id === winner ? 1 : 2,
  }));

  return {
    winner_profile_id: winner,
    step_resolved: stepResolved,
    final_positions,
    breakdown,
  };
}
