import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { readFantasyConfig } from "@/lib/fantasy/config";
import { ensureProfiles, toSimProfile } from "@/lib/fantasy/profiles";
import { getMarketDefinition, MARKET_REGISTRY } from "@/lib/fantasy/markets/registry";
import type { FantasyMarket, LiveMarketCtx, MarketSpec } from "@/lib/fantasy/markets/types";
import { runSimulation, pickSimulationCount } from "@/lib/fantasy/simulation/engine";
import { hashSeed } from "@/lib/fantasy/simulation/rng";
import {
  clampProbability,
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

type EventRow = {
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
};

type EntryRow = {
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

const ACTIVE_ENTRY_STATUSES = ["entered", "approved"];

async function loadEvent(eventId: string): Promise<EventRow> {
  const { data, error } = await supabaseAdmin
    .from("events")
    .select(
      "id, name, group_id, course_id, event_date, majors_status, scoring_model, scoring_basis, handicap_rules, num_rounds"
    )
    .eq("id", eventId)
    .single();
  if (error) throw error;
  return data as EventRow;
}

function allowancePct(event: EventRow): number {
  const rules = event.handicap_rules as { mode?: string; allowance_pct?: number | string | null } | null;
  if (!rules || rules.mode === "none") return 0;
  const pct = Number(rules.allowance_pct);
  if (!Number.isFinite(pct) || pct <= 0) return 100;
  return pct;
}

/**
 * Event playing handicap per player. Uses the same source as the leaderboard
 * (event_entries assigned values), so net market pricing matches settlement:
 * assigned_playing_handicap → CH × allowance → HI × allowance → profile HI.
 * compare_against_lowest mode nets everyone against the field's lowest.
 */
function resolvePlayingHandicaps(
  event: EventRow,
  entries: EntryRow[],
  profileHi: Map<string, number | null>
): Map<string, number> {
  const rules = event.handicap_rules as { mode?: string } | null;
  const pct = allowancePct(event);
  const out = new Map<string, number>();

  const courseHandicap = (e: EntryRow): number | null => {
    if (e.assigned_course_handicap != null) return Number(e.assigned_course_handicap);
    if (e.assigned_handicap_index != null) return Number(e.assigned_handicap_index);
    return profileHi.get(e.profile_id) ?? null;
  };

  if (rules?.mode === "none") {
    for (const e of entries) out.set(e.profile_id, 0);
    return out;
  }

  if (rules?.mode === "compare_against_lowest") {
    const chs = entries.map((e) => courseHandicap(e) ?? 0);
    const lowest = chs.length > 0 ? Math.min(...chs) : 0;
    entries.forEach((e, i) => {
      out.set(e.profile_id, Math.round((chs[i] - lowest) * (pct / 100)));
    });
    return out;
  }

  for (const e of entries) {
    if (e.assigned_playing_handicap != null) {
      out.set(e.profile_id, Number(e.assigned_playing_handicap));
    } else {
      const ch = courseHandicap(e) ?? 0;
      out.set(e.profile_id, Math.round(ch * (pct / 100)));
    }
  }
  return out;
}

async function loadHoles(event: EventRow): Promise<SimHole[]> {
  if (!event.course_id) return [];

  // Prefer the round-1 default tee; otherwise the first tee with 18 holes.
  const { data: eventRounds } = await supabaseAdmin
    .from("event_rounds")
    .select("round_number, default_tee_box_id_male, default_tee_box_id_female")
    .eq("event_id", event.id)
    .order("round_number", { ascending: true })
    .limit(1);
  const preferredTee =
    (eventRounds?.[0] as { default_tee_box_id_male?: string | null } | undefined)
      ?.default_tee_box_id_male ??
    (eventRounds?.[0] as { default_tee_box_id_female?: string | null } | undefined)
      ?.default_tee_box_id_female ??
    null;

  const { data: tees, error: teeErr } = await supabaseAdmin
    .from("course_tee_boxes")
    .select("id, holes_count, gender, name")
    .eq("course_id", event.course_id);
  if (teeErr) throw teeErr;
  const teeRows = (tees ?? []) as { id: string; holes_count: number | null }[];
  const teeId =
    preferredTee && teeRows.some((t) => t.id === preferredTee)
      ? preferredTee
      : (teeRows.find((t) => (t.holes_count ?? 18) >= 18) ?? teeRows[0])?.id;
  if (!teeId) return [];

  const { data: holes, error: holeErr } = await supabaseAdmin
    .from("course_tee_holes")
    .select("hole_number, par, yardage, handicap")
    .eq("tee_box_id", teeId)
    .order("hole_number", { ascending: true });
  if (holeErr) throw holeErr;

  return ((holes ?? []) as { hole_number: number; par: number | null; yardage: number | null; handicap: number | null }[])
    .filter((h) => h.par != null)
    .map((h) => ({
      holeNumber: h.hole_number,
      par: h.par as number,
      yardage: h.yardage,
      strokeIndex: h.handicap ?? h.hole_number,
    }));
}

/** Standard-par fallback so pre-course events can still be simulated. */
function fallbackHoles(): SimHole[] {
  const pars = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
  return pars.map((par, i) => ({
    holeNumber: i + 1,
    par,
    yardage: null,
    strokeIndex: i + 1,
  }));
}

export type LiveRoundData = {
  profileRoundStatus: Map<string, { finished: boolean; holesInRound: number }>;
  completedByProfile: Map<string, Record<number, number>>;
};

/** Live in-event rounds: per-player round status + latest score per hole. */
async function loadLiveRoundData(eventId: string, fallbackHoleCount: number): Promise<LiveRoundData> {
  // rounds ↔ event_tee_times are related in both directions, which makes a
  // PostgREST embed ambiguous — resolve the tee times first, then the rounds.
  const { data: teeTimes, error: ttErr } = await supabaseAdmin
    .from("event_tee_times")
    .select("id")
    .eq("event_id", eventId);
  if (ttErr) throw ttErr;
  const teeTimeIds = ((teeTimes ?? []) as { id: string }[]).map((t) => t.id);

  if (teeTimeIds.length === 0) {
    return { profileRoundStatus: new Map(), completedByProfile: new Map() };
  }

  const { data: liveRounds, error: liveErr } = await supabaseAdmin
    .from("rounds")
    .select("id, status, number_of_holes, event_tee_time_id, round_participants(id, profile_id)")
    .in("event_tee_time_id", teeTimeIds);
  if (liveErr) throw liveErr;

  const participantToProfile = new Map<string, string>();
  const profileRoundStatus = new Map<string, { finished: boolean; holesInRound: number }>();
  const roundIds: string[] = [];
  for (const r of (liveRounds ?? []) as any[]) {
    roundIds.push(r.id);
    for (const p of r.round_participants ?? []) {
      if (!p.profile_id) continue;
      participantToProfile.set(p.id, p.profile_id);
      profileRoundStatus.set(p.profile_id, {
        finished: r.status === "finished",
        holesInRound: r.number_of_holes ?? fallbackHoleCount,
      });
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
      const map = completedByProfile.get(profileId) ?? {};
      map[ev.hole_number] = ev.strokes; // ascending order → last write wins
      completedByProfile.set(profileId, map);
    }
  }

  return { profileRoundStatus, completedByProfile };
}

function makeLiveCtx(event: EventRow, holes: SimHole[], liveData: LiveRoundData): LiveMarketCtx {
  const { profileRoundStatus, completedByProfile } = liveData;
  const parByHole = new Map<number, number>(holes.map((h) => [h.holeNumber, h.par]));
  return {
    eventCompleted: ["completed", "cancelled"].includes(event.majors_status),
    roundComplete: (profileId) => profileRoundStatus.get(profileId)?.finished ?? false,
    holesRemaining: (profileId) => {
      const status = profileRoundStatus.get(profileId);
      if (!status) return Infinity; // round not started
      if (status.finished) return 0;
      const scored = Object.keys(completedByProfile.get(profileId) ?? {}).length;
      return Math.max(0, status.holesInRound - scored);
    },
    currentBirdies: (profileId) => {
      const completed = completedByProfile.get(profileId) ?? {};
      let birdies = 0;
      for (const [holeNumber, strokes] of Object.entries(completed)) {
        const par = parByHole.get(Number(holeNumber));
        if (par != null && strokes <= par - 1) birdies += 1;
      }
      return birdies;
    },
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
  const fieldIds = entries.map((e) => e.profile_id);

  const [profiles, names] = await Promise.all([
    ensureProfiles(groupId, fieldIds),
    loadNames(fieldIds),
  ]);

  const profileHi = new Map<string, number | null>();
  for (const [pid, row] of profiles) profileHi.set(pid, row.handicap_index);
  const playingHandicaps = resolvePlayingHandicaps(event, entries, profileHi);

  let holes = await loadHoles(event);
  if (holes.length === 0) holes = fallbackHoles();

  const liveData = await loadLiveRoundData(eventId, holes.length);
  const { profileRoundStatus, completedByProfile } = liveData;

  const players: SimPlayer[] = entries.map((e) => {
    const stored = profiles.get(e.profile_id)!;
    const status = profileRoundStatus.get(e.profile_id);
    return {
      profileId: e.profile_id,
      displayName: names[e.profile_id] ?? "Player",
      profile: toSimProfile(stored),
      playingHandicap: playingHandicaps.get(e.profile_id) ?? 0,
      completedHoles: completedByProfile.get(e.profile_id) ?? {},
      roundComplete: status?.finished ?? false,
    };
  });

  const rankingBasis: RankingBasis = event.scoring_model === "gross" ? "gross" : "net";

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
    }
  }

  if (rows.length > 0) {
    const { error } = await supabaseAdmin
      .from("fantasy_odds_snapshots")
      .upsert(rows, { onConflict: "market_id,selection_key,event_version" });
    if (error) throw error;
  }

  const { error: supersedeErr } = await supabaseAdmin
    .from("fantasy_odds_snapshots")
    .update({ status: "superseded" })
    .eq("event_id", ctx.event.id)
    .lt("event_version", version)
    .eq("status", "active");
  if (supersedeErr) throw supersedeErr;
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

    const { data: marketData, error: marketErr } = await supabaseAdmin
      .from("fantasy_markets")
      .select("*")
      .eq("event_id", eventId);
    if (marketErr) throw marketErr;

    await writeSnapshots(ctx, sim, (marketData ?? []) as FantasyMarket[], version);

    await supabaseAdmin
      .from("fantasy_event_state")
      .update({
        odds_stale: false,
        last_refreshed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("event_id", eventId)
      .eq("version", version);

    await supabaseAdmin
      .from("fantasy_refresh_jobs")
      .update({ status: "done", updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .eq("status", "running");
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

/** Shape identity for market dedupe (params entries sorted for stability). */
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
    JSON.stringify(Object.entries(m.params ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))),
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
  if ((event.num_rounds ?? 1) > 1) {
    throw new Error("Fantasy picks support single-round events only (V1)");
  }
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
  if (ctx.players.length < 2) throw new Error("Need at least 2 entered players");
  logPhase(`inputs+profiles (${ctx.players.length} players)`);

  const state = await readState(eventId);
  const version = state?.version ?? 1;
  const sim = simulateEvent(ctx, version);
  logPhase("simulation");

  const projections: Record<string, { meanGross: number; meanNet: number }> = {};
  for (const p of sim.players) {
    projections[p.profileId] = { meanGross: p.meanGross, meanNet: p.meanNet };
  }

  const generateCtx = {
    players: ctx.players.map((p) => ({ profileId: p.profileId })),
    projections,
  };
  const specs: MarketSpec[] = Object.values(MARKET_REGISTRY).flatMap((def) =>
    def.generateMarkets(generateCtx)
  );

  // The shape uniqueness index uses COALESCE expressions, which PostgREST
  // upserts can't target — diff against existing markets in TS and bulk-insert
  // only the missing shapes (re-generation adds new entrants' markets without
  // duplicating). A concurrent-generate race can still 23505; fall back to
  // per-row inserts for that case only.
  const { data: existingData, error: existingErr } = await supabaseAdmin
    .from("fantasy_markets")
    .select("market_type, subject_profile_id, opponent_profile_id, params")
    .eq("event_id", eventId);
  if (existingErr) throw existingErr;
  const existingKeys = new Set(
    ((existingData ?? []) as FantasyMarket[]).map((m) => marketShapeKey(m))
  );
  const missingRows = specs
    .filter((s) => !existingKeys.has(marketShapeKey(s)))
    .map((s) => ({
      event_id: eventId,
      group_id: event.group_id,
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
  logPhase(`markets (${missingRows.length} new)`);

  const { data: marketData, error: marketSelErr } = await supabaseAdmin
    .from("fantasy_markets")
    .select("*")
    .eq("event_id", eventId);
  if (marketSelErr) throw marketSelErr;
  const markets = (marketData ?? []) as FantasyMarket[];

  await writeSnapshots(ctx, sim, markets, version);
  await supabaseAdmin
    .from("fantasy_event_state")
    .update({
      odds_stale: false,
      last_refreshed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("event_id", eventId)
    .eq("version", version);
  logPhase("snapshots");
  console.log(`[fantasy-generate] ${eventId} total: ${Date.now() - t0}ms`);

  return { markets: markets.length };
}
