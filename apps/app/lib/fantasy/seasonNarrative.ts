import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { mulberry32, hashSeed } from "@/lib/fantasy/simulation/rng";
import {
  firstName,
  ordinal,
  loadHandicapDeltas,
  selectAndCompose,
  type Candidate,
} from "@/lib/fantasy/narrative";
// Type-only: value imports would make seasonOdds.ts ↔ seasonNarrative.ts circular.
import type { SeasonContext } from "@/lib/fantasy/seasonOdds";
import type { SeasonSimResult } from "@/lib/fantasy/simulation/seasonEngine";

/**
 * Season narrative engine — the auto-written title-race story shown on the
 * season markets board (and, from Change B1, the group's Overview tab).
 *
 * The season analogue of narrative.ts: same two-stage, deterministic, no-LLM
 * design (candidate extractors → rank/dedupe/compose), reusing that module's
 * selection scaffolding. Where the event narrator previews one field over one
 * event, this one narrates the whole standings — the title favourite by the
 * season sim's win probability, the chasing pack, form surges up the table,
 * the wins leader, the run-in, and a decided title. Every angle guards for
 * missing data (a season with no standings yet simply omits it), and the whole
 * thing is best-effort at the call site.
 */

export type SeasonNarrativeInputs = {
  seasonName: string;
  /** Constituent events still to play (0 ⇒ the race is settled). */
  remainingCount: number;
  players: {
    profileId: string;
    name: string;
    /** Season win probability from the remaining-events Monte Carlo. */
    winProb: number;
    /** Probability of a top-3 standings finish. */
    top3Prob: number;
    currentPoints: number;
    /** Standings position (1 = leader); null when the player is unranked. */
    position: number | null;
    isLeader: boolean;
    /** Points behind the standings leader (0 for the leader). */
    pointsToLeader: number | null;
    /** Leader only: points clear of second place. */
    leadMargin: number | null;
    eventsPlayed: number;
    wins: number;
    top3s: number;
    // Optional form/history context — absent ⇒ the matching angle skips.
    recentForm?: number | null;
    /** Recent handicap-index movement (latest − earliest in window); < 0 = cut. */
    handicapDelta?: number | null;
    isDefendingSeasonChampion?: boolean;
  }[];
};

const MAX_INSIGHTS = 4;

// Angle thresholds — tunable in one place.
const TITLE_FAV_MIN_PROB = 0.3; // a clear title favourite…
const TITLE_FAV_GAP = 0.1; // …this far clear of the next player
const WIDE_OPEN_MAX_PROB = 0.22; // top win-prob below this ⇒ wide-open race
const RUNAWAY_MIN_PROB = 0.6; // leader this likely to win ⇒ running away
const TIGHT_TITLE_GAP = 0.08; // top-two win-prob within this ⇒ two-horse race
const CHASE_MAX_POSITION = 4; // "chasing" is a top-four challenger…
const CHASE_REL_GAP = 0.15; // …within 15% of the leader's points
const SURGE_MIN_POSITION = 3; // a form surge starts outside the top two
const SURGE_FORM = -1.5; // recent_form this negative = genuinely hot
const HANDICAP_MOVE_MIN = 1.0; // strokes of index movement worth a mention
const WINS_MIN = 2; // a wins leader needs at least this many
const PODIUM_MIN_TOP3_PROB = 0.5; // reliably in the top three…
const PODIUM_MAX_WIN_PROB = 0.25; // …without being the outright favourite
const DECIDED_MIN_PROB = 0.98; // effectively certain ⇒ title wrapped up

// ── Extractors ────────────────────────────────────────────────────────────

