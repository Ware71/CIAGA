// lib/stats/projectionView.ts
//
// Pure presentation logic for Stats › Projections — extracted from the page so
// it can be tested. Everything here answers the same question in different
// forms: given a projection, what are we entitled to tell the user, and what
// must we refuse to say?
//
// The governing rule is that a number is either correct or absent. Where the
// evidence does not support an answer we return a reason, not a hedge, and the
// page renders the reason.

import { formatHI } from "@/lib/rounds/handicapUtils";
import { addDays, isoLocal, round1, startOfLocalDay } from "@/lib/stats/chartMath";
import { dayIndexFromISO, isoFromDayIndex } from "@/lib/whs/handicapIndex";
import type { Projection, ProjectionConfidence } from "@/lib/stats/projection/simulate";

/** Simulated horizon. Nothing outside it gets an answer. */
export const HORIZON_DAYS = 730;

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export type Readiness = {
  /** Mirrors the projection status, which is driven by accepted-round count. */
  level: Projection["status"];
  headline: string;
  detail: string | null;
  /** Whether the fan / probabilities / ETA may be shown at all. */
  canProject: boolean;
};

/**
 * What the page may show for this player.
 *
 * The levels are deliberately distinct because they call for different
 * responses. "No rounds", "not enough for an index", "enough for an index but
 * not for a distribution" and "projectable" are four different facts; the old
 * page reported all of them as "Not enough data", including for players with
 * three years of history whose handicap simply was not trending down.
 */
