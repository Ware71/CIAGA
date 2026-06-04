import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

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
// Competitions sheet columns (1-indexed):
//   1=competition_name, 2=event_name, 3=course_name, 4=tee_name, 5=season_name
//   6=entry_fee_override, 7=notes, 8=competition_id(H), 9=course_id(I), 10=tee_box_id(J), 11=season_id(K), 12=default_entry_fee(L)
//
// Seasons sheet columns (1-indexed):
//   1=season_name, 2=year, 3=start_date_override, 4=end_date_override, 5=season_id
//
// Scores sheet columns (1-indexed):
//   1=competition_name, 2=player_label, 3=handicap, 4-21=holes 1-18, 22=competition_id(V), 23=profile_id(W)

type ParsedSeason = {
  season_name: string;
  year: number | null;
  start_date: string;
  end_date: string;
  type: "calendar_year" | "custom";
};

type ParsedComp = {
  competition_name: string;
  event_name: string;
  competition_id: string;
  tee_box_id: string;
  season_name: string;
  entry_fee_override: number | null;
};

type ParsedScore = {
  competition_name: string;
  competition_id: string;
  player_label: string;
  profile_id: string;
  handicap: number | null;
  holes: number[];
};

async function parseXlsx(file: File) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());

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
    const compName = cellString(row.getCell(1));
    if (!compName) return;
    competitions.push({
      competition_name:   compName,
      event_name:         cellString(row.getCell(2)),
      competition_id:     cellString(row.getCell(8)),  // H
      tee_box_id:         cellString(row.getCell(10)), // J
      season_name:        cellString(row.getCell(5)),  // E
      entry_fee_override: cellNumber(row.getCell(6)),  // F
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
    for (let h = 0; h < 18; h++) holes.push(cellNumber(row.getCell(4 + h)) ?? 0);
    scores.push({
      competition_name: compName,
      competition_id:   cellString(row.getCell(22)),
      player_label:     playerLabel,
      profile_id:       cellString(row.getCell(23)),
      handicap:         cellNumber(row.getCell(3)),
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

    // ── 1. Upsert group_seasons ───────────────────────────────────────────────
    // Build a name → season_id map (existing + newly created)
    const seasonIdByName = new Map<string, string>();

    const existingSeasonNames = Array.from(new Set(seasonRows.map(s => s.season_name)));
    if (existingSeasonNames.length) {
      const { data: existingSeasons, error: esErr } = await admin
        .from("group_seasons")
        .select("id,name")
        .eq("group_id", groupId)
        .in("name", existingSeasonNames);
      if (esErr) throw new Error(`Season lookup failed: ${esErr.message}`);
      for (const s of existingSeasons ?? []) seasonIdByName.set(s.name, s.id);
    }

    const seasons_created: string[] = [];

    for (const season of seasonRows) {
      if (seasonIdByName.has(season.season_name)) continue; // already exists

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

    // ── 2. Group scores by competition_id ─────────────────────────────────────
    const scoresByComp = new Map<string, typeof scoreRows>();
    for (const s of scoreRows) {
      if (!s.competition_id) continue;
      if (!scoresByComp.has(s.competition_id)) scoresByComp.set(s.competition_id, []);
      scoresByComp.get(s.competition_id)!.push(s);
    }

    const summary = {
      seasons_created,
      rounds_created: 0,
      participants_created: 0,
      members_enrolled: 0,
      score_events_created: 0,
      competition_entries_created: 0,
      fee_transactions_created: 0,
      skipped_already_imported: [] as string[],
      competition_round_ids: [] as Array<{ competition_name: string; event_name: string; competition_id: string; round_id: string }>,
    };

    for (const comp of compRows) {
      if (!comp.competition_id || !comp.tee_box_id) {
        throw new Error(`Competition "${comp.competition_name}": missing competition_id or tee_box_id — run Preview first`);
      }

      // Idempotency check
      const { data: existingRound } = await admin
        .from("rounds")
        .select("id")
        .eq("competition_id", comp.competition_id)
        .maybeSingle();

      if (existingRound) {
        summary.skipped_already_imported.push(comp.competition_name);
        continue;
      }

      // Fetch competition
      const { data: competition, error: compErr } = await admin
        .from("events")
        .select("id,name,group_id,course_id,event_date,entry_fee_amount")
        .eq("id", comp.competition_id)
        .single();
      if (compErr || !competition) throw new Error(`Event "${comp.competition_name}" not found`);
      if (competition.group_id !== groupId) throw new Error(`Event "${comp.competition_name}" does not belong to this group`);
      if (!competition.course_id) throw new Error(`Event "${comp.competition_name}" has no course_id — set a course on the event first`);

      // Fetch course
      const { data: course, error: cErr } = await admin
        .from("courses")
        .select("id,name,city,country,lat,lng")
        .eq("id", competition.course_id)
        .single();
      if (cErr || !course) throw new Error(`Course lookup failed for "${comp.competition_name}"`);

      // Fetch tee box + holes
      const { data: teeBox, error: tbErr } = await admin
        .from("course_tee_boxes")
        .select("id,name,gender,yards,par,rating,slope,holes_count")
        .eq("id", comp.tee_box_id)
        .single();
      if (tbErr || !teeBox) throw new Error(`Tee box lookup failed for "${comp.competition_name}"`);

      const { data: holes, error: hErr } = await admin
        .from("course_tee_holes")
        .select("hole_number,par,yardage,handicap")
        .eq("tee_box_id", comp.tee_box_id)
        .order("hole_number", { ascending: true });
      if (hErr) throw new Error(`Tee holes lookup failed: ${hErr.message}`);

      const teeHoles: TeeHole[] = (holes ?? []) as TeeHole[];
      if (!teeHoles.length) throw new Error(`Tee box "${teeBox.name}" has no holes configured`);

      const playedAtIso  = competition.event_date
        ? new Date(competition.event_date).toISOString()
        : new Date().toISOString();

      const roundName = comp.event_name || competition.name;

      // ── Create round ──────────────────────────────────────────────────────
      const { data: round, error: rErr } = await admin
        .from("rounds")
        .insert({
          created_by:   myProfile.id,
          status:       "live",
          visibility:   "private",
          course_id:    course.id,
          competition_id: competition.id,
          name:         roundName,
          started_at:   playedAtIso,
          finished_at:  playedAtIso,
        })
        .select("id")
        .single();
      if (rErr || !round) throw new Error(`Create round failed for "${comp.competition_name}": ${rErr?.message}`);

      // ── Course snapshot ───────────────────────────────────────────────────
      const { data: courseSnap, error: csErr } = await admin
        .from("round_course_snapshots")
        .insert({
          round_id:        round.id,
          source_course_id: course.id,
          course_name:     course.name,
          city:            course.city,
          country:         course.country,
          lat:             course.lat,
          lng:             course.lng,
        })
        .select("id")
        .single();
      if (csErr || !courseSnap) throw new Error(`Create course snapshot failed: ${csErr?.message}`);

      // ── Tee snapshot + hole snapshots ─────────────────────────────────────
      const yardsTotal = teeHoles.reduce((a, h) => a + (h.yardage ?? 0), 0);
      const parTotal   = teeHoles.reduce((a, h) => a + (h.par    ?? 0), 0);

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
          hole_number:   h.hole_number,
          par:           h.par,
          yardage:       h.yardage,
          stroke_index:  h.handicap,
        }))
      );
      if (hsErr) throw new Error(`Create hole snapshots failed: ${hsErr.message}`);

      // ── Per-player: enrol, participant, entry, fee ────────────────────────
      const compScores    = scoresByComp.get(comp.competition_id) ?? [];
      const uniquePlayers = new Map<string, typeof compScores[number]>();
      for (const s of compScores) {
        if (s.profile_id && !uniquePlayers.has(s.profile_id)) uniquePlayers.set(s.profile_id, s);
      }

      const entryFee = comp.entry_fee_override != null
        ? comp.entry_fee_override
        : (competition.entry_fee_amount ?? null);

      const participantIdByProfileId = new Map<string, string>();

      for (const [profileId, playerScore] of uniquePlayers.entries()) {
        // Auto-enrol if not already a member
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
            joined_at:  playedAtIso,
          });
          if (enrollErr) throw new Error(`Enrol member ${profileId} failed: ${enrollErr.message}`);
          summary.members_enrolled++;
        }

        // Round participant
        const { data: part, error: rpErr } = await admin
          .from("round_participants")
          .insert({
            round_id:       round.id,
            profile_id:     profileId,
            is_guest:       false,
            role:           "player",
            handicap_index: playerScore.handicap,
            tee_snapshot_id: teeSnap.id,
          })
          .select("id")
          .single();
        if (rpErr || !part) throw new Error(`Create participant failed for ${profileId}: ${rpErr?.message}`);

        participantIdByProfileId.set(profileId, part.id);
        summary.participants_created++;

        // Competition entry
        const { error: ceErr } = await admin.from("event_entries").upsert({
          event_id:               comp.competition_id,
          profile_id:             profileId,
          assigned_handicap_index: playerScore.handicap,
          source:                 "manual",
          locked:                 true,
        }, { onConflict: "event_id,profile_id" });
        if (ceErr) throw new Error(`Create competition entry failed: ${ceErr.message}`);
        summary.competition_entries_created++;

        // Entry fee transaction
        if (entryFee != null && entryFee > 0) {
          const { error: txErr } = await admin.from("group_balance_transactions").insert({
            group_id:   groupId,
            profile_id: profileId,
            event_id:   comp.competition_id,
            type:       "entry_fee",
            amount:         entryFee,
            note:           `Entry fee for ${roundName}`,
            recorded_by:    myProfile.id,
          });
          if (txErr) throw new Error(`Create fee transaction failed: ${txErr.message}`);
          summary.fee_transactions_created++;
        }
      }

      // ── Score events ──────────────────────────────────────────────────────
      const scoreEvents: Array<{
        round_id: string;
        participant_id: string;
        hole_number: number;
        strokes: number;
        entered_by: string;
      }> = [];

      for (const s of compScores) {
        if (!s.profile_id) continue;
        const participantId = participantIdByProfileId.get(s.profile_id);
        if (!participantId) continue;
        s.holes.forEach((strokes, idx) => {
          scoreEvents.push({
            round_id:       round.id,
            participant_id: participantId,
            hole_number:    idx + 1,
            strokes,
            entered_by:     myProfile.id,
          });
        });
      }

      if (scoreEvents.length) {
        const { error: seErr } = await admin.from("round_score_events").insert(scoreEvents);
        if (seErr) throw new Error(`Create score events failed for "${comp.competition_name}": ${seErr.message}`);
        summary.score_events_created += scoreEvents.length;
      }

      // ── Finish round (fires handicap triggers) ────────────────────────────
      const { error: finErr } = await admin
        .from("rounds")
        .update({ status: "finished" })
        .eq("id", round.id);
      if (finErr) throw new Error(`Finish round failed: ${finErr.message}`);

      summary.rounds_created++;
      summary.competition_round_ids.push({
        competition_name: comp.competition_name,
        event_name:       roundName,
        competition_id:   comp.competition_id,
        round_id:         round.id,
      });
    }

    return NextResponse.json({ ok: true, summary });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
