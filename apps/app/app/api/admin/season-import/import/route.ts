import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { TEMPLATE_VERSION } from "../template/route";

type TeeHole = {
  hole_number: number;
  par: number | null;
  yardage: number | null;
  handicap: number | null;
};

// ── Cell readers ──────────────────────────────────────────────────────────────

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
  start_date: string;
  end_date: string;
  type: "calendar_year" | "custom";
};

type ParsedComp = {
  event_name: string;
  event_date: string | null;
  event_type: string | null;
  scoring_model: string | null;
  template_id: string;
  allowance_resolved: number | null;
  season_name: string;
  entry_fee_override: number | null;
  event_id: string;
  is_new_event: boolean;
  course_id: string;
  tee_box_id: string;
};

type ParsedScore = {
  competition_name: string; // = event_name from col A
  competition_id: string;   // resolved event_id from col Y (blank for new events at parse time)
  player_label: string;
  profile_id: string;
  handicap: number | null;
  round_number: number;
  holes: number[];
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

async function parseXlsx(file: File) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());

  // Version check
  const guideSheet = wb.getWorksheet("Guide");
  if (guideSheet) {
    const versionCell = cellString(guideSheet.getCell(1, 4));
    if (versionCell !== TEMPLATE_VERSION) {
      throw new Error(`Outdated template (version "${versionCell || "none"}") — please re-download the template from Step 1.`);
    }
  }

  const seasonSheet = wb.getWorksheet("Seasons");
  if (!seasonSheet) throw new Error("Workbook is missing the 'Seasons' sheet");

  const compSheet = wb.getWorksheet("Competitions");
  if (!compSheet) throw new Error("Workbook is missing the 'Competitions' sheet");

  const scoresSheet = wb.getWorksheet("Scores");
  if (!scoresSheet) throw new Error("Workbook is missing the 'Scores' sheet");

  const seasons: ParsedSeason[] = [];
  seasonSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const name = cellString(row.getCell(1));
    if (!name) return;
    const year             = cellNumber(row.getCell(2));
    const startOverride    = cellString(row.getCell(3)) || null;
    const endOverride      = cellString(row.getCell(4)) || null;
    const isCustom         = !!(startOverride || endOverride);
    seasons.push({
      season_name: name,
      year,
      start_date:  startOverride ?? (year ? `${year}-01-01` : ""),
      end_date:    endOverride   ?? (year ? `${year}-12-31` : ""),
      type:        isCustom ? "custom" : "calendar_year",
    });
  });

  const competitions: ParsedComp[] = [];
  compSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const eventName = cellString(row.getCell(1)); // A
    if (!eventName) return;
    const eventId = cellString(row.getCell(12)); // L
    competitions.push({
      event_name:         eventName,
      event_date:         cellString(row.getCell(2)) || null,  // B
      event_type:         cellString(row.getCell(3)) || null,  // C
      scoring_model:      cellString(row.getCell(4)) || null,  // D
      template_id:        cellString(row.getCell(19)),         // S
      allowance_resolved: cellNumber(row.getCell(23)),         // W
      season_name:        cellString(row.getCell(7)),          // G
      entry_fee_override: cellNumber(row.getCell(10)),         // J
      event_id:           eventId,
      is_new_event:       eventId === "",
      course_id:          cellString(row.getCell(14)),         // N
      tee_box_id:         cellString(row.getCell(15)),         // O
    });
  });

  const scores: ParsedScore[] = [];
  scoresSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const compName    = cellString(row.getCell(1));
    if (!compName) return;
    const playerLabel = cellString(row.getCell(2));
    if (!playerLabel) return;
    const holes: number[] = [];
    for (let h = 0; h < 18; h++) holes.push(cellNumber(row.getCell(5 + h)) ?? 0);
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

  const pots: ParsedPot[] = [];
  const prizesSheet = wb.getWorksheet("Prizes");
  prizesSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const eventName = cellString(row.getCell(1));
    const potName   = cellString(row.getCell(2));
    if (!eventName || !potName) return;
    pots.push({
      event_name:        eventName,
      pot_name:          potName,
      distribution_type: cellString(row.getCell(3)) || "position_based",
      entry_fee_amount:  cellNumber(row.getCell(4)),
      metric_type:       cellString(row.getCell(5)) || null,
      is_monetary:       (cellString(row.getCell(6)) || "Yes").toLowerCase() !== "no",
      prize_description: cellString(row.getCell(7)) || null,
      description:       cellString(row.getCell(8)) || null,
      event_id:          cellString(row.getCell(9)),
    });
  });

  const payouts: ParsedPayout[] = [];
  const payoutsSheet = wb.getWorksheet("Payouts");
  payoutsSheet?.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const eventName   = cellString(row.getCell(1));
    const potName     = cellString(row.getCell(2));
    const playerLabel = cellString(row.getCell(3));
    if (!eventName || !potName || !playerLabel) return;
    payouts.push({
      event_name:   eventName,
      pot_name:     potName,
      player_label: playerLabel,
      position:     cellNumber(row.getCell(4)),
      amount:       cellNumber(row.getCell(5)),
      metric_value: cellNumber(row.getCell(6)),
      note:         cellString(row.getCell(7)) || null,
      event_id:     cellString(row.getCell(8)),
      profile_id:   cellString(row.getCell(9)),
    });
  });

  return { seasons, competitions, scores, pots, payouts };
}