export function readiness(p: Projection): Readiness {
  switch (p.status) {
    case "no_data":
      return {
        level: p.status,
        headline: "No rounds yet",
        detail: "Post your first round to start your handicap.",
        canProject: false,
      };
    case "pre_index":
      return {
        level: p.status,
        headline: "Almost there",
        detail: `You need ${3 - p.diagnostics.sampleSize} more round${
          3 - p.diagnostics.sampleSize === 1 ? "" : "s"
        } before you have a Handicap Index.`,
        canProject: false,
      };
    case "mechanical":
      return {
        level: p.status,
        headline: "Too few rounds to forecast",
        detail:
          "With under 8 accepted rounds there isn't enough to measure how much your scoring varies, so a projection would be guesswork. What your next round does is shown below — that part is exact.",
        canProject: false,
      };
    default:
      return { level: p.status, headline: "", detail: null, canProject: true };
  }
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export type Confidence = { level: ProjectionConfidence; reason: string };

/** Why the projection carries the weight it does. */
export function confidenceOf(p: Projection): Confidence {
  const d = p.diagnostics;

  if (d.cadenceMethod === "prior") {
    return { level: p.confidence, reason: "We don't know how often you play yet." };
  }
  if (d.dormancyDays > 120) {
    return {
      level: p.confidence,
      reason: `No rounds posted for ${Math.round(d.dormancyDays)} days — this assumes you start playing again.`,
    };
  }
  if (p.confidence === "high") {
    return {
      level: p.confidence,
      reason: `${d.sampleSize} accepted rounds, about ${Math.round(d.roundsPerYear)} a year.`,
    };
  }
  if (p.confidence === "medium") {
    return { level: p.confidence, reason: `${d.sampleSize} accepted rounds.` };
  }
  return { level: p.confidence, reason: `Only ${d.sampleSize} accepted rounds.` };
}

// ---------------------------------------------------------------------------
// Goal
// ---------------------------------------------------------------------------

export type GoalOutlook = {
  /** Probability of touching the target at any point before the date, 0–1. */
  probability: number | null;
  /** Median days to first reach it, when more than half the paths get there. */
  medianDays: number | null;
  medianDateISO: string | null;
  /** 80% interval on the arrival date, when both ends are defined. */
  earliestISO: string | null;
  latestISO: string | null;
  note: string;
  reached: boolean;
};

/**
 * Outlook for a target Handicap Index.
 *
 * Reports a PROBABILITY and an interval rather than a single date. The date the
 * old page printed was the exact instant a fitted curve crossed a line — a
 * quantity with no uncertainty attached and no chance of being right.
 */
export function goalOutlook(
  p: Projection,
  targetHi: number,
  byDateISO: string,
  today: Date
): GoalOutlook {
  const empty: GoalOutlook = {
    probability: null,
    medianDays: null,
    medianDateISO: null,
    earliestISO: null,
    latestISO: null,
    note: "",
    reached: false,
  };

  if (p.currentHi !== null && p.currentHi <= targetHi) {
    return { ...empty, reached: true, probability: 1, note: "Already at or below target" };
  }
  if (!readiness(p).canProject) {
    return { ...empty, note: readiness(p).detail ?? "Not enough rounds to project" };
  }

  const probability = p.probReachBy(targetHi, byDateISO);
  const eta = p.etaDistribution(targetHi);
  const todayIdx = dayIndexFromISO(isoLocal(startOfLocalDay(today)));

  if (probability === null) {
    return { ...empty, note: `Beyond the ${Math.round(HORIZON_DAYS / 365)}-year projection horizon` };
  }

  if (eta.probEver < 0.05) {
    return {
      ...empty,
      probability,
      note: "Not reachable within 2 years at your current scoring",
    };
  }

  return {
    probability,
    medianDays: eta.p50Days,
    medianDateISO: eta.p50Days === null ? null : isoFromDayIndex(todayIdx + eta.p50Days),
    earliestISO: eta.p10Days === null ? null : isoFromDayIndex(todayIdx + eta.p10Days),
    latestISO: eta.p90Days === null ? null : isoFromDayIndex(todayIdx + eta.p90Days),
    note:
      eta.p50Days === null
        ? `Fewer than half of simulated futures get there within 2 years`
        : "",
    reached: false,
  };
}

// ---------------------------------------------------------------------------
// Projected HI and the realistic floor
// ---------------------------------------------------------------------------

export type RangeValue = {
  p50: number | null;
  p10: number | null;
  p90: number | null;
  note: string;
};

export function projectedHiOn(p: Projection, dateISO: string): RangeValue {
  const r = readiness(p);
  if (!r.canProject) return { p50: null, p10: null, p90: null, note: r.detail ?? "" };

  const q = p.hiAtDate(dateISO);
  if (!q) {
    return {
      p50: null,
      p10: null,
      p90: null,
      note: `Beyond the ${Math.round(HORIZON_DAYS / 365)}-year projection horizon`,
    };
  }
  return { p50: round1(q.p50), p10: round1(q.p10), p90: round1(q.p90), note: "" };
}

/**
 * Where the index settles if the player keeps playing at their current
 * standard — the terminal distribution of the simulation.
 *
 * Unlike the old "potential floor", this is not a curve's asymptote. It is the
 * best-8-of-20 mean of the player's own scoring distribution, which is a real
 * property of how they play.
 */
export function realisticFloor(p: Projection): RangeValue {
  const r = readiness(p);
  if (!r.canProject || !p.realisticFloor) {
    return { p50: null, p10: null, p90: null, note: r.detail ?? "" };
  }
  return {
    p50: round1(p.realisticFloor.p50),
    p10: round1(p.realisticFloor.p10),
    p90: round1(p.realisticFloor.p90),
    note: "",
  };
}

// ---------------------------------------------------------------------------
// Direction
// ---------------------------------------------------------------------------

export type Direction = "Improving" | "Holding" | "Slipping";

/**
 * Direction from the model's own fitted trend, and only when that trend cleared
 * the significance gate. A player whose apparent slope is indistinguishable from
 * noise is "Holding" — the old page called them "Improving" off a 60-day linear
 * slope anchored to their last round, which kept describing players who had
 * stopped playing months earlier.
 */
export function directionOf(p: Projection): Direction | null {
  const d = p.diagnostics;
  if (d.sampleSize < 3) return null;
  if (!d.trendApplied || d.trendPerRound === null) return "Holding";
  // Index 0 is the newest round, so a positive slope means older rounds scored
  // higher — the player is improving.
  return d.trendPerRound > 0 ? "Improving" : "Slipping";
}

/** Expected change per round from the fitted trend, in strokes. Null when none. */
export function trendPerRoundLabel(p: Projection): string | null {
  const d = p.diagnostics;
  if (!d.trendApplied || d.trendPerRound === null) return null;
  const perRound = -d.trendPerRound; // forward direction
  const sign = perRound < 0 ? "−" : "+";
  return `${sign}${Math.abs(perRound).toFixed(2)}/round`;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "HI 12.3" / "HI +1.2" for a plus handicap / "—" when absent. */
export function hiLabel(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `HI ${formatHI(round1(v))}`;
}

/** Bare index, no prefix: "12.3" / "+1.2" / "—". */
export function hiValue(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return formatHI(round1(v));
}

/** "68%" — rounded to whole percent, with the extremes kept honest. */
export function percentLabel(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return "—";
  if (p > 0 && p < 0.005) return "<1%";
  if (p < 1 && p > 0.995) return ">99%";
  return `${Math.round(p * 100)}%`;
}

/** "in 4 months" / "in 12 days" — a duration a golfer would actually say. */
export function horizonLabel(days: number | null): string | null {
  if (days === null || !Number.isFinite(days)) return null;
  if (days <= 0) return "now";
  if (days < 45) return `in ${Math.round(days)} days`;
  const months = Math.round(days / 30);
  if (months < 24) return `in ${months} month${months === 1 ? "" : "s"}`;
  return `in ${(days / 365).toFixed(1)} years`;
}

/** Clamp a chosen date into the simulated horizon. */
export function clampToHorizon(dateISO: string, today: Date): string {
  const todayIdx = dayIndexFromISO(isoLocal(startOfLocalDay(today)));
  const want = dayIndexFromISO(dateISO);
  return isoFromDayIndex(Math.min(Math.max(want, todayIdx), todayIdx + HORIZON_DAYS));
}

/** Default projection date: a month out. */
export function defaultProjectionDate(today: Date): string {
  return isoLocal(addDays(today, 30));
}
