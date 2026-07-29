import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readFantasyConfig } from "@/lib/fantasy/config";
import { ensureProfiles, toSimProfile } from "@/lib/fantasy/profiles";
import { getMarketDefinition, MARKET_REGISTRY } from "@/lib/fantasy/markets/registry";
import { analyticDistributions } from "@/lib/fantasy/markets/analytic";
import type { FantasyMarket, GenerateCtx, LiveMarketCtx, MarketSpec } from "@/lib/fantasy/markets/types";
import { runSimulation, pickSimulationCount } from "@/lib/fantasy/simulation/engine";
import { hashSeed } from "@/lib/fantasy/simulation/rng";
import { generateNarrative } from "@/lib/fantasy/narrative";
import { writeJointSamples } from "@/lib/fantasy/jointSamples";
import { computeAttendanceProbability, participationRate } from "@/lib/fantasy/attendance";
import {
  clampProbability,
  holeKey,
  probabilityToDecimalOdds,
  type RankingBasis,
  type SimHole,
  type SimPlayer,
  type SimulationResult,
} from "@/lib/fantasy/simulation/types";
import type { FantasyEventState } from "@/lib/fantasy/types";

/**
 * Odds service: sim-input assembly, market generation, lazy refresh.
 *
 * Refresh model (no queue runner): staleness triggers write a debounced
 * fantasy_refresh_jobs row; whichever request arrives past debounce_until
 * claims it atomically (ciaga_fantasy_claim_refresh_job) and simulates inline.
 * Losers serve the cached snapshots with a "refreshing" flag; the realtime
 * fantasy_event_state UPDATE tells clients when to refetch.
 */

export type EventRow = {
  id: string;
  name: string;
  group_id: string | null;
  course_id: string | null;
  event_date: string | null;
  majors_status: string;
  scoring_model: string | null;
  scoring_basis: string | null;
  handicap_rules: Record<string, unknown> | null;
  num_rounds: number | null;
  entry_window_start: string | null;
  entry_window_end: string | null;
  // Season/series linkage — nullable (one-off or untagged events). Only the
  // narrator reads these today, for season/defending-champion storylines.
  group_season_id: string | null;
  competition_id: string | null;
  competition_event_template_id: string | null;
  event_year: number | null;
};

export type EntryRow = {
  profile_id: string;
  entry_status: string;
  assigned_handicap_index: number | null;
  assigned_course_handicap: number | null;
  assigned_playing_handicap: number | null;
};

export type EventSimContext = {
  event: EventRow;
  groupId: string;
  players: SimPlayer[];
  holes: SimHole[];
  rankingBasis: RankingBasis;
  names: Record<string, string>;
  live: LiveMarketCtx;
};

// Statuses that count as "in the field" for PRICING — must match what
// settlement grades (settlement.ts WITHDRAWN_STATUSES = withdrawn/no_show/
// rejected; everything else is graded). Previously only entered/approved were
// priced, so pending_approval/waitlisted entrants were graded but never priced:
// they fell through to provisional and lost all their per-player markets
// (birdies/eagles/bands/finish position) while still showing in field markets.
export const ACTIVE_ENTRY_STATUSES = ["entered", "approved", "pending_approval", "waitlisted"];

export async function loadEvent(eventId: string): Promise<EventRow> {
  const { data, error } = await supabaseAdmin
    .from("events")
    .select(
      "id, name, group_id, course_id, event_date, majors_status, scoring_model, scoring_basis, handicap_rules, num_rounds, entry_window_start, entry_window_end, group_season_id, competition_id, competition_event_template_id, event_year"
    )
    .eq("id", eventId)
    .single();
  if (error) throw error;
  return data as EventRow;
}

export function allowancePct(event: EventRow): number {
  const rules = event.handicap_rules as { mode?: string; allowance_pct?: number | string | null } | null;
  if (!rules || rules.mode === "none") return 0;
  const pct = Number(rules.allowance_pct);
  if (!Number.isFinite(pct) || pct <= 0) return 100;
  return pct;
}

export type PlayingHandicapDetail = {
  value: number;
  /** Which input produced the value — surfaced by the odds inspector. */
  source:
    | "handicap_mode_none"
    | "assigned_playing_handicap"
    | "assigned_course_handicap_x_pct"
    | "assigned_handicap_index_x_pct"
    | "profile_handicap_index_x_pct"
    | "compare_against_lowest"
    | "no_data";
};

/** Tee ratings needed to turn a handicap index into a course handicap. */
export type CourseConversion = {
  slope: number | null;
  rating: number | null;
  parTotal: number | null;
  holesInRound: number | null;
};

/**
 * Event playing handicap per player: PLAYING HANDICAP = COURSE HANDICAP ×
 * allowance, matching round_participants and therefore the leaderboard.
 *
 * The trap this function used to fall into: event_entries.assigned_course_handicap
 * and .assigned_playing_handicap are never written by the app — only
 * assigned_handicap_index is (see events/[id]/enter) — so every entry landed on
 * the index branch, and the index was then multiplied by the allowance AS IF it
 * were a course handicap. That skipped the slope/rating conversion entirely and
 * priced every net market off a handicap ~7-8 strokes too generous (measured on
 * the CiaGA Championship 2026: HI 22.1 → 15 on the leaderboard, 23 in fantasy).
 *
 * `conversion` supplies the tee's slope/rating/par so an index can be converted
 * properly. Without it we can only fall back to treating the index as a course
 * handicap — the old behaviour — so callers that can supply it should.
 */
