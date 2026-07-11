import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mulberry32, hashSeed } from "@/lib/fantasy/simulation/rng";
// Type-only: a value import would make odds.ts ↔ narrative.ts circular.
import type { EventSimContext } from "@/lib/fantasy/odds";
import type { SimulationResult } from "@/lib/fantasy/simulation/types";
import type { RecentRound, StoredFantasyProfile } from "@/lib/fantasy/profiles";

/**
 * Narrative engine — the auto-written overview at the top of the market page
 * (and a truncated snippet on the group events coupon).
 *
 * Two stages so every event's preview feels unique:
 *  1. Candidate generation: each extractor scans the sim + stored profiles +
 *     season/history context and emits zero-or-more scored insight candidates.
 *  2. Selection + composition: rank by interestingness, enforce variety (max
 *     one insight per player), keep the top few, and phrase each through
 *     templates chosen by a seeded RNG (event + version → stable text per
 *     refresh, different texture across events).
 *
 * Deterministic, no LLM. Add an angle by writing one extractor function and
 * registering it in `composeNarrative`. Season/defending-champion angles guard
 * for missing linkage (one-off / untagged events) exactly like the profile
 * angles guard for missing data.
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
    // Optional season/history context — absent (undefined/null) ⇒ the matching
    // angle simply skips, so existing callers/fixtures need not set these.
    avgGross?: number | null;
    /** Recent handicap-index movement (latest − earliest in window); < 0 = cut. */
    handicapDelta?: number | null;
    seasonPoints?: number | null;
    seasonPosition?: number | null;
    /** Points behind the season leader (0 for the leader). */
    pointsToLeader?: number | null;
    isSeasonLeader?: boolean;
    /** Leader only: points clear of second place. */
    leadMargin?: number | null;
    isDefendingEventChampion?: boolean;
    isDefendingSeasonChampion?: boolean;
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

const MAX_INSIGHTS = 4;

// Angle thresholds — tunable in one place.
const HANDICAP_MOVE_MIN = 1.0; // strokes of index movement to be worth a mention
const COMEBACK_MIN_POSITION = 4; // "trailing" starts outside the top three
const COMEBACK_FORM = -1.5; // recent_form this negative = genuinely hot
const CHASE_MAX_POSITION = 3; // "chasing" is a top-three challenger…
const CHASE_REL_GAP = 0.12; // …within 12% of the leader's points
const CONSISTENCY_MAX_STDDEV = 2.5;
const CONSISTENCY_MIN_SAMPLE = 8;
const EXCEPTIONAL_STDDEV_BELOW = 1.5; // a best round this many σ under the mean

function firstName(full: string): string {
  return full.split(" ")[0] || full;
}

