import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { TEMPLATE_VERSION } from "../template/route";

export type SeasonPreview = {
  season_name: string;
  year: number | null;
  start_date: string | null;
  end_date: string | null;
  already_exists: boolean;
};

export type RoundPreview = {
  round_number: number;
  round_name: string;
  already_imported: boolean;
};

export type CompetitionPreview = {
  competition_id: string;   // event_id (blank for new events before import)
  competition_name: string; // event_name
  event_name: string;
  season_name: string;
  tee_box_id: string;
  entry_fee: number | null;
  player_count: number;
  score_row_count: number;
  already_imported: boolean;
  rounds: RoundPreview[];
  is_new_event: boolean;
  event_date: string | null;
  event_type: string | null;
  scoring_model: string | null;
  template_name: string | null;
  allowance_pct: number | null;
  round_overrides: { round_number: number; course_id: string; tee_box_id: string }[];
};

export type PotPreview = {
  event_name: string;
  pot_name: string;
  distribution_type: string;
  entry_fee_amount: number | null;
  player_count: number;       // players who scored this event (auto-enrolled)
  payout_count: number;
  already_exists: boolean;
};

export type PreviewResponse = {
  group_id: string;
  seasons: SeasonPreview[];
  competitions: CompetitionPreview[];
  pots: PotPreview[];
  errors: string[];
  totals: {
    seasons_to_create: number;
    competitions: number;
    participants: number;
    score_events: number;
    fee_transactions: number;
    prize_pots: number;
    pot_entries: number;
    pot_entry_fees: number;
    pot_payouts: number;
    pot_winnings: number;
  };
};

