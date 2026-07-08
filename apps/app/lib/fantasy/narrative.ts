import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mulberry32, hashSeed } from "@/lib/fantasy/simulation/rng";
// Type-only: a value import would make odds.ts ↔ narrative.ts circular.
import type { EventSimContext } from "@/lib/fantasy/odds";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";
import type { RecentRound, StoredFantasyProfile } from "@/lib/fantasy/profiles";

/**
 * Narrative engine — the auto-written overview at the top of the market page.
 *
 * Two stages so every event's preview feels unique:
 *  1. Candidate generation: each extractor scans the sim + stored profiles and
 *     emits zero-or-more scored insight candidates (many permutations exist).
 *  2. Selection + composition: rank by interestingness, enforce variety (max
 *     one insight per player), keep the top few, and phrase each through
 *     templates chosen by a seeded RNG (event + version → stable text per
 *     refresh, different texture across events).
 *
 * Deterministic, no LLM. Add an angle by writing one extractor function.
 */

export type NarrativeInputs = {
  eventName: string;
  courseName: string | null;
  scoringModel: string | null;
  rankingBasis: "gross" | "net";
  allowance: number;
  numRounds: number;
  players: {
    profileId: string;
    name: string;
    playingHandicap: number;
    winProb: number;
    meanGross: number;
    meanNet: number;
    sampleSize: number;
    scoreStddev: number | null;
    recentForm: number | null;
    recentRounds: RecentRound[] | null;
  }[];
};

type Candidate = {
  /** Higher = more insightful; the setup line is composed separately. */
  score: number;
  /** At most one candidate per player survives selection. */
  profileId: string | null;
  /** Phrasing variants — the seeded RNG picks one. */
  templates: string[];
};

const MAX_INSIGHTS = 3;

function firstName(full: string): string {
  return full.split(" ")[0] || full;
}

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length) % arr.length];
}

// ── Extractors ────────────────────────────────────────────────────────────

function favouriteAngle(inputs: NarrativeInputs): Candidate[] {
  const sorted = [...inputs.players].sort((a, b) => b.winProb - a.winProb);
  const fav = sorted[0];
  const second = sorted[1];
  if (!fav || !second) return [];
  const gap = fav.winProb - second.winProb;
  if (fav.winProb >= 0.28 && gap >= 0.08) {
    const pctStr = `${Math.round(fav.winProb * 100)}%`;
    return [
      {
        score: 40 + gap * 100,
        profileId: fav.profileId,
        templates: [
          `${fav.name} heads the market at ${pctStr} to win.`,
          `The simulation makes ${fav.name} the one to beat (${pctStr}).`,
          `All eyes on ${fav.name}, the clear market leader at ${pctStr}.`,
        ],
      },
    ];
  }
  if (fav.winProb < 0.2 && inputs.players.length >= 6) {
    return [
      {
        score: 35,
        profileId: null,
        templates: [
          `No standout favourite — this one is wide open.`,
          `The market can't split this field; anyone's event.`,
        ],
      },
    ];
  }
  return [];
}

function formStreakAngle(inputs: NarrativeInputs): Candidate[] {
  const out: Candidate[] = [];
  for (const p of inputs.players) {
    if (p.recentForm == null || (p.recentRounds?.length ?? 0) < 3) continue;
    const magnitude = Math.abs(p.recentForm);
    if (magnitude < 1.5) continue;
    const lastThree = (p.recentRounds ?? [])
      .slice(0, 3)
      .map((r) => Math.round(r.gross18))
      .join(", ");
    const improving = p.recentForm < 0;
    out.push({
      score: 20 + magnitude * 6,
      profileId: p.profileId,
      templates: improving
        ? [
            `${p.name} arrives in form, going ${lastThree} in the last three.`,
            `${firstName(p.name)} is trending the right way — ${lastThree} recently.`,
          ]
        : [
            `${p.name} has been scratchy lately (${lastThree}).`,
            `Form is a worry for ${firstName(p.name)} — ${lastThree} in the last three.`,
          ],
    });
  }
  return out;
}