// ── POST handler ──────────────────────────────────────────────────────────────

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

    if (!file)    return NextResponse.json({ error: "Missing file" },     { status: 400 });
    if (!groupId) return NextResponse.json({ error: "Missing group_id" }, { status: 400 });

    const { seasons: seasonRows, competitions: compRows, scores: scoreRows, pots: potRows, payouts: payoutRows } = await parseXlsx(file);

    // ── 0. Pre-flight validation ──────────────────────────────────────────────
    const existingCompRows = compRows.filter(c => !c.is_new_event);
    const newCompRows      = compRows.filter(c => c.is_new_event);

    // Resolve template defaults for any referenced templates (event_type/scoring_model/max_handicap)
    type TemplateDefaults = { event_type: string | null; scoring_model: string | null; max_handicap: number | null };
    const templateDefaults = new Map<string, TemplateDefaults>();
    const referencedTemplateIds = Array.from(new Set(compRows.map(c => c.template_id).filter(Boolean)));
    if (referencedTemplateIds.length) {
      const { data: tmplRows, error: tmplErr } = await admin
        .from("competition_event_templates")
        .select("id,template_event_type,template_scoring_model,template_settings")
        .in("id", referencedTemplateIds);
      if (tmplErr) throw new Error(`Template lookup failed: ${tmplErr.message}`);
      for (const t of tmplRows ?? []) {
        const settings = ((t as any).template_settings ?? {}) as Record<string, any>;
        templateDefaults.set((t as any).id, {
          event_type:    (t as any).template_event_type ?? null,
          scoring_model: (t as any).template_scoring_model ?? null,
          max_handicap:  settings.max_handicap ?? null,
        });
      }
    }
    const resolveAllowance = (comp: ParsedComp): number => {
      const a = comp.allowance_resolved;
      if (a == null || !Number.isFinite(a)) return 100;
      return Math.max(0, Math.min(100, Math.round(a)));
    };

    const existingCompIds = Array.from(new Set(existingCompRows.map(c => c.event_id).filter(Boolean)));
    const allTeeBoxIds    = Array.from(new Set(compRows.map(c => c.tee_box_id).filter(Boolean)));

    // Validate new event required fields
    const preflightErrors: string[] = [];
    for (const comp of newCompRows) {
      if (!comp.event_date) preflightErrors.push(`New event "${comp.event_name}": Event Date is required`);
      if (!comp.event_type) preflightErrors.push(`New event "${comp.event_name}": Event Type is required`);
      if (!comp.scoring_model) preflightErrors.push(`New event "${comp.event_name}": Scoring Model is required`);
      if (!comp.course_id)  preflightErrors.push(`New event "${comp.event_name}": Course did not resolve`);
      if (!comp.tee_box_id) preflightErrors.push(`New event "${comp.event_name}": Tee did not resolve — check column N shows ✓`);
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

    // Prize pot / payout preflight
    const VALID_DIST   = new Set(["position_based", "metric_weighted", "metric_equal", "equal_split", "non_monetary", "entry_only"]);
    const VALID_METRIC = new Set(["twos", "nearest_pin", "longest_drive", "season_points", "custom"]);
    const compNamesSet = new Set(compRows.map(c => c.event_name));
    const potKeys      = new Set<string>();
    for (const pot of potRows) {
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

    if (preflightErrors.length) {
      return NextResponse.json({ error: preflightErrors[0], errors: preflightErrors }, { status: 400 });
    }

    // ── Build round-count map keyed by event_name (before IDs are resolved) ──
    // This is needed so new event creation knows how many event_rounds to create.
    const roundsPerEventName = new Map<string, Set<number>>();
    for (const s of scoreRows) {
      if (!s.competition_name) continue;
      if (!roundsPerEventName.has(s.competition_name)) roundsPerEventName.set(s.competition_name, new Set());
      roundsPerEventName.get(s.competition_name)!.add(s.round_number);
    }

    // ── 1a. Auto-resolve blank handicaps ─────────────────────────────────────
    // For any score row where the handicap column was left blank, look up the
    // player's WHS handicap index as of the day before the event using the
    // ciaga_true_hi_as_of DB function. This mirrors how the handicap replay
    // system snapshots HI (it uses round_date - 1).
    {
      // Build a map from competition_name → event_date for quick lookup
      const eventDateByName = new Map<string, string>();
      for (const comp of compRows) {
        if (comp.event_date) eventDateByName.set(comp.event_name, comp.event_date);
      }

      // Collect unique (profile_id, as_of_date) pairs that need resolution
      type HiKey = `${string}::${string}`;
      const needed = new Map<HiKey, { profileId: string; asOfDate: string }>();
      for (const score of scoreRows) {
        if (score.handicap !== null) continue;
        if (!score.profile_id) continue;
        const eventDate = eventDateByName.get(score.competition_name);
        if (!eventDate) continue;
        // Day before the event (matches ciaga_refresh_handicaps_from logic)
        const asOf = new Date(eventDate);
        asOf.setDate(asOf.getDate() - 1);
        const asOfStr = asOf.toISOString().slice(0, 10);
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

        // Patch score rows in place
        for (const score of scoreRows) {
          if (score.handicap !== null) continue;
          if (!score.profile_id) continue;
          const eventDate = eventDateByName.get(score.competition_name);
          if (!eventDate) continue;
          const asOf = new Date(eventDate);
          asOf.setDate(asOf.getDate() - 1);
          const asOfStr = asOf.toISOString().slice(0, 10);
          const key: HiKey = `${score.profile_id}::${asOfStr}`;
          const hi = resolvedHi.get(key);
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

    const seasons_created: string[] = [];

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
      seasons_created.push(season.season_name);
    }

    // ── 1.5. Create new events ────────────────────────────────────────────────
    // Build event_name → event_id map for all comps (existing + newly created)
    const eventIdByName = new Map<string, string>();
    for (const comp of existingCompRows) eventIdByName.set(comp.event_name, comp.event_id);

    const events_created: string[] = [];

    for (const comp of newCompRows) {
      const resolvedSeasonId = comp.season_name ? (seasonIdByName.get(comp.season_name) ?? null) : null;
      const roundNumbers     = Array.from(roundsPerEventName.get(comp.event_name) ?? new Set([1])).sort((a, b) => a - b);
      const multiRound       = roundNumbers.length > 1;

      // Inherit type/scoring from the template when the row leaves them blank (row overrides template)
      const tmpl = comp.template_id ? templateDefaults.get(comp.template_id) : undefined;
      const rawType    = comp.event_type    || tmpl?.event_type    || "stroke";
      const rawScoring = comp.scoring_model  || tmpl?.scoring_model || "net";

      // Normalise event_type to DB enum value
      const eventTypeNorm = rawType.toLowerCase().replace(/\s+/g, "") === "bestball"
        ? "bestball"
        : rawType.toLowerCase().replace(/\s+/g, "");

      const resolvedAllowance = resolveAllowance(comp);
      const handicapRules = {
        mode:         "allowance_pct",
        allowance_pct: resolvedAllowance,
        max_handicap:  tmpl?.max_handicap ?? null,
      };

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
          competition_event_template_id: comp.template_id || null,
          handicap_rules:   handicapRules,
        })
        .select("id")
        .single();
      if (neErr || !newEvent) throw new Error(`Create event "${comp.event_name}" failed: ${neErr?.message}`);

      // Create event_rounds (one per unique round_number)
      const { error: erErr } = await admin.from("event_rounds").insert(
        roundNumbers.map(n => ({
          event_id:                  newEvent.id,
          round_number:              n,
          name:                      multiRound ? `Round ${n}` : comp.event_name,
          scheduled_date:            comp.event_date,
          course_id:                 comp.course_id || null,
          status:                    "completed",
          default_tee_box_id_male:   comp.tee_box_id || null,
          default_tee_box_id_female: comp.tee_box_id || null,
        }))
      );
      if (erErr) {
        // Surface the newly created event_id so it can be cleaned up if needed
        throw new Error(`Create event_rounds for "${comp.event_name}" (event_id: ${newEvent.id}) failed: ${erErr.message}`);
      }

      eventIdByName.set(comp.event_name, newEvent.id);
      events_created.push(comp.event_name);
    }

    // ── 2. Re-key scores by (resolved_event_id, round_number) ────────────────
    const scoresByRound = new Map<string, typeof scoreRows>();
    for (const s of scoreRows) {
      const resolvedId = eventIdByName.get(s.competition_name) ?? s.competition_id;
      if (!resolvedId) continue;
      const key = `${resolvedId}::${s.round_number}`;
      if (!scoresByRound.has(key)) scoresByRound.set(key, []);
      scoresByRound.get(key)!.push({ ...s, competition_id: resolvedId });
    }

    // Determine distinct round numbers per resolved event_id
    const roundsPerComp = new Map<string, Set<number>>();
    for (const s of scoreRows) {
      const resolvedId = eventIdByName.get(s.competition_name) ?? s.competition_id;
      if (!resolvedId) continue;
      if (!roundsPerComp.has(resolvedId)) roundsPerComp.set(resolvedId, new Set());
      roundsPerComp.get(resolvedId)!.add(s.round_number);
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    const summary = {
      seasons_created,
      events_created,
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
      skipped_already_imported: [] as string[],
      competition_round_ids: [] as Array<{ competition_name: string; event_name: string; competition_id: string; round_id: string }>,
    };

    // Track which events had rounds created this run (for leaderboard recompute)
    const eventsTouched = new Set<string>();

    // ── 3. Create rounds + scores per competition ─────────────────────────────
    for (const comp of compRows) {
      const resolvedEventId = eventIdByName.get(comp.event_name);
      if (!resolvedEventId) {
        throw new Error(`No resolved event_id for "${comp.event_name}" — this should not happen after pre-flight`);
      }

      const roundNumbers      = Array.from(roundsPerComp.get(resolvedEventId) ?? new Set([1])).sort((a, b) => a - b);
      const multiRound        = roundNumbers.length > 1;
      const resolvedAllowance = resolveAllowance(comp);

      // Fetch event data (for course, entry_fee, event_date, name)
      const { data: competition, error: compErr } = await admin
        .from("events")
        .select("id,name,group_id,course_id,event_date,entry_fee_amount,group_season_id,handicap_rules,competition_event_template_id,scoring_model")
        .eq("id", resolvedEventId)
        .single();
      if (compErr || !competition) throw new Error(`Event "${comp.event_name}" not found`);
      if (competition.group_id !== groupId) throw new Error(`Event "${comp.event_name}" does not belong to this group`);

      // Scoring model: sheet override → template default → DB event value → net
      const eventScoringModel = (
        comp.scoring_model || templateDefaults.get(comp.template_id)?.scoring_model || competition.scoring_model || "net"
      ).toLowerCase();

      // Set group_season_id / template / handicap_rules on existing events if not already set (fill nulls only)
      if (!comp.is_new_event) {
        const resolvedSeasonId = comp.season_name ? (seasonIdByName.get(comp.season_name) ?? null) : null;
        const patch: Record<string, unknown> = {};
        if (resolvedSeasonId && competition.group_season_id === null) patch.group_season_id = resolvedSeasonId;
        if (comp.template_id && !competition.competition_event_template_id) patch.competition_event_template_id = comp.template_id;
        const existingRules = (competition.handicap_rules ?? {}) as Record<string, any>;
        if (existingRules.allowance_pct == null) {
          patch.handicap_rules = {
            mode:          "allowance_pct",
            allowance_pct: resolvedAllowance,
            max_handicap:  templateDefaults.get(comp.template_id)?.max_handicap ?? existingRules.max_handicap ?? null,
          };
        }
        if (Object.keys(patch).length) {
          const { error: updErr } = await admin.from("events").update(patch).eq("id", resolvedEventId);
          if (updErr) throw new Error(`Update event "${comp.event_name}" failed: ${updErr.message}`);
        }
      }

      // Map round_number → event_round_id for submissions (event_rounds created with the event)
      const { data: eventRoundsRows, error: erMapErr } = await admin
        .from("event_rounds")
        .select("id,round_number")
        .eq("event_id", resolvedEventId);
      if (erMapErr) throw new Error(`event_rounds lookup failed for "${comp.event_name}": ${erMapErr.message}`);
      const eventRoundIdByNumber = new Map<number, string>(
        (eventRoundsRows ?? []).map((er: any) => [er.round_number as number, er.id as string])
      );

      const courseId = comp.course_id || competition.course_id;
      if (!courseId) throw new Error(`Event "${comp.event_name}" has no course — set a course on the event first`);

      // Fetch course
      const { data: course, error: cErr } = await admin
        .from("courses")
        .select("id,name,city,country,lat,lng")
        .eq("id", courseId)
        .single();
      if (cErr || !course) throw new Error(`Course lookup failed for "${comp.event_name}"`);

      // Fetch tee box + holes
      const { data: teeBox, error: tbErr } = await admin
        .from("course_tee_boxes")
        .select("id,name,gender,yards,par,rating,slope,holes_count")
        .eq("id", comp.tee_box_id)
        .single();
      if (tbErr || !teeBox) throw new Error(`Tee box lookup failed for "${comp.event_name}"`);

      const { data: holes, error: hErr } = await admin
        .from("course_tee_holes")
        .select("hole_number,par,yardage,handicap")
        .eq("tee_box_id", comp.tee_box_id)
        .order("hole_number", { ascending: true });
      if (hErr) throw new Error(`Tee holes lookup failed: ${hErr.message}`);

      const teeHoles: TeeHole[] = (holes ?? []) as TeeHole[];
      if (!teeHoles.length) throw new Error(`Tee box "${teeBox.name}" has no holes configured`);

      const basePlayedAt  = competition.event_date
        ? new Date(competition.event_date).toISOString()
        : new Date().toISOString();
      const baseEventName = comp.event_name;
      const entryFee      = comp.entry_fee_override != null
        ? comp.entry_fee_override
        : (competition.entry_fee_amount ?? null);
      const yardsTotal    = teeHoles.reduce((a, h) => a + (h.yardage ?? 0), 0);
      const parTotal      = teeHoles.reduce((a, h) => a + (h.par    ?? 0), 0);

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

        // ── Create round ──────────────────────────────────────────────────
        const { data: round, error: rErr } = await admin
          .from("rounds")
          .insert({
            created_by:     myProfile.id,
            status:         "live",
            visibility:     "private",
            course_id:      course.id,
            competition_id: competition.id,
            name:           roundName,
            started_at:     basePlayedAt,
            finished_at:    basePlayedAt,
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
        const roundScores   = scoresByRound.get(roundKey) ?? [];
        const uniquePlayers = new Map<string, typeof roundScores[number]>();
        for (const s of roundScores) {
          if (s.profile_id && !uniquePlayers.has(s.profile_id)) uniquePlayers.set(s.profile_id, s);
        }

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
                joined_at:  basePlayedAt,
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
                recorded_by: myProfile.id,
              });
              if (txErr) throw new Error(`Create fee transaction failed: ${txErr.message}`);
              summary.fee_transactions_created++;
            }
            entryCreatedProfiles.add(profileId);
          }
        }

        // ── Score events (use uniquePlayers to avoid duplicates) ──────────
        const scoreEvents: Array<{
          round_id: string; participant_id: string; hole_number: number; strokes: number; entered_by: string;
        }> = [];
        for (const [profileId, playerScore] of uniquePlayers.entries()) {
          const participantId = participantIdByProfileId.get(profileId);
          if (!participantId) continue;
          playerScore.holes.forEach((strokes, idx) => {
            scoreEvents.push({ round_id: round.id, participant_id: participantId, hole_number: idx + 1, strokes, entered_by: myProfile.id });
          });
        }
        if (scoreEvents.length) {
          const { error: seErr } = await admin.from("round_score_events").insert(scoreEvents);
          if (seErr) throw new Error(`Create score events failed for "${roundName}": ${seErr.message}`);
          summary.score_events_created += scoreEvents.length;
        }

        // ── Finish round ──────────────────────────────────────────────────
        // Flipping to 'finished' fires compute_all_results_when_round_finishes
        // (replays HI + computes handicap_round_results).
        const { error: finErr } = await admin.from("rounds").update({ status: "finished" }).eq("id", round.id);
        if (finErr) throw new Error(`Finish round failed: ${finErr.message}`);

        // Persist Playing Handicap (allowance applied) — must run AFTER the finish
        // replay so it reflects the replayed HI. Populates round_participants.playing_handicap_used.
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
          // Playing handicap (allowance applied) preferred; fall back to course handicap.
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
            submitted_at: basePlayedAt,
          };
        });
        if (submissions.length) {
          const { error: subErr } = await admin
            .from("event_round_submissions")
            .upsert(submissions, { onConflict: "event_id,round_id,profile_id" });
          if (subErr) throw new Error(`Create submissions failed for "${roundName}": ${subErr.message}`);
          summary.event_submissions_created += submissions.length;
        }

        eventsTouched.add(resolvedEventId);
        summary.rounds_created++;
        summary.competition_round_ids.push({
          competition_name: comp.event_name,
          event_name:       roundName,
          competition_id:   resolvedEventId,
          round_id:         round.id,
        });
      }
    }

    // ── 4. Recompute event leaderboards for every event we added rounds to ────
    for (const eventId of eventsTouched) {
      const { error: lbErr } = await admin.rpc("ciaga_compute_event_leaderboard", { p_event_id: eventId });
      if (lbErr) throw new Error(`Leaderboard compute failed for event ${eventId}: ${lbErr.message}`);
      summary.leaderboards_computed++;
    }

    // ── 5. Prize pots + payouts ───────────────────────────────────────────────
    await importPrizePots({
      admin, groupId, recordedBy: myProfile.id,
      potRows, payoutRows, compRows, scoreRows, eventIdByName, summary,
    });

    return NextResponse.json({ ok: true, summary });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}