export function resolvePlayingHandicapDetails(
  event: EventRow,
  entries: EntryRow[],
  profileHi: Map<string, number | null>,
  conversion?: CourseConversion | null
): Map<string, PlayingHandicapDetail> {
  const rules = event.handicap_rules as { mode?: string } | null;
  const pct = allowancePct(event);
  const out = new Map<string, PlayingHandicapDetail>();

  const slope = conversion?.slope ?? null;
  const rating = conversion?.rating ?? null;
  const parTotal = conversion?.parTotal ?? null;
  const holesInRound = conversion?.holesInRound ?? 18;

  /** WHS course handicap from an index, mirroring calcCourseHandicap plus the
   *  9-hole halving the round SQL applies (20260717000000). */
  const indexToCourseHandicap = (hi: number): number => {
    if (slope == null || rating == null || parTotal == null) return hi;
    const effectiveHi = holesInRound === 9 ? hi / 2 : hi;
    return Math.round(effectiveHi * (slope / 113) + (rating - parTotal));
  };

  const courseHandicap = (
    e: EntryRow
  ): { value: number; src: "assigned_course_handicap" | "assigned_handicap_index" | "profile_handicap_index" } | null => {
    if (e.assigned_course_handicap != null)
      return { value: Number(e.assigned_course_handicap), src: "assigned_course_handicap" };
    if (e.assigned_handicap_index != null)
      return {
        value: indexToCourseHandicap(Number(e.assigned_handicap_index)),
        src: "assigned_handicap_index",
      };
    const hi = profileHi.get(e.profile_id);
    if (hi != null)
      return { value: indexToCourseHandicap(hi), src: "profile_handicap_index" };
    return null;
  };

  if (rules?.mode === "none") {
    for (const e of entries) out.set(e.profile_id, { value: 0, source: "handicap_mode_none" });
    return out;
  }

  if (rules?.mode === "compare_against_lowest") {
    const chs = entries.map((e) => courseHandicap(e)?.value ?? 0);
    const lowest = chs.length > 0 ? Math.min(...chs) : 0;
    entries.forEach((e, i) => {
      out.set(e.profile_id, {
        value: Math.round((chs[i] - lowest) * (pct / 100)),
        source: "compare_against_lowest",
      });
    });
    return out;
  }

  for (const e of entries) {
    if (e.assigned_playing_handicap != null) {
      out.set(e.profile_id, {
        value: Number(e.assigned_playing_handicap),
        source: "assigned_playing_handicap",
      });
    } else {
      const ch = courseHandicap(e);
      out.set(e.profile_id, {
        value: Math.round((ch?.value ?? 0) * (pct / 100)),
        source: ch == null ? "no_data" : (`${ch.src}_x_pct` as PlayingHandicapDetail["source"]),
      });
    }
  }
  return out;
}

function resolvePlayingHandicaps(
  event: EventRow,
  entries: EntryRow[],
  profileHi: Map<string, number | null>,
  conversion?: CourseConversion | null
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [pid, d] of resolvePlayingHandicapDetails(event, entries, profileHi, conversion)) {
    out.set(pid, d.value);
  }
  return out;
}

/** Tee conversion inputs ride on every SimHole; round 1's tee is the basis. */
export function conversionFromHoles(holes: SimHole[]): CourseConversion | null {
  const h = holes.find((x) => (x.round ?? 1) === 1) ?? holes[0];
  if (!h) return null;
  return {
    slope: h.slope ?? null,
    rating: h.rating ?? null,
    parTotal: h.parTotal ?? null,
    holesInRound: h.holesInRound ?? null,
  };
}

/** One tee's holes for a course; empty when unresolvable. */
async function loadCourseHoles(
  courseId: string | null,
  preferredTee: string | null
): Promise<Omit<SimHole, "round">[]> {
  if (!courseId) return [];

  const { data: tees, error: teeErr } = await supabaseAdmin
    .from("course_tee_boxes")
    .select("id, holes_count, gender, name, rating, slope")
    .eq("course_id", courseId);
  if (teeErr) throw teeErr;
  const teeRows = (tees ?? []) as {
    id: string; holes_count: number | null; rating: number | null; slope: number | null;
  }[];
  const teeId =
    preferredTee && teeRows.some((t) => t.id === preferredTee)
      ? preferredTee
      : (teeRows.find((t) => (t.holes_count ?? 18) >= 18) ?? teeRows[0])?.id;
  if (!teeId) return [];
  const tee = teeRows.find((t) => t.id === teeId);

  const { data: holes, error: holeErr } = await supabaseAdmin
    .from("course_tee_holes")
    .select("hole_number, par, yardage, handicap")
    .eq("tee_box_id", teeId)
    .order("hole_number", { ascending: true });
  if (holeErr) throw holeErr;

  const valid = ((holes ?? []) as { hole_number: number; par: number | null; yardage: number | null; handicap: number | null }[])
    .filter((h) => h.par != null);
  // Rating/slope drive the differential → gross inverse; parTotal + count let the
  // model spread the round target across holes. All four ride on each hole so a
  // multi-round event across different tees prices each round on its own tee.
  const parTotal = valid.reduce((s, h) => s + (h.par as number), 0);
  const holesInRound = valid.length;
  const rating = tee?.rating != null ? Number(tee.rating) : null;
  const slope = tee?.slope != null ? Number(tee.slope) : null;
  return valid.map((h) => ({
    holeNumber: h.hole_number,
    par: h.par as number,
    yardage: h.yardage,
    strokeIndex: h.handicap ?? h.hole_number,
    rating,
    slope,
    parTotal,
    holesInRound,
  }));
}

/** Standard-par fallback so pre-course events can still be simulated. */
function fallbackHoles(round = 1): SimHole[] {
  const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
  return pars.map((par, i) => ({
    holeNumber: i + 1,
    par,
    yardage: null,
    strokeIndex: i + 1,
    round,
  }));
}

/**
 * Round-tagged hole set for the whole event. Each event round contributes its
 * own course/tee (falling back to the event course, then to a standard-par
 * layout), so a 2-round event across two courses simulates both correctly.
 */