function pick<T>(rand: () => number, arr: T[]): T {
  return arr[Math.floor(rand() * arr.length) % arr.length];
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

// ── Extractors ────────────────────────────────────────────────────────────

function favouriteAngle(inputs: NarrativeInputs): Candidate[] {
  const sorted = [...inputs.players].sort((a, b) => b.winProb - a.winProb);
  const fav = sorted[0];
  const second = sorted[1];
  if (!fav || !second) return [];
  const gap = fav.winProb - second.winProb;
  if (fav.winProb >= 0.28 && gap >= 0.08) {
    const pct = `${Math.round(fav.winProb * 100)}%`;
    return [
      {
        score: 40 + gap * 100,
        profileId: fav.profileId,
        templates: [
          `${fav.name} heads the market at ${pct} to win.`,
          `The sim makes ${fav.name} the one to beat — ${pct} to lift it.`,
          `All eyes on ${fav.name}, clear market leader at ${pct}.`,
          `${fav.name} is the standout, priced ${pct} to take it.`,
          `Hard to look past ${fav.name} here (${pct}).`,
          `${firstName(fav.name)} tops the board at ${pct}; the field is chasing.`,
          `${pct} says it all — ${fav.name} is the play to win.`,
          `The numbers love ${fav.name}, out on his own at ${pct}.`,
          `${fav.name} carries favouritism into this one at ${pct}.`,
          `Beat ${firstName(fav.name)} and you beat the field — ${pct} the leader.`,
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
          `Pick a name out of the hat — there's no clear leader here.`,
          `Wide open at the top, with nothing between the contenders.`,
          `The sim shrugs: no favourite emerges from this field.`,
          `Bunched and unpredictable — this one's up for grabs.`,
          `Not a favourite in sight; the field is level pegging.`,
          `Too close to call — the market backs no one in particular.`,
          `A true lottery, with every name holding a live chance.`,
          `Nobody's a runaway here — the door is open for all.`,
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
    const three = (p.recentRounds ?? [])
      .slice(0, 3)
      .map((r) => Math.round(r.gross18))
      .join(", ");
    const improving = p.recentForm < 0;
    out.push({
      score: 20 + magnitude * 6,
      profileId: p.profileId,
      templates: improving
        ? [
            `${p.name} arrives in form, going ${three} in the last three.`,
            `${firstName(p.name)} is trending the right way — ${three} lately.`,
            `Form horse: ${p.name} has posted ${three} recently.`,
            `${p.name} looks sharp, backing up ${three} of late.`,
            `The graph's pointing up for ${firstName(p.name)} — ${three}.`,
            `${p.name} is peaking at the right time (${three}).`,
            `Recent cards of ${three} have ${firstName(p.name)} bang in form.`,
            `${p.name} brings momentum, with ${three} in the book.`,
            `Watch ${firstName(p.name)}: ${three} says the game is there.`,
            `${p.name} is rolling — ${three} across his last three.`,
          ]
        : [
            `${p.name} has been scratchy lately (${three}).`,
            `Form is a worry for ${firstName(p.name)} — ${three} in the last three.`,
            `${p.name} arrives cold, having gone ${three}.`,
            `Not much going right for ${firstName(p.name)} of late (${three}).`,
            `${p.name} needs to arrest a slide — ${three} recently.`,
            `Recent cards of ${three} leave ${firstName(p.name)} out of touch.`,
            `${p.name} has misfired lately (${three}).`,
            `The form book is against ${firstName(p.name)}: ${three}.`,
            `${p.name} is searching for his game after ${three}.`,
            `Question marks over ${firstName(p.name)} — ${three} in the last three.`,
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
    const n = last4.length;
    out.push({
      score: 15 + birdies * 3,
      profileId: p.profileId,
      templates: [
        `${p.name} is heating up with ${birdies} birdies in his last ${n} rounds.`,
        `${firstName(p.name)}'s putter is hot: ${birdies} birdies across the last ${n}.`,
        `${p.name} has found the birdie trail — ${birdies} in ${n} rounds.`,
        `Plenty of red numbers for ${firstName(p.name)}: ${birdies} birdies of late.`,
        `${p.name} is making birdies for fun (${birdies} in his last ${n}).`,
        `The flatstick is behaving for ${firstName(p.name)} — ${birdies} recent birdies.`,
        `${p.name} racked up ${birdies} birdies over his last ${n} cards.`,
        `Aggressive and rewarded: ${birdies} birdies lately for ${firstName(p.name)}.`,
        `${p.name} keeps rolling them in — ${birdies} birdies in ${n} rounds.`,
        `Birdie machine: ${firstName(p.name)} has ${birdies} in his last ${n}.`,
      ],
    });
  }
  return out;
}

function courseAngle(inputs: NarrativeInputs, courseId: string | null): Candidate[] {
  if (!courseId || !inputs.courseName) return [];
  const course = inputs.courseName;
  const out: Candidate[] = [];
  for (const p of inputs.players) {
    const here = (p.recentRounds ?? []).filter((r) => r.courseId === courseId);
    if (here.length < 2) continue;
    const best = Math.round(Math.min(...here.map((r) => r.gross18)));
    const avgHere = Math.round(here.reduce((s, r) => s + r.gross18, 0) / here.length);
    const avgAll =
      (p.recentRounds ?? []).reduce((s, r) => s + r.gross18, 0) / (p.recentRounds?.length ?? 1);
    const delta = avgHere - avgAll;
    if (delta <= -2) {
      out.push({
        score: 18 + Math.abs(delta) * 4,
        profileId: p.profileId,
        templates: [
          `${p.name} loves it at ${course} — best of ${best} there recently.`,
          `${course} suits ${firstName(p.name)}, who averages ${avgHere} on it.`,
          `Horses for courses: ${p.name} goes well at ${course} (best ${best}).`,
          `${firstName(p.name)} has history at ${course}, averaging ${avgHere}.`,
          `${p.name} feels at home on ${course} — a ${best} in the locker.`,
          `Course form favours ${firstName(p.name)} here (${avgHere} average).`,
          `${p.name} knows the way round ${course}; best of ${best}.`,
          `${course} brings out the best in ${firstName(p.name)} (avg ${avgHere}).`,
          `A happy hunting ground for ${p.name}, who's shot ${best} at ${course}.`,
          `${firstName(p.name)} fancies ${course}, averaging a tidy ${avgHere}.`,
        ],
      });
    } else if (delta >= 3) {
      out.push({
        score: 16 + delta * 4,
        profileId: p.profileId,
        templates: [
          `${p.name} has struggled at ${course}, averaging ${avgHere} there.`,
          `${course} hasn't been kind to ${firstName(p.name)} so far.`,
          `Course history is a concern for ${p.name} here (avg ${avgHere}).`,
          `${firstName(p.name)} can't crack ${course} — ${avgHere} on average.`,
          `${course} has ${firstName(p.name)}'s number, averaging ${avgHere}.`,
          `A bogey course for ${p.name}, who averages ${avgHere} at ${course}.`,
          `${p.name} will want to rewrite his ${course} record (${avgHere}).`,
          `Not a favourite venue for ${firstName(p.name)} — ${avgHere} here.`,
          `${course} has been a puzzle for ${p.name} (avg ${avgHere}).`,
          `${firstName(p.name)} tends to leak shots at ${course} (${avgHere}).`,
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
    const sd = Math.round(p.scoreStddev);
    out.push({
      score: 8 + p.scoreStddev,
      profileId: p.profileId,
      templates: [
        `${p.name} could shoot anything — his rounds swing by ${sd}+ shots.`,
        `Boom or bust for ${firstName(p.name)}; expect the unexpected.`,
        `${p.name} runs hot and cold, with ${sd}-shot swings round to round.`,
        `High variance on ${firstName(p.name)} — brilliant or busy, rarely between.`,
        `${p.name} is a coin-flip; scores bounce around by ${sd}.`,
        `Strap in for ${firstName(p.name)}: a ${sd}-shot spread says anything goes.`,
        `${p.name} can win it or waste it — that's ${sd} shots of volatility.`,
        `Consistency isn't ${firstName(p.name)}'s game (${sd}-shot swings).`,
        `${p.name} is the wildcard, with rounds ranging by ${sd}+.`,
        `Feast or famine for ${firstName(p.name)} — ${sd} shots either way.`,
      ],
    });
  }
  return out;
}

function debutantAngle(inputs: NarrativeInputs): Candidate[] {
  const debs = inputs.players.filter((p) => p.sampleSize === 0);
  if (debs.length === 0) return [];
  const names = debs.map((d) => d.name);
  const label =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const single = debs.length === 1;
  return [
    {
      score: 12 + debs.length * 2,
      profileId: debs[0].profileId,
      templates: single
        ? [
            `${label} makes a group debut — priced off handicap until the data lands.`,
            `Newcomer alert: ${label} carries handicap-based odds only for now.`,
            `${label} is an unknown quantity here, priced purely off the handicap.`,
            `No group history for ${label} yet — the model leans on the handicap.`,
            `${label} steps in for the first time; odds are handicap-driven until we learn more.`,
            `First appearance for ${label}, so the price is all handicap.`,
            `${label} debuts with no data behind him — the handicap sets the number.`,
            `Keep an eye on debutant ${label}, priced off the mark alone.`,
            `${label} is a fresh face; expect the odds to move once he's played.`,
            `Until ${label} posts a card, the handicap does the pricing.`,
          ]
        : [
            `${label} make group debuts — priced off handicap until the data lands.`,
            `New faces ${label} carry handicap-based odds only for now.`,
            `${label} are unknown quantities here, priced purely off handicaps.`,
            `No group history for ${label} yet — the model leans on handicaps.`,
            `${label} step in for the first time; odds are handicap-driven until we learn more.`,
            `First appearances for ${label}, so the prices are all handicap.`,
            `${label} debut with no data behind them — handicaps set the numbers.`,
            `Keep an eye on debutants ${label}, priced off the mark alone.`,
            `${label} are fresh faces; expect the odds to move once they've played.`,
            `Until ${label} post cards, the handicaps do the pricing.`,
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
  const gap = Math.abs(basis === "gross" ? a.meanGross - b.meanGross : a.meanNet - b.meanNet);
  if (gap > 0.8) return [];
  return [
    {
      score: 22,
      profileId: null,
      templates: [
        `${a.name} and ${b.name} project within a stroke of each other at the top.`,
        `Barely a shot separates ${firstName(a.name)} and ${firstName(b.name)} in the projections.`,
        `${a.name} vs ${b.name} looks a two-horse race, and a tight one.`,
        `Nothing in it up top: ${firstName(a.name)} and ${firstName(b.name)} are neck and neck.`,
        `The projections have ${a.name} and ${b.name} locked together.`,
        `A stroke or less between ${firstName(a.name)} and ${firstName(b.name)} — this could go the distance.`,
        `${a.name} and ${b.name} are inseparable on the numbers.`,
        `Expect a duel: ${firstName(a.name)} and ${firstName(b.name)} project dead level.`,
        `The model can't separate ${a.name} and ${b.name} at the sharp end.`,
        `${firstName(a.name)} and ${firstName(b.name)} are set for a shootout, a shot apart.`,
      ],
    },
  ];
}

function handicapMoveAngle(inputs: NarrativeInputs): Candidate[] {
  const out: Candidate[] = [];
  for (const p of inputs.players) {
    const d = p.handicapDelta;
    if (d == null || Math.abs(d) < HANDICAP_MOVE_MIN) continue;
    const mag = Math.abs(d);
    const magStr = `${mag.toFixed(1)} shots`;
    const cut = d < 0; // index fell → improving
    out.push({
      score: cut ? 26 + mag * 5 : 18 + mag * 4,
      profileId: p.profileId,
      templates: cut
        ? [
            `${p.name} has been cut ${magStr} lately — the handicapper's noticed.`,
            `${firstName(p.name)}'s handicap is tumbling, down ${magStr} recently.`,
            `${p.name} is playing off a lower mark, ${magStr} sharper than before.`,
            `The cut's come for ${firstName(p.name)}: ${magStr} off the index.`,
            `${p.name} keeps getting cut — ${magStr} lower and still trending down.`,
            `Improving fast, ${firstName(p.name)} has shed ${magStr} from his index.`,
            `${p.name}'s index has dropped ${magStr}; the game is clearly there.`,
            `Handicap on the slide for ${firstName(p.name)} — ${magStr} recently.`,
            `${p.name} is in form off the course too, cut ${magStr}.`,
            `Watch ${firstName(p.name)}: ${magStr} of cuts says he's getting better.`,
          ]
        : [
            `${p.name}'s handicap has drifted up ${magStr} of late.`,
            `${firstName(p.name)} is heading the wrong way — up ${magStr} on the index.`,
            `${p.name} has been handed ${magStr} back, the game a touch off.`,
            `The index has risen ${magStr} for ${firstName(p.name)} recently.`,
            `${p.name} is playing off a higher mark, ${magStr} adrift of before.`,
            `Form off the course too for ${firstName(p.name)}: up ${magStr}.`,
            `${p.name}'s handicap has crept up ${magStr}; work to do.`,
            `${firstName(p.name)} has lost ${magStr} to the handicapper of late.`,
            `${p.name} is trending up ${magStr} — the sharpness has dipped.`,
            `A softer mark for ${firstName(p.name)} now, ${magStr} higher.`,
          ],
    });
  }
  return out;
}

function seasonLeadAngle(inputs: NarrativeInputs): Candidate[] {
  const out: Candidate[] = [];
  for (const p of inputs.players) {
    if (!p.isSeasonLeader || p.seasonPoints == null) continue;
    const ptsStr = `${Math.round(p.seasonPoints)} pts`;
    const margin = p.leadMargin ?? 0;
    const leadStr = margin > 0 ? `${Math.round(margin)} points clear` : `level at the top`;
    out.push({
      score: 30 + Math.min(margin, 30) * 0.3,
      profileId: p.profileId,
      templates: [
        `${p.name} tops the season standings — ${leadStr}, ${ptsStr}.`,
        `Season leader ${firstName(p.name)} arrives ${leadStr} (${ptsStr}).`,
        `${p.name} leads the race, ${leadStr} with ${ptsStr} banked.`,
        `Standings pacesetter ${firstName(p.name)} is ${leadStr}.`,
        `${p.name} heads the table on ${ptsStr}, ${leadStr}.`,
        `Out in front all season, ${firstName(p.name)} is ${leadStr}.`,
        `${p.name} defends top spot, ${leadStr} on ${ptsStr}.`,
        `The man to catch is ${firstName(p.name)}, ${leadStr} in the standings.`,
        `${p.name} carries the season lead into this one (${ptsStr}, ${leadStr}).`,
        `${firstName(p.name)} sits atop the standings, ${leadStr}.`,
      ],
    });
  }
  return out;
}

function seasonComebackAngle(inputs: NarrativeInputs): Candidate[] {
  const out: Candidate[] = [];
  for (const p of inputs.players) {
    if (p.seasonPosition == null || p.seasonPosition < COMEBACK_MIN_POSITION) continue;
    if (p.recentForm == null || p.recentForm > COMEBACK_FORM) continue;
    const posStr = ordinal(p.seasonPosition);
    const gapStr = `${Math.round(p.pointsToLeader ?? 0)} pts`;
    out.push({
      score: 22 + Math.abs(p.recentForm) * 3 + Math.min(p.seasonPosition, 10) * 0.5,
      profileId: p.profileId,
      templates: [
        `Down in ${posStr} but red-hot — ${p.name} has the form to charge up the table.`,
        `${firstName(p.name)} is ${gapStr} off the lead, and arriving in form to close it.`,
        `Written off in ${posStr}? ${p.name}'s recent form says think again.`,
        `${p.name} is the comeback pick — ${posStr} in the standings but flying.`,
        `Form makes ${firstName(p.name)} dangerous despite sitting ${posStr}.`,
        `${p.name} could ignite a season revival from ${posStr}.`,
        `${gapStr} back but full of running, ${firstName(p.name)} is one to watch.`,
        `A big result here would launch ${p.name}'s climb from ${posStr}.`,
        `${firstName(p.name)} has the game right now to eat into that ${gapStr} gap.`,
        `Don't sleep on ${p.name} in ${posStr} — the form's there for a surge.`,
      ],
    });
  }
  return out;
}

function seasonChasingAngle(inputs: NarrativeInputs): Candidate[] {
  const out: Candidate[] = [];
  for (const p of inputs.players) {
    if (p.isSeasonLeader) continue;
    if (p.seasonPosition == null || p.pointsToLeader == null) continue;
    if (p.seasonPosition > CHASE_MAX_POSITION || p.pointsToLeader <= 0) continue;
    if (p.seasonPoints == null) continue;
    const leaderPoints = p.seasonPoints + p.pointsToLeader;
    if (leaderPoints <= 0 || p.pointsToLeader > CHASE_REL_GAP * leaderPoints) continue;
    const posStr = ordinal(p.seasonPosition);
    const gapStr = `${Math.round(p.pointsToLeader)} pts`;
    out.push({
      score: 26,
      profileId: p.profileId,
      templates: [
        `Just ${gapStr} back, ${p.name} is breathing down the leader's neck.`,
        `${firstName(p.name)} sits ${posStr}, within ${gapStr} of top spot.`,
        `${p.name} smells blood — only ${gapStr} off the standings lead.`,
        `A win here could put ${firstName(p.name)} top; he's ${gapStr} adrift.`,
        `${p.name} is the closest challenger, ${gapStr} behind.`,
        `The gap is just ${gapStr} — ${firstName(p.name)} is right in the title race.`,
        `${p.name} shadows the leader, ${gapStr} back in ${posStr}.`,
        `Keep an eye on ${firstName(p.name)}: ${gapStr} from the summit.`,
        `${p.name} is poised to pounce, ${gapStr} off the pace.`,
        `${gapStr} covers ${firstName(p.name)} and the leader — game on.`,
      ],
    });
  }
  return out;
}

function titleHolderAngle(inputs: NarrativeInputs): Candidate[] {
  const out: Candidate[] = [];
  const event = inputs.eventName;
  for (const p of inputs.players) {
    if (p.isDefendingEventChampion) {
      out.push({
        score: 34,
        profileId: p.profileId,
        templates: [
          `${p.name} returns as defending ${event} champion.`,
          `Last year's winner ${firstName(p.name)} is back to defend the title.`,
          `${p.name} lifted this one last time — can he go back-to-back?`,
          `The holder is here: ${firstName(p.name)} defends his ${event} crown.`,
          `${p.name} knows how to win this — he's the reigning champion.`,
          `Defending champ ${firstName(p.name)} eyes a successful title defence.`,
          `${p.name} arrives with a target on his back as last year's winner.`,
          `Can ${firstName(p.name)} retain it? The ${event} champion is in the field.`,
          `${p.name} won it last time out and returns to do it again.`,
          `History favours ${firstName(p.name)} — the defending ${event} champion.`,
        ],
      });
    }
    if (p.isDefendingSeasonChampion) {
      out.push({
        score: 30,
        profileId: p.profileId,
        templates: [
          `${p.name} is the reigning season champion, back to defend his crown.`,
          `Last season's winner ${firstName(p.name)} headlines the field.`,
          `${p.name} lifted the season title last year — the target man again.`,
          `The defending season champion ${firstName(p.name)} tees it up.`,
          `${p.name} knows what it takes — he won the whole thing last season.`,
          `Reigning champ ${firstName(p.name)} begins another title bid.`,
          `${p.name} carries last season's crown into this one.`,
          `Can ${firstName(p.name)} defend? The season champion is in the mix.`,
          `${p.name} set the standard last season and returns to repeat it.`,
          `All roads go through ${firstName(p.name)}, last season's champion.`,
        ],
      });
    }
  }
  return out;
}

function exceptionalScoreAngle(inputs: NarrativeInputs): Candidate[] {
  const out: Candidate[] = [];
  for (const p of inputs.players) {
    const rr = p.recentRounds ?? [];
    if (rr.length < 3 || p.avgGross == null || p.scoreStddev == null || p.scoreStddev <= 0) continue;
    const best = Math.min(...rr.map((r) => r.gross18));
    if (best > p.avgGross - EXCEPTIONAL_STDDEV_BELOW * p.scoreStddev) continue;
    const sdBelow = (p.avgGross - best) / p.scoreStddev;
    const bestStr = `${Math.round(best)}`;
    out.push({
      score: 22 + sdBelow * 6,
      profileId: p.profileId,
      templates: [
        `${p.name} has a low ${bestStr} in the bag recently — the ceiling is high.`,
        `${firstName(p.name)} carded a sparkling ${bestStr} not long ago.`,
        `${p.name} can go deep: a recent ${bestStr} proves it.`,
        `That ${bestStr} from ${firstName(p.name)} lately turned heads.`,
        `${p.name} showed his best with a ${bestStr} in recent play.`,
        `A round of ${bestStr} says ${firstName(p.name)} has a big number in him.`,
        `${p.name} caught fire for a ${bestStr} not so long ago.`,
        `${firstName(p.name)}'s recent ${bestStr} is the score to fear.`,
        `${p.name} has already gone as low as ${bestStr} of late.`,
        `Don't forget ${firstName(p.name)}'s ${bestStr} — the potential is there.`,
      ],
    });
  }
  return out;
}

function consistencyAngle(inputs: NarrativeInputs): Candidate[] {
  const out: Candidate[] = [];
  for (const p of inputs.players) {
    if (p.scoreStddev == null || p.sampleSize < CONSISTENCY_MIN_SAMPLE) continue;
    if (p.scoreStddev > CONSISTENCY_MAX_STDDEV) continue;
    const sdStr = p.scoreStddev.toFixed(1);
    out.push({
      score: 14 + (CONSISTENCY_MAX_STDDEV - p.scoreStddev) * 4,
      profileId: p.profileId,
      templates: [
        `${p.name} is Mr Reliable — scores barely move (±${sdStr}).`,
        `Metronomic ${firstName(p.name)} keeps posting the same tidy number.`,
        `${p.name} rarely beats himself; a ${sdStr}-shot spread says steady.`,
        `Consistency is ${firstName(p.name)}'s weapon — you know what you'll get.`,
        `${p.name} is a machine, round after round within ${sdStr} shots.`,
        `No surprises from ${firstName(p.name)}: dependable to the shot.`,
        `${p.name} grinds out the same score every time (±${sdStr}).`,
        `Rock-solid ${firstName(p.name)} keeps it between the hedges.`,
        `${p.name} is the steadiest in the field, swinging just ${sdStr}.`,
        `Bankable ${firstName(p.name)} — low variance, high floor.`,
      ],
    });
  }
  return out;
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
    `${field} go to war over ${format}${rounds}${where}.`,
    `${format}${rounds}${where}, and ${field} in the hunt.`,
    `Game on: ${format}${rounds}${where} with ${field}.`,
    `${field} line up for a ${format} test${rounds}${where}.`,
    `The card: ${format}${rounds}${where}, ${field} chasing it.`,
    `A ${format} affair${rounds}${where} — ${field} on the tee.`,
    `${field} contest ${format}${rounds}${where}.`,
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
    ...handicapMoveAngle(inputs),
    ...seasonLeadAngle(inputs),
    ...seasonComebackAngle(inputs),
    ...seasonChasingAngle(inputs),
    ...titleHolderAngle(inputs),
    ...exceptionalScoreAngle(inputs),
    ...consistencyAngle(inputs),
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

// ── Input assembly ────────────────────────────────────────────────────────

type SeasonEntry = { position: number | null; points: number };

/** Best-effort season standings for the field's group-season (leader + gaps). */
async function loadSeasonStandings(groupSeasonId: string): Promise<{
  byId: Map<string, SeasonEntry>;
  leaderId: string | null;
  leaderPoints: number;
  secondPoints: number;
}> {
  const { data } = await supabaseAdmin
    .from("group_season_standings_entries")
    .select("profile_id, season_points, position")
    .eq("group_season_id", groupSeasonId);
  const rows = (data ?? []) as {
    profile_id: string;
    season_points: number | string | null;
    position: number | null;
  }[];
  const byId = new Map<string, SeasonEntry>();
  for (const r of rows) {
    byId.set(r.profile_id, { position: r.position, points: Number(r.season_points ?? 0) });
  }
  const byPos = [...rows].sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9));
  return {
    byId,
    leaderId: byPos[0]?.profile_id ?? null,
    leaderPoints: byPos[0] ? Number(byPos[0].season_points ?? 0) : 0,
    secondPoints: byPos[1] ? Number(byPos[1].season_points ?? 0) : 0,
  };
}

/** Recent handicap-index movement per player over a bounded window. */
async function loadHandicapDeltas(profileIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (profileIds.length === 0) return out;
  const since = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data } = await supabaseAdmin
    .from("handicap_index_history")
    .select("profile_id, as_of_date, handicap_index")
    .in("profile_id", profileIds)
    .gte("as_of_date", since)
    .not("handicap_index", "is", null)
    .order("as_of_date", { ascending: true });
  const byPlayer = new Map<string, number[]>();
  for (const r of (data ?? []) as {
    profile_id: string;
    as_of_date: string;
    handicap_index: number | string;
  }[]) {
    const arr = byPlayer.get(r.profile_id) ?? [];
    arr.push(Number(r.handicap_index));
    byPlayer.set(r.profile_id, arr);
  }
  for (const [pid, arr] of byPlayer) {
    if (arr.length < 2) continue; // need movement across ≥2 dated rows
    out.set(pid, arr[arr.length - 1] - arr[0]); // latest − earliest (< 0 = cut)
  }
  return out;
}

/** Defending champions in the field: this event a year ago + previous season. */
async function loadDefendingChampions(
  event: EventSimContext["event"],
  fieldSet: Set<string>
): Promise<{ eventChamp: Set<string>; seasonChamp: Set<string> }> {
  const eventChamp = new Set<string>();
  const seasonChamp = new Set<string>();

  if (event.competition_event_template_id && event.event_year != null) {
    const { data } = await supabaseAdmin
      .from("event_history_summaries")
      .select("winner_profile_id")
      .eq("competition_event_template_id", event.competition_event_template_id)
      .eq("season_year", event.event_year - 1)
      .maybeSingle();
    const wid = (data as { winner_profile_id: string | null } | null)?.winner_profile_id ?? null;
    if (wid && fieldSet.has(wid)) eventChamp.add(wid);
  }

  if (event.group_season_id) {
    const { data: seasonRow } = await supabaseAdmin
      .from("group_seasons")
      .select("group_id, season_year")
      .eq("id", event.group_season_id)
      .maybeSingle();
    const s = seasonRow as { group_id: string; season_year: number | null } | null;
    if (s && s.season_year != null) {
      const { data: prev } = await supabaseAdmin
        .from("group_seasons")
        .select("id")
        .eq("group_id", s.group_id)
        .eq("season_year", s.season_year - 1)
        .maybeSingle();
      const prevId = (prev as { id: string } | null)?.id ?? null;
      if (prevId) {
        const { data: champ } = await supabaseAdmin
          .from("group_season_standings_entries")
          .select("profile_id")
          .eq("group_season_id", prevId)
          .eq("position", 1)
          .maybeSingle();
        const cid = (champ as { profile_id: string } | null)?.profile_id ?? null;
        if (cid && fieldSet.has(cid)) seasonChamp.add(cid);
      }
    }
  }

  return { eventChamp, seasonChamp };
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

  const fieldIds = ctx.players.map((p) => p.profileId);
  const fieldSet = new Set(fieldIds);

  const { data: profRows } = await supabaseAdmin
    .from("fantasy_player_profiles")
    .select("profile_id, sample_size, score_stddev, recent_form, recent_rounds, avg_gross")
    .eq("group_id", ctx.groupId)
    .in("profile_id", fieldIds);
  const stored = new Map(
    ((profRows ?? []) as Pick<
      StoredFantasyProfile,
      "profile_id" | "sample_size" | "score_stddev" | "recent_form" | "recent_rounds" | "avg_gross"
    >[]).map((r) => [r.profile_id, r])
  );

  // Season / history context — every read is guarded so an event with no
  // season linkage (or no defending champion in the field) simply omits those
  // angles, and any failure is swallowed by the caller's best-effort catch.
  const standings = ctx.event.group_season_id
    ? await loadSeasonStandings(ctx.event.group_season_id)
    : null;
  const handicapDeltas = await loadHandicapDeltas(fieldIds);
  const { eventChamp, seasonChamp } = await loadDefendingChampions(ctx.event, fieldSet);

  const inputs: NarrativeInputs = {
    eventName: ctx.event.name,
    courseName,
    scoringModel: ctx.event.scoring_model,
    // Narrative phrasing only distinguishes gross vs net; stableford → net.
    rankingBasis: ctx.rankingBasis === "gross" ? "gross" : "net",
    allowance,
    numRounds: ctx.event.num_rounds ?? 1,
    players: ctx.players.map((p) => {
      const res = sim.players[sim.playerIndex[p.profileId]];
      const row = stored.get(p.profileId);
      const season = standings?.byId.get(p.profileId) ?? null;
      const isSeasonLeader = standings?.leaderId != null && standings.leaderId === p.profileId;
      const pointsToLeader =
        season && standings ? Math.max(0, standings.leaderPoints - season.points) : null;
      const leadMargin =
        isSeasonLeader && standings
          ? Math.max(0, standings.leaderPoints - standings.secondPoints)
          : null;
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
        avgGross: row?.avg_gross != null ? Number(row.avg_gross) : null,
        handicapDelta: handicapDeltas.get(p.profileId) ?? null,
        seasonPoints: season ? season.points : null,
        seasonPosition: season?.position ?? null,
        pointsToLeader,
        isSeasonLeader,
        leadMargin,
        isDefendingEventChampion: eventChamp.has(p.profileId),
        isDefendingSeasonChampion: seasonChamp.has(p.profileId),
      };
    }),
  };

  return composeNarrative(inputs, ctx.event.course_id, hashSeed(ctx.event.id, version));
}
