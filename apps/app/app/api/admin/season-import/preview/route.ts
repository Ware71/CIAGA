import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type SeasonPreview = {
  season_name: string;
  year: number | null;
  start_date: string | null;
  end_date: string | null;
  already_exists: boolean;
};

export type CompetitionPreview = {
  competition_id: string;
  competition_name: string;
  event_name: string;
  season_name: string;
  tee_box_id: string;
  entry_fee: number | null;
  player_count: number;
  score_row_count: number;
  already_imported: boolean;
};

export type PreviewResponse = {
  group_id: string;
  seasons: SeasonPreview[];
  competitions: CompetitionPreview[];
  errors: string[];
  totals: {
    seasons_to_create: number;
    competitions: number;
    participants: number;
    score_events: number;
    fee_transactions: number;
  };
};

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

    const errors: string[] = [];

    // Validate season names referenced in Competitions are defined in Seasons sheet
    const definedSeasonNames = new Set(parsed.seasons.map(s => s.season_name));
    for (const comp of parsed.competitions) {
      if (comp.season_name && !definedSeasonNames.has(comp.season_name)) {
        errors.push(`Competition "${comp.competition_name}": Season Name "${comp.season_name}" not found in Seasons sheet`);
      }
      if (!comp.season_name) {
        errors.push(`Competition "${comp.competition_name}": Season Name is blank — every competition must belong to a season`);
      }
    }

    const compIds    = Array.from(new Set(parsed.competitions.map(c => c.competition_id).filter(Boolean)));
    const profileIds = Array.from(new Set(parsed.scores.map(s => s.profile_id).filter(Boolean)));
    const teeBoxIds  = Array.from(new Set(parsed.competitions.map(c => c.tee_box_id).filter(Boolean)));
    const seasonNames = Array.from(definedSeasonNames);

    const [compsRes, profilesRes, teeBoxesRes, existingRoundsRes, existingSeasonsRes] = await Promise.all([
      compIds.length
        ? admin.from("events").select("id,name,group_id,entry_fee_amount").in("id", compIds)
        : Promise.resolve({ data: [], error: null }),
      profileIds.length
        ? admin.from("profiles").select("id").in("id", profileIds)
        : Promise.resolve({ data: [], error: null }),
      teeBoxIds.length
        ? admin.from("course_tee_boxes").select("id").in("id", teeBoxIds)
        : Promise.resolve({ data: [], error: null }),
      compIds.length
        ? admin.from("rounds").select("competition_id").in("competition_id", compIds).not("competition_id", "is", null)
        : Promise.resolve({ data: [], error: null }),
      seasonNames.length
        ? admin.from("group_seasons").select("name").eq("group_id", groupId).in("name", seasonNames)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (compsRes.error)          throw new Error(compsRes.error.message);
    if (profilesRes.error)       throw new Error(profilesRes.error.message);
    if (teeBoxesRes.error)       throw new Error(teeBoxesRes.error.message);
    if (existingRoundsRes.error) throw new Error(existingRoundsRes.error.message);
    if (existingSeasonsRes.error) throw new Error(existingSeasonsRes.error.message);

    const validCompMap = new Map<string, { name: string; group_id: string | null; entry_fee_amount: number | null }>();
    for (const c of compsRes.data ?? []) validCompMap.set(c.id, c);

    const validProfileIds        = new Set((profilesRes.data        ?? []).map(p => p.id));
    const validTeeBoxIds         = new Set((teeBoxesRes.data        ?? []).map(t => t.id));
    const alreadyImportedCompIds = new Set((existingRoundsRes.data  ?? []).map(r => r.competition_id as string));
    const existingSeasonNames    = new Set((existingSeasonsRes.data ?? []).map(s => s.name));

    // Validate competitions
    for (const comp of parsed.competitions) {
      if (!comp.competition_id) {
        errors.push(`Competitions sheet "${comp.competition_name}": competition_id is blank — check Competition Name matches the lookup`);
        continue;
      }
      const dbComp = validCompMap.get(comp.competition_id);
      if (!dbComp) {
        errors.push(`Competition "${comp.competition_name}" (${comp.competition_id}): not found in database`);
        continue;
      }
      if (dbComp.group_id !== groupId) {
        errors.push(`Competition "${comp.competition_name}": does not belong to the selected group`);
      }
      if (!comp.tee_box_id) {
        errors.push(`Competition "${comp.competition_name}": tee_box_id is blank — check Tee Name matches a tee for this course`);
      } else if (!validTeeBoxIds.has(comp.tee_box_id)) {
        errors.push(`Competition "${comp.competition_name}": tee_box_id "${comp.tee_box_id}" not found`);
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
      if (!s.competition_id) continue;
      if (!scoresByComp.has(s.competition_id)) scoresByComp.set(s.competition_id, []);
      scoresByComp.get(s.competition_id)!.push(s);
    }

    const competitionPreviews: CompetitionPreview[] = parsed.competitions.map(comp => {
      const compScores    = scoresByComp.get(comp.competition_id) ?? [];
      const uniquePlayers = new Set(compScores.map(s => s.profile_id).filter(Boolean));
      const dbComp        = validCompMap.get(comp.competition_id);
      const entryFee      = comp.entry_fee_override != null ? comp.entry_fee_override : (dbComp?.entry_fee_amount ?? null);
      return {
        competition_id:  comp.competition_id,
        competition_name: comp.competition_name,
        event_name:      comp.event_name || comp.competition_name,
        season_name:     comp.season_name,
        tee_box_id:      comp.tee_box_id,
        entry_fee:       entryFee,
        player_count:    uniquePlayers.size,
        score_row_count: compScores.length,
        already_imported: alreadyImportedCompIds.has(comp.competition_id),
      };
    });

    const playersWithFee = competitionPreviews.reduce((acc, c) =>
      acc + (c.entry_fee != null ? c.player_count : 0), 0);

    const response: PreviewResponse = {
      group_id: groupId,
      seasons: seasonPreviews,
      competitions: competitionPreviews,
      errors,
      totals: {
        seasons_to_create:  seasonPreviews.filter(s => !s.already_exists).length,
        competitions:       parsed.competitions.length,
        participants:       competitionPreviews.reduce((a, c) => a + c.player_count, 0),
        score_events:       competitionPreviews.reduce((a, c) => a + c.score_row_count * 18, 0),
        fee_transactions:   playersWithFee,
      },
    };

    return NextResponse.json({ ok: true, preview: response });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}

// ── XLSX parsing ──────────────────────────────────────────────────────────────
// Competitions sheet column indices (1-based):
//   1=competition_name, 2=event_name, 3=course_name, 4=tee_name, 5=season_name
//   6=entry_fee_override, 7=notes, 8=competition_id, 9=course_id, 10=tee_box_id, 11=season_id, 12=default_entry_fee
//
// Seasons sheet column indices (1-based):
//   1=season_name, 2=year, 3=start_date_override, 4=end_date_override, 5=season_id
//
// Scores sheet column indices (1-based):
//   1=competition_name, 2=player_label, 3=handicap, 4-21=holes 1-18, 22=competition_id, 23=profile_id

type ParsedSeason = {
  season_name: string;
  year: number | null;
  start_date_override: string | null;
  end_date_override: string | null;
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

async function parseXlsx(file: File): Promise<{
  parsed: { seasons: ParsedSeason[]; competitions: ParsedComp[]; scores: ParsedScore[] };
  errors: string[];
}> {
  const errors: string[] = [];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());

  const seasonSheet = wb.getWorksheet("Seasons");
  if (!seasonSheet) errors.push("Workbook is missing the 'Seasons' sheet");

  const compSheet = wb.getWorksheet("Competitions");
  if (!compSheet) errors.push("Workbook is missing the 'Competitions' sheet");

  const scoresSheet = wb.getWorksheet("Scores");
  if (!scoresSheet) errors.push("Workbook is missing the 'Scores' sheet");

  if (errors.length) return { parsed: { seasons: [], competitions: [], scores: [] }, errors };

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
  scoresSheet!.eachRow((row, rowNumber) => {
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

  return { parsed: { seasons, competitions, scores }, errors };
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
