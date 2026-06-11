import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  parseXlsx,
  type ParsedComp,
  type ParsedPot,
  type ParsedRound,
  type ParsedScore,
  type ParsedWorkbook,
} from "@/lib/admin/season-import/parse";
import { resolveTemplateDefaults, type TemplateDefaults } from "@/lib/admin/season-import/templates";
import { teeDateTime, holeTime, roundFinishTime } from "@/lib/admin/season-import/timing";
import { importPrizePots } from "@/lib/admin/season-import/importers/pots";
import { importCharges, importPayments } from "@/lib/admin/season-import/importers/money";
import { importPlayoffs } from "@/lib/admin/season-import/importers/playoffs";
import { backfillFeedForRounds } from "@/lib/admin/season-import/importers/feed";

export const runtime = "nodejs";
// Multi-season imports replay every scorecard hole-by-hole — allow the full
// Vercel function budget rather than the default timeout.
export const maxDuration = 300;

type TeeHole = {
  hole_number: number;
  par: number | null;
  yardage: number | null;
  handicap: number | null;
};

// ── POST handler ──────────────────────────────────────────────────────────────
// Form fields:
//   file         — the .xlsx workbook (template v4)
//   group_id     — target group
//   season_names — optional JSON array; restricts this run to those seasons
//                  (the UI imports big workbooks one season per request)
//   phase        — "all" (default) | "events" | "finalize"
//                  "events"   = create everything for the (filtered) seasons but
//                               skip the global finishing steps
//                  "finalize" = run only the finishing steps for the whole file:
//                               standings recompute, handicap replay, feed backfill,
//                               group-level payments

export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdmin();

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing Authorization token" }, { status: 401 });

    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const { data: myProfile, error: pErr } = await admin
      .from("profiles")
      .select("id,is_admin")
      .eq("owner_user_id", userRes.user.id)
      .single();

    if (pErr) throw new Error(pErr.message);
    if (!myProfile?.is_admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    const form    = await req.formData();
    const file    = form.get("file")     as File | null;
    const groupId = form.get("group_id") as string | null;
    const phase   = ((form.get("phase") as string | null) || "all") as "all" | "events" | "finalize";

    let seasonFilter: Set<string> | null = null;
    const seasonNamesRaw = form.get("season_names") as string | null;
    if (seasonNamesRaw) {
      try {
        const arr = JSON.parse(seasonNamesRaw);
        if (Array.isArray(arr) && arr.length) seasonFilter = new Set(arr.map(String));
      } catch {
        return NextResponse.json({ error: "season_names must be a JSON array" }, { status: 400 });
      }
    }

    if (!file)    return NextResponse.json({ error: "Missing file" },     { status: 400 });
    if (!groupId) return NextResponse.json({ error: "Missing group_id" }, { status: 400 });

    const { parsed: fullParsed, errors: parseErrors } = await parseXlsx(file);
    if (parseErrors.length) {
      return NextResponse.json({ error: parseErrors[0], errors: parseErrors }, { status: 400 });
    }

    const summary = makeSummary();

    if (phase === "finalize") {
      // Chunked imports always end with an explicit finalize — the handicap
      // replay must run because rounds were created by earlier requests.
      await finalizeImport({ admin, groupId, recordedBy: myProfile.id, parsed: fullParsed, summary, refreshHandicaps: true });
      return NextResponse.json({ ok: true, summary });
    }

    const parsed = seasonFilter ? filterBySeasons(fullParsed, seasonFilter) : fullParsed;

    await importSeasons({ admin, groupId, recordedBy: myProfile.id, parsed, summary });

    if (phase === "all") {
      // Skip the (expensive) handicap replay when this run imported nothing new.
      await finalizeImport({ admin, groupId, recordedBy: myProfile.id, parsed: fullParsed, summary, refreshHandicaps: summary.rounds_created > 0 });
    }

    return NextResponse.json({ ok: true, summary });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}

function makeSummary() {
  return {
    seasons_created: [] as string[],
    events_created: [] as string[],
    rounds_created: 0,
    participants_created: 0,
    members_enrolled: 0,
    score_events_created: 0,
    competition_entries_created: 0,
    fee_transactions_created: 0,
    event_submissions_created: 0,
    leaderboards_computed: 0,
    prize_pots_created: 0,
    pot_entries_created: 0,
    pot_payouts_created: 0,
    pot_entry_fee_transactions: 0,
    pot_winnings_transactions: 0,
    event_charges_created: 0,
    player_charges_created: 0,
    charge_transactions_created: 0,
    payment_transactions_created: 0,
    payments_skipped: 0,
    playoffs_created: 0,
    playoffs_skipped: 0,
    standings_recomputed: 0,
    handicaps_refreshed_from: null as string | null,
    feed_items_created: 0,
    skipped_already_imported: [] as string[],
    competition_round_ids: [] as Array<{ competition_name: string; event_name: string; competition_id: string; round_id: string }>,
  };
}
type Summary = ReturnType<typeof makeSummary>;

// Restrict a parsed workbook to the given seasons (events of other seasons and
// everything hanging off them are dropped). Group-level payments (no event) are
// left to the finalize phase.
function filterBySeasons(parsed: ParsedWorkbook, seasons: Set<string>): ParsedWorkbook {
  const competitions = parsed.competitions.filter(c => seasons.has(c.season_name));
  const eventNames = new Set(competitions.map(c => c.event_name));
  return {
    seasons:      parsed.seasons.filter(s => seasons.has(s.season_name)),
    competitions,
    scores:       parsed.scores.filter(s => eventNames.has(s.competition_name)),
    eventRounds:  parsed.eventRounds.filter(r => eventNames.has(r.event_name)),
    pots:         parsed.pots.filter(p => eventNames.has(p.event_name)),
    payouts:      parsed.payouts.filter(p => eventNames.has(p.event_name)),
    charges:      parsed.charges.filter(c => eventNames.has(c.event_name)),
    payments:     parsed.payments.filter(p => !!p.event_name && eventNames.has(p.event_name)),
    playoffs:     parsed.playoffs.filter(p => eventNames.has(p.event_name)),
  };
}

// ── Core per-season(s) import ─────────────────────────────────────────────────

