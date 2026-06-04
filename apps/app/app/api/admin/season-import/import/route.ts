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
// Competitions sheet columns (v2, 1-based):
//   1=event_name(A), 2=event_date(B), 3=event_type(C), 4=scoring_model(D)
//   5=season_name(E), 6=course_name(F), 7=tee_name(G), 8=entry_fee_override(H), 9=notes(I)
//   10=event_id(J), 11=is_new(K), 12=course_id(L), 13=tee_box_id(M), 14=tee_found(N)
//   15=season_id(O), 16=default_entry_fee(P)
//
// Seasons sheet columns (1-based):
//   1=season_name, 2=year, 3=start_date_override, 4=end_date_override, 5=season_id
//
// Scores sheet columns (1-based):
//   1=event_name, 2=player_label, 3=handicap, 4=round_number, 5-22=holes 1-18, 23=event_id, 24=profile_id

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
  season_name: string;
  entry_fee_override: number | null;
  event_id: string;
  is_new_event: boolean;
  course_id: string;
  tee_box_id: string;
};

type ParsedScore = {
  competition_name: string; // = event_name from col A
  competition_id: string;   // resolved event_id from col W (blank for new events at parse time)
  player_label: string;
  profile_id: string;
  handicap: number | null;
  round_number: number;
  holes: number[];
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
    const eventId = cellString(row.getCell(10)); // J
    competitions.push({
      event_name:         eventName,
      event_date:         cellString(row.getCell(2)) || null,  // B
      event_type:         cellString(row.getCell(3)) || null,  // C
      scoring_model:      cellString(row.getCell(4)) || null,  // D
      season_name:        cellString(row.getCell(5)),          // E
      entry_fee_override: cellNumber(row.getCell(8)),          // H
      event_id:           eventId,
      is_new_event:       eventId === "",
      course_id:          cellString(row.getCell(12)),         // L
      tee_box_id:         cellString(row.getCell(13)),         // M
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
      competition_id:   cellString(row.getCell(23)), // W
      player_label:     playerLabel,
      profile_id:       cellString(row.getCell(24)), // X
      handicap:         cellNumber(row.getCell(3)),
      round_number:     cellNumber(row.getCell(4)) ?? 1,
      holes,
    });
  });

  return { seasons, competitions, scores };
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

    const { seasons: seasonRows, competitions: compRows, scores: scoreRows } = await parseXlsx(file);

    // ── 0. Pre-flight validation ──────────────────────────────────────────────
    const existingCompRows = compRows.filter(c => !c.is_new_event);
    const newCompRows      = compRows.filter(c => c.is_new_event);

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

      // Normalise event_type to DB enum value
      const eventTypeNorm = (comp.event_type ?? "stroke")
        .toLowerCase().replace(/\s+/g, "") === "bestball" ? "bestball"
        : (comp.event_type ?? "stroke").toLowerCase().replace(/\s+/g, "");

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
          scoring_model:    (comp.scoring_model ?? "net").toLowerCase(),
          num_rounds:       roundNumbers.length,
          course_id:        comp.course_id || null,
          entry_fee_amount: comp.entry_fee_override,
          majors_status:    "completed",
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
      skipped_already_imported: [] as string[],
      competition_round_ids: [] as Array<{ competition_name: string; event_name: string; competition_id: string; round_id: string }>,
    };

    // ── 3. Create rounds + scores per competition ─────────────────────────────
    for (const comp of compRows) {
      const resolvedEventId = eventIdByName.get(comp.event_name);
      if (!resolvedEventId) {
        throw new Error(`No resolved event_id for "${comp.event_name}" — this should not happen after pre-flight`);
      }

      const roundNumbers = Array.from(roundsPerComp.get(resolvedEventId) ?? new Set([1])).sort((a, b) => a - b);
      const multiRound   = roundNumbers.length > 1;

      // Fetch event data (for course, entry_fee, event_date, name)
      const { data: competition, error: compErr } = await admin
        .from("events")
        .select("id,name,group_id,course_id,event_date,entry_fee_amount,group_season_id")
        .eq("id", resolvedEventId)
        .single();
      if (compErr || !competition) throw new Error(`Event "${comp.event_name}" not found`);
      if (competition.group_id !== groupId) throw new Error(`Event "${comp.event_name}" does not belong to this group`);

      // Set group_season_id on existing events if not already set
      if (!comp.is_new_event) {
        const resolvedSeasonId = comp.season_name ? (seasonIdByName.get(comp.season_name) ?? null) : null;
        if (resolvedSeasonId && competition.group_season_id === null) {
          const { error: gsiErr } = await admin
            .from("events")
            .update({ group_season_id: resolvedSeasonId })
            .eq("id", resolvedEventId);
          if (gsiErr) throw new Error(`Set group_season_id failed for "${comp.event_name}": ${gsiErr.message}`);
        }
      }

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
        const { error: finErr } = await admin.from("rounds").update({ status: "finished" }).eq("id", round.id);
        if (finErr) throw new Error(`Finish round failed: ${finErr.message}`);

        summary.rounds_created++;
        summary.competition_round_ids.push({
          competition_name: comp.event_name,
          event_name:       roundName,
          competition_id:   resolvedEventId,
          round_id:         round.id,
        });
      }
    }

    return NextResponse.json({ ok: true, summary });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