function titleFavouriteAngle(inputs: SeasonNarrativeInputs): Candidate[] {
  const sorted = [...inputs.players].sort((a, b) => b.winProb - a.winProb);
  const fav = sorted[0];
  const second = sorted[1];
  if (!fav || !second) return [];
  const gap = fav.winProb - second.winProb;
  // A runaway or a decided race is handled by its own (higher-scored) angle.
  if (fav.winProb >= DECIDED_MIN_PROB || fav.winProb >= RUNAWAY_MIN_PROB) return [];
  if (fav.winProb >= TITLE_FAV_MIN_PROB && gap >= TITLE_FAV_GAP) {
    const pct = `${Math.round(fav.winProb * 100)}%`;
    return [
      {
        score: 40 + gap * 100,
        profileId: fav.profileId,
        templates: [
          `${fav.name} is favourite for the title at ${pct}.`,
          `The sim makes ${fav.name} the one to catch — ${pct} to take the crown.`,
          `${fav.name} heads the title race, ${pct} to lift it.`,
          `Season honours point to ${fav.name}, priced ${pct}.`,
          `Hard to look past ${fav.name} for the title (${pct}).`,
          `${firstName(fav.name)} tops the market for the crown at ${pct}.`,
          `${pct} says it all — ${fav.name} is the play for the title.`,
          `The numbers favour ${fav.name} to close it out (${pct}).`,
          `${fav.name} carries title favouritism at ${pct}.`,
          `Beat ${firstName(fav.name)} and you win the season — ${pct} the favourite.`,
        ],
      },
    ];
  }
  if (fav.winProb < WIDE_OPEN_MAX_PROB && inputs.players.length >= 4) {
    return [
      {
        score: 35,
        profileId: null,
        templates: [
          `No standout for the title — this race is wide open.`,
          `The standings can't be called; the crown is up for grabs.`,
          `Wide open at the top, with nothing between the contenders.`,
          `The sim shrugs: no clear title favourite has emerged.`,
          `Bunched and unpredictable — the season is anyone's.`,
          `Not a favourite in sight; the title race is level pegging.`,
          `Too close to call — the market backs no one for the crown.`,
          `A true title lottery, with several names holding live chances.`,
          `Nobody's running away with it — the door is open for all.`,
          `The championship is genuinely up for grabs.`,
        ],
      },
    ];
  }
  return [];
}

function runawayLeaderAngle(inputs: SeasonNarrativeInputs): Candidate[] {
  const leader = inputs.players.find((p) => p.isLeader);
  if (!leader || leader.winProb < RUNAWAY_MIN_PROB || leader.winProb >= DECIDED_MIN_PROB) return [];
  const pct = `${Math.round(leader.winProb * 100)}%`;
  const margin = leader.leadMargin ?? 0;
  const marginStr = margin > 0 ? `${Math.round(margin)} points clear` : `out in front`;
  return [
    {
      score: 44 + leader.winProb * 10,
      profileId: leader.profileId,
      templates: [
        `${leader.name} is running away with the season — ${marginStr}, ${pct} to win it.`,
        `${firstName(leader.name)} has one hand on the trophy, ${marginStr} at ${pct}.`,
        `${leader.name} is in command of the title race, ${marginStr}.`,
        `It's ${leader.name}'s to lose — ${pct} favourite and ${marginStr}.`,
        `${firstName(leader.name)} is pulling clear at the top (${pct}).`,
        `${leader.name} looks the class of the field, ${marginStr}.`,
        `Barring a collapse, ${firstName(leader.name)} takes this — ${pct}.`,
        `${leader.name} has turned the title race into a procession (${marginStr}).`,
        `The chasers are running out of road on ${firstName(leader.name)} (${pct}).`,
        `${leader.name} is the runaway leader, ${marginStr}.`,
      ],
    },
  ];
}

function decidedAngle(inputs: SeasonNarrativeInputs): Candidate[] {
  const leader = inputs.players.find((p) => p.isLeader);
  if (!leader) return [];
  const decided = inputs.remainingCount === 0 || leader.winProb >= DECIDED_MIN_PROB;
  if (!decided) return [];
  return [
    {
      score: 52,
      profileId: leader.profileId,
      templates: [
        `${leader.name} has wrapped up the ${inputs.seasonName} title.`,
        `It's done: ${firstName(leader.name)} has the season sewn up.`,
        `${leader.name} is the champion — the title race is settled.`,
        `No catching ${firstName(leader.name)} now; the crown is his.`,
        `${leader.name} has clinched it, mathematically out of reach.`,
        `The season belongs to ${firstName(leader.name)}.`,
        `${leader.name} has seen off the field to take the title.`,
        `Game over at the top — ${firstName(leader.name)} is champion.`,
        `${leader.name} has done enough; the championship is decided.`,
        `Congratulations to ${firstName(leader.name)}, your season winner.`,
      ],
    },
  ];
}