async function loadHoles(event: EventRow): Promise<SimHole[]> {
  const numRounds = Math.max(1, event.num_rounds ?? 1);

  const { data: roundRows } = await supabaseAdmin
    .from("event_rounds")
    .select("round_number, status, course_id, default_tee_box_id_male, default_tee_box_id_female")
    .eq("event_id", event.id)
    .order("round_number", { ascending: true });
  const eventRounds = (roundRows ?? []) as {
    round_number: number;
    status: string;
    course_id: string | null;
    default_tee_box_id_male: string | null;
    default_tee_box_id_female: string | null;
  }[];

  const defs: { round: number; courseId: string | null; preferredTee: string | null }[] = [];
  for (let r = 1; r <= numRounds; r++) {
    const row = eventRounds.find((x) => x.round_number === r);
    if (row?.status === "cancelled") continue;
    defs.push({
      round: r,
      courseId: row?.course_id ?? event.course_id,
      preferredTee: row?.default_tee_box_id_male ?? row?.default_tee_box_id_female ?? null,
    });
  }
  if (defs.length === 0) defs.push({ round: 1, courseId: event.course_id, preferredTee: null });

  const cache = new Map<string, Omit<SimHole, "round">[]>();
  const out: SimHole[] = [];
  for (const def of defs) {
    const key = `${def.courseId ?? ""}|${def.preferredTee ?? ""}`;
    let base = cache.get(key);
    if (!base) {
      base = await loadCourseHoles(def.courseId, def.preferredTee);
      cache.set(key, base);
    }
    const holes = base.length > 0 ? base.map((h) => ({ ...h, round: def.round })) : fallbackHoles(def.round);
    out.push(...holes);
  }
  return out;
}

export type LiveRoundData = {
  /** profile → event round number → live status of that round. */
  profileRoundStatus: Map<string, Map<number, { finished: boolean; holesInRound: number }>>;
  /** profile → holeKey(round, hole) → latest strokes. */
  completedByProfile: Map<string, Record<number, number>>;
  /**
   * Players whose leaderboard row is frozen for the ceremony. Their holes above
   * the freeze threshold have already been stripped from completedByProfile, so
   * the model can only see what a spectator sees.
   */
  frozenProfiles: Set<string>;
};

