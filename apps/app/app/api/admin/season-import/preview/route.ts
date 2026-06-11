import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { parseXlsx, type ParsedRound } from "@/lib/admin/season-import/parse";
import { resolveTemplateDefaults } from "@/lib/admin/season-import/templates";

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
  points_model: string | null;          // resolved (sheet override → template → none)
  points_model_source: "sheet" | "template" | "default";
  field_size: number | null;
  tee_time: string | null;
  default_pots_inherited: number;       // pots synthesized from the template
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
  from_template: boolean;
};

export type ChargePreview = {
  event_name: string;
  charge_name: string;
  category: string;
  amount: number | null;
  applies_to_all: boolean;
  player_count: number;       // assignments this charge will create
  paid_count: number;         // assignments that also get a settling payment
  already_exists: boolean;
};

export type PaymentPreview = {
  player_label: string;
  event_name: string | null;
  amount: number | null;      // null = auto-settle
  payment_date: string | null;
};

export type PlayoffPreview = {
  event_name: string;
  resolution_type: string;
  player_count: number;
  winner_label: string | null;
  already_exists: boolean;
};

export type PreviewResponse = {
  group_id: string;
  seasons: SeasonPreview[];
  competitions: CompetitionPreview[];
  pots: PotPreview[];
  charges: ChargePreview[];
  payments: PaymentPreview[];
  playoffs: PlayoffPreview[];
  errors: string[];
  warnings: string[];
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
    event_charges: number;
    player_charges: number;
    charge_transactions: number;
    payment_transactions: number;
    playoffs: number;
    events_inheriting_template: number;
  };
};