function tightTitleRaceAngle(inputs: SeasonNarrativeInputs): Candidate[] {
  const sorted = [...inputs.players].sort((a, b) => b.winProb - a.winProb);
  const [a, b] = sorted;
  if (!a || !b) return [];
  if (a.winProb < TITLE_FAV_MIN_PROB * 0.7) return []; // both too long-odds to be a "duel"
  if (a.winProb - b.winProb > TIGHT_TITLE_GAP) return [];
  return [
    {
      score: 30,
      profileId: null,
      templates: [
        `${a.name} and ${b.name} are locked together at the top of the title race.`,
        `Barely anything separates ${firstName(a.name)} and ${firstName(b.name)} for the crown.`,
        `${a.name} vs ${b.name} looks a two-horse title race.`,
        `Nothing in it up top: ${firstName(a.name)} and ${firstName(b.name)} are neck and neck for the season.`,
        `The sim can't split ${a.name} and ${b.name} for the title.`,
        `A championship duel: ${firstName(a.name)} and ${firstName(b.name)} dead level.`,
        `${a.name} and ${b.name} are inseparable at the head of the standings.`,
        `Expect ${firstName(a.name)} and ${firstName(b.name)} to fight this title out to the wire.`,
        `Two clear of the rest, ${a.name} and ${b.name} will trade blows for the crown.`,
        `${firstName(a.name)} and ${firstName(b.name)} are set for a season-long shootout.`,
      ],
    },
  ];
}

function chasingPackAngle(inputs: SeasonNarrativeInputs): Candidate[] {
  const out: Candidate[] = [];
  for (const p of inputs.players) {
    if (p.isLeader) continue;
    if (p.position == null || p.pointsToLeader == null) continue;
    if (p.position > CHASE_MAX_POSITION || p.pointsToLeader <= 0) continue;
    const leaderPoints = p.currentPoints + p.pointsToLeader;
    if (leaderPoints <= 0 || p.pointsToLeader > CHASE_REL_GAP * leaderPoints) continue;
    const posStr = ordinal(p.position);
    const gapStr = `${Math.round(p.pointsToLeader)} pts`;
    out.push({
      score: 26 + p.top3Prob * 6,
      profileId: p.profileId,
      templates: [
        `Just ${gapStr} back, ${p.name} is right in the title hunt.`,
        `${firstName(p.name)} sits ${posStr}, within ${gapStr} of the lead.`,
        `${p.name} smells blood — only ${gapStr} off top spot.`,
        `A strong finish could put ${firstName(p.name)} top; he's ${gapStr} adrift.`,
        `${p.name} is the closest challenger, ${gapStr} behind.`,
        `The gap is just ${gapStr} — ${firstName(p.name)} is firmly in the race.`,
        `${p.name} shadows the leader, ${gapStr} back in ${posStr}.`,
        `Keep an eye on ${firstName(p.name)}: ${gapStr} from the summit.`,
        `${p.name} is poised to pounce, ${gapStr} off the pace.`,
        `${gapStr} covers ${firstName(p.name)} and the lead — game on.`,
      ],
    });
  }
  return out;
}

function formSurgeAngle(inputs: SeasonNarrativeInputs): Candidate[] {
  const out: Candidate[] = [];
  for (const p of inputs.players) {
    if (p.position == null || p.position < SURGE_MIN_POSITION) continue;
    if (p.recentForm == null || p.recentForm > SURGE_FORM) continue;
    const posStr = ordinal(p.position);
    const gapStr = p.pointsToLeader != null ? `${Math.round(p.pointsToLeader)} pts` : "ground";
    out.push({
      score: 22 + Math.abs(p.recentForm) * 3 + p.top3Prob * 4,
      profileId: p.profileId,
      templates: [
        `${p.name} is charging up the table — ${posStr}, but in the form to climb.`,
        `${firstName(p.name)} is ${gapStr} off the lead and arriving red-hot.`,
        `Down in ${posStr}, ${p.name}'s recent form says don't write him off.`,
        `${p.name} is the mover — flying up the standings from ${posStr}.`,
        `Form makes ${firstName(p.name)} dangerous despite sitting ${posStr}.`,
        `${p.name} could ignite a late-season surge from ${posStr}.`,
        `${gapStr} back but full of running, ${firstName(p.name)} is one to watch.`,
        `A hot streak has ${p.name} eating into the deficit from ${posStr}.`,
        `${firstName(p.name)} has the game right now to climb the table.`,
        `Don't sleep on ${p.name} in ${posStr} — the form's there for a run.`,
      ],
    });
  }
  return out;
}