function birdieRunAngle(inputs: NarrativeInputs): Candidate[] {
  const out: Candidate[] = [];
  for (const p of inputs.players) {
    const last4 = (p.recentRounds ?? []).slice(0, 4);
    if (last4.length < 3) continue;
    const birdies = last4.reduce((s, r) => s + r.birdies, 0);
    if (birdies < 5) continue;
    out.push({
      score: 15 + birdies * 3,
      profileId: p.profileId,
      templates: [
        `${p.name} is heating up with ${birdies} birdies in his last ${last4.length} rounds.`,
        `${firstName(p.name)}'s putter is hot: ${birdies} birdies across the last ${last4.length}.`,
      ],
    });
  }
  return out;
}

function courseAngle(inputs: NarrativeInputs, courseId: string | null): Candidate[] {
  if (!courseId || !inputs.courseName) return [];
  const out: Candidate[] = [];
  for (const p of inputs.players) {
    const here = (p.recentRounds ?? []).filter((r) => r.courseId === courseId);
    if (here.length < 2) continue;
    const best = Math.min(...here.map((r) => r.gross18));
    const avgHere = here.reduce((s, r) => s + r.gross18, 0) / here.length;
    const avgAll =
      (p.recentRounds ?? []).reduce((s, r) => s + r.gross18, 0) / (p.recentRounds?.length ?? 1);
    const delta = avgHere - avgAll;
    if (delta <= -2) {
      out.push({
        score: 18 + Math.abs(delta) * 4,
        profileId: p.profileId,
        templates: [
          `${p.name} loves it at ${inputs.courseName} — best of ${Math.round(best)} there recently.`,
          `${inputs.courseName} suits ${firstName(p.name)}, who averages ${Math.round(avgHere)} on it.`,
        ],
      });
    } else if (delta >= 3) {
      out.push({
        score: 16 + delta * 4,
        profileId: p.profileId,
        templates: [
          `${p.name} has struggled at ${inputs.courseName}, averaging ${Math.round(avgHere)} there.`,
          `${inputs.courseName} hasn't been kind to ${firstName(p.name)} so far.`,
        ],
      });
    }
  }
  return out;
}

function volatilityAngle(inputs: NarrativeInputs): Candidate[] {
  const out: Candidate[] = [];
  for (const p of inputs.players) {
    if (p.scoreStddev == null || p.scoreStddev < 6) continue;
    out.push({
      score: 8 + p.scoreStddev,
      profileId: p.profileId,
      templates: [
        `${p.name} could shoot anything — his last rounds swing by ${Math.round(p.scoreStddev)}+ shots.`,
        `Boom or bust for ${firstName(p.name)}; expect the unexpected.`,
      ],
    });
  }
  return out;
}

function debutantAngle(inputs: NarrativeInputs): Candidate[] {
  const debs = inputs.players.filter((p) => p.sampleSize === 0);
  if (debs.length === 0) return [];
  const names = debs.map((d) => d.name);
  const label = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return [
    {
      score: 12 + debs.length * 2,
      profileId: debs[0].profileId,
      templates: [
        `${label} ${debs.length === 1 ? "makes" : "make"} a group debut — priced off handicap until the data lands.`,
        `Watch the newcomer${debs.length > 1 ? "s" : ""}: ${label} carr${debs.length === 1 ? "ies" : "y"} handicap-based odds only.`,
      ],
    },
  ];
}

function tightRaceAngle(inputs: NarrativeInputs): Candidate[] {
  const basis = inputs.rankingBasis;
  const sorted = [...inputs.players].sort((a, b) =>
    basis === "gross" ? a.meanGross - b.meanGross : a.meanNet - b.meanNet
  );
  if (sorted.length < 2) return [];
  const [a, b] = sorted;
  const gap = Math.abs(
    basis === "gross" ? a.meanGross - b.meanGross : a.meanNet - b.meanNet
  );
  if (gap > 0.8) return [];
  return [
    {
      score: 22,
      profileId: null,
      templates: [
        `${a.name} and ${b.name} project within a stroke of each other at the top.`,
        `Barely a shot separates ${firstName(a.name)} and ${firstName(b.name)} in the projections.`,
      ],
    },
  ];
}

// ── Composition ───────────────────────────────────────────────────────────