async function importSeasons(args: {
  admin: ReturnType<typeof getSupabaseAdmin>;
  groupId: string;
  recordedBy: string;
  parsed: ParsedWorkbook;
  summary: Summary;
}) {
  const { admin, groupId, recordedBy, parsed, summary } = args;
  const {
    seasons: seasonRows, competitions: compRows, scores: scoreRows,
    eventRounds: eventRoundRows, pots: potRows, payouts: payoutRows,
    charges: chargeRows, payments: paymentRows, playoffs: playoffRows,
  } = parsed;

  // Build per-round course/tee override map keyed by "eventName::roundNumber"
  const roundCourseByKey = new Map<string, ParsedRound>();
  for (const r of eventRoundRows) {
    roundCourseByKey.set(`${r.event_name}::${r.round_number}`, r);
  }

  // ── 0. Pre-flight validation ──────────────────────────────────────────────
  const existingCompRows = compRows.filter(c => !c.is_new_event);
  const newCompRows      = compRows.filter(c => c.is_new_event);

  // Resolve full template defaults — template_id may be "comp_<uuid>" (series-level)
  // or plain uuid (event template slot). Slots merge their parent series settings.
  const referencedTemplateIds = Array.from(new Set(compRows.map(c => c.template_id).filter(Boolean)));
  const templateDefaults = await resolveTemplateDefaults(admin, referencedTemplateIds, groupId);

  const resolveAllowance = (comp: ParsedComp): number => {
    const a = comp.allowance_resolved ?? comp.allowance_pct
      ?? (comp.template_id ? templateDefaults.get(comp.template_id)?.allowance_pct ?? null : null);
    if (a == null || !Number.isFinite(a)) return 100;
    return Math.max(0, Math.min(100, Math.round(a)));
  };
  const resolvePointsModel = (comp: ParsedComp): string => {
    const m = comp.points_model_override
      || (comp.template_id ? templateDefaults.get(comp.template_id)?.points_model ?? null : null)
      || "none";
    return m.toLowerCase();
  };

  const existingCompIds = Array.from(new Set(existingCompRows.map(c => c.event_id).filter(Boolean)));
  const allTeeBoxIds    = Array.from(new Set([
    ...compRows.map(c => c.tee_box_id),
    ...eventRoundRows.map(r => r.tee_box_id),
  ].filter(Boolean)));

  // Validate new event required fields
  const preflightErrors: string[] = [];
  for (const comp of newCompRows) {
    if (!comp.event_date) preflightErrors.push(`New event "${comp.event_name}": Event Date is required`);
    if (!comp.event_type && !(comp.template_id && templateDefaults.get(comp.template_id)?.event_type)) {
      preflightErrors.push(`New event "${comp.event_name}": Event Type is required (or pick a Template)`);
    }
    if (!comp.course_id)  preflightErrors.push(`New event "${comp.event_name}": Course did not resolve`);
    if (!comp.tee_box_id) preflightErrors.push(`New event "${comp.event_name}": Tee did not resolve — check column P shows ✓`);
  }

  const [preflightCompsRes, preflightTeeBoxesRes, preflightTeeHolesRes] = await Promise.all([
    existingCompIds.length
      ? admin.from("events").select("id,group_id,course_id,group_season_id").in("id", existingCompIds)
      : Promise.resolve({ data: [], error: null }),
    allTeeBoxIds.length
      ? admin.from("course_tee_boxes").select("id").in("id", allTeeBoxIds)
      : Promise.resolve({ data: [], error: null }),
    allTeeBoxIds.length
      ? admin.from("course_tee_holes").select("tee_box_id").in("tee_box_id", allTeeBoxIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (preflightCompsRes.error)    throw new Error(`Pre-flight event lookup failed: ${preflightCompsRes.error.message}`);
  if (preflightTeeBoxesRes.error) throw new Error(`Pre-flight tee box lookup failed: ${preflightTeeBoxesRes.error.message}`);
  if (preflightTeeHolesRes.error) throw new Error(`Pre-flight tee holes lookup failed: ${preflightTeeHolesRes.error.message}`);

  const preflightCompMap   = new Map((preflightCompsRes.data ?? []).map(e => [e.id, e]));
  const preflightTeeBoxIds = new Set((preflightTeeBoxesRes.data ?? []).map(t => t.id));
  const teeBoxHoleCounts   = new Map<string, number>();
  for (const h of preflightTeeHolesRes.data ?? []) {
    teeBoxHoleCounts.set(h.tee_box_id, (teeBoxHoleCounts.get(h.tee_box_id) ?? 0) + 1);
  }

  for (const comp of existingCompRows) {
    const ev = preflightCompMap.get(comp.event_id);
    if (!ev) { preflightErrors.push(`Competition "${comp.event_name}": event not found`); continue; }
    if (ev.group_id !== groupId) preflightErrors.push(`Competition "${comp.event_name}": event does not belong to this group`);
    if (!ev.course_id) preflightErrors.push(`Competition "${comp.event_name}": event has no course — set a course on the event first`);
  }
  for (const comp of compRows) {
    if (!comp.tee_box_id) continue;
    if (!preflightTeeBoxIds.has(comp.tee_box_id)) {
      preflightErrors.push(`Competition "${comp.event_name}": tee box not found in database`);
    } else if ((teeBoxHoleCounts.get(comp.tee_box_id) ?? 0) === 0) {
      preflightErrors.push(`Competition "${comp.event_name}": tee box has no holes configured`);
    }
  }

  // ── 0.5 Synthesize default prize pots from templates ──────────────────────
  // Events whose template defines default_prize_pots and that have no Prizes
  // rows of their own inherit the template pots (sheet rows always win).
  const potEventNames = new Set(potRows.map(p => p.event_name));
  const effectivePotRows: ParsedPot[] = [...potRows];
  for (const comp of compRows) {
    if (potEventNames.has(comp.event_name)) continue;
    const tmpl = comp.template_id ? templateDefaults.get(comp.template_id) : undefined;
    if (!tmpl?.default_prize_pots?.length) continue;
    for (const dp of tmpl.default_prize_pots) {
      if (!dp?.name) continue;
      effectivePotRows.push({
        event_name:        comp.event_name,
        event_id:          comp.event_id,
        pot_name:          dp.name,
        distribution_type: dp.distribution_type === "winner_takes_all" ? "position_based" : (dp.distribution_type || "position_based"),
        entry_fee_amount:  dp.entry_fee_amount ?? null,
        metric_type:       null,
        is_monetary:       dp.is_monetary ?? true,
        prize_description: null,
        description:       "Inherited from competition template",
      });
    }
  }

  // Prize pot / payout preflight
  const VALID_DIST   = new Set(["position_based", "metric_weighted", "metric_equal", "equal_split", "non_monetary", "entry_only"]);
  const VALID_METRIC = new Set(["twos", "nearest_pin", "longest_drive", "season_points", "custom"]);
  const compNamesSet = new Set(compRows.map(c => c.event_name));
  const potKeys      = new Set<string>();
  for (const pot of effectivePotRows) {
    potKeys.add(`${pot.event_name}::${pot.pot_name}`);
    if (!compNamesSet.has(pot.event_name)) preflightErrors.push(`Prize pot "${pot.pot_name}": event "${pot.event_name}" is not on the Competitions sheet`);
    if (!VALID_DIST.has(pot.distribution_type)) preflightErrors.push(`Prize pot "${pot.pot_name}": invalid Distribution Type "${pot.distribution_type}"`);
    if ((pot.distribution_type === "metric_weighted" || pot.distribution_type === "metric_equal") && (!pot.metric_type || !VALID_METRIC.has(pot.metric_type))) {
      preflightErrors.push(`Prize pot "${pot.pot_name}": a valid Metric Type is required for metric pots`);
    }
  }
  for (const po of payoutRows) {
    if (!potKeys.has(`${po.event_name}::${po.pot_name}`)) preflightErrors.push(`Payout for "${po.player_label}": no pot "${po.pot_name}" defined for event "${po.event_name}"`);
    if (!po.profile_id) preflightErrors.push(`Payout: player "${po.player_label}" did not resolve to a profile`);
  }

  // Charges / payments / playoffs preflight
  const VALID_CATEGORIES = new Set(["green_fee", "buggy", "food", "drink", "other"]);
  {
    const rowsByChargeKey = new Map<string, typeof chargeRows>();
    for (const ch of chargeRows) {
      if (!compNamesSet.has(ch.event_name)) preflightErrors.push(`Charge "${ch.charge_name}": event "${ch.event_name}" is not on the Competitions sheet`);
      if (!VALID_CATEGORIES.has(ch.category)) preflightErrors.push(`Charge "${ch.charge_name}": invalid Category "${ch.category}"`);
      if (ch.player_label && !ch.profile_id) preflightErrors.push(`Charge "${ch.charge_name}": player "${ch.player_label}" did not resolve to a profile`);
      const key = `${ch.event_name}::${ch.charge_name}`;
      if (!rowsByChargeKey.has(key)) rowsByChargeKey.set(key, []);
      rowsByChargeKey.get(key)!.push(ch);
    }
    // Amount may live on the all-entrants row (per-player rows inherit it) — only
    // error when a charge group ends up with no amount anywhere.
    for (const [, rows] of rowsByChargeKey.entries()) {
      const groupAmount = rows.find(r => r.amount != null)?.amount ?? null;
      const ok = groupAmount != null || rows.every(r => r.player_label && (r.amount_override ?? r.amount) != null);
      if (!ok) preflightErrors.push(`Charge "${rows[0].charge_name}" (${rows[0].event_name}): Amount is required (on the all-entrants row or each player row)`);
    }
  }
  for (const pm of paymentRows) {
    if (!pm.profile_id) preflightErrors.push(`Payment: player "${pm.player_label}" did not resolve to a profile`);
    if (pm.event_name && !compNamesSet.has(pm.event_name)) preflightErrors.push(`Payment for "${pm.player_label}": event "${pm.event_name}" is not on the Competitions sheet`);
  }
  {
    const byEvent = new Map<string, typeof playoffRows>();
    for (const row of playoffRows) {
      if (!compNamesSet.has(row.event_name)) preflightErrors.push(`Playoff: event "${row.event_name}" is not on the Competitions sheet`);
      if (!row.profile_id) preflightErrors.push(`Playoff (${row.event_name}): player "${row.player_label}" did not resolve to a profile`);
      if (!byEvent.has(row.event_name)) byEvent.set(row.event_name, []);
      byEvent.get(row.event_name)!.push(row);
    }
    for (const [eventName, rows] of byEvent.entries()) {
      if (rows.length < 2) preflightErrors.push(`Playoff for "${eventName}": needs at least 2 tied players`);
      const winners = rows.filter(r => r.final_position === 1);
      if (winners.length !== 1) preflightErrors.push(`Playoff for "${eventName}": exactly one player must have Final Position 1`);
      if (rows.some(r => r.final_position == null)) preflightErrors.push(`Playoff for "${eventName}": every player needs a Final Position`);
    }
  }

  if (preflightErrors.length) {
    throw new Error(preflightErrors[0]);
  }

  // ── Build round-count map keyed by event_name (before IDs are resolved) ──
  const roundsPerEventName = new Map<string, Set<number>>();
  for (const s of scoreRows) {
    if (!s.competition_name) continue;
    if (!roundsPerEventName.has(s.competition_name)) roundsPerEventName.set(s.competition_name, new Set());
    roundsPerEventName.get(s.competition_name)!.add(s.round_number);
  }

  // ── 1a. Auto-resolve blank handicaps ─────────────────────────────────────
  // For any score row where the handicap column was left blank, look up the
  // player's WHS handicap index as of the day before the event using the
  // ciaga_true_hi_as_of DB function (mirrors the handicap replay snapshot).
  const eventDateByName = new Map<string, string>();
  for (const comp of compRows) {
    if (comp.event_date) eventDateByName.set(comp.event_name, comp.event_date);
  }
  {
    type HiKey = `${string}::${string}`;
    const needed = new Map<HiKey, { profileId: string; asOfDate: string }>();
    const asOfFor = (score: ParsedScore): string | null => {
      const eventDate = eventDateByName.get(score.competition_name);
      if (!eventDate) return null;
      const asOf = new Date(eventDate);
      asOf.setDate(asOf.getDate() - 1);
      return asOf.toISOString().slice(0, 10);
    };
    for (const score of scoreRows) {
      if (score.handicap !== null || !score.profile_id) continue;
      const asOfStr = asOfFor(score);
      if (!asOfStr) continue;
      const key: HiKey = `${score.profile_id}::${asOfStr}`;
      if (!needed.has(key)) needed.set(key, { profileId: score.profile_id, asOfDate: asOfStr });
    }

    if (needed.size > 0) {
      const resolvedHi = new Map<HiKey, number | null>();
      await Promise.all(
        Array.from(needed.entries()).map(async ([key, { profileId, asOfDate }]) => {
          const { data, error } = await admin.rpc("ciaga_true_hi_as_of", {
            p_profile_id: profileId,
            p_as_of:      asOfDate,
          });
          resolvedHi.set(key, error || data == null ? null : Number(data));
        })
      );
      for (const score of scoreRows) {
        if (score.handicap !== null || !score.profile_id) continue;
        const asOfStr = asOfFor(score);
        if (!asOfStr) continue;
        const hi = resolvedHi.get(`${score.profile_id}::${asOfStr}`);
        if (hi !== null && hi !== undefined) score.handicap = hi;
      }
    }
  }

  // ── 1. Upsert group_seasons ───────────────────────────────────────────────
  const seasonIdByName = new Map<string, string>();

  const allSeasonNames = Array.from(new Set(seasonRows.map(s => s.season_name)));
  if (allSeasonNames.length) {
    const { data: existingSeasons, error: esErr } = await admin
      .from("group_seasons")
      .select("id,name")
      .eq("group_id", groupId)
      .in("name", allSeasonNames);
    if (esErr) throw new Error(`Season lookup failed: ${esErr.message}`);
    for (const s of existingSeasons ?? []) seasonIdByName.set(s.name, s.id);
  }

  for (const season of seasonRows) {
    if (seasonIdByName.has(season.season_name)) continue;

    if (!season.start_date || !season.end_date) {
      throw new Error(`Season "${season.season_name}": missing Year or Start/End Date`);
    }

    const { data: newSeason, error: nsErr } = await admin
      .from("group_seasons")
      .insert({
        group_id:    groupId,
        name:        season.season_name,
        season_year: season.year,
        start_date:  season.start_date,
        end_date:    season.end_date,
        status:      "completed",
        season_type: season.type,
      })
      .select("id")
      .single();
    if (nsErr || !newSeason) throw new Error(`Create season "${season.season_name}" failed: ${nsErr?.message}`);

    seasonIdByName.set(season.season_name, newSeason.id);
    summary.seasons_created.push(season.season_name);
  }

  // ── 1.5. Create new events with full template inheritance ─────────────────
  const eventIdByName = new Map<string, string>();
  for (const comp of existingCompRows) eventIdByName.set(comp.event_name, comp.event_id);

  for (const comp of newCompRows) {
    const resolvedSeasonId = comp.season_name ? (seasonIdByName.get(comp.season_name) ?? null) : null;
    const roundNumbers     = Array.from(roundsPerEventName.get(comp.event_name) ?? new Set([1])).sort((a, b) => a - b);
    const multiRound       = roundNumbers.length > 1;

    // Field precedence: sheet override → event-template slot → series template → default
    // (slots already have their parent's settings merged in resolveTemplateDefaults).
    const tmpl: TemplateDefaults | undefined = comp.template_id ? templateDefaults.get(comp.template_id) : undefined;
    const rawType    = comp.event_type    || tmpl?.event_type    || "stroke";
    const rawScoring = comp.scoring_model || tmpl?.scoring_model || "net";
    const eventTypeNorm = rawType.toLowerCase().replace(/\s+/g, "");
    const pointsModel   = resolvePointsModel(comp);

    const resolvedAllowance = resolveAllowance(comp);
    const handicapRules = {
      mode:          tmpl?.handicap_mode ?? "allowance_pct",
      allowance_pct: resolvedAllowance,
      max_handicap:  tmpl?.max_handicap ?? null,
    };
    const pointsConfig = comp.field_size_override != null
      ? { num_participants: comp.field_size_override }
      : {};

    const { data: newEvent, error: neErr } = await admin
      .from("events")
      .insert({
        name:             comp.event_name,
        group_id:         groupId,
        group_season_id:  resolvedSeasonId,
        event_date:       comp.event_date,
        event_year:       new Date(comp.event_date!).getFullYear(),
        event_type:       eventTypeNorm,
        event_structure:  multiRound ? "multi_round" : "standalone",
        scoring_model:    rawScoring.toLowerCase(),
        num_rounds:       roundNumbers.length,
        course_id:        comp.course_id || null,
        entry_fee_amount: comp.entry_fee_override,
        majors_status:    "completed",
        competition_id:                tmpl?.competition_id ?? null,
        competition_event_template_id: tmpl?.competition_event_template_id ?? null,
        handicap_rules:   handicapRules,
        points_model:     pointsModel,
        points_config:    pointsConfig,
        rules_text:       tmpl?.rules_text ?? null,
        standings_contribution: pointsModel !== "none" ? "both" : "event_only",
        // Historical events are fully visible — never frozen for a reveal ceremony.
        leaderboard_freeze_state: "revealed",
      })
      .select("id")
      .single();
    if (neErr || !newEvent) throw new Error(`Create event "${comp.event_name}" failed: ${neErr?.message}`);

    const { error: erErr } = await admin.from("event_rounds").insert(
      roundNumbers.map(n => {
        const roundOverride = roundCourseByKey.get(`${comp.event_name}::${n}`);
        return {
          event_id:                  newEvent.id,
          round_number:              n,
          name:                      multiRound ? `Round ${n}` : comp.event_name,
          scheduled_date:            roundOverride?.round_date || comp.event_date,
          course_id:                 roundOverride?.course_id  || comp.course_id || null,
          status:                    "completed",
          default_tee_box_id_male:   roundOverride?.tee_box_id || comp.tee_box_id || null,
          default_tee_box_id_female: roundOverride?.tee_box_id || comp.tee_box_id || null,
        };
      })
    );
    if (erErr) {
      throw new Error(`Create event_rounds for "${comp.event_name}" (event_id: ${newEvent.id}) failed: ${erErr.message}`);
    }

    eventIdByName.set(comp.event_name, newEvent.id);
    summary.events_created.push(comp.event_name);
  }

  // ── 2. Re-key scores by (resolved_event_id, round_number) ────────────────
  const scoresByRound = new Map<string, ParsedScore[]>();
  for (const s of scoreRows) {
    const resolvedId = eventIdByName.get(s.competition_name) ?? s.competition_id;
    if (!resolvedId) continue;
    const key = `${resolvedId}::${s.round_number}`;
    if (!scoresByRound.has(key)) scoresByRound.set(key, []);
    scoresByRound.get(key)!.push({ ...s, competition_id: resolvedId });
  }

  const roundsPerComp = new Map<string, Set<number>>();
  for (const s of scoreRows) {
    const resolvedId = eventIdByName.get(s.competition_name) ?? s.competition_id;
    if (!resolvedId) continue;
    if (!roundsPerComp.has(resolvedId)) roundsPerComp.set(resolvedId, new Set());
    roundsPerComp.get(resolvedId)!.add(s.round_number);
  }

  // Track which events had rounds created this run (for leaderboard recompute)
  const eventsTouched = new Set<string>();
  // event_id → ISO timestamp of the last imported round's finish (for backdating
  // playoff completion + payout transactions)
  const eventFinishTimes = new Map<string, string>();

  // ── 3. Create rounds + scores per competition ─────────────────────────────
  for (const comp of compRows) {
    const resolvedEventId = eventIdByName.get(comp.event_name);
    if (!resolvedEventId) {
      throw new Error(`No resolved event_id for "${comp.event_name}" — this should not happen after pre-flight`);
    }

    const roundNumbers      = Array.from(roundsPerComp.get(resolvedEventId) ?? new Set([1])).sort((a, b) => a - b);
    const multiRound        = roundNumbers.length > 1;
    const resolvedAllowance = resolveAllowance(comp);

    const { data: competition, error: compErr } = await admin
      .from("events")
      .select("id,name,group_id,course_id,event_date,entry_fee_amount,group_season_id,handicap_rules,competition_id,competition_event_template_id,scoring_model,points_model,points_config,leaderboard_freeze_state")
      .eq("id", resolvedEventId)
      .single();
    if (compErr || !competition) throw new Error(`Event "${comp.event_name}" not found`);
    if (competition.group_id !== groupId) throw new Error(`Event "${comp.event_name}" does not belong to this group`);

    const eventScoringModel = (
      comp.scoring_model || templateDefaults.get(comp.template_id)?.scoring_model || competition.scoring_model || "net"
    ).toLowerCase();

    // Fill nulls on existing events (season link, template link, handicap rules,
    // points model/config) and force the freeze state to 'revealed' BEFORE any
    // score events are inserted — otherwise the auto-freeze trigger fires
    // mid-import and snapshots a frozen leaderboard.
    if (!comp.is_new_event) {
      const resolvedSeasonId = comp.season_name ? (seasonIdByName.get(comp.season_name) ?? null) : null;
      const patch: Record<string, unknown> = {};
      if (resolvedSeasonId && competition.group_season_id === null) patch.group_season_id = resolvedSeasonId;
      if (comp.template_id) {
        const td = templateDefaults.get(comp.template_id);
        if (td?.competition_id && !(competition as any).competition_id) patch.competition_id = td.competition_id;
        if (td?.competition_event_template_id && !competition.competition_event_template_id) patch.competition_event_template_id = td.competition_event_template_id;
      }
      const existingRules = (competition.handicap_rules ?? {}) as Record<string, any>;
      if (existingRules.allowance_pct == null) {
        patch.handicap_rules = {
          mode:          "allowance_pct",
          allowance_pct: resolvedAllowance,
          max_handicap:  templateDefaults.get(comp.template_id)?.max_handicap ?? existingRules.max_handicap ?? null,
        };
      }
      const resolvedPointsModel = resolvePointsModel(comp);
      if ((competition.points_model == null || competition.points_model === "none") && resolvedPointsModel !== "none") {
        patch.points_model = resolvedPointsModel;
        patch.standings_contribution = "both";
      }
      if (comp.field_size_override != null && (competition.points_config as any)?.num_participants == null) {
        patch.points_config = { ...((competition.points_config as any) ?? {}), num_participants: comp.field_size_override };
      }
      if (competition.leaderboard_freeze_state !== "revealed") {
        patch.leaderboard_freeze_state = "revealed";
      }
      if (Object.keys(patch).length) {
        const { error: updErr } = await admin.from("events").update(patch).eq("id", resolvedEventId);
        if (updErr) throw new Error(`Update event "${comp.event_name}" failed: ${updErr.message}`);
      }
    }

    // Map round_number → event_round_id for submissions
    const { data: eventRoundsRows, error: erMapErr } = await admin
      .from("event_rounds")
      .select("id,round_number")
      .eq("event_id", resolvedEventId);
    if (erMapErr) throw new Error(`event_rounds lookup failed for "${comp.event_name}": ${erMapErr.message}`);
    const eventRoundIdByNumber = new Map<number, string>(
      (eventRoundsRows ?? []).map((er: any) => [er.round_number as number, er.id as string])
    );

    const eventLevelCourseId = comp.course_id || competition.course_id;
    if (!eventLevelCourseId) throw new Error(`Event "${comp.event_name}" has no course — set a course on the event first`);

    const eventDateStr  = competition.event_date
      ? String(competition.event_date).slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const baseEventName = comp.event_name;
    const entryFee      = comp.entry_fee_override != null
      ? comp.entry_fee_override
      : (competition.entry_fee_amount ?? null);

    // Per-event caches to avoid re-fetching the same course/tee across rounds
    type CourseRow  = { id: string; name: string; city: string | null; country: string | null; lat: number | null; lng: number | null };
    type TeeBoxRow  = { id: string; name: string; gender: string | null; yards: number | null; par: number | null; rating: number | null; slope: number | null; holes_count: number | null };
    const courseCache  = new Map<string, CourseRow>();
    const teeBoxCache  = new Map<string, TeeBoxRow>();
    const teeHoleCache = new Map<string, TeeHole[]>();

    const fetchCourse = async (cid: string): Promise<CourseRow> => {
      if (courseCache.has(cid)) return courseCache.get(cid)!;
      const { data, error } = await admin.from("courses").select("id,name,city,country,lat,lng").eq("id", cid).single();
      if (error || !data) throw new Error(`Course lookup failed: ${error?.message}`);
      courseCache.set(cid, data as CourseRow);
      return data as CourseRow;
    };
    const fetchTeeBox = async (tid: string): Promise<TeeBoxRow> => {
      if (teeBoxCache.has(tid)) return teeBoxCache.get(tid)!;
      const { data, error } = await admin.from("course_tee_boxes").select("id,name,gender,yards,par,rating,slope,holes_count").eq("id", tid).single();
      if (error || !data) throw new Error(`Tee box lookup failed: ${error?.message}`);
      teeBoxCache.set(tid, data as TeeBoxRow);
      return data as TeeBoxRow;
    };
    const fetchTeeHoles = async (tid: string): Promise<TeeHole[]> => {
      if (teeHoleCache.has(tid)) return teeHoleCache.get(tid)!;
      const { data, error } = await admin.from("course_tee_holes").select("hole_number,par,yardage,handicap").eq("tee_box_id", tid).order("hole_number", { ascending: true });
      if (error) throw new Error(`Tee holes lookup failed: ${error.message}`);
      const holes = (data ?? []) as TeeHole[];
      teeHoleCache.set(tid, holes);
      return holes;
    };

    const enrolledProfileIds   = new Set<string>();
    const entryCreatedProfiles = new Set<string>();

    for (const roundNumber of roundNumbers) {
      const roundKey  = `${resolvedEventId}::${roundNumber}`;
      const roundName = multiRound ? `${baseEventName} — Round ${roundNumber}` : baseEventName;

      // Idempotency: skip if round already exists by name
      const { data: existingRound } = await admin
        .from("rounds")
        .select("id")
        .eq("competition_id", resolvedEventId)
        .eq("name", roundName)
        .maybeSingle();

      if (existingRound) {
        summary.skipped_already_imported.push(roundName);
        continue;
      }

      // ── Resolve per-round course + tee + timing ───────────────────────
      const roundOverride  = roundCourseByKey.get(`${comp.event_name}::${roundNumber}`);
      const roundCourseId  = roundOverride?.course_id  || eventLevelCourseId;
      const roundTeeBoxId  = roundOverride?.tee_box_id || comp.tee_box_id;
      const roundDateStr   = roundOverride?.round_date || eventDateStr;
      // Backdated timing: scorecards read like the round was really played,
      // starting at the sheet's tee time (default 09:00).
      const teeTime    = teeDateTime(roundDateStr, roundOverride?.tee_time ?? comp.tee_time);
      const startedAt  = teeTime.toISOString();

      const course   = await fetchCourse(roundCourseId);
      const teeBox   = await fetchTeeBox(roundTeeBoxId);
      const teeHoles = await fetchTeeHoles(roundTeeBoxId);
      if (!teeHoles.length) throw new Error(`Tee box "${teeBox.name}" has no holes configured (round ${roundNumber} of "${comp.event_name}")`);

      const yardsTotal = teeHoles.reduce((a, h) => a + (h.yardage ?? 0), 0);
      const parTotal   = teeHoles.reduce((a, h) => a + (h.par    ?? 0), 0);

      // ── Per-round players (needed before round insert for finish time) ──
      const roundScores   = scoresByRound.get(roundKey) ?? [];
      const uniquePlayers = new Map<string, ParsedScore>();
      for (const s of roundScores) {
        if (s.profile_id && !uniquePlayers.has(s.profile_id)) uniquePlayers.set(s.profile_id, s);
      }
      const playerCount = Math.max(uniquePlayers.size, 1);
      const finishedAt  = roundFinishTime(teeTime, playerCount - 1).toISOString();

      // ── Create round ──────────────────────────────────────────────────
      const { data: round, error: rErr } = await admin
        .from("rounds")
        .insert({
          created_by:     recordedBy,
          status:         "live",
          visibility:     "private",
          course_id:      course.id,
          competition_id: competition.id,
          name:           roundName,
          created_at:     startedAt,
          started_at:     startedAt,
          finished_at:    finishedAt,
          // Drives Playing Handicap (allowance) for net scoring — populated by
          // ciaga_persist_playing_handicaps after the round is finished.
          default_playing_handicap_mode:  "allowance_pct",
          default_playing_handicap_value: resolvedAllowance,
        })
        .select("id")
        .single();
      if (rErr || !round) throw new Error(`Create round failed for "${roundName}": ${rErr?.message}`);

      // ── Course snapshot ───────────────────────────────────────────────
      const { data: courseSnap, error: csErr } = await admin
        .from("round_course_snapshots")
        .insert({
          round_id:         round.id,
          source_course_id: course.id,
          course_name:      course.name,
          city:             course.city,
          country:          course.country,
          lat:              course.lat,
          lng:              course.lng,
        })
        .select("id")
        .single();
      if (csErr || !courseSnap) throw new Error(`Create course snapshot failed: ${csErr?.message}`);

      // ── Tee snapshot + hole snapshots ─────────────────────────────────
      const { data: teeSnap, error: tsErr } = await admin
        .from("round_tee_snapshots")
        .insert({
          round_course_snapshot_id: courseSnap.id,
          source_tee_box_id: teeBox.id,
          name:        teeBox.name,
          gender:      teeBox.gender,
          holes_count: teeBox.holes_count ?? teeHoles.length,
          yards_total: teeBox.yards ?? yardsTotal,
          par_total:   teeBox.par   ?? parTotal,
          rating:      teeBox.rating,
          slope:       teeBox.slope,
        })
        .select("id")
        .single();
      if (tsErr || !teeSnap) throw new Error(`Create tee snapshot failed: ${tsErr?.message}`);

      const { error: hsErr } = await admin.from("round_hole_snapshots").insert(
        teeHoles.map(h => ({
          round_tee_snapshot_id: teeSnap.id,
          hole_number:  h.hole_number,
          par:          h.par,
          yardage:      h.yardage,
          stroke_index: h.handicap,
        }))
      );
      if (hsErr) throw new Error(`Create hole snapshots failed: ${hsErr.message}`);

      // ── Per-player ────────────────────────────────────────────────────
      const participantIdByProfileId = new Map<string, string>();

      for (const [profileId, playerScore] of uniquePlayers.entries()) {
        // Auto-enrol once per event
        if (!enrolledProfileIds.has(profileId)) {
          const { data: membership } = await admin
            .from("major_group_memberships")
            .select("id")
            .eq("group_id", groupId)
            .eq("profile_id", profileId)
            .maybeSingle();

          if (!membership) {
            const { error: enrollErr } = await admin.from("major_group_memberships").insert({
              group_id:   groupId,
              profile_id: profileId,
              role:       "member",
              status:     "active",
              joined_at:  startedAt,
            });
            if (enrollErr) throw new Error(`Enrol member ${profileId} failed: ${enrollErr.message}`);
            summary.members_enrolled++;
          }
          enrolledProfileIds.add(profileId);
        }

        // Round participant
        const { data: part, error: rpErr } = await admin
          .from("round_participants")
          .insert({
            round_id:        round.id,
            profile_id:      profileId,
            is_guest:        false,
            role:            "player",
            handicap_index:  playerScore.handicap,
            tee_snapshot_id: teeSnap.id,
            created_at:      startedAt,
          })
          .select("id")
          .single();
        if (rpErr || !part) throw new Error(`Create participant failed for ${profileId}: ${rpErr?.message}`);

        participantIdByProfileId.set(profileId, part.id);
        summary.participants_created++;

        // Event entry + fee — once per event, not per round
        if (!entryCreatedProfiles.has(profileId)) {
          const { error: ceErr } = await admin.from("event_entries").upsert({
            event_id:                resolvedEventId,
            profile_id:              profileId,
            assigned_handicap_index: playerScore.handicap,
            source:                  "manual",
            locked:                  true,
          }, { onConflict: "event_id,profile_id" });
          if (ceErr) throw new Error(`Create event entry failed: ${ceErr.message}`);
          summary.competition_entries_created++;

          if (entryFee != null && entryFee > 0) {
            const { error: txErr } = await admin.from("group_balance_transactions").insert({
              group_id:    groupId,
              profile_id:  profileId,
              event_id:    resolvedEventId,
              type:        "entry_fee",
              amount:      entryFee,
              note:        `Entry fee for ${baseEventName}`,
              recorded_by: recordedBy,
              created_at:  startedAt,
            });
            if (txErr) throw new Error(`Create fee transaction failed: ${txErr.message}`);
            summary.fee_transactions_created++;
          }
          entryCreatedProfiles.add(profileId);
        }
      }

      // ── Score events — backdated per hole, staggered per player slot ──
      const scoreEvents: Array<{
        round_id: string; participant_id: string; hole_number: number; strokes: number; entered_by: string; created_at: string;
      }> = [];
      let playerIdx = 0;
      for (const [profileId, playerScore] of uniquePlayers.entries()) {
        const participantId = participantIdByProfileId.get(profileId);
        if (!participantId) continue;
        const idx = playerIdx++;
        playerScore.holes.forEach((strokes, hIdx) => {
          scoreEvents.push({
            round_id:       round.id,
            participant_id: participantId,
            hole_number:    hIdx + 1,
            strokes,
            entered_by:     recordedBy,
            created_at:     holeTime(teeTime, hIdx + 1, idx).toISOString(),
          });
        });
      }
      scoreEvents.sort((a, b) => a.created_at.localeCompare(b.created_at));
      if (scoreEvents.length) {
        const { error: seErr } = await admin.from("round_score_events").insert(scoreEvents);
        if (seErr) throw new Error(`Create score events failed for "${roundName}": ${seErr.message}`);
        summary.score_events_created += scoreEvents.length;
      }

      // ── Finish round ──────────────────────────────────────────────────
      // Flipping to 'finished' fires compute_all_results_when_round_finishes
      // (replays HI + computes handicap_round_results).
      const { error: finErr } = await admin.from("rounds").update({ status: "finished", finished_at: finishedAt }).eq("id", round.id);
      if (finErr) throw new Error(`Finish round failed: ${finErr.message}`);

      // Persist Playing Handicap (allowance applied) — must run AFTER the finish
      // replay so it reflects the replayed HI.
      const { error: phErr } = await admin.rpc("ciaga_persist_playing_handicaps", { p_round_id: round.id });
      if (phErr) throw new Error(`Persist playing handicaps failed for "${roundName}": ${phErr.message}`);

      // ── Event round submissions (so the event leaderboard computes net) ──
      const { data: rpRows, error: rpFetchErr } = await admin
        .from("round_participants")
        .select("id,profile_id,playing_handicap_used,course_handicap_used")
        .eq("round_id", round.id);
      if (rpFetchErr) throw new Error(`Participant fetch failed for "${roundName}": ${rpFetchErr.message}`);

      const partIds = (rpRows ?? []).map((p: any) => p.id);
      const hrrByParticipant = new Map<string, { gross: number | null; ch: number | null }>();
      if (partIds.length) {
        const { data: hrrRows, error: hrrErr } = await admin
          .from("handicap_round_results")
          .select("participant_id,adjusted_gross_score,course_handicap_used")
          .in("participant_id", partIds);
        if (hrrErr) throw new Error(`Handicap results fetch failed for "${roundName}": ${hrrErr.message}`);
        for (const h of hrrRows ?? []) {
          hrrByParticipant.set((h as any).participant_id, {
            gross: (h as any).adjusted_gross_score ?? null,
            ch:    (h as any).course_handicap_used ?? null,
          });
        }
      }

      const eventRoundId = eventRoundIdByNumber.get(roundNumber) ?? null;
      const submissions = (rpRows ?? []).map((p: any) => {
        const hrr   = hrrByParticipant.get(p.id);
        const gross = hrr?.gross ?? null;
        const ch    = p.playing_handicap_used != null ? p.playing_handicap_used : (p.course_handicap_used ?? hrr?.ch ?? null);
        let score_used: number | null = null;
        if (gross != null) {
          score_used = (eventScoringModel === "net" && ch != null) ? gross - ch : gross;
        }
        return {
          event_id:     resolvedEventId,
          round_id:     round.id,
          event_round_id: eventRoundId,
          profile_id:   p.profile_id,
          score_used,
          accepted:     true,
          submitted_at: finishedAt,
        };
      });
      if (submissions.length) {
        const { error: subErr } = await admin
          .from("event_round_submissions")
          .upsert(submissions, { onConflict: "event_id,round_id,profile_id" });
        if (subErr) throw new Error(`Create submissions failed for "${roundName}": ${subErr.message}`);
        summary.event_submissions_created += submissions.length;
      }

      // Existing events imported into for the first time keep their scheduled
      // event_rounds — mark this one completed like the live flow would.
      if (eventRoundId) {
        await admin.from("event_rounds").update({ status: "completed" }).eq("id", eventRoundId);
      }

      eventsTouched.add(resolvedEventId);
      const prevFinish = eventFinishTimes.get(resolvedEventId);
      if (!prevFinish || finishedAt > prevFinish) eventFinishTimes.set(resolvedEventId, finishedAt);
      summary.rounds_created++;
      summary.competition_round_ids.push({
        competition_name: comp.event_name,
        event_name:       roundName,
        competition_id:   resolvedEventId,
        round_id:         round.id,
      });
    }
  }

  // ── 4. Recompute event leaderboards ───────────────────────────────────────
  // Events that already have a recorded playoff are skipped — the RPC deletes +
  // re-inserts every entry, which would wipe the stored playoff outcome.
  const playoffEventIds = new Set<string>([
    ...Array.from(eventsTouched),
    ...playoffRows.map(r => eventIdByName.get(r.event_name) ?? r.event_id).filter(Boolean) as string[],
  ]);
  const eventsWithExistingPlayoff = new Set<string>();
  if (playoffEventIds.size) {
    const { data: existingPlayoffs, error: epoErr } = await admin
      .from("event_playoffs")
      .select("event_id")
      .in("event_id", Array.from(playoffEventIds));
    if (epoErr) throw new Error(`Playoff lookup failed: ${epoErr.message}`);
    for (const p of existingPlayoffs ?? []) eventsWithExistingPlayoff.add((p as any).event_id);
  }

  for (const eventId of eventsTouched) {
    if (eventsWithExistingPlayoff.has(eventId)) continue;
    const { error: lbErr } = await admin.rpc("ciaga_compute_event_leaderboard", { p_event_id: eventId });
    if (lbErr) throw new Error(`Leaderboard compute failed for event ${eventId}: ${lbErr.message}`);
    summary.leaderboards_computed++;
  }

  // ── 5. Playoffs (after leaderboards — writes playoff columns + points) ────
  await importPlayoffs({
    admin, recordedBy,
    playoffRows, eventIdByName, eventsWithExistingPlayoff, eventFinishTimes, eventDateByName,
    summary,
  });

  // Players who scored each event — used for pot enrolment and all-entrant charges
  const scoredByEvent = new Map<string, Set<string>>();
  for (const s of scoreRows) {
    if (!s.profile_id) continue;
    if (!scoredByEvent.has(s.competition_name)) scoredByEvent.set(s.competition_name, new Set());
    scoredByEvent.get(s.competition_name)!.add(s.profile_id);
  }

  // ── 6. Prize pots + payouts (incl. template default pots) ─────────────────
  await importPrizePots({
    admin, groupId, recordedBy,
    potRows: effectivePotRows, payoutRows, eventIdByName, scoredByEvent, eventDateByName, eventFinishTimes,
    summary,
  });

  // ── 7. Charges (green fees, buggies, food…) + settling payments ───────────
  await importCharges({
    admin, groupId, recordedBy,
    chargeRows, eventIdByName, eventDateByName, scoredByEvent,
    summary,
  });

  // ── 8. Event-scoped payments ───────────────────────────────────────────────
  await importPayments({
    admin, groupId, recordedBy,
    paymentRows: paymentRows.filter(p => !!p.event_name),
    eventIdByName, eventDateByName,
    summary,
  });
}

// ── Finalize: standings, handicap replay, feed backfill, group payments ──────
// Operates on the WHOLE workbook (not season-filtered) so it can run once after
// per-season chunked imports. Everything here is idempotent.

async function finalizeImport(args: {
  admin: ReturnType<typeof getSupabaseAdmin>;
  groupId: string;
  recordedBy: string;
  parsed: ParsedWorkbook;
  summary: Summary;
  refreshHandicaps: boolean;
}) {
  const { admin, groupId, recordedBy, parsed, summary, refreshHandicaps } = args;

  // Resolve every event named in the workbook from the DB (by id when the sheet
  // has one, else by name — new events were created by the per-season phase).
  const namedIds = parsed.competitions.map(c => c.event_id).filter(Boolean);
  const names    = parsed.competitions.map(c => c.event_name);
  const eventRowsById = namedIds.length
    ? (await admin.from("events").select("id,name,group_season_id,event_date").in("id", namedIds)).data ?? []
    : [];
  const eventRowsByName = names.length
    ? (await admin.from("events").select("id,name,group_season_id,event_date").eq("group_id", groupId).in("name", names)).data ?? []
    : [];
  const eventsInFile = new Map<string, { id: string; name: string; group_season_id: string | null; event_date: string | null }>();
  for (const e of [...eventRowsById, ...eventRowsByName] as any[]) eventsInFile.set(e.id, e);

  const eventIds = Array.from(eventsInFile.keys());
  const eventIdByName = new Map<string, string>();
  for (const e of eventsInFile.values()) eventIdByName.set(e.name, e.id);

  const eventDateByName = new Map<string, string>();
  for (const comp of parsed.competitions) {
    if (comp.event_date) eventDateByName.set(comp.event_name, comp.event_date);
  }

  // ── Group-level payments (no event scope) ─────────────────────────────────
  await importPayments({
    admin, groupId, recordedBy,
    paymentRows: parsed.payments.filter(p => !p.event_name),
    eventIdByName, eventDateByName,
    summary,
  });

  // ── Standings recompute ───────────────────────────────────────────────────
  // The leaderboard RPC cascades into group-season standings, but playoff
  // outcomes are written afterwards and bypass the cascade — recompute
  // explicitly so season tables respect playoff-resolved positions.
  const groupSeasonIds = Array.from(new Set(
    Array.from(eventsInFile.values()).map(e => e.group_season_id).filter(Boolean) as string[]
  ));
  for (const gsId of groupSeasonIds) {
    const { error } = await admin.rpc("ciaga_compute_group_season_standings", { p_group_season_id: gsId });
    if (error) throw new Error(`Group season standings compute failed (${gsId}): ${error.message}`);
    summary.standings_recomputed++;
  }
  {
    const { error } = await admin.rpc("ciaga_compute_group_standings", { p_group_id: groupId });
    if (error) throw new Error(`Group standings compute failed: ${error.message}`);
    summary.standings_recomputed++;
  }

  // ── Handicap replay ───────────────────────────────────────────────────────
  // Imported rounds count toward WHS — replay the handicap pipeline from the
  // earliest imported date so every later round (imported or real) reflects it.
  const allDates = [
    ...parsed.competitions.map(c => c.event_date),
    ...parsed.eventRounds.map(r => r.round_date),
  ].filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (refreshHandicaps && allDates.length && eventIds.length) {
    const fromDate = allDates[0];
    const { error } = await admin.rpc("ciaga_refresh_handicaps_from", { p_from_date: fromDate });
    if (error) throw new Error(`Handicap refresh failed: ${error.message}`);
    summary.handicaps_refreshed_from = fromDate;
  }

  // ── Feed backfill ─────────────────────────────────────────────────────────
  // hole_event cards only (event rounds never get round_played cards in the
  // live flow). Idempotent by group_key, so previously imported rounds are fine.
  if (eventIds.length) {
    const { data: roundRows, error: rdErr } = await admin
      .from("rounds")
      .select("id")
      .in("competition_id", eventIds)
      .eq("status", "finished");
    if (rdErr) throw new Error(`Round lookup for feed backfill failed: ${rdErr.message}`);
    await backfillFeedForRounds({
      roundIds: (roundRows ?? []).map((r: any) => r.id),
      actorProfileId: recordedBy,
      summary,
    });
  }
}