function winsLeaderAngle(inputs: SeasonNarrativeInputs): Candidate[] {
  const sorted = [...inputs.players].filter((p) => p.wins > 0).sort((a, b) => b.wins - a.wins);
  const top = sorted[0];
  if (!top || top.wins < WINS_MIN) return [];
  // Only if the wins lead is outright (no tie on the same win count).
  if (sorted[1] && sorted[1].wins === top.wins) return [];
  const winsStr = `${top.wins} wins`;
  return [
    {
      score: 24,
      profileId: top.profileId,
      templates: [
        `${top.name} has the most silverware this season — ${winsStr}.`,
        `${firstName(top.name)} keeps winning events (${winsStr} and counting).`,
        `Nobody has won more than ${top.name} this year (${winsStr}).`,
        `${top.name} is the season's serial winner with ${winsStr}.`,
        `When it matters, ${firstName(top.name)} delivers — ${winsStr} already.`,
        `${top.name} leads the way for event wins (${winsStr}).`,
        `A habit of winning: ${firstName(top.name)} has ${winsStr}.`,
        `${top.name} tops the wins column with ${winsStr}.`,
        `${firstName(top.name)} has been to the winner's circle ${top.wins} times.`,
        `Form player of the season, ${top.name}, boasts ${winsStr}.`,
      ],
    },
  ];
}

function podiumRegularAngle(inputs: SeasonNarrativeInputs): Candidate[] {
  const out: Candidate[] = [];
  for (const p of inputs.players) {
    if (p.isLeader) continue;
    if (p.top3Prob < PODIUM_MIN_TOP3_PROB || p.winProb >= PODIUM_MAX_WIN_PROB) continue;
    const pct = `${Math.round(p.top3Prob * 100)}%`;
    out.push({
      score: 18 + p.top3Prob * 8,
      profileId: p.profileId,
      templates: [
        `${p.name} keeps finishing near the top — ${pct} for a season top-three.`,
        `${firstName(p.name)} is Mr Consistent, ${pct} to land a podium spot.`,
        `Don't overlook ${p.name}: ${pct} to end the season in the top three.`,
        `${p.name} banks points week in, week out (${pct} top-three).`,
        `A safe pair of hands, ${firstName(p.name)} is ${pct} for a podium.`,
        `${p.name} may not win it but he'll be there or thereabouts (${pct}).`,
        `Steady ${firstName(p.name)} projects ${pct} to make the top three.`,
        `${p.name} is the reliable pick for a season podium (${pct}).`,
        `${firstName(p.name)} rarely finishes far off the pace — ${pct} top-three.`,
        `Consistency is ${p.name}'s currency: ${pct} for a top-three finish.`,
      ],
    });
  }
  return out;
}

function seasonHandicapMoveAngle(inputs: SeasonNarrativeInputs): Candidate[] {
  const out: Candidate[] = [];
  for (const p of inputs.players) {
    const d = p.handicapDelta;
    if (d == null || Math.abs(d) < HANDICAP_MOVE_MIN) continue;
    const mag = Math.abs(d);
    const magStr = `${mag.toFixed(1)} shots`;
    const cut = d < 0; // index fell → improving
    out.push({
      score: cut ? 20 + mag * 4 : 14 + mag * 3,
      profileId: p.profileId,
      templates: cut
        ? [
            `${p.name} has been cut ${magStr} across the season — trending the right way.`,
            `${firstName(p.name)}'s handicap is tumbling, down ${magStr} this year.`,
            `${p.name} is playing off a lower mark, ${magStr} sharper than the start.`,
            `The cut's come for ${firstName(p.name)}: ${magStr} off the index this season.`,
            `${p.name} keeps improving — ${magStr} lower and still falling.`,
            `Getting better all year, ${firstName(p.name)} has shed ${magStr}.`,
            `${p.name}'s index has dropped ${magStr}; the game is clearly there.`,
            `A season of progress for ${firstName(p.name)} — ${magStr} of cuts.`,
            `${p.name} is improving off the course too, cut ${magStr}.`,
            `Watch ${firstName(p.name)}: ${magStr} of cuts says he's on the up.`,
          ]
        : [
            `${p.name}'s handicap has drifted up ${magStr} this season.`,
            `${firstName(p.name)} is heading the wrong way — up ${magStr} on the index.`,
            `${p.name} has been handed ${magStr} back over the year.`,
            `The index has risen ${magStr} for ${firstName(p.name)} this season.`,
            `${p.name} is playing off a higher mark, ${magStr} adrift of the start.`,
            `A tougher year off the course for ${firstName(p.name)}: up ${magStr}.`,
            `${p.name}'s handicap has crept up ${magStr}; work to do.`,
            `${firstName(p.name)} has lost ${magStr} to the handicapper this season.`,
            `${p.name} is trending up ${magStr} — the sharpness has dipped.`,
            `A softer mark for ${firstName(p.name)} now, ${magStr} higher than the start.`,
          ],
    });
  }
  return out;
}

