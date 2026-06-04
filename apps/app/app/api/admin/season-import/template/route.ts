import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type Fill = ExcelJS.Fill;

const GREEN_FILL: Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF92D050" } };
const AMBER_FILL: Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC000" } };
const RED_FILL:   Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF6B6B" } };
const LIGHT_RED:  Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFDDDD" } };

const DATA_ROWS        = 300;
const COMP_DATA_ROWS   = 100;
const SEASON_DATA_ROWS = 50;

export async function GET(req: Request) {
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

    const url = new URL(req.url);
    const groupId = url.searchParams.get("group_id");
    if (!groupId) return NextResponse.json({ error: "group_id is required" }, { status: 400 });

    const { data: group, error: gErr } = await admin
      .from("major_groups")
      .select("id,name")
      .eq("id", groupId)
      .single();
    if (gErr || !group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

    const [eventsRes, allProfilesRes, teeBoxesRes, coursesRes, seasonsRes, membershipsRes] = await Promise.all([
      admin
        .from("events")
        .select("id,name,event_date,entry_fee_amount,course_id")
        .eq("group_id", groupId)
        .order("event_date", { ascending: false })
        .limit(500),
      admin.from("profiles").select("id,name,email").order("name").limit(2000),
      admin.from("course_tee_boxes").select("id,name,course_id").order("sort_order"),
      admin.from("courses").select("id,name,city,country").order("name").limit(2000),
      admin
        .from("group_seasons")
        .select("id,name,season_year,start_date,end_date")
        .eq("group_id", groupId)
        .order("season_year", { ascending: false }),
      admin
        .from("major_group_memberships")
        .select("profile_id")
        .eq("group_id", groupId)
        .eq("status", "active"),
    ]);

    if (eventsRes.error)      throw new Error(eventsRes.error.message);
    if (allProfilesRes.error) throw new Error(allProfilesRes.error.message);
    if (teeBoxesRes.error)    throw new Error(teeBoxesRes.error.message);
    if (coursesRes.error)     throw new Error(coursesRes.error.message);
    if (seasonsRes.error)     throw new Error(seasonsRes.error.message);
    if (membershipsRes.error) throw new Error(membershipsRes.error.message);

    type EventRow   = { id: string; name: string; event_date: string | null; entry_fee_amount: number | null; course_id: string | null };
    type ProfileRow = { id: string; name: string | null; email: string | null };
    type SeasonRow  = { id: string; name: string; season_year: number | null; start_date: string | null; end_date: string | null };

    const events      = (eventsRes.data     ?? []) as EventRow[];
    const allProfiles = (allProfilesRes.data ?? []) as ProfileRow[];
    const teeBoxes    = teeBoxesRes.data    ?? [];
    const courses     = coursesRes.data     ?? [];
    const seasons     = (seasonsRes.data    ?? []) as SeasonRow[];

    // Group members first in the player dropdown so they're easy to find
    const memberIdSet = new Set((membershipsRes.data ?? []).map((m: { profile_id: string }) => m.profile_id));
    const orderedProfiles: ProfileRow[] = [
      ...allProfiles.filter(p => memberIdSet.has(p.id)),
      ...allProfiles.filter(p => !memberIdSet.has(p.id)),
    ];

    const wb = new ExcelJS.Workbook();
    wb.creator = "CIAGA Admin";
    wb.created = new Date();

    buildGuideSheet(wb, group.name);
    buildSeasonsSheet(wb);
    buildCompetitionsSheet(wb, events.length, courses.length);
    buildScoresSheet(wb, orderedProfiles.length);
    buildLookupSheets(wb, events, orderedProfiles, teeBoxes, courses, seasons);

    const buf = await wb.xlsx.writeBuffer();
    const safeName = group.name.replace(/[^a-z0-9]/gi, "-").toLowerCase();

    return new Response(new Uint8Array(buf as ArrayBuffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="season-import-${safeName}.xlsx"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function addSection(ws: ExcelJS.Worksheet, r: number, title: string, width: number): number {
  ws.mergeCells(`A${r}:${colLetter(width)}${r}`);
  const cell = ws.getCell(r, 1);
  cell.value = title;
  cell.font  = { bold: true, size: 12, color: { argb: "FF1F497D" } };
  return r + 1;
}

function addText(ws: ExcelJS.Worksheet, r: number, text: string, width: number): number {
  ws.mergeCells(`A${r}:${colLetter(width)}${r}`);
  const cell = ws.getCell(r, 1);
  cell.value     = text;
  cell.alignment = { indent: 1, wrapText: true };
  return r + 1;
}

function addBlank(ws: ExcelJS.Worksheet, r: number): number {
  ws.getRow(r);
  return r + 1;
}

// Apply a list data-validation dropdown to a column range
function applyListValidation(
  ws: ExcelJS.Worksheet,
  col: number,
  startRow: number,
  endRow: number,
  rangeFormula: string,
) {
  for (let row = startRow; row <= endRow; row++) {
    ws.getCell(row, col).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [rangeFormula],
      showErrorMessage: false,
    };
  }
}

// ── Guide sheet ───────────────────────────────────────────────────────────────

function buildGuideSheet(wb: ExcelJS.Workbook, groupName: string) {
  const ws = wb.addWorksheet("Guide");
  ws.properties.tabColor = { argb: "FF0070C0" };
  ws.getColumn(1).width = 28;
  ws.getColumn(2).width = 70;
  ws.getColumn(3).width = 20;

  let r = 1;
  ws.mergeCells("A1:C1");
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `Season Import Template — ${groupName}`;
  titleCell.font  = { bold: true, size: 14, color: { argb: "FF1F497D" } };
  ws.getRow(1).height = 24;
  r++;

  r = addBlank(ws, r);
  r = addSection(ws, r, "Overview", 3);
  r = addText(ws, r, "Fill three sheets: Seasons (one row per season), Competitions (one row per event), and Scores (one row per player per competition).", 3);
  r = addText(ws, r, "GREEN columns have dropdown lists — click a cell and use the arrow to select. Players do not need to be existing group members.", 3);

  r = addBlank(ws, r);
  r = addSection(ws, r, "Colour Legend", 3);
  const legend: [Fill, string, string][] = [
    [GREEN_FILL, "GREEN", "You must fill these in — most have dropdown lists"],
    [AMBER_FILL, "AMBER", "Optional — leave blank to use the default value"],
    [RED_FILL,   "RED",   "Auto-filled by formula — do NOT type in these cells"],
  ];
  for (const [fill, label, desc] of legend) {
    const c1 = ws.getCell(r, 1);
    c1.value = label; c1.fill = fill; c1.font = { bold: true };
    ws.mergeCells(`B${r}:C${r}`);
    ws.getCell(r, 2).value = desc;
    r++;
  }

  r = addBlank(ws, r);
  r = addSection(ws, r, "Seasons sheet — columns", 3);
  const seasonCols: [string, string, string][] = [
    ["Season Name",  "Free text, e.g. '2023 Season'. Competitions reference this.", "Green"],
    ["Year",         "Integer year e.g. 2023. Sets Jan 1 → Dec 31 unless overridden.", "Green"],
    ["Start Date",   "Override start date YYYY-MM-DD. Leave blank to derive from Year.", "Amber"],
    ["End Date",     "Override end date YYYY-MM-DD. Leave blank to derive from Year.", "Amber"],
    ["season_id",    "Auto-resolved for existing seasons — do not edit.", "Red"],
  ];
  ws.getRow(r).values = ["Column", "Description", "Colour"]; ws.getRow(r).font = { bold: true }; r++;
  for (const [col, desc, colour] of seasonCols) { ws.getRow(r).values = [col, desc, colour]; r++; }

  r = addBlank(ws, r);
  r = addSection(ws, r, "Competitions sheet — columns", 3);
  const compCols: [string, string, string][] = [
    ["Competition Name",   "Dropdown — pick from events in this group", "Green"],
    ["Event Name",         "Free text name for this specific instance, e.g. 'Club Championship 2023'. Used as the round name.", "Green"],
    ["Course Name",        "Dropdown — pick a course. Drives tee_box_id lookup.", "Green"],
    ["Tee Name",           "Type the tee name, e.g. White. Must match a tee on the chosen course.", "Green"],
    ["Season Name",        "Dropdown — pick from Seasons sheet. Links event to its season.", "Green"],
    ["Entry Fee Override", "Leave blank to use the default fee. Enter a number to override.", "Amber"],
    ["Notes",              "Free text — ignored on import", "Amber"],
    ["competition_id",     "Auto-resolved — do not edit", "Red"],
    ["course_id",          "Auto-resolved — do not edit", "Red"],
    ["tee_box_id",         "Auto-resolved — do not edit", "Red"],
    ["season_id",          "Auto-resolved — do not edit", "Red"],
    ["default_entry_fee",  "Auto-resolved — do not edit", "Red"],
  ];
  ws.getRow(r).values = ["Column", "Description", "Colour"]; ws.getRow(r).font = { bold: true }; r++;
  for (const [col, desc, colour] of compCols) { ws.getRow(r).values = [col, desc, colour]; r++; }

  r = addBlank(ws, r);
  r = addSection(ws, r, "Scores sheet — columns", 3);
  const scoreCols: [string, string, string][] = [
    ["Competition Name",    "Dropdown — picks from Competitions sheet. New competitions added there appear here automatically.", "Green"],
    ["Player Email or Name", "Dropdown — any registered profile", "Green"],
    ["Handicap Used",       "The handicap index the player used for this competition", "Green"],
    ["Round",               "Round number within the competition (1, 2, 3…). Leave blank or 1 for single-round events.", "Green"],
    ["Hole 1 … Hole 18",    "Strokes on each hole (integer 0–30)", "Green"],
    ["competition_id",      "Auto-resolved via Competitions sheet — do not edit", "Red"],
    ["profile_id",          "Auto-resolved — do not edit", "Red"],
  ];
  ws.getRow(r).values = ["Column", "Description", "Colour"]; ws.getRow(r).font = { bold: true }; r++;
  for (const [col, desc, colour] of scoreCols) { ws.getRow(r).values = [col, desc, colour]; r++; }

  r = addBlank(ws, r);
  r = addSection(ws, r, "Workflow", 3);
  const steps = [
    "1. Fill Seasons sheet — one row per season.",
    "2. Fill Competitions sheet — one row per event. Use the dropdown lists.",
    "3. Fill Scores sheet — one row per player per round. Competition Name dropdown only shows events from the Competitions sheet.",
    "4. Check RED formula columns are populated — blank = lookup failed.",
    "5. Upload this .xlsx on the admin Season Import page, click Preview, then Confirm Import.",
  ];
  for (const s of steps) { r = addText(ws, r, s, 3); }

  r = addBlank(ws, r);
  r = addSection(ws, r, "Notes", 3);
  r = addText(ws, r, "Requires Excel 365 or Excel 2019+ for XLOOKUP and data validation with cross-sheet references.", 3);
  r = addText(ws, r, "Multiple rounds: add multiple Scores rows for the same competition with different Round numbers. Each unique round creates a separate record.", 3);
  r = addText(ws, r, "Re-importing is safe: seasons are upserted by name, competitions already linked to a round are skipped.", 3);
}

// ── Seasons sheet ─────────────────────────────────────────────────────────────

const SEASON_COLS = [
  { header: "Season Name", width: 28, fill: GREEN_FILL }, // A
  { header: "Year",        width: 10, fill: GREEN_FILL }, // B
  { header: "Start Date",  width: 14, fill: AMBER_FILL }, // C
  { header: "End Date",    width: 14, fill: AMBER_FILL }, // D
  { header: "season_id",   width: 38, fill: RED_FILL   }, // E
] as const;

function buildSeasonsSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet("Seasons");
  ws.properties.tabColor = { argb: "FF7030A0" };

  SEASON_COLS.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

  type CellVal = string | number | null | { formula: string };
  const rows: CellVal[][] = [];

  for (let i = 0; i < SEASON_DATA_ROWS; i++) {
    const r = i + 2;
    rows.push([
      null,
      null,
      null,
      null,
      { formula: `IFERROR(XLOOKUP(A${r},_Seasons!$B:$B,_Seasons!$A:$A),"")` },
    ]);
  }

  ws.addTable({
    name: "SeasonsImport",
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium7", showRowStripes: true } as any,
    columns: SEASON_COLS.map(col => ({ name: col.header, filterButton: true })),
    rows: rows as any,
  });

  const headerRow = ws.getRow(1);
  SEASON_COLS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.fill = col.fill; cell.font = { bold: true }; cell.alignment = { horizontal: "center" };
  });

  for (let row = 2; row <= SEASON_DATA_ROWS + 1; row++) {
    ws.getCell(row, 5).fill = LIGHT_RED;
  }

  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// ── Competitions sheet ────────────────────────────────────────────────────────
// A  Competition Name   GREEN  dropdown: _Competitions!$B$2:$B$N
// B  Event Name         GREEN  free text
// C  Course Name        GREEN  dropdown: _Courses!$B$2:$B$N
// D  Tee Name           GREEN  free text (course-dependent, too complex for cascading dropdown)
// E  Season Name        GREEN  dropdown: Seasons!$A$2:$A$[SEASON_DATA_ROWS+1]
// F  Entry Fee Override AMBER
// G  Notes              AMBER
// H  competition_id     RED  ← XLOOKUP(A, _Competitions!$B, $A)
// I  course_id          RED  ← XLOOKUP(C, _Courses!$B, $A)
// J  tee_box_id         RED  ← XLOOKUP(I&"|"&D, _TeeBoxes!$D, $A)
// K  season_id          RED  ← XLOOKUP(E, _Seasons!$B, $A)
// L  default_entry_fee  RED  ← XLOOKUP(H, _Competitions!$A, $D)

const COMP_COLS = [
  { header: "Competition Name",   width: 30, fill: GREEN_FILL }, // A
  { header: "Event Name",         width: 30, fill: GREEN_FILL }, // B
  { header: "Course Name",        width: 28, fill: GREEN_FILL }, // C
  { header: "Tee Name",           width: 14, fill: GREEN_FILL }, // D
  { header: "Season Name",        width: 20, fill: GREEN_FILL }, // E
  { header: "Entry Fee Override", width: 20, fill: AMBER_FILL }, // F
  { header: "Notes",              width: 30, fill: AMBER_FILL }, // G
  { header: "competition_id",     width: 38, fill: RED_FILL   }, // H
  { header: "course_id",          width: 38, fill: RED_FILL   }, // I
  { header: "tee_box_id",         width: 38, fill: RED_FILL   }, // J
  { header: "season_id",          width: 38, fill: RED_FILL   }, // K
  { header: "default_entry_fee",  width: 18, fill: RED_FILL   }, // L
] as const;

function buildCompetitionsSheet(wb: ExcelJS.Workbook, eventCount: number, courseCount: number) {
  const ws = wb.addWorksheet("Competitions");
  ws.properties.tabColor = { argb: "FFFF8000" };

  COMP_COLS.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

  type CellVal = string | number | null | { formula: string };
  const rows: CellVal[][] = [];

  for (let i = 0; i < COMP_DATA_ROWS; i++) {
    const r = i + 2;
    rows.push([
      null, null, null, null, null, null, null,
      { formula: `IFERROR(XLOOKUP(A${r},_Competitions!$B:$B,_Competitions!$A:$A),"")` },    // H
      { formula: `IFERROR(XLOOKUP(C${r},_Courses!$B:$B,_Courses!$A:$A),"")` },              // I
      { formula: `IFERROR(XLOOKUP(I${r}&"|"&D${r},_TeeBoxes!$D:$D,_TeeBoxes!$A:$A),"")` }, // J
      { formula: `IFERROR(XLOOKUP(E${r},_Seasons!$B:$B,_Seasons!$A:$A),"")` },              // K
      { formula: `IFERROR(XLOOKUP(H${r},_Competitions!$A:$A,_Competitions!$D:$D),"")` },    // L
    ]);
  }

  ws.addTable({
    name: "CompetitionsImport",
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium3", showRowStripes: true } as any,
    columns: COMP_COLS.map(col => ({ name: col.header, filterButton: true })),
    rows: rows as any,
  });

  const headerRow = ws.getRow(1);
  COMP_COLS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.fill = col.fill; cell.font = { bold: true }; cell.alignment = { horizontal: "center" };
  });

  for (let row = 2; row <= COMP_DATA_ROWS + 1; row++) {
    for (let col = 8; col <= 12; col++) ws.getCell(row, col).fill = LIGHT_RED;
  }

  // Data validation dropdowns
  const eventEnd  = Math.max(eventCount + 1, 2);
  const courseEnd = Math.max(courseCount + 1, 2);
  const seasonEnd = SEASON_DATA_ROWS + 1;

  applyListValidation(ws, 1, 2, COMP_DATA_ROWS + 1, `_Competitions!$B$2:$B$${eventEnd}`);  // A Competition Name
  applyListValidation(ws, 3, 2, COMP_DATA_ROWS + 1, `_Courses!$B$2:$B$${courseEnd}`);       // C Course Name
  applyListValidation(ws, 5, 2, COMP_DATA_ROWS + 1, `Seasons!$A$2:$A$${seasonEnd}`);        // E Season Name

  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// ── Scores sheet ──────────────────────────────────────────────────────────────