/** Live in-event rounds: per-player per-event-round status + latest scores. */
async function loadLiveRoundData(eventId: string, fallbackHoleCount: number): Promise<LiveRoundData> {
  // rounds ↔ event_tee_times are related in both directions, which makes a
  // PostgREST embed ambiguous — resolve the tee times first, then the rounds.
  const [{ data: teeTimes, error: ttErr }, { data: erRows }] = await Promise.all([
    supabaseAdmin.from("event_tee_times").select("id, event_round_id").eq("event_id", eventId),
    supabaseAdmin.from("event_rounds").select("id, round_number").eq("event_id", eventId),
  ]);
  if (ttErr) throw ttErr;
  const roundNumberByEventRoundId = new Map(
    ((erRows ?? []) as { id: string; round_number: number }[]).map((r) => [r.id, r.round_number])
  );
  const slots = (teeTimes ?? []) as { id: string; event_round_id: string | null }[];
  const teeTimeIds = slots.map((t) => t.id);
  const eventRoundOfTeeTime = new Map(
    slots.map((t) => [
      t.id,
      (t.event_round_id ? roundNumberByEventRoundId.get(t.event_round_id) : null) ?? 1,
    ])
  );

  if (teeTimeIds.length === 0) {
    return {
      profileRoundStatus: new Map(),
      completedByProfile: new Map(),
      frozenProfiles: new Set(),
    };
  }

  // Plain queries, no embed: rounds ↔ round_participants embeds are ambiguous
  // to PostgREST (junction-table inference via round_hole_states et al).
  const { data: liveRounds, error: liveErr } = await supabaseAdmin
    .from("rounds")
    .select("id, status, number_of_holes, event_tee_time_id")
    .in("event_tee_time_id", teeTimeIds);
  if (liveErr) throw liveErr;

  const rounds = (liveRounds ?? []) as {
    id: string; status: string; number_of_holes: number | null; event_tee_time_id: string | null;
  }[];
  const roundIds = rounds.map((r) => r.id);
  const roundById = new Map(rounds.map((r) => [r.id, r]));

  const participantToProfile = new Map<string, string>();
  const participantEventRound = new Map<string, number>();
  const profileRoundStatus = new Map<string, Map<number, { finished: boolean; holesInRound: number }>>();
  if (roundIds.length > 0) {
    const { data: partData, error: partErr } = await supabaseAdmin
      .from("round_participants")
      .select("id, round_id, profile_id")
      .in("round_id", roundIds);
    if (partErr) throw partErr;
    for (const p of (partData ?? []) as { id: string; round_id: string; profile_id: string | null }[]) {
      if (!p.profile_id) continue;
      const round = roundById.get(p.round_id);
      if (!round) continue;
      const eventRound = round.event_tee_time_id
        ? eventRoundOfTeeTime.get(round.event_tee_time_id) ?? 1
        : 1;
      participantToProfile.set(p.id, p.profile_id);
      participantEventRound.set(p.id, eventRound);
      const perRound = profileRoundStatus.get(p.profile_id) ?? new Map();
      perRound.set(eventRound, {
        finished: round.status === "finished",
        holesInRound: round.number_of_holes ?? fallbackHoleCount,
      });
      profileRoundStatus.set(p.profile_id, perRound);
    }
  }

  const completedByProfile = new Map<string, Record<number, number>>();
  if (roundIds.length > 0) {
    const { data: scoreData, error: scoreErr } = await supabaseAdmin
      .from("round_score_events")
      .select("participant_id, hole_number, strokes, created_at, id")
      .in("round_id", roundIds)
      .not("strokes", "is", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (scoreErr) throw scoreErr;
    for (const ev of (scoreData ?? []) as any[]) {
      const profileId = participantToProfile.get(ev.participant_id);
      if (!profileId) continue;
      const eventRound = participantEventRound.get(ev.participant_id) ?? 1;
      const map = completedByProfile.get(profileId) ?? {};
      map[holeKey(eventRound, ev.hole_number)] = ev.strokes; // ascending → last write wins
      completedByProfile.set(profileId, map);
    }
  }

  // ── Ceremony freeze ────────────────────────────────────────────────────
  // The leaderboard hides a frozen player's last N holes, but the model was
  // still pricing off every one of them — so the board published, to within a
  // stroke, the score the ceremony was hiding (measured: an outright drifting
  // 4.50 → 51.00 while the leaderboard showed "thru 12"). Strip the hidden
  // holes here, at the single point where live scores enter the engine, so
  // every market, cash-out quote and narrative downstream is leak-proof by
  // construction.
  const frozenProfiles = new Set<string>();
  const { data: freezeEvent } = await supabaseAdmin
    .from("events")
    .select("leaderboard_freeze_state")
    .eq("id", eventId)
    .maybeSingle();

  if ((freezeEvent as any)?.leaderboard_freeze_state === "frozen") {
    const { data: snaps } = await supabaseAdmin
      .from("event_player_freeze_snapshots")
      .select("profile_id, holes_shown")
      .eq("event_id", eventId);

    for (const s of (snaps ?? []) as { profile_id: string; holes_shown: number | null }[]) {
      if (!s.profile_id) continue;
      frozenProfiles.add(s.profile_id);
      const shown = s.holes_shown ?? 0;

      // holes_shown counts holes across the whole event, so keep the first N in
      // play order rather than filtering on hole number (which would be wrong
      // for a multi-round event, and for anyone starting on the 10th).
      const completed = completedByProfile.get(s.profile_id);
      if (completed) {
        const kept: Record<number, number> = {};
        const orderedKeys = Object.keys(completed)
          .map(Number)
          .sort((a, b) => a - b)
          .slice(0, shown);
        for (const k of orderedKeys) kept[k] = completed[k];
        completedByProfile.set(s.profile_id, kept);
      }

      // Their round being finished is itself part of what's hidden — leaving it
      // true would close their markets at exactly the moment they hole out.
      const perRound = profileRoundStatus.get(s.profile_id);
      if (perRound) {
        for (const [round, st] of perRound) {
          perRound.set(round, { ...st, finished: false });
        }
      }
    }
  }

  return { profileRoundStatus, completedByProfile, frozenProfiles };
}

function makeLiveCtx(event: EventRow, holes: SimHole[], liveData: LiveRoundData): LiveMarketCtx {
  const { profileRoundStatus, completedByProfile } = liveData;
  const parByKey = new Map<number, number>(
    holes.map((h) => [holeKey(h.round ?? 1, h.holeNumber), h.par])
  );
  const roundNumbers = [...new Set(holes.map((h) => h.round ?? 1))].sort((a, b) => a - b);
  const holesPerRound = new Map<number, number>();
  for (const h of holes) {
    const r = h.round ?? 1;
    holesPerRound.set(r, (holesPerRound.get(r) ?? 0) + 1);
  }

  const scoredInRound = (profileId: string, round: number): number => {
    const completed = completedByProfile.get(profileId) ?? {};
    let n = 0;
    for (const key of Object.keys(completed)) {
      if (Math.floor(Number(key) / 100) === round) n += 1;
    }
    return n;
  };

  const remainingInRound = (profileId: string, round: number): number => {
    const status = profileRoundStatus.get(profileId)?.get(round);
    if (status?.finished) return 0;
    const total = status?.holesInRound ?? holesPerRound.get(round) ?? 18;
    return Math.max(0, total - scoredInRound(profileId, round));
  };

  return {
    eventCompleted: ["completed", "cancelled"].includes(event.majors_status),
    frozen: (profileId) => liveData.frozenProfiles.has(profileId),
    roundComplete: (profileId, round) => {
      if (round != null) return profileRoundStatus.get(profileId)?.get(round)?.finished ?? false;
      const perRound = profileRoundStatus.get(profileId);
      if (!perRound) return false;
      return roundNumbers.every((r) => perRound.get(r)?.finished ?? false);
    },
    holesRemaining: (profileId, round) => {
      if (round != null) return remainingInRound(profileId, round);
      const perRound = profileRoundStatus.get(profileId);
      if (!perRound || perRound.size === 0) return Infinity; // nothing started
      return roundNumbers.reduce((s, r) => s + remainingInRound(profileId, r), 0);
    },
    currentBirdies: (profileId, round) => {
      const completed = completedByProfile.get(profileId) ?? {};
      let birdies = 0;
      for (const [key, strokes] of Object.entries(completed)) {
        if (round != null && Math.floor(Number(key) / 100) !== round) continue;
        const par = parByKey.get(Number(key));
        if (par != null && strokes <= par - 1) birdies += 1;
      }
      return birdies;
    },
    currentEagles: (profileId, round) => {
      const completed = completedByProfile.get(profileId) ?? {};
      let eagles = 0;
      for (const [key, strokes] of Object.entries(completed)) {
        if (round != null && Math.floor(Number(key) / 100) !== round) continue;
        const par = parByKey.get(Number(key));
        if (par != null && strokes <= par - 2) eagles += 1;
      }
      return eagles;
    },
    holeScore: (profileId, round, holeNumber) =>
      completedByProfile.get(profileId)?.[holeKey(round, holeNumber)] ?? null,
  };
}

/**
 * Lightweight context for placement / cash-out eligibility checks — no
 * profile rebuilds or handicap resolution, just event status + live scores.
 */
export async function loadPlacementContext(eventId: string): Promise<{
  event: EventRow;
  holes: SimHole[];
  live: LiveMarketCtx;
  liveData: LiveRoundData;
}> {
  const event = await loadEvent(eventId);
  let holes = await loadHoles(event);
  if (holes.length === 0) holes = fallbackHoles();
  const liveData = await loadLiveRoundData(eventId, holes.length);
  return { event, holes, live: makeLiveCtx(event, holes, liveData), liveData };
}

type ProvisionalPlayer = { profileId: string; attendanceProb: number };

/**
 * Active group members who haven't entered yet but should still appear in the
 * field, with their attendance probability (see lib/fantasy/attendance.ts).
 * Empty once the event is live/past or the 2-week cutoff has passed.
 */
async function loadProvisionalPlayers(
  event: EventRow,
  groupId: string,
  enteredIds: Set<string>
): Promise<ProvisionalPlayer[]> {
  const now = Date.now();
  const eventDate = event.event_date ? new Date(event.event_date).getTime() : null;
  if (eventDate == null || eventDate <= now) return [];
  if (["completed", "cancelled"].includes(event.majors_status)) return [];
  // Entry closed ⇒ the field is fixed: no one else can sign up, so price only
  // the confirmed entrants (no provisional attendance dilution).
  const entryEnd = event.entry_window_end ? new Date(event.entry_window_end).getTime() : null;
  if (entryEnd != null && now > entryEnd) return [];

  const { data: memberRows, error: memberErr } = await supabaseAdmin
    .from("major_group_memberships")
    .select("profile_id, joined_at")
    .eq("group_id", groupId)
    .eq("status", "active");
  if (memberErr) throw memberErr;
  const members = ((memberRows ?? []) as { profile_id: string; joined_at: string | null }[]).filter(
    (m) => !enteredIds.has(m.profile_id)
  );
  if (members.length === 0) return [];
  const memberIds = members.map((m) => m.profile_id);

  const [{ data: statRows }, { data: eventRows }] = await Promise.all([
    supabaseAdmin
      .from("profile_event_stats")
      .select("profile_id, events_played")
      .eq("group_id", groupId)
      .in("profile_id", memberIds),
    supabaseAdmin
      .from("events")
      .select("event_date, majors_status")
      .eq("group_id", groupId)
      .in("majors_status", ["completed", "official"]),
  ]);
  const playedBy = new Map(
    ((statRows ?? []) as { profile_id: string; events_played: number | null }[]).map((s) => [
      s.profile_id,
      Number(s.events_played ?? 0),
    ])
  );
  const heldDates = ((eventRows ?? []) as { event_date: string | null }[])
    .map((e) => (e.event_date ? new Date(e.event_date).getTime() : null))
    .filter((t): t is number => t != null);
  const windowStart = event.entry_window_start
    ? new Date(event.entry_window_start).getTime()
    : null;

  const out: ProvisionalPlayer[] = [];
  for (const m of members) {
    const joined = m.joined_at ? new Date(m.joined_at).getTime() : 0;
    const heldSinceJoin = heldDates.filter((d) => d >= joined).length;
    const participation = participationRate(playedBy.get(m.profile_id) ?? 0, heldSinceJoin);
    const p = computeAttendanceProbability(
      { entered: false, participation },
      now,
      eventDate,
      windowStart
    );
    if (p > 0) out.push({ profileId: m.profile_id, attendanceProb: Math.round(p * 1000) / 1000 });
  }
  return out;
}

export async function loadSimInputs(eventId: string): Promise<EventSimContext> {
  const event = await loadEvent(eventId);
  if (!event.group_id) throw new Error("Event has no group");
  const groupId = event.group_id;

  const { data: entryData, error: entryErr } = await supabaseAdmin
    .from("event_entries")
    .select(
      "profile_id, entry_status, assigned_handicap_index, assigned_course_handicap, assigned_playing_handicap"
    )
    .eq("event_id", eventId)
    .in("entry_status", ACTIVE_ENTRY_STATUSES);
  if (entryErr) throw entryErr;
  const entries = (entryData ?? []) as EntryRow[];
  const enteredIds = new Set(entries.map((e) => e.profile_id));

  // Not-yet-entered members carry an attendance probability that decays as the
  // event nears; the engine samples their presence each iteration.
  const provisional = await loadProvisionalPlayers(event, groupId, enteredIds);
  const provisionalIds = provisional.map((p) => p.profileId);
  const attendanceById = new Map(provisional.map((p) => [p.profileId, p.attendanceProb]));
  const fieldIds = [...enteredIds, ...provisionalIds];

  const [profiles, names] = await Promise.all([
    ensureProfiles(groupId, fieldIds),
    loadNames(fieldIds),
  ]);

  const profileHi = new Map<string, number | null>();
  for (const [pid, row] of profiles) profileHi.set(pid, row.handicap_index);

  // Provisional players get a synthetic entry (no assigned values) so their PH
  // resolves from profile HI × allowance — the same path the leaderboard uses.
  const provisionalEntries: EntryRow[] = provisionalIds.map((profile_id) => ({
    profile_id,
    entry_status: "provisional",
    assigned_handicap_index: null,
    assigned_course_handicap: null,
    assigned_playing_handicap: null,
  }));
  const allEntries = [...entries, ...provisionalEntries];

  let holes = await loadHoles(event);
  if (holes.length === 0) holes = fallbackHoles();

  // Handicaps resolve AFTER the holes load: converting a handicap index into a
  // course handicap needs the tee's slope/rating/par, which ride on SimHole.
  const playingHandicaps = resolvePlayingHandicaps(
    event,
    allEntries,
    profileHi,
    conversionFromHoles(holes)
  );

  const liveData = await loadLiveRoundData(eventId, holes.length);
  const { profileRoundStatus, completedByProfile } = liveData;

  const roundNumbers = [...new Set(holes.map((h) => h.round ?? 1))].sort((a, b) => a - b);
  const players: SimPlayer[] = allEntries.map((e) => {
    const stored = profiles.get(e.profile_id)!;
    const perRound = profileRoundStatus.get(e.profile_id);
    const completedRounds = roundNumbers.filter((r) => perRound?.get(r)?.finished ?? false);
    const attendanceProb = attendanceById.get(e.profile_id);
    return {
      profileId: e.profile_id,
      displayName: names[e.profile_id] ?? "Player",
      profile: toSimProfile(stored),
      playingHandicap: playingHandicaps.get(e.profile_id) ?? 0,
      completedHoles: completedByProfile.get(e.profile_id) ?? {},
      roundComplete: roundNumbers.length > 0 && completedRounds.length === roundNumbers.length,
      completedRounds,
      ...(attendanceProb != null ? { attendanceProb } : {}),
    };
  });

  // Rank the sim on the event's scoring format so pricing matches settlement:
  // stableford ranks on points, gross on gross strokes, everything else on net.
  const rankingBasis: RankingBasis =
    event.scoring_model === "stableford_points"
      ? "stableford"
      : event.scoring_model === "gross"
      ? "gross"
      : "net";

  return {
    event,
    groupId,
    players,
    holes,
    rankingBasis,
    names,
    live: makeLiveCtx(event, holes, liveData),
  };
}

async function loadNames(profileIds: string[]): Promise<Record<string, string>> {
  if (profileIds.length === 0) return {};
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, name")
    .in("id", profileIds);
  if (error) throw error;
  const out: Record<string, string> = {};
  for (const p of (data ?? []) as { id: string; name: string | null }[]) {
    out[p.id] = p.name ?? "Player";
  }
  return out;
}

export function simulateEvent(ctx: EventSimContext, version: number): SimulationResult {
  return runSimulation({
    players: ctx.players,
    holes: ctx.holes,
    rankingBasis: ctx.rankingBasis,
    simulationCount: pickSimulationCount(ctx.players.length),
    seed: hashSeed(ctx.event.id, version),
  });
}

async function readState(eventId: string): Promise<FantasyEventState | null> {
  const { data, error } = await supabaseAdmin
    .from("fantasy_event_state")
    .select("*")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw error;
  return (data as FantasyEventState | null) ?? null;
}

async function writeSnapshots(
  ctx: EventSimContext,
  sim: SimulationResult,
  markets: FantasyMarket[],
  version: number
): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  const writtenMarketIds = new Set<string>();
  for (const market of markets) {
    if (market.status !== "open") continue;
    const def = getMarketDefinition(market.market_type);
    if (!def) continue;
    for (const [selectionKey, probability] of def.simulate(sim, market)) {
      const clamped = clampProbability(probability);
      rows.push({
        market_id: market.id,
        event_id: ctx.event.id,
        group_id: ctx.groupId,
        selection_key: selectionKey,
        event_version: version,
        probability: clamped,
        decimal_odds: probabilityToDecimalOdds(probability),
        simulation_count: sim.simulationCount,
        status: "active",
      });
      writtenMarketIds.add(market.id);
    }
  }

  if (rows.length > 0) {
    const { error } = await supabaseAdmin
      .from("fantasy_odds_snapshots")
      .upsert(rows, { onConflict: "market_id,selection_key,event_version" });
    if (error) throw error;
  }

  // Supersede prior-version active snapshots — but ONLY for markets we either
  // just re-priced or that are no longer open. An OPEN market we couldn't price
  // this version (e.g. its subject was momentarily absent from the field) keeps
  // its last good snapshot; blanking it would punch a hole in the ladder (the
  // "1+ shows, 2+ blank, 3+ shows" bug). Settled/suspended markets are not in
  // writtenMarketIds, so they still get superseded and correctly drop out.
  const keepMarketIds = markets
    .filter((m) => m.status === "open" && !writtenMarketIds.has(m.id))
    .map((m) => m.id);
  let supersede = supabaseAdmin
    .from("fantasy_odds_snapshots")
    .update({ status: "superseded" })
    .eq("event_id", ctx.event.id)
    .lt("event_version", version)
    .eq("status", "active");
  if (keepMarketIds.length > 0) {
    supersede = supersede.not("market_id", "in", `(${keepMarketIds.join(",")})`);
  }
  const { error: supersedeErr } = await supersede;
  if (supersedeErr) throw supersedeErr;

  // Persist each player's exact per-score distribution (gross + net) so
  // score_band / score_total cash-out and settlement can price a pick's OWN
  // band/value from the current book, independent of the drifting offered set.
  // Best-effort — a pmf write must never fail the reprice (cash-out falls back
  // to the snapshot when a pmf row is missing).
  await writeScorePmfs(ctx, sim, version).catch((e) =>
    console.error(`[fantasy] writeScorePmfs failed for ${ctx.event.id}`, e)
  );
}