const VALID_EVENT_TYPES    = ["stroke", "stableford", "matchplay", "skins", "scramble", "bestball", "best ball", "custom"];
const VALID_SCORING_MODELS = ["gross", "net"];

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

    const form = await req.formData();
    const file    = form.get("file")     as File | null;
    const groupId = form.get("group_id") as string | null;

    if (!file)    return NextResponse.json({ error: "Missing file" },     { status: 400 });
    if (!groupId) return NextResponse.json({ error: "Missing group_id" }, { status: 400 });

    const { parsed, errors: parseErrors } = await parseXlsx(file);
    if (parseErrors.length) {
      return NextResponse.json({ error: parseErrors[0], errors: parseErrors }, { status: 400 });
    }

    // Build round override map keyed by "eventName::roundNumber"
    const roundCourseByKey = new Map<string, ParsedRound>();
    for (const r of parsed.eventRounds) {
      roundCourseByKey.set(`${r.event_name}::${r.round_number}`, r);
    }

    const errors: string[] = [];

    // Validate season names referenced in Competitions are defined in Seasons sheet
    const definedSeasonNames = new Set(parsed.seasons.map(s => s.season_name));
    for (const comp of parsed.competitions) {
      if (comp.season_name && !definedSeasonNames.has(comp.season_name)) {
        errors.push(`Competition "${comp.event_name}": Season Name "${comp.season_name}" not found in Seasons sheet`);
      }
      if (!comp.season_name) {
        errors.push(`Competition "${comp.event_name}": Season Name is blank — every competition must belong to a season`);
      }
    }

    // Split into existing vs new events
    const existingComps = parsed.competitions.filter(c => !c.is_new_event);
    const newComps      = parsed.competitions.filter(c => c.is_new_event);

    // Validate new event required fields
    const seenNewEventNames = new Set<string>();
    for (const comp of newComps) {
      if (seenNewEventNames.has(comp.event_name)) {
        errors.push(`Competitions sheet: duplicate Event Name "${comp.event_name}" — each row must have a unique name`);
      }
      seenNewEventNames.add(comp.event_name);

      if (!comp.event_date) {
        errors.push(`New event "${comp.event_name}": Event Date is required`);
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(comp.event_date)) {
        errors.push(`New event "${comp.event_name}": Event Date must be formatted YYYY-MM-DD (e.g. 2024-06-15)`);
      }
      if (!comp.event_type) {
        errors.push(`New event "${comp.event_name}": Event Type is required (Stroke/Stableford/Matchplay/etc.)`);
      } else if (!VALID_EVENT_TYPES.includes(comp.event_type.toLowerCase())) {
        errors.push(`New event "${comp.event_name}": Event Type "${comp.event_type}" is not valid`);
      }
      if (!comp.scoring_model) {
        errors.push(`New event "${comp.event_name}": Scoring Model is required (Gross or Net)`);
      } else if (!VALID_SCORING_MODELS.includes(comp.scoring_model.toLowerCase())) {
        errors.push(`New event "${comp.event_name}": Scoring Model "${comp.scoring_model}" must be Gross or Net`);
      }
      if (!comp.course_id) {
        errors.push(`New event "${comp.event_name}": Course Name did not resolve — select a course from the dropdown`);
      }
      if (!comp.tee_box_id) {
        errors.push(`New event "${comp.event_name}": Tee Name did not resolve — check column P (tee_found) shows ✓`);
      }
    }

    // Template + allowance validation (applies to all competition rows)
    const referencedTemplateIds = Array.from(new Set(parsed.competitions.map(c => c.template_id).filter(Boolean)));
    let validTemplateIds = new Set<string>();
    if (referencedTemplateIds.length) {
      // template_id may be "comp_<uuid>" (series) or plain uuid (event template slot)
      const compSeriesIds = referencedTemplateIds.filter(id => id.startsWith("comp_")).map(id => id.slice(5));
      const eventTmplIds  = referencedTemplateIds.filter(id => !id.startsWith("comp_"));

      // Validate series IDs belong to this group
      if (compSeriesIds.length) {
        const { data: seriesRows } = await admin
          .from("competitions")
          .select("id")
          .eq("group_id", groupId)
          .in("id", compSeriesIds);
        for (const r of seriesRows ?? []) validTemplateIds.add(`comp_${(r as any).id}`);
      }

      // Validate event template IDs belong to this group's series
      if (eventTmplIds.length) {
        const { data: groupComps2 } = await admin.from("competitions").select("id").eq("group_id", groupId);
        const groupCompIds = (groupComps2 ?? []).map((c: any) => c.id);
        if (groupCompIds.length) {
          const { data: tmplRows } = await admin
            .from("competition_event_templates")
            .select("id")
            .in("id", eventTmplIds)
            .in("competition_id", groupCompIds);
          for (const t of tmplRows ?? []) validTemplateIds.add((t as any).id);
        }
      }
    }
    for (const comp of parsed.competitions) {
      if (comp.template_name && !comp.template_id) {
        errors.push(`Competition "${comp.event_name}": Template "${comp.template_name}" did not resolve — pick it from the dropdown.`);
      } else if (comp.template_id && !validTemplateIds.has(comp.template_id)) {
        errors.push(`Competition "${comp.event_name}": Template does not belong to this group.`);
      }
      if (comp.allowance_pct != null && (comp.allowance_pct < 0 || comp.allowance_pct > 100)) {
        errors.push(`Competition "${comp.event_name}": Handicap Allowance % must be between 0 and 100.`);
      }
    }

    const existingCompIds = Array.from(new Set(existingComps.map(c => c.event_id).filter(Boolean)));
    const profileIds      = Array.from(new Set([
      ...parsed.scores.map(s => s.profile_id),
      ...parsed.payouts.map(p => p.profile_id),
    ].filter(Boolean)));
    const teeBoxIds       = Array.from(new Set([
      ...parsed.competitions.map(c => c.tee_box_id),
      ...parsed.eventRounds.map(r => r.tee_box_id),
    ].filter(Boolean)));
    const seasonNames     = Array.from(definedSeasonNames);
    const newEventNames   = newComps.map(c => c.event_name);
    const allCourseIds    = Array.from(new Set(parsed.competitions.map(c => c.course_id).filter(Boolean)));

    const [compsRes, profilesRes, teeBoxesRes, existingRoundsRes, existingSeasonsRes, nameCollisionRes, courseTeeBoxesRes] = await Promise.all([
      existingCompIds.length
        ? admin.from("events").select("id,name,group_id,entry_fee_amount,course_id,group_season_id").in("id", existingCompIds)
        : Promise.resolve({ data: [], error: null }),
      profileIds.length
        ? admin.from("profiles").select("id").in("id", profileIds)
        : Promise.resolve({ data: [], error: null }),
      teeBoxIds.length
        ? admin.from("course_tee_boxes").select("id,name,course_id").in("id", teeBoxIds)
        : Promise.resolve({ data: [], error: null }),
      existingCompIds.length
        ? admin.from("rounds").select("competition_id,name").in("competition_id", existingCompIds).not("competition_id", "is", null)
        : Promise.resolve({ data: [], error: null }),
      seasonNames.length
        ? admin.from("group_seasons").select("name").eq("group_id", groupId).in("name", seasonNames)
        : Promise.resolve({ data: [], error: null }),
      // Check if any "new" event names already exist in the DB (would be a silent collision)
      newEventNames.length
        ? admin.from("events").select("name").eq("group_id", groupId).in("name", newEventNames)
        : Promise.resolve({ data: [], error: null }),
      // Fetch all tee boxes for the courses referenced — for error hinting
      allCourseIds.length
        ? admin.from("course_tee_boxes").select("id,name,course_id").in("course_id", allCourseIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (compsRes.error)          throw new Error(compsRes.error.message);
    if (profilesRes.error)       throw new Error(profilesRes.error.message);
    if (teeBoxesRes.error)       throw new Error(teeBoxesRes.error.message);
    if (existingRoundsRes.error) throw new Error(existingRoundsRes.error.message);
    if (existingSeasonsRes.error) throw new Error(existingSeasonsRes.error.message);
    if (nameCollisionRes.error)   throw new Error(nameCollisionRes.error.message);
    if (courseTeeBoxesRes.error)  throw new Error(courseTeeBoxesRes.error.message);

    const validCompMap = new Map<string, { name: string; group_id: string | null; entry_fee_amount: number | null; course_id: string | null; group_season_id: string | null }>();
    for (const c of compsRes.data ?? []) validCompMap.set(c.id, c);

    const validProfileIds = new Set((profilesRes.data ?? []).map(p => p.id));
    const validTeeBoxIds  = new Set((teeBoxesRes.data ?? []).map(t => t.id));

    const alreadyImportedKeys = new Set(
      (existingRoundsRes.data ?? []).map(r => `${r.competition_id as string}::${r.name as string}`)
    );
    const existingSeasonNames  = new Set((existingSeasonsRes.data ?? []).map(s => s.name));
    const collidingEventNames  = new Set((nameCollisionRes.data ?? []).map(e => e.name));

    // Build tee-name hint map: course_id → tee names (for error messages)
    const teeNamesByCourseId = new Map<string, string[]>();
    for (const t of courseTeeBoxesRes.data ?? []) {
      if (!teeNamesByCourseId.has(t.course_id)) teeNamesByCourseId.set(t.course_id, []);
      teeNamesByCourseId.get(t.course_id)!.push(t.name);
    }

    // Validate new event name collisions
    for (const comp of newComps) {
      if (collidingEventNames.has(comp.event_name)) {
        errors.push(
          `Competitions sheet "${comp.event_name}": this name matches an existing event in the database — ` +
          `if you meant to import into it, select it from the Event Name dropdown instead of typing it.`
        );
      }
    }

    // Validate existing events
    for (const comp of existingComps) {
      if (!comp.event_id) {
        errors.push(`Competitions sheet "${comp.event_name}": event_id is blank — check Event Name matches an existing event, or fill in Event Date/Type/Scoring Model to create a new one`);
        continue;
      }
      const dbComp = validCompMap.get(comp.event_id);
      if (!dbComp) {
        errors.push(`Competition "${comp.event_name}" (${comp.event_id}): not found in database`);
        continue;
      }
      if (dbComp.group_id !== groupId) {
        errors.push(`Competition "${comp.event_name}": does not belong to the selected group`);
      }
      if (!comp.tee_box_id) {
        const availableTees = comp.course_id ? (teeNamesByCourseId.get(comp.course_id) ?? []) : [];
        const hint = availableTees.length ? ` Available tee names (exact match, case-sensitive): ${availableTees.join(", ")}` : "";
        errors.push(`Competition "${comp.event_name}": tee_box_id is blank — check Tee Name matches a tee for this course.${hint}`);
      } else if (!validTeeBoxIds.has(comp.tee_box_id)) {
        const availableTees = comp.course_id ? (teeNamesByCourseId.get(comp.course_id) ?? []) : [];
        const hint = availableTees.length ? ` Available tee names (exact match, case-sensitive): ${availableTees.join(", ")}` : "";
        errors.push(`Competition "${comp.event_name}": tee_box_id "${comp.tee_box_id}" not found.${hint}`);
      }
    }

    // Validate score profiles
    for (const score of parsed.scores) {
      if (!score.profile_id) {
        errors.push(`Scores sheet: "${score.player_label}" has no resolved profile_id — check email/name matches a profile`);
      } else if (!validProfileIds.has(score.profile_id)) {
        errors.push(`Scores sheet: profile_id "${score.profile_id}" for "${score.player_label}" not found`);
      }
    }

    // Build season previews
    const seasonPreviews: SeasonPreview[] = parsed.seasons.map(s => ({
      season_name:    s.season_name,
      year:           s.year,
      start_date:     s.start_date_override ?? (s.year ? `${s.year}-01-01` : null),
      end_date:       s.end_date_override   ?? (s.year ? `${s.year}-12-31` : null),
      already_exists: existingSeasonNames.has(s.season_name),
    }));

    // Build competition previews
    const scoresByComp = new Map<string, typeof parsed.scores>();
    for (const s of parsed.scores) {
      // For new events, key by event_name (competition_id blank); for existing, key by competition_id
      const key = s.competition_id || s.competition_name;
      if (!key) continue;
      if (!scoresByComp.has(key)) scoresByComp.set(key, []);
      scoresByComp.get(key)!.push(s);
    }

    const competitionPreviews: CompetitionPreview[] = parsed.competitions.map(comp => {
      const lookupKey   = comp.event_id || comp.event_name;
      const compScores  = scoresByComp.get(lookupKey) ?? [];
      const uniquePlayers = new Set(compScores.map(s => s.profile_id).filter(Boolean));
      const dbComp        = comp.event_id ? validCompMap.get(comp.event_id) : null;
      const entryFee      = comp.entry_fee_override != null ? comp.entry_fee_override : (dbComp?.entry_fee_amount ?? null);
      const baseEventName = comp.event_name;

      // Per-round status (only for existing events — new events have no prior rounds)
      const roundNumbers = Array.from(new Set(compScores.map(s => s.round_number))).sort((a, b) => a - b);
      const effectiveRoundNumbers = roundNumbers.length > 0 ? roundNumbers : [1];
      const multiRound = effectiveRoundNumbers.length > 1;
      const rounds: RoundPreview[] = comp.is_new_event
        ? effectiveRoundNumbers.map(n => ({
            round_number:     n,
            round_name:       multiRound ? `${baseEventName} — Round ${n}` : baseEventName,
            already_imported: false, // new event, nothing imported yet
          }))
        : effectiveRoundNumbers.map(n => {
            const roundName = multiRound ? `${baseEventName} — Round ${n}` : baseEventName;
            return {
              round_number:     n,
              round_name:       roundName,
              already_imported: alreadyImportedKeys.has(`${comp.event_id}::${roundName}`),
            };
          });

      const already_imported = !comp.is_new_event && rounds.length > 0 && rounds.every(r => r.already_imported);

      // Per-round course overrides (for display only)
      const roundOverrides = parsed.eventRounds
        .filter(r => r.event_name === comp.event_name)
        .map(r => ({ round_number: r.round_number, course_id: r.course_id, tee_box_id: r.tee_box_id }));

      return {
        competition_id:   comp.event_id,
        competition_name: comp.event_name,
        event_name:       baseEventName,
        season_name:      comp.season_name,
        tee_box_id:       comp.tee_box_id,
        entry_fee:        entryFee,
        player_count:     uniquePlayers.size,
        score_row_count:  compScores.length,
        already_imported,
        rounds,
        round_overrides:  roundOverrides,
        is_new_event:     comp.is_new_event,
        event_date:       comp.event_date,
        event_type:       comp.event_type,
        scoring_model:    comp.scoring_model,
        template_name:    comp.template_name || null,
        allowance_pct:    comp.allowance_resolved,
      };
    });

    const newCompPreviews  = competitionPreviews.filter(c => !c.already_imported);
    const playersWithFee   = newCompPreviews.reduce((acc, c) => acc + (c.entry_fee != null && c.entry_fee > 0 ? c.player_count : 0), 0);

    // ── Event Rounds validation ───────────────────────────────────────────────
    const compNamesOnSheet = new Set(parsed.competitions.map(c => c.event_name));
    for (const er of parsed.eventRounds) {
      if (!compNamesOnSheet.has(er.event_name)) {
        errors.push(`Event Rounds: event "${er.event_name}" not on the Competitions sheet`);
      }
      if (!validTeeBoxIds.has(er.tee_box_id)) {
        errors.push(`Event Rounds: round ${er.round_number} of "${er.event_name}" — tee not found (check column I shows ✓)`);
      }
    }

    // ── Prize pots + payouts ──────────────────────────────────────────────────
    const DIST_TYPES   = new Set(["position_based", "metric_weighted", "metric_equal", "equal_split", "non_monetary", "entry_only"]);
    const METRIC_TYPES = new Set(["twos", "nearest_pin", "longest_drive", "season_points", "custom"]);

    // Players who scored each event (these are auto-enrolled into the event's pots)
    const playersScoredByEventName = new Map<string, Set<string>>();
    for (const s of parsed.scores) {
      if (!s.profile_id) continue;
      if (!playersScoredByEventName.has(s.competition_name)) playersScoredByEventName.set(s.competition_name, new Set());
      playersScoredByEventName.get(s.competition_name)!.add(s.profile_id);
    }

    const compByName = new Map(parsed.competitions.map(c => [c.event_name, c]));
    const potKeySet  = new Set<string>();
    for (const pot of parsed.pots) {
      const key = `${pot.event_name}::${pot.pot_name}`;
      if (potKeySet.has(key)) errors.push(`Prizes sheet: duplicate pot "${pot.pot_name}" for event "${pot.event_name}".`);
      potKeySet.add(key);
      if (!compByName.has(pot.event_name)) {
        errors.push(`Prize pot "${pot.pot_name}": Event "${pot.event_name}" is not on the Competitions sheet.`);
      }
      if (!DIST_TYPES.has(pot.distribution_type)) {
        errors.push(`Prize pot "${pot.pot_name}": invalid Distribution Type "${pot.distribution_type}".`);
      }
      if ((pot.distribution_type === "metric_weighted" || pot.distribution_type === "metric_equal")
          && (!pot.metric_type || !METRIC_TYPES.has(pot.metric_type))) {
        errors.push(`Prize pot "${pot.pot_name}": a valid Metric Type is required for metric pots.`);
      }
    }
    for (const po of parsed.payouts) {
      const key = `${po.event_name}::${po.pot_name}`;
      if (!potKeySet.has(key)) {
        errors.push(`Payout for "${po.player_label}": no pot "${po.pot_name}" defined for event "${po.event_name}" on the Prizes sheet.`);
      }
      if (!po.profile_id || !validProfileIds.has(po.profile_id)) {
        errors.push(`Payout: player "${po.player_label}" did not resolve to a known profile.`);
      }
    }

    // Detect pots that already exist (existing events only — new events have no event_id yet)
    const potEventIds = Array.from(new Set(
      parsed.pots.map(p => compByName.get(p.event_name)?.event_id).filter(Boolean) as string[]
    ));
    let existingPotKeys = new Set<string>();
    if (potEventIds.length) {
      const { data: existingPots } = await admin.from("prize_pots").select("event_id,name").in("event_id", potEventIds);
      existingPotKeys = new Set((existingPots ?? []).map((p: any) => `${p.event_id}::${p.name}`));
    }

    const potPreviews: PotPreview[] = parsed.pots.map(pot => {
      const comp        = compByName.get(pot.event_name);
      const scored      = playersScoredByEventName.get(pot.event_name)?.size ?? 0;
      const payoutCount = parsed.payouts.filter(p => p.event_name === pot.event_name && p.pot_name === pot.pot_name).length;
      const already_exists = comp?.event_id ? existingPotKeys.has(`${comp.event_id}::${pot.pot_name}`) : false;
      return {
        event_name:        pot.event_name,
        pot_name:          pot.pot_name,
        distribution_type: pot.distribution_type,
        entry_fee_amount:  pot.entry_fee_amount,
        player_count:      scored,
        payout_count:      payoutCount,
        already_exists,
      };
    });

    const newPotPreviews = potPreviews.filter(p => !p.already_exists);
    const monetaryPayouts = parsed.payouts.filter(p => p.amount != null && p.amount > 0).length;

    const response: PreviewResponse = {
      group_id: groupId,
      seasons: seasonPreviews,
      competitions: competitionPreviews,
      pots: potPreviews,
      errors,
      totals: {
        seasons_to_create: seasonPreviews.filter(s => !s.already_exists).length,
        competitions:      newCompPreviews.length,
        participants:      newCompPreviews.reduce((a, c) => a + c.player_count, 0),
        score_events:      newCompPreviews.reduce((a, c) => a + c.score_row_count, 0) * 18,
        fee_transactions:  playersWithFee,
        prize_pots:        newPotPreviews.length,
        pot_entries:       newPotPreviews.reduce((a, p) => a + p.player_count, 0),
        pot_entry_fees:    newPotPreviews.reduce((a, p) => a + (p.entry_fee_amount != null && p.entry_fee_amount > 0 ? p.player_count : 0), 0),
        pot_payouts:       parsed.payouts.length,
        pot_winnings:      monetaryPayouts,
      },
    };

    return NextResponse.json({ ok: true, preview: response });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}

// ── XLSX parsing ──────────────────────────────────────────────────────────────
// Competitions sheet columns (v3, 1-based):
//   1=event_name(A), 2=event_date(B), 3=event_type(C), 4=scoring_model(D), 5=template(E),
//   6=allowance%(F), 7=season_name(G), 8=course_name(H), 9=tee_name(I), 10=entry_fee_override(J),
//   11=notes(K), 12=event_id(L), 13=is_new(M), 14=course_id(N), 15=tee_box_id(O), 16=tee_found(P),
//   17=season_id(Q), 18=default_entry_fee(R), 19=template_id(S), 20=tee_slope(T), 21=tee_rating(U),
//   22=tee_par(V), 23=allowance_resolved(W)
//
// Seasons sheet columns (1-based):
//   1=season_name, 2=year, 3=start_date_override, 4=end_date_override, 5=season_id
//
// Scores sheet columns (v3, 1-based):
//   1=event_name, 2=player_label, 3=handicap_index, 4=round_number, 5-22=holes 1-18,
//   23=course_handicap, 24=playing_handicap, 25=event_id, 26=profile_id
//
// Event Rounds sheet columns (1-based, optional):
//   1=event_name, 2=round_number, 3=round_date, 4=course_name, 5=tee_name,
//   6=event_id, 7=course_id, 8=tee_box_id, 9=tee_found, 10=tee_slope,
//   11=tee_rating, 12=tee_par, 13=round_key
//
// Prizes sheet columns (1-based):
//   1=event_name, 2=pot_name, 3=distribution_type, 4=entry_fee_amount, 5=metric_type,
//   6=is_monetary, 7=prize_description, 8=description, 9=event_id
//
// Payouts sheet columns (1-based):
//   1=event_name, 2=pot_name, 3=player_label, 4=position, 5=amount, 6=metric_value,
//   7=note, 8=event_id, 9=profile_id

type ParsedSeason = {
  season_name: string;
  year: number | null;
  start_date_override: string | null;
  end_date_override: string | null;
};

type ParsedComp = {
  event_name: string;
  event_date: string | null;
  event_type: string | null;
  scoring_model: string | null;
  template_name: string;
  template_id: string;
  allowance_pct: number | null;       // user-entered (col F), may be null
  allowance_resolved: number | null;  // effective (col W)
  season_name: string;
  course_name: string;
  tee_name: string;
  entry_fee_override: number | null;
  event_id: string;
  is_new_event: boolean;
  course_id: string;
  tee_box_id: string;
};

type ParsedScore = {
  competition_name: string;
  competition_id: string;
  player_label: string;
  profile_id: string;
  handicap: number | null;
  round_number: number;
  holes: number[];
};

type ParsedRound = {
  event_name: string;
  round_number: number;
  round_date: string | null;
  course_id: string;   // col G
  tee_box_id: string;  // col H
};

type ParsedPot = {
  event_name: string;
  event_id: string;
  pot_name: string;
  distribution_type: string;
  entry_fee_amount: number | null;
  metric_type: string | null;
  is_monetary: boolean;
  prize_description: string | null;
  description: string | null;
};

type ParsedPayout = {
  event_name: string;
  event_id: string;
  pot_name: string;
  player_label: string;
  profile_id: string;
  position: number | null;
  amount: number | null;
  metric_value: number | null;
  note: string | null;
};

async function parseXlsx(file: File): Promise<{
  parsed: { seasons: ParsedSeason[]; competitions: ParsedComp[]; scores: ParsedScore[]; eventRounds: ParsedRound[]; pots: ParsedPot[]; payouts: ParsedPayout[] };
  errors: string[];
}> {
  const errors: string[] = [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());

  const EMPTY = { seasons: [], competitions: [], scores: [], eventRounds: [], pots: [], payouts: [] };

  // Version check — guide sheet col D row 1 contains the version marker
  const guideSheet = wb.getWorksheet("Guide");
  if (guideSheet) {
    const versionCell = cellString(guideSheet.getCell(1, 4));
    if (versionCell && versionCell !== TEMPLATE_VERSION) {
      errors.push(`This template is outdated (version "${versionCell}") — please re-download the template from Step 1.`);
      return { parsed: EMPTY, errors };
    }
    if (!versionCell) {
      errors.push(`This template is outdated (no version marker) — please re-download the template from Step 1.`);
      return { parsed: EMPTY, errors };
    }
  }

  const seasonSheet = wb.getWorksheet("Seasons");
  if (!seasonSheet) errors.push("Workbook is missing the 'Seasons' sheet");

  const compSheet = wb.getWorksheet("Competitions");
  if (!compSheet) errors.push("Workbook is missing the 'Competitions' sheet");

  const scoresSheet = wb.getWorksheet("Scores");
  if (!scoresSheet) errors.push("Workbook is missing the 'Scores' sheet");

  if (errors.length) return { parsed: EMPTY, errors };

  const seasons: ParsedSeason[] = [];
  seasonSheet!.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = cellString(row.getCell(1));
    if (!name) return;
    seasons.push({
      season_name:         name,
      year:                cellNumber(row.getCell(2)),
      start_date_override: cellString(row.getCell(3)) || null,
      end_date_override:   cellString(row.getCell(4)) || null,
    });
  });

  const competitions: ParsedComp[] = [];
  compSheet!.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const eventName = cellString(row.getCell(1)); // A
    if (!eventName) return;
    const eventId = cellString(row.getCell(12)); // L
    competitions.push({
      event_name:         eventName,
      event_date:         cellString(row.getCell(2)) || null,  // B
      event_type:         cellString(row.getCell(3)) || null,  // C
      scoring_model:      cellString(row.getCell(4)) || null,  // D
      template_name:      cellString(row.getCell(5)),          // E
      allowance_pct:      cellNumber(row.getCell(6)),          // F
      season_name:        cellString(row.getCell(7)),          // G
      course_name:        cellString(row.getCell(8)),          // H
      tee_name:           cellString(row.getCell(9)),          // I
      entry_fee_override: cellNumber(row.getCell(10)),         // J
      event_id:           eventId,
      is_new_event:       eventId === "",
      course_id:          cellString(row.getCell(14)),         // N
      tee_box_id:         cellString(row.getCell(15)),         // O
      template_id:        cellString(row.getCell(19)),         // S
      allowance_resolved: cellNumber(row.getCell(23)),         // W
    });
  });

  const scores: ParsedScore[] = [];
  scoresSheet!.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const compName    = cellString(row.getCell(1));
    if (!compName) return;
    const playerLabel = cellString(row.getCell(2));
    if (!playerLabel) return;
    const holes: number[] = [];
    for (let h = 0; h < 18; h++) holes.push(cellNumber(row.getCell(5 + h)) ?? 0); // E-V
    scores.push({
      competition_name: compName,
      competition_id:   cellString(row.getCell(25)), // Y
      player_label:     playerLabel,
      profile_id:       cellString(row.getCell(26)), // Z
      handicap:         cellNumber(row.getCell(3)),
      round_number:     cellNumber(row.getCell(4)) ?? 1,
      holes,
    });
  });

  const eventRounds: ParsedRound[] = [];
  const eventRoundsSheet = wb.getWorksheet("Event Rounds");
  eventRoundsSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const eventName = cellString(row.getCell(1)); // A
    if (!eventName) return;
    const roundNum = cellNumber(row.getCell(2));  // B
    if (!roundNum) return;
    const courseId  = cellString(row.getCell(7)); // G
    const teeBoxId  = cellString(row.getCell(8)); // H
    if (!courseId || !teeBoxId) return;
    eventRounds.push({
      event_name:   eventName,
      round_number: roundNum,
      round_date:   cellString(row.getCell(3)) || null, // C
      course_id:    courseId,
      tee_box_id:   teeBoxId,
    });
  });

  const pots: ParsedPot[] = [];
  const prizesSheet = wb.getWorksheet("Prizes");
  prizesSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const eventName = cellString(row.getCell(1)); // A
    const potName   = cellString(row.getCell(2)); // B
    if (!eventName || !potName) return;
    pots.push({
      event_name:        eventName,
      pot_name:          potName,
      distribution_type: cellString(row.getCell(3)) || "position_based", // C
      entry_fee_amount:  cellNumber(row.getCell(4)),                      // D
      metric_type:       cellString(row.getCell(5)) || null,             // E
      is_monetary:       (cellString(row.getCell(6)) || "Yes").toLowerCase() !== "no", // F
      prize_description: cellString(row.getCell(7)) || null,             // G
      description:       cellString(row.getCell(8)) || null,             // H
      event_id:          cellString(row.getCell(9)),                      // I
    });
  });

  const payouts: ParsedPayout[] = [];
  const payoutsSheet = wb.getWorksheet("Payouts");
  payoutsSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const eventName   = cellString(row.getCell(1)); // A
    const potName     = cellString(row.getCell(2)); // B
    const playerLabel = cellString(row.getCell(3)); // C
    if (!eventName || !potName || !playerLabel) return;
    payouts.push({
      event_name:   eventName,
      pot_name:     potName,
      player_label: playerLabel,
      position:     cellNumber(row.getCell(4)), // D
      amount:       cellNumber(row.getCell(5)), // E
      metric_value: cellNumber(row.getCell(6)), // F
      note:         cellString(row.getCell(7)) || null, // G
      event_id:     cellString(row.getCell(8)), // H
      profile_id:   cellString(row.getCell(9)), // I
    });
  });

  return { parsed: { seasons, competitions, scores, eventRounds, pots, payouts }, errors };
}

function cellString(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && "result" in v) return cellString({ value: (v as any).result } as any);
  return String(v).trim();
}

function cellNumber(cell: ExcelJS.Cell): number | null {
  const v = cell.value;
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "result" in v) return cellNumber({ value: (v as any).result } as any);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