function defendingChampionAngle(inputs: SeasonNarrativeInputs): Candidate[] {
  const out: Candidate[] = [];
  for (const p of inputs.players) {
    if (!p.isDefendingSeasonChampion) continue;
    out.push({
      score: 28,
      profileId: p.profileId,
      templates: [
        `${p.name} is the reigning champion, out to defend his crown.`,
        `Last season's winner ${firstName(p.name)} headlines the title race.`,
        `${p.name} lifted this title last year — the target man again.`,
        `The defending champion ${firstName(p.name)} is back in the hunt.`,
        `${p.name} knows what it takes — he won the whole thing last season.`,
        `Reigning champ ${firstName(p.name)} bids to go back-to-back.`,
        `${p.name} carries last season's crown into this race.`,
        `Can ${firstName(p.name)} defend? The champion is in the mix.`,
        `${p.name} set the standard last season and wants a repeat.`,
        `All roads go through ${firstName(p.name)}, last season's champion.`,
      ],
    });
  }
  return out;
}

// ── Composition ───────────────────────────────────────────────────────────

function seasonSetupLine(inputs: SeasonNarrativeInputs, rand: () => number): string {
  const field = `${inputs.players.length} in contention`;
  const m = inputs.remainingCount;
  const runIn =
    m <= 0
      ? " with the season complete"
      : m === 1
      ? " with one event left to settle it"
      : m <= 2
      ? ` down the final stretch (${m} to play)`
      : ` with ${m} events still to play`;
  const templates = [
    `The ${inputs.seasonName} title race, ${field}${runIn}.`,
    `${inputs.seasonName}: ${field}${runIn}.`,
    `${field} in the ${inputs.seasonName} standings${runIn}.`,
    `The race for the ${inputs.seasonName} crown${runIn}, ${field}.`,
    `${inputs.seasonName} honours are up for grabs${runIn} — ${field}.`,
    `Standings watch: the ${inputs.seasonName}${runIn}, ${field}.`,
    `${field} chasing the ${inputs.seasonName} title${runIn}.`,
    `Where the ${inputs.seasonName} stands${runIn}: ${field}.`,
    `The ${inputs.seasonName} is heating up${runIn}, ${field}.`,
    `${inputs.seasonName} title picture${runIn}, ${field}.`,
  ];
  return templates[Math.floor(rand() * templates.length) % templates.length];
}

export function composeSeasonNarrative(inputs: SeasonNarrativeInputs, seed: number): string {
  const rand = mulberry32(seed);

  const candidates: Candidate[] = [
    ...decidedAngle(inputs),
    ...runawayLeaderAngle(inputs),
    ...titleFavouriteAngle(inputs),
    ...tightTitleRaceAngle(inputs),
    ...chasingPackAngle(inputs),
    ...formSurgeAngle(inputs),
    ...winsLeaderAngle(inputs),
    ...podiumRegularAngle(inputs),
    ...seasonHandicapMoveAngle(inputs),
    ...defendingChampionAngle(inputs),
  ];

  return selectAndCompose((r) => seasonSetupLine(inputs, r), candidates, rand, MAX_INSIGHTS);
}

// ── Input assembly ────────────────────────────────────────────────────────

type StandingsExtra = {
  position: number | null;
  points: number;
  eventsPlayed: number;
  wins: number;
  top3s: number;
};

/** Full standings rows for the season — leader/gaps plus per-player counters. */
async function loadStandingsExtras(groupSeasonId: string): Promise<{
  byId: Map<string, StandingsExtra>;
  leaderId: string | null;
  leaderPoints: number;
  secondPoints: number;
}> {
  const { data } = await supabaseAdmin
    .from("group_season_standings_entries")
    .select("profile_id, season_points, position, events_played, wins, top_3s")
    .eq("group_season_id", groupSeasonId);
  const rows = (data ?? []) as {
    profile_id: string;
    season_points: number | string | null;
    position: number | null;
    events_played: number | null;
    wins: number | null;
    top_3s: number | null;
  }[];
  const byId = new Map<string, StandingsExtra>();
  for (const r of rows) {
    byId.set(r.profile_id, {
      position: r.position,
      points: Number(r.season_points ?? 0),
      eventsPlayed: Number(r.events_played ?? 0),
      wins: Number(r.wins ?? 0),
      top3s: Number(r.top_3s ?? 0),
    });
  }
  const byPos = [...rows].sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9));
  return {
    byId,
    leaderId: byPos[0]?.profile_id ?? null,
    leaderPoints: byPos[0] ? Number(byPos[0].season_points ?? 0) : 0,
    secondPoints: byPos[1] ? Number(byPos[1].season_points ?? 0) : 0,
  };
}