/** Round to keep the jsonb compact; well within odds-floor (0.001) resolution. */
function trimProbs(probs: number[]): number[] {
  return probs.map((x) => Math.round(x * 1e7) / 1e7);
}

async function writeScorePmfs(
  ctx: EventSimContext,
  sim: SimulationResult,
  version: number
): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  for (const p of sim.players) {
    const analytic = p.analytic;
    const { gross, net } = analytic
      ? analyticDistributions(analytic)
      : {
          // Fully-played (deterministic): a spike at the single realized total.
          gross: { min: p.grossTotals[0] ?? 0, probs: [1] },
          net: { min: p.netTotals[0] ?? 0, probs: [1] },
        };
    for (const [basis, pmf] of [["gross", gross], ["net", net]] as const) {
      rows.push({
        event_id: ctx.event.id,
        profile_id: p.profileId,
        basis,
        pmf_min: pmf.min,
        pmf_probs: trimProbs(pmf.probs),
        event_version: version,
      });
    }
  }
  if (rows.length === 0) return;
  const { error } = await supabaseAdmin
    .from("fantasy_score_pmfs")
    .upsert(rows, { onConflict: "event_id,profile_id,basis" });
  if (error) throw error;
}

/**
 * Materialize registry markets for the event, inserting any shapes not yet
 * present (new entrants, newly shipped market types). Never deletes or
 * duplicates — existing markets (and any picks on them) are untouched.
 * Runs on generation AND on every refresh, so a player entering after the
 * initial generation still gets their H2H/O-U/birdie markets.
 */