const VALID_EVENT_TYPES    = ["stroke", "stableford", "matchplay", "skins", "scramble", "bestball", "best ball", "custom"];
const VALID_SCORING_MODELS = ["gross", "net"];
const VALID_POINTS_MODELS  = ["none", "position_based", "custom_table", "fedex_style", "ciaga_formula", "custom_formula"];
const VALID_CATEGORIES     = ["green_fee", "buggy", "food", "drink", "other"];
const TIME_RE = /^\d{1,2}:\d{2}$/;

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
    const warnings: string[] = [];

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

    // Resolve template defaults early — required to validate "blank but inherited" fields
    const referencedTemplateIds = Array.from(new Set(parsed.competitions.map(c => c.template_id).filter(Boolean)));
    const templateDefaults = await resolveTemplateDefaults(admin, referencedTemplateIds, groupId);

    // Validate new event required fields
    const seenNewEventNames = new Set<string>();
    for (const comp of newComps) {
      if (seenNewEventNames.has(comp.event_name)) {
        errors.push(`Competitions sheet: duplicate Event Name "${comp.event_name}" — each row must have a unique name`);
      }
      seenNewEventNames.add(comp.event_name);

      const tmpl = comp.template_id ? templateDefaults.get(comp.template_id) : undefined;

      if (!comp.event_date) {
        errors.push(`New event "${comp.event_name}": Event Date is required`);
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(comp.event_date)) {
        errors.push(`New event "${comp.event_name}": Event Date must be formatted YYYY-MM-DD (e.g. 2024-06-15)`);
      }
      if (!comp.event_type && !tmpl?.event_type) {
        errors.push(`New event "${comp.event_name}": Event Type is required (or pick a Template that defines it)`);
      } else if (comp.event_type && !VALID_EVENT_TYPES.includes(comp.event_type.toLowerCase())) {
        errors.push(`New event "${comp.event_name}": Event Type "${comp.event_type}" is not valid`);
      }
      if (comp.scoring_model && !VALID_SCORING_MODELS.includes(comp.scoring_model.toLowerCase())) {
        errors.push(`New event "${comp.event_name}": Scoring Model "${comp.scoring_model}" must be Gross or Net`);
      }
      if (!comp.course_id) {
        errors.push(`New event "${comp.event_name}": Course Name did not resolve — select a course from the dropdown`);
      }
      if (!comp.tee_box_id) {
        errors.push(`New event "${comp.event_name}": Tee Name did not resolve — check column P (tee_found) shows ✓`);
      }
    }

    // Template + allowance + points/tee-time validation (applies to all competition rows)
    for (const comp of parsed.competitions) {
      if (comp.template_name && !comp.template_id) {
        errors.push(`Competition "${comp.event_name}": Template "${comp.template_name}" did not resolve — pick it from the dropdown.`);
      } else if (comp.template_id && !templateDefaults.has(comp.template_id)) {
        errors.push(`Competition "${comp.event_name}": Template does not belong to this group.`);
      }
      if (comp.allowance_pct != null && (comp.allowance_pct < 0 || comp.allowance_pct > 100)) {
        errors.push(`Competition "${comp.event_name}": Handicap Allowance % must be between 0 and 100.`);
      }
      if (comp.points_model_override && !VALID_POINTS_MODELS.includes(comp.points_model_override.toLowerCase())) {
        errors.push(`Competition "${comp.event_name}": points_model_override "${comp.points_model_override}" is not valid.`);
      }
      if (comp.field_size_override != null && comp.field_size_override < 1) {
        errors.push(`Competition "${comp.event_name}": field_size_override must be ≥ 1.`);
      }
      if (comp.tee_time && !TIME_RE.test(comp.tee_time)) {
        errors.push(`Competition "${comp.event_name}": tee_time "${comp.tee_time}" must be HH:MM (e.g. 09:30).`);
      }
    }
    for (const er of parsed.eventRounds) {
      if (er.tee_time && !TIME_RE.test(er.tee_time)) {
        errors.push(`Event Rounds: round ${er.round_number} of "${er.event_name}" — Tee Time "${er.tee_time}" must be HH:MM.`);
      }
    }

    const existingCompIds = Array.from(new Set(existingComps.map(c => c.event_id).filter(Boolean)));
    const profileIds      = Array.from(new Set([
      ...parsed.scores.map(s => s.profile_id),
      ...parsed.payouts.map(p => p.profile_id),
      ...parsed.charges.map(c => c.profile_id),
      ...parsed.payments.map(p => p.profile_id),
      ...parsed.playoffs.map(p => p.profile_id),
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
        ? admin.from("events").select("id,name,group_id,entry_fee_amount,course_id,group_season_id,points_model").in("id", existingCompIds)
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

    const validCompMap = new Map<string, { name: string; group_id: string | null; entry_fee_amount: number | null; course_id: string | null; group_season_id: string | null; points_model: string | null }>();
    for (const c of compsRes.data ?? []) validCompMap.set(c.id, c as any);

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
      start_date:     s.start_date || null,
      end_date:       s.end_date || null,
      already_exists: existingSeasonNames.has(s.season_name),
    }));

    // Players who scored each event (auto-enrolled into the event's pots / all-entrant charges)
    const playersScoredByEventName = new Map<string, Set<string>>();
    for (const s of parsed.scores) {
      if (!s.profile_id) continue;
      if (!playersScoredByEventName.has(s.competition_name)) playersScoredByEventName.set(s.competition_name, new Set());
      playersScoredByEventName.get(s.competition_name)!.add(s.profile_id);
    }

    // Build competition previews
    const scoresByComp = new Map<string, typeof parsed.scores>();
    for (const s of parsed.scores) {
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
      const tmpl          = comp.template_id ? templateDefaults.get(comp.template_id) : undefined;

      // Per-round status (only for existing events — new events have no prior rounds)
      const roundNumbers = Array.from(new Set(compScores.map(s => s.round_number))).sort((a, b) => a - b);
      const effectiveRoundNumbers = roundNumbers.length > 0 ? roundNumbers : [1];
      const multiRound = effectiveRoundNumbers.length > 1;
      const rounds: RoundPreview[] = comp.is_new_event
        ? effectiveRoundNumbers.map(n => ({
            round_number:     n,
            round_name:       multiRound ? `${baseEventName} — Round ${n}` : baseEventName,
            already_imported: false,
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

      const roundOverrides = parsed.eventRounds
        .filter(r => r.event_name === comp.event_name)
        .map(r => ({ round_number: r.round_number, course_id: r.course_id, tee_box_id: r.tee_box_id }));

      // Resolved inheritance for display: value + where it came from
      let points_model: string;
      let points_model_source: "sheet" | "template" | "default";
      if (comp.points_model_override) {
        points_model = comp.points_model_override.toLowerCase();
        points_model_source = "sheet";
      } else if (tmpl?.points_model) {
        points_model = tmpl.points_model.toLowerCase();
        points_model_source = "template";
      } else {
        points_model = dbComp?.points_model && dbComp.points_model !== "none" ? dbComp.points_model : "none";
        points_model_source = "default";
      }

      const default_pots_inherited =
        !parsed.pots.some(p => p.event_name === comp.event_name) && tmpl?.default_prize_pots?.length
          ? tmpl.default_prize_pots.length
          : 0;

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
        event_type:       comp.event_type || tmpl?.event_type || null,
        scoring_model:    comp.scoring_model || tmpl?.scoring_model || null,
        template_name:    comp.template_name || null,
        allowance_pct:    comp.allowance_resolved,
        points_model,
        points_model_source,
        field_size:       comp.field_size_override,
        tee_time:         comp.tee_time,
        default_pots_inherited,
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
        errors.push(`Event Rounds: round ${er.round_number} of "${er.event_name}" — tee not found (check column J shows ✓)`);
      }
    }

    // ── Prize pots + payouts ──────────────────────────────────────────────────
    const DIST_TYPES   = new Set(["position_based", "metric_weighted", "metric_equal", "equal_split", "non_monetary", "entry_only"]);
    const METRIC_TYPES = new Set(["twos", "nearest_pin", "longest_drive", "season_points", "custom"]);

    const compByName = new Map(parsed.competitions.map(c => [c.event_name, c]));

    // Synthesize template default pots for events without explicit Prizes rows
    // (mirrors the import behaviour so the preview counts match).
    type PotRow = (typeof parsed.pots)[number] & { from_template?: boolean };
    const potEventNames = new Set(parsed.pots.map(p => p.event_name));
    const effectivePots: PotRow[] = [...parsed.pots];
    for (const comp of parsed.competitions) {
      if (potEventNames.has(comp.event_name)) continue;
      const tmpl = comp.template_id ? templateDefaults.get(comp.template_id) : undefined;
      if (!tmpl?.default_prize_pots?.length) continue;
      for (const dp of tmpl.default_prize_pots) {
        if (!dp?.name) continue;
        effectivePots.push({
          event_name:        comp.event_name,
          event_id:          comp.event_id,
          pot_name:          dp.name,
          distribution_type: dp.distribution_type === "winner_takes_all" ? "position_based" : (dp.distribution_type || "position_based"),
          entry_fee_amount:  dp.entry_fee_amount ?? null,
          metric_type:       null,
          is_monetary:       dp.is_monetary ?? true,
          prize_description: null,
          description:       "Inherited from competition template",
          from_template:     true,
        });
      }
    }

    const potKeySet  = new Set<string>();
    for (const pot of effectivePots) {
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
      effectivePots.map(p => compByName.get(p.event_name)?.event_id).filter(Boolean) as string[]
    ));
    let existingPotKeys = new Set<string>();
    if (potEventIds.length) {
      const { data: existingPots } = await admin.from("prize_pots").select("event_id,name").in("event_id", potEventIds);
      existingPotKeys = new Set((existingPots ?? []).map((p: any) => `${p.event_id}::${p.name}`));
    }

    const potPreviews: PotPreview[] = effectivePots.map(pot => {
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
        from_template:     !!pot.from_template,
      };
    });

    const newPotPreviews = potPreviews.filter(p => !p.already_exists);
    const monetaryPayouts = parsed.payouts.filter(p => p.amount != null && p.amount > 0).length;

    // ── Charges ───────────────────────────────────────────────────────────────
    type ChargeGroup = {
      event_name: string; charge_name: string; category: string; amount: number | null;
      applies_to_all: boolean; all_paid: boolean;
      explicit: Array<{ profile_id: string; paid: boolean; player_label: string }>;
    };
    const chargeGroups = new Map<string, ChargeGroup>();
    for (const ch of parsed.charges) {
      if (!compNamesOnSheet.has(ch.event_name)) {
        errors.push(`Charge "${ch.charge_name}": event "${ch.event_name}" is not on the Competitions sheet.`);
      }
      if (!VALID_CATEGORIES.includes(ch.category)) {
        errors.push(`Charge "${ch.charge_name}" (${ch.event_name}): invalid Category "${ch.category}".`);
      }
      if (ch.player_label && !ch.profile_id) {
        errors.push(`Charge "${ch.charge_name}": player "${ch.player_label}" did not resolve to a profile.`);
      } else if (ch.player_label && ch.profile_id && !playersScoredByEventName.get(ch.event_name)?.has(ch.profile_id)) {
        warnings.push(`Charge "${ch.charge_name}": "${ch.player_label}" has no scores for "${ch.event_name}" — they will still be charged.`);
      }

      const key = `${ch.event_name}::${ch.charge_name}`;
      let g = chargeGroups.get(key);
      if (!g) {
        g = { event_name: ch.event_name, charge_name: ch.charge_name, category: ch.category, amount: ch.amount, applies_to_all: false, all_paid: true, explicit: [] };
        chargeGroups.set(key, g);
      }
      if (g.amount == null && ch.amount != null) g.amount = ch.amount;
      if (!ch.player_label) {
        if (g.applies_to_all) errors.push(`Charge "${ch.charge_name}" (${ch.event_name}): more than one all-entrants row.`);
        g.applies_to_all = true;
        g.all_paid = ch.paid;
      } else if (ch.profile_id) {
        if (g.explicit.some(e => e.profile_id === ch.profile_id)) {
          errors.push(`Charge "${ch.charge_name}" (${ch.event_name}): duplicate row for "${ch.player_label}".`);
        }
        g.explicit.push({ profile_id: ch.profile_id, paid: ch.paid, player_label: ch.player_label });
      }
    }
    // Amount can live on the all-entrants row (per-player rows inherit it) — only
    // error when a charge group ends up with no amount anywhere.
    for (const g of chargeGroups.values()) {
      const groupRows = parsed.charges.filter(c => c.event_name === g.event_name && c.charge_name === g.charge_name);
      const hasAmount = g.amount != null || groupRows.every(r => r.player_label && (r.amount_override ?? r.amount) != null);
      if (!hasAmount) {
        errors.push(`Charge "${g.charge_name}" (${g.event_name}): Amount is required (on the all-entrants row or each player row).`);
      }
    }

    // already_exists detection for charges (existing events only)
    const chargeEventIds = Array.from(new Set(
      Array.from(chargeGroups.values()).map(g => compByName.get(g.event_name)?.event_id).filter(Boolean) as string[]
    ));
    let existingChargeKeys = new Set<string>();
    if (chargeEventIds.length) {
      const { data: existingCharges } = await admin.from("event_charges").select("event_id,name").in("event_id", chargeEventIds);
      existingChargeKeys = new Set((existingCharges ?? []).map((c: any) => `${c.event_id}::${c.name}`));
    }

    const chargePreviews: ChargePreview[] = Array.from(chargeGroups.values()).map(g => {
      const assignments = new Map<string, boolean>(); // profile → paid
      if (g.applies_to_all) {
        for (const pid of playersScoredByEventName.get(g.event_name) ?? []) assignments.set(pid, g.all_paid);
      }
      for (const ex of g.explicit) assignments.set(ex.profile_id, ex.paid);
      const comp = compByName.get(g.event_name);
      return {
        event_name:     g.event_name,
        charge_name:    g.charge_name,
        category:       g.category,
        amount:         g.amount,
        applies_to_all: g.applies_to_all,
        player_count:   assignments.size,
        paid_count:     Array.from(assignments.values()).filter(Boolean).length,
        already_exists: comp?.event_id ? existingChargeKeys.has(`${comp.event_id}::${g.charge_name}`) : false,
      };
    });

    // ── Payments ──────────────────────────────────────────────────────────────
    for (const pm of parsed.payments) {
      if (!pm.profile_id || !validProfileIds.has(pm.profile_id)) {
        errors.push(`Payment: player "${pm.player_label}" did not resolve to a known profile.`);
      }
      if (pm.event_name && !compNamesOnSheet.has(pm.event_name)) {
        errors.push(`Payment for "${pm.player_label}": event "${pm.event_name}" is not on the Competitions sheet.`);
      }
      if (pm.payment_date && !/^\d{4}-\d{2}-\d{2}$/.test(pm.payment_date)) {
        errors.push(`Payment for "${pm.player_label}": Payment Date must be YYYY-MM-DD.`);
      }
      if (pm.amount != null && pm.amount <= 0) {
        errors.push(`Payment for "${pm.player_label}": Amount must be positive (or blank to auto-settle).`);
      }
      if (pm.amount == null && pm.event_name && pm.profile_id) {
        // Auto-settle with nothing to settle is suspicious — warn, don't block
        const scored = playersScoredByEventName.get(pm.event_name)?.has(pm.profile_id);
        const hasCharge = parsed.charges.some(c => c.event_name === pm.event_name && (!c.player_label || c.profile_id === pm.profile_id));
        const comp = compByName.get(pm.event_name);
        const hasFee = (comp?.entry_fee_override ?? null) != null
          || (comp?.event_id ? (validCompMap.get(comp.event_id)?.entry_fee_amount ?? null) != null : false)
          || effectivePots.some(p => p.event_name === pm.event_name && (p.entry_fee_amount ?? 0) > 0);
        if (!scored && !hasCharge && !hasFee) {
          warnings.push(`Payment for "${pm.player_label}" (${pm.event_name}): auto-settle but no imported debits found — it may settle to nothing.`);
        }
      }
    }
    const paymentPreviews: PaymentPreview[] = parsed.payments.map(pm => ({
      player_label: pm.player_label,
      event_name:   pm.event_name || null,
      amount:       pm.amount,
      payment_date: pm.payment_date,
    }));

    // ── Playoffs ──────────────────────────────────────────────────────────────
    const playoffsByEvent = new Map<string, typeof parsed.playoffs>();
    for (const row of parsed.playoffs) {
      if (!compNamesOnSheet.has(row.event_name)) {
        errors.push(`Playoff: event "${row.event_name}" is not on the Competitions sheet.`);
      }
      if (!row.profile_id || !validProfileIds.has(row.profile_id)) {
        errors.push(`Playoff (${row.event_name}): player "${row.player_label}" did not resolve to a known profile.`);
      } else if (!playersScoredByEventName.get(row.event_name)?.has(row.profile_id)) {
        errors.push(`Playoff (${row.event_name}): "${row.player_label}" has no scores for this event.`);
      }
      if (!["playoff", "countback"].includes(row.resolution_type)) {
        errors.push(`Playoff (${row.event_name}): Resolution Type must be playoff or countback.`);
      }
      if (!playoffsByEvent.has(row.event_name)) playoffsByEvent.set(row.event_name, []);
      playoffsByEvent.get(row.event_name)!.push(row);
    }
    for (const [eventName, rows] of playoffsByEvent.entries()) {
      if (rows.length < 2) errors.push(`Playoff for "${eventName}": needs at least 2 tied players.`);
      const positions = rows.map(r => r.final_position).filter((p): p is number => p != null).sort((a, b) => a - b);
      if (positions.length !== rows.length) errors.push(`Playoff for "${eventName}": every player needs a Final Position.`);
      if (rows.filter(r => r.final_position === 1).length !== 1) {
        errors.push(`Playoff for "${eventName}": exactly one player must have Final Position 1.`);
      }
    }

    const playoffEventIds = Array.from(new Set(
      Array.from(playoffsByEvent.keys()).map(n => compByName.get(n)?.event_id).filter(Boolean) as string[]
    ));
    let eventsWithPlayoff = new Set<string>();
    if (playoffEventIds.length) {
      const { data: existingPlayoffs } = await admin.from("event_playoffs").select("event_id").in("event_id", playoffEventIds);
      eventsWithPlayoff = new Set((existingPlayoffs ?? []).map((p: any) => p.event_id));
    }

    const playoffPreviews: PlayoffPreview[] = Array.from(playoffsByEvent.entries()).map(([eventName, rows]) => {
      const comp = compByName.get(eventName);
      return {
        event_name:      eventName,
        resolution_type: rows[0]?.resolution_type ?? "playoff",
        player_count:    rows.length,
        winner_label:    rows.find(r => r.final_position === 1)?.player_label ?? null,
        already_exists:  comp?.event_id ? eventsWithPlayoff.has(comp.event_id) : false,
      };
    });

    // ── Totals ────────────────────────────────────────────────────────────────
    const newChargePreviews = chargePreviews.filter(c => !c.already_exists);
    const chargePaymentTxs  = newChargePreviews.reduce((a, c) => a + c.paid_count, 0);

    const response: PreviewResponse = {
      group_id: groupId,
      seasons: seasonPreviews,
      competitions: competitionPreviews,
      pots: potPreviews,
      charges: chargePreviews,
      payments: paymentPreviews,
      playoffs: playoffPreviews,
      errors,
      warnings,
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
        event_charges:        newChargePreviews.length,
        player_charges:       newChargePreviews.reduce((a, c) => a + c.player_count, 0),
        charge_transactions:  newChargePreviews.reduce((a, c) => a + c.player_count, 0),
        payment_transactions: chargePaymentTxs + parsed.payments.length,
        playoffs:             playoffPreviews.filter(p => !p.already_exists).length,
        events_inheriting_template: competitionPreviews.filter(c => c.template_name).length,
      },
    };

    return NextResponse.json({ ok: true, preview: response });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