// A   Competition Name     GREEN  dropdown: Competitions!$A$2:$A$[COMP_DATA_ROWS+1]
// B   Player Email or Name GREEN  dropdown: _Members!$B$2:$B$N
// C   Handicap Used        GREEN
// D   Round                GREEN  (integer 1+, blank=1)
// E-V Hole 1–18            GREEN  cols 5-22
// W   competition_id       RED    col 23  ← XLOOKUP(A, Competitions!$A, Competitions!$H)
// X   profile_id           RED    col 24

function buildScoresSheet(wb: ExcelJS.Workbook, memberCount: number) {
  const ws = wb.addWorksheet("Scores");
  ws.properties.tabColor = { argb: "FF00B050" };

  const SCORE_COLS: Array<{ header: string; width: number; fill: Fill }> = [
    { header: "Competition Name",     width: 30, fill: GREEN_FILL }, // A  col 1
    { header: "Player Email or Name", width: 28, fill: GREEN_FILL }, // B  col 2
    { header: "Handicap Used",        width: 14, fill: GREEN_FILL }, // C  col 3
    { header: "Round",                width: 9,  fill: GREEN_FILL }, // D  col 4
    ...Array.from({ length: 18 }, (_, i) => ({                       // E-V cols 5-22
      header: `Hole ${i + 1}`,
      width: 8,
      fill: GREEN_FILL,
    })),
    { header: "competition_id", width: 38, fill: RED_FILL },         // W  col 23
    { header: "profile_id",     width: 38, fill: RED_FILL },         // X  col 24
  ];

  SCORE_COLS.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

  type CellVal = string | number | null | { formula: string };
  const rows: CellVal[][] = [];

  for (let i = 0; i < DATA_ROWS; i++) {
    const r = i + 2;
    const row: CellVal[] = [
      null, // A Competition Name
      null, // B Player
      null, // C Handicap
      1,    // D Round (default 1)
      ...Array.from({ length: 18 }, () => null as CellVal), // E-V holes
      // W: competition_id resolves via Competitions sheet (picks up new entries automatically)
      { formula: `IFERROR(XLOOKUP(A${r},Competitions!$A:$A,Competitions!$H:$H),"")` },
      // X: profile_id
      { formula: `IFERROR(XLOOKUP(B${r},_Members!$C:$C,_Members!$A:$A,XLOOKUP(B${r},_Members!$B:$B,_Members!$A:$A,"")),"")` },
    ];
    rows.push(row);
  }

  ws.addTable({
    name: "ScoresImport",
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium2", showRowStripes: true } as any,
    columns: SCORE_COLS.map(col => ({ name: col.header, filterButton: true })),
    rows: rows as any,
  });

  const headerRow = ws.getRow(1);
  SCORE_COLS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.fill = col.fill; cell.font = { bold: true }; cell.alignment = { horizontal: "center" };
  });

  for (let row = 2; row <= DATA_ROWS + 1; row++) {
    ws.getCell(row, 23).fill = LIGHT_RED;
    ws.getCell(row, 24).fill = LIGHT_RED;
  }

  // Data validation dropdowns
  const compEnd   = COMP_DATA_ROWS + 1;
  const memberEnd = Math.max(memberCount + 1, 2);

  applyListValidation(ws, 1, 2, DATA_ROWS + 1, `Competitions!$A$2:$A$${compEnd}`);       // A Competition Name
  applyListValidation(ws, 2, 2, DATA_ROWS + 1, `_Members!$B$2:$B$${memberEnd}`);          // B Player name

  // Round column: integer >= 1
  for (let row = 2; row <= DATA_ROWS + 1; row++) {
    ws.getCell(row, 4).dataValidation = {
      type: "whole",
      operator: "greaterThanOrEqual",
      formulae: [1],
      allowBlank: true,
      showErrorMessage: false,
    };
  }

  ws.views = [{ state: "frozen", xSplit: 4, ySplit: 1 }];
}