function setupLine(inputs: NarrativeInputs, rand: () => number): string {
  const format =
    inputs.scoringModel === "stableford_points"
      ? "stableford"
      : inputs.rankingBasis === "gross"
      ? "gross strokeplay"
      : inputs.allowance !== 100 && inputs.allowance > 0
      ? `${inputs.allowance}% strokeplay`
      : "strokeplay";
  const where = inputs.courseName ? ` at ${inputs.courseName}` : "";
  const rounds = inputs.numRounds > 1 ? ` over ${inputs.numRounds} rounds` : "";
  const field = `${inputs.players.length} players`;
  return pick(rand, [
    `A ${format} battle${rounds}${where} with ${field} in the field.`,
    `${field} tee it up for ${format}${rounds}${where}.`,
    `This is ${format}${rounds}${where} — ${field} entered.`,
  ]);
}

export function composeNarrative(
  inputs: NarrativeInputs,
  courseId: string | null,
  seed: number
): string {
  const rand = mulberry32(seed);

  const candidates: Candidate[] = [
    ...favouriteAngle(inputs),
    ...formStreakAngle(inputs),
    ...birdieRunAngle(inputs),
    ...courseAngle(inputs, courseId),
    ...volatilityAngle(inputs),
    ...debutantAngle(inputs),
    ...tightRaceAngle(inputs),
  ];

  // Rank by insightfulness with a hair of seeded jitter so equal-score
  // candidates rotate between refreshes/events; then enforce one per player.
  candidates.sort((a, b) => b.score + rand() * 0.5 - (a.score + rand() * 0.5));
  const seen = new Set<string>();
  const chosen: Candidate[] = [];
  for (const c of candidates) {
    if (c.profileId && seen.has(c.profileId)) continue;
    if (c.profileId) seen.add(c.profileId);
    chosen.push(c);
    if (chosen.length >= MAX_INSIGHTS) break;
  }

  const sentences = [setupLine(inputs, rand), ...chosen.map((c) => pick(rand, c.templates))];
  return sentences.join(" ");
}

/** Assemble inputs from a sim run and write-ready narrative text. */
export async function generateNarrative(
  ctx: EventSimContext,
  sim: SimulationResult,
  version: number,
  allowance: number
): Promise<string> {
  let courseName: string | null = null;
  if (ctx.event.course_id) {
    const { data } = await supabaseAdmin
      .from("courses")
      .select("name")
      .eq("id", ctx.event.course_id)
      .maybeSingle();
    courseName = (data as { name: string | null } | null)?.name ?? null;
  }

  const { data: profRows } = await supabaseAdmin
    .from("fantasy_player_profiles")
    .select("profile_id, sample_size, score_stddev, recent_form, recent_rounds")
    .eq("group_id", ctx.groupId)
    .in("profile_id", ctx.players.map((p) => p.profileId));
  const stored = new Map(
    ((profRows ?? []) as Pick<
      StoredFantasyProfile,
      "profile_id" | "sample_size" | "score_stddev" | "recent_form" | "recent_rounds"
    >[]).map((r) => [r.profile_id, r])
  );

  const inputs: NarrativeInputs = {
    eventName: ctx.event.name,
    courseName,
    scoringModel: ctx.event.scoring_model,
    rankingBasis: ctx.rankingBasis,
    allowance,
    numRounds: ctx.event.num_rounds ?? 1,
    players: ctx.players.map((p) => {
      const res = sim.players[sim.playerIndex[p.profileId]];
      const row = stored.get(p.profileId);
      return {
        profileId: p.profileId,
        name: p.displayName,
        playingHandicap: p.playingHandicap,
        winProb: res?.winProb ?? 0,
        meanGross: res?.meanGross ?? 0,
        meanNet: res?.meanNet ?? 0,
        sampleSize: row?.sample_size ?? 0,
        scoreStddev: row?.score_stddev != null ? Number(row.score_stddev) : null,
        recentForm: row?.recent_form != null ? Number(row.recent_form) : null,
        recentRounds: row?.recent_rounds ?? null,
      };
    }),
  };

  return composeNarrative(inputs, ctx.event.course_id, hashSeed(ctx.event.id, version));
}