function meanOf(totals: Int16Array): number {
  let s = 0;
  for (let i = 0; i < totals.length; i++) s += totals[i];
  return totals.length > 0 ? s / totals.length : 0;
}

async function ensureMarkets(
  ctx: EventSimContext,
  sim: SimulationResult
): Promise<number> {
  const projections: GenerateCtx["projections"] = {};
  for (const p of sim.players) {
    const rounds: Record<number, { meanGross: number; meanNet: number }> = {};
    for (const [r, totals] of Object.entries(p.roundGrossTotals)) {
      rounds[Number(r)] = {
        meanGross: meanOf(totals),
        meanNet: meanOf(p.roundNetTotals[Number(r)]),
      };
    }
    projections[p.profileId] = { meanGross: p.meanGross, meanNet: p.meanNet, rounds };
  }
  const generateCtx: GenerateCtx = {
    players: ctx.players.map((p) => ({
      profileId: p.profileId,
      provisional: (p.attendanceProb ?? 1) < 1,
      playingHandicap: p.playingHandicap,
    })),
    projections,
    rounds: [...new Set(ctx.holes.map((h) => h.round ?? 1))].sort((a, b) => a - b),
    holes: ctx.holes.map((h) => ({ holeNumber: h.holeNumber, par: h.par, round: h.round ?? 1 })),
  };
  const specs: MarketSpec[] = Object.values(MARKET_REGISTRY).flatMap((def) =>
    def.generateMarkets(generateCtx)
  );

  // The shape uniqueness index uses COALESCE expressions, which PostgREST
  // upserts can't target — diff against existing markets in TS and bulk-insert
  // only the missing shapes. A concurrent-generate race can still 23505; fall
  // back to per-row inserts for that case only.
  const { data: existingData, error: existingErr } = await supabaseAdmin
    .from("fantasy_markets")
    .select("market_type, subject_profile_id, opponent_profile_id, params")
    .eq("event_id", ctx.event.id);
  if (existingErr) throw existingErr;
  const existingKeys = new Set(
    ((existingData ?? []) as FantasyMarket[]).map((m) => marketShapeKey(m))
  );
  const missingRows = specs
    .filter((s) => !existingKeys.has(marketShapeKey(s)))
    .map((s) => ({
      event_id: ctx.event.id,
      group_id: ctx.groupId,
      market_type: s.market_type,
      subject_profile_id: s.subject_profile_id ?? null,
      opponent_profile_id: s.opponent_profile_id ?? null,
      params: s.params,
      status: "open",
    }));

  if (missingRows.length > 0) {
    const { error: bulkErr } = await supabaseAdmin.from("fantasy_markets").insert(missingRows);
    if (bulkErr && bulkErr.code === "23505") {
      for (const row of missingRows) {
        const { error: insErr } = await supabaseAdmin.from("fantasy_markets").insert(row);
        if (insErr && insErr.code !== "23505") throw insErr;
      }
    } else if (bulkErr) {
      throw bulkErr;
    }
  }
  return missingRows.length;
}