/** Recent-form per player (from the stored fantasy profiles for this group). */
async function loadRecentForm(groupId: string, profileIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (profileIds.length === 0) return out;
  const { data } = await supabaseAdmin
    .from("fantasy_player_profiles")
    .select("profile_id, recent_form")
    .eq("group_id", groupId)
    .in("profile_id", profileIds);
  for (const r of (data ?? []) as { profile_id: string; recent_form: number | string | null }[]) {
    if (r.recent_form != null) out.set(r.profile_id, Number(r.recent_form));
  }
  return out;
}

/** The previous season's standings winner, if they feature this season. */
async function loadDefendingSeasonChampion(
  groupSeasonId: string,
  fieldSet: Set<string>
): Promise<string | null> {
  const { data: seasonRow } = await supabaseAdmin
    .from("group_seasons")
    .select("group_id, season_year")
    .eq("id", groupSeasonId)
    .maybeSingle();
  const s = seasonRow as { group_id: string; season_year: number | null } | null;
  if (!s || s.season_year == null) return null;
  const { data: prev } = await supabaseAdmin
    .from("group_seasons")
    .select("id")
    .eq("group_id", s.group_id)
    .eq("season_year", s.season_year - 1)
    .maybeSingle();
  const prevId = (prev as { id: string } | null)?.id ?? null;
  if (!prevId) return null;
  const { data: champ } = await supabaseAdmin
    .from("group_season_standings_entries")
    .select("profile_id")
    .eq("group_season_id", prevId)
    .eq("position", 1)
    .maybeSingle();
  const cid = (champ as { profile_id: string } | null)?.profile_id ?? null;
  return cid && fieldSet.has(cid) ? cid : null;
}

/** Assemble inputs from a season sim run and produce write-ready narrative text. */
export async function generateSeasonNarrative(
  ctx: SeasonContext,
  sim: SeasonSimResult,
  version: number
): Promise<string> {
  const simById = new Map(sim.players.map((p) => [p.profileId, p]));
  const fieldSet = new Set(ctx.playerIds);

  // Season / history context — every read is guarded so a season with sparse
  // data simply omits the corresponding angles, and any failure is swallowed by
  // the caller's best-effort catch.
  const standings = await loadStandingsExtras(ctx.groupSeasonId);
  const recentForm = await loadRecentForm(ctx.groupId, ctx.playerIds);
  const handicapDeltas = await loadHandicapDeltas(ctx.playerIds);
  const defendingChampId = await loadDefendingSeasonChampion(ctx.groupSeasonId, fieldSet);

  const players: SeasonNarrativeInputs["players"] = ctx.playerIds.map((id) => {
    const res = simById.get(id);
    const entry = standings.byId.get(id) ?? null;
    const points = entry?.points ?? ctx.currentPoints[id] ?? 0;
    const isLeader = standings.leaderId != null && standings.leaderId === id;
    const pointsToLeader = entry ? Math.max(0, standings.leaderPoints - points) : null;
    const leadMargin = isLeader ? Math.max(0, standings.leaderPoints - standings.secondPoints) : null;
    return {
      profileId: id,
      name: ctx.names[id] ?? "Player",
      winProb: res?.winProb ?? 0,
      top3Prob: res?.top3Prob ?? 0,
      currentPoints: points,
      position: entry?.position ?? ctx.standingsPosition[id] ?? null,
      isLeader,
      pointsToLeader,
      leadMargin,
      eventsPlayed: entry?.eventsPlayed ?? 0,
      wins: entry?.wins ?? 0,
      top3s: entry?.top3s ?? 0,
      recentForm: recentForm.get(id) ?? null,
      handicapDelta: handicapDeltas.get(id) ?? null,
      isDefendingSeasonChampion: defendingChampId === id,
    };
  });

  const inputs: SeasonNarrativeInputs = {
    seasonName: ctx.seasonName,
    remainingCount: ctx.remaining.length,
    players,
  };

  return composeSeasonNarrative(inputs, hashSeed(ctx.groupSeasonId, version));
}