// ── Hidden lookup sheets ──────────────────────────────────────────────────────

function buildLookupSheets(
  wb: ExcelJS.Workbook,
  events:      Array<{ id: string; name: string; event_date: string | null; entry_fee_amount: number | null; course_id: string | null }>,
  allProfiles: Array<{ id: string; name: string | null; email: string | null }>,
  teeBoxes:    Array<{ id: string; name: string; course_id: string }>,
  courses:     Array<{ id: string; name: string; city: string | null; country: string | null }>,
  seasons:     Array<{ id: string; name: string; season_year: number | null; start_date: string | null; end_date: string | null }>,
) {
  // _Competitions: A=id, B=name, C=event_date, D=entry_fee_amount, E=course_id
  const wsComps = wb.addWorksheet("_Competitions");
  wsComps.state = "hidden";
  wsComps.addRow(["id", "name", "event_date", "entry_fee_amount", "course_id"]);
  events.forEach(e =>
    wsComps.addRow([e.id, e.name, e.event_date ?? "", e.entry_fee_amount ?? "", e.course_id ?? ""])
  );

  // _Members: A=id, B="name (email)" display label, C=email (for direct email lookup)
  const wsMembers = wb.addWorksheet("_Members");
  wsMembers.state = "hidden";
  wsMembers.addRow(["id", "name (email)", "email"]);
  allProfiles.forEach(p => wsMembers.addRow([p.id, `${p.name ?? ""} (${p.email ?? ""})`, p.email ?? ""]));

  // _TeeBoxes: A=id, B=name, C=course_id, D=key(course_id|name)
  const wsTeeBoxes = wb.addWorksheet("_TeeBoxes");
  wsTeeBoxes.state = "hidden";
  wsTeeBoxes.addRow(["id", "name", "course_id", "key"]);
  teeBoxes.forEach(t => wsTeeBoxes.addRow([t.id, t.name, t.course_id, `${t.course_id}|${t.name}`]));

  // _Courses: A=id, B=name, C=city, D=country
  const wsCourses = wb.addWorksheet("_Courses");
  wsCourses.state = "hidden";
  wsCourses.addRow(["id", "name", "city", "country"]);
  courses.forEach(c => wsCourses.addRow([c.id, c.name, c.city ?? "", c.country ?? ""]));

  // _Seasons: A=id, B=name, C=season_year, D=start_date, E=end_date
  const wsSeasons = wb.addWorksheet("_Seasons");
  wsSeasons.state = "hidden";
  wsSeasons.addRow(["id", "name", "season_year", "start_date", "end_date"]);
  seasons.forEach(s => wsSeasons.addRow([s.id, s.name, s.season_year ?? "", s.start_date ?? "", s.end_date ?? ""]));
}