/**
 * Run one refresh for a claimed job. The "mark fresh" update is guarded on
 * the version we simulated — if a change bumped it mid-run, odds stay stale
 * and the (re-pended) job re-runs on the next request.
 */
async function executeRefresh(eventId: string, jobId: string): Promise<void> {
  try {
    const state = await readState(eventId);
    if (!state) throw new Error("fantasy_event_state missing");
    const version = state.version;

    const ctx = await loadSimInputs(eventId);
    const sim = simulateEvent(ctx, version);

    // New entrants since generation get their per-player markets here.
    await ensureMarkets(ctx, sim);

    const { data: marketData, error: marketErr } = await supabaseAdmin
      .from("fantasy_markets")
      .select("*")
      .eq("event_id", eventId);
    if (marketErr) throw marketErr;

    await writeSnapshots(ctx, sim, (marketData ?? []) as FantasyMarket[], version);

    // Retain the joint positions matrix for correlated-acca pricing. Best-effort
    // — accas fall back to the independent product if it's missing.
    await writeJointSamples(eventId, ctx.groupId, version, sim).catch((e) =>
      console.error(`[fantasy] writeJointSamples failed for ${eventId}`, e)
    );

    // Best-effort — a narrative failure must never fail the reprice.
    const narrative = await generateNarrative(ctx, sim, version, allowancePct(ctx.event)).catch(
      () => null
    );

    await supabaseAdmin
      .from("fantasy_event_state")
      .update({
        odds_stale: false,
        last_refreshed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...(narrative ? { narrative } : {}),
      })
      .eq("event_id", eventId)
      .eq("version", version);

    await supabaseAdmin
      .from("fantasy_refresh_jobs")
      .update({ status: "done", updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .eq("status", "running");

    // Multi-round: settle any round-scoped markets whose round just finished.
    // Best-effort (cron is the safety net); dynamic import avoids the
    // odds ↔ settlement module cycle.
    if ((ctx.event.num_rounds ?? 1) > 1) {
      import("@/lib/fantasy/settlement")
        .then(({ settleFantasyRoundMarkets }) => settleFantasyRoundMarkets(eventId))
        .catch(() => {});
    }
  } catch (e: any) {
    await supabaseAdmin
      .from("fantasy_refresh_jobs")
      .update({
        status: "failed",
        last_error: String(e?.message ?? e).slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    throw e;
  }
}

/**
 * Refresh odds if stale, respecting debounce unless forced.
 * Returns whether fresh odds are now available and whether a refresh is
 * running elsewhere.
 */
export async function refreshIfStale(
  eventId: string,
  opts: { force?: boolean } = {}
): Promise<{ refreshed: boolean; refreshing: boolean }> {
  const state = await readState(eventId);
  if (!state || state.is_final) return { refreshed: false, refreshing: false };
  if (!state.odds_stale && !opts.force) return { refreshed: false, refreshing: false };

  const { data: jobId, error } = await supabaseAdmin.rpc("ciaga_fantasy_claim_refresh_job", {
    p_event_id: eventId,
    p_ignore_debounce: !!opts.force,
    p_locked_by: randomUUID(),
  });
  if (error) throw error;

  if (!jobId) {
    // Someone else is refreshing, or we're inside the debounce window.
    const { data: liveJob } = await supabaseAdmin
      .from("fantasy_refresh_jobs")
      .select("status")
      .eq("event_id", eventId)
      .in("status", ["pending", "running"])
      .maybeSingle();
    return { refreshed: false, refreshing: (liveJob as { status?: string } | null)?.status === "running" };
  }

  await executeRefresh(eventId, jobId as string);
  return { refreshed: true, refreshing: false };
}

/**
 * Recursively sort object keys so a params value stringifies identically no
 * matter the key order — matching how Postgres jsonb normalizes. Without this,
 * a spec's params (generation key order) and the same row read back from jsonb
 * (jsonb key order) produced DIFFERENT shape keys for nested objects (e.g.
 * score_band `bands:[{key,lo,hi}]`), so `ensureMarkets` mis-detected existing
 * markets and re-ran its 23505/per-row fallback every refresh.
 */
function canonicalizeJson(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalizeJson);
  if (v && typeof v === "object") {
    const src = v as Record<string, unknown>;
    return Object.keys(src)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = canonicalizeJson(src[k]);
        return acc;
      }, {});
  }
  return v;
}

/** Shape identity for market dedupe (params canonicalized for stability). */
function marketShapeKey(m: {
  market_type: string;
  subject_profile_id?: string | null;
  opponent_profile_id?: string | null;
  params: Record<string, unknown>;
}): string {
  return [
    m.market_type,
    m.subject_profile_id ?? "",
    m.opponent_profile_id ?? "",
    JSON.stringify(canonicalizeJson(m.params ?? {})),
  ].join("|");
}

/**
 * Generate (or re-generate) fantasy for an event: activate state, rebuild the
 * field's performance profiles, materialize markets from the registry, and
 * price the initial snapshots. Idempotent — safe to call repeatedly.
 */
export async function generateEventFantasy(eventId: string): Promise<{ markets: number }> {
  const t0 = Date.now();
  let tPhase = t0;
  const logPhase = (label: string) => {
    console.log(`[fantasy-generate] ${eventId} ${label}: ${Date.now() - tPhase}ms`);
    tPhase = Date.now();
  };

  const event = await loadEvent(eventId);
  if (!event.group_id) throw new Error("Event has no group");
  if (["completed", "cancelled"].includes(event.majors_status)) {
    throw new Error("Event is already finished");
  }

  const { data: groupRow, error: groupErr } = await supabaseAdmin
    .from("major_groups")
    .select("fantasy_config")
    .eq("id", event.group_id)
    .single();
  if (groupErr) throw groupErr;
  if (!readFantasyConfig((groupRow as { fantasy_config: unknown }).fantasy_config)) {
    throw new Error("Fantasy picks are not enabled for this group");
  }

  // Activate versioning (row existence gates the staleness triggers).
  const { error: stateErr } = await supabaseAdmin
    .from("fantasy_event_state")
    .insert({ event_id: eventId, group_id: event.group_id, changed_reason: "generated" });
  if (stateErr && stateErr.code !== "23505") throw stateErr;
  logPhase("checks+state");

  const ctx = await loadSimInputs(eventId);
  if (ctx.players.length < 2) throw new Error("Need at least 2 players in the field");
  logPhase(`inputs+profiles (${ctx.players.length} players)`);

  const state = await readState(eventId);
  const version = state?.version ?? 1;
  const sim = simulateEvent(ctx, version);
  logPhase("simulation");

  const newMarkets = await ensureMarkets(ctx, sim);
  logPhase(`markets (${newMarkets} new)`);

  const { data: marketData, error: marketSelErr } = await supabaseAdmin
    .from("fantasy_markets")
    .select("*")
    .eq("event_id", eventId);
  if (marketSelErr) throw marketSelErr;
  const markets = (marketData ?? []) as FantasyMarket[];

  await writeSnapshots(ctx, sim, markets, version);
  await writeJointSamples(eventId, ctx.groupId, version, sim).catch((e) =>
    console.error(`[fantasy] writeJointSamples failed for ${eventId}`, e)
  );
  const narrative = await generateNarrative(ctx, sim, version, allowancePct(ctx.event)).catch(
    () => null
  );
  await supabaseAdmin
    .from("fantasy_event_state")
    .update({
      odds_stale: false,
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(narrative ? { narrative } : {}),
    })
    .eq("event_id", eventId)
    .eq("version", version);
  logPhase("snapshots");
  console.log(`[fantasy-generate] ${eventId} total: ${Date.now() - t0}ms`);

  return { markets: markets.length };
}