// ── Prize pots + payouts ────────────────────────────────────────────────────────
// Creates event-scoped pots, auto-enrols every player who scored the event (charging
// the buy-in once), and records winners from the Payouts sheet. Idempotent: existing
// pots/entries/payouts are reused/skipped so re-import never double-charges.
async function importPrizePots(args: {
  admin: ReturnType<typeof getSupabaseAdmin>;
  groupId: string;
  recordedBy: string;
  potRows: ParsedPot[];
  payoutRows: ParsedPayout[];
  compRows: ParsedComp[];
  scoreRows: ParsedScore[];
  eventIdByName: Map<string, string>;
  summary: any;
}) {
  const { admin, groupId, recordedBy, potRows, payoutRows, scoreRows, eventIdByName, summary } = args;
  if (!potRows.length) return;

  // Players who scored each event — these are auto-enrolled into the event's pots
  const scoredByEvent = new Map<string, Set<string>>();
  for (const s of scoreRows) {
    if (!s.profile_id) continue;
    if (!scoredByEvent.has(s.competition_name)) scoredByEvent.set(s.competition_name, new Set());
    scoredByEvent.get(s.competition_name)!.add(s.profile_id);
  }

  for (const pot of potRows) {
    const eventId = eventIdByName.get(pot.event_name) ?? (pot.event_id || null);
    if (!eventId) throw new Error(`Prize pot "${pot.pot_name}": event "${pot.event_name}" did not resolve`);

    // Find or create the pot (idempotent by event_id + name)
    const { data: existingPot, error: epErr } = await admin
      .from("prize_pots")
      .select("id,status")
      .eq("event_id", eventId)
      .eq("name", pot.pot_name)
      .maybeSingle();
    if (epErr) throw new Error(`Prize pot lookup failed for "${pot.pot_name}": ${epErr.message}`);

    let potId: string;
    let potStatus: string;
    if (existingPot) {
      potId = (existingPot as any).id;
      potStatus = (existingPot as any).status;
    } else {
      const { data: newPot, error: npErr } = await admin
        .from("prize_pots")
        .insert({
          group_id:          groupId,
          event_id:          eventId,
          name:              pot.pot_name,
          description:       pot.description,
          entry_fee_amount:  pot.entry_fee_amount,
          distribution_type: pot.distribution_type,
          metric_type:       pot.metric_type || null,
          is_monetary:       pot.is_monetary,
          prize_description: pot.prize_description,
          status:            "active",
          created_by:        recordedBy,
        })
        .select("id,status")
        .single();
      if (npErr || !newPot) throw new Error(`Create prize pot "${pot.pot_name}" failed: ${npErr?.message}`);
      potId = (newPot as any).id;
      potStatus = (newPot as any).status;
      summary.prize_pots_created++;
    }

    // Auto-enrol players who scored the event (skip already-enrolled; charge fee once)
    const scored = Array.from(scoredByEvent.get(pot.event_name) ?? new Set<string>());
    if (scored.length) {
      const { data: existingEntries } = await admin
        .from("prize_pot_entries")
        .select("profile_id")
        .eq("prize_pot_id", potId)
        .in("profile_id", scored);
      const enrolled = new Set((existingEntries ?? []).map((e: any) => e.profile_id));
      const toEnrol  = scored.filter(p => !enrolled.has(p));
      const fee      = pot.entry_fee_amount ?? 0;

      const txnByProfile = new Map<string, string>();
      if (fee > 0 && toEnrol.length) {
        const txns = toEnrol.map(pid => ({
          group_id: groupId, profile_id: pid, event_id: eventId,
          type: "entry_fee", amount: fee, note: `Entry fee: ${pot.pot_name}`, recorded_by: recordedBy,
        }));
        const { data: txnRows, error: txnErr } = await admin
          .from("group_balance_transactions").insert(txns).select("id,profile_id");
        if (txnErr) throw new Error(`Pot entry-fee transaction failed for "${pot.pot_name}": ${txnErr.message}`);
        for (const t of txnRows ?? []) txnByProfile.set((t as any).profile_id, (t as any).id);
        summary.pot_entry_fee_transactions += txnRows?.length ?? 0;
      }

      if (toEnrol.length) {
        const entries = toEnrol.map(pid => ({
          prize_pot_id: potId, profile_id: pid,
          amount_contributed: fee, transaction_id: txnByProfile.get(pid) ?? null,
        }));
        const { error: entErr } = await admin.from("prize_pot_entries").insert(entries);
        if (entErr) throw new Error(`Pot enrolment failed for "${pot.pot_name}": ${entErr.message}`);
        summary.pot_entries_created += entries.length;
      }
    }

    // Payouts (winners listed on the Payouts sheet)
    const potPayouts = payoutRows.filter(p => p.event_name === pot.event_name && p.pot_name === pot.pot_name && p.profile_id);
    if (potPayouts.length) {
      const { data: existingPayouts } = await admin
        .from("prize_pot_payouts").select("profile_id,position").eq("prize_pot_id", potId);
      const payoutKey = (pid: string, pos: number | null) => `${pid}::${pos ?? ""}`;
      const existingKeys = new Set((existingPayouts ?? []).map((p: any) => payoutKey(p.profile_id, p.position)));
      const toInsert = potPayouts.filter(p => !existingKeys.has(payoutKey(p.profile_id, p.position)));

      if (toInsert.length) {
        const rows = toInsert.map(p => ({
          prize_pot_id: potId, profile_id: p.profile_id,
          position: p.position, amount: p.amount, note: p.note ?? null, recorded_by: recordedBy,
        }));
        const { data: inserted, error: poErr } = await admin
          .from("prize_pot_payouts").insert(rows).select("id,profile_id,amount");
        if (poErr) throw new Error(`Pot payout insert failed for "${pot.pot_name}": ${poErr.message}`);
        summary.pot_payouts_created += inserted?.length ?? 0;

        const monetary = (inserted ?? []).filter((p: any) => p.amount != null && p.amount > 0);
        if (monetary.length) {
          const txns = monetary.map((p: any) => ({
            group_id: groupId, profile_id: p.profile_id, event_id: eventId,
            type: "winnings", amount: -Math.abs(p.amount), note: `${pot.pot_name} payout`, recorded_by: recordedBy,
          }));
          const { data: txnRows, error: txnErr } = await admin
            .from("group_balance_transactions").insert(txns).select("id,profile_id");
          if (txnErr) throw new Error(`Pot winnings transaction failed for "${pot.pot_name}": ${txnErr.message}`);
          summary.pot_winnings_transactions += txnRows?.length ?? 0;
          const txnByProfile = new Map<string, string>();
          for (const t of txnRows ?? []) txnByProfile.set((t as any).profile_id, (t as any).id);
          for (const p of monetary as any[]) {
            const tid = txnByProfile.get(p.profile_id);
            if (tid) await admin.from("prize_pot_payouts").update({ transaction_id: tid }).eq("id", p.id);
          }
        }
      }

      if (potStatus !== "distributed") {
        await admin.from("prize_pots")
          .update({ status: "distributed", updated_at: new Date().toISOString() })
          .eq("id", potId);
      }
    }
  }
}
