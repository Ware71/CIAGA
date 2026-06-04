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

export const TEMPLATE_VERSION = "v2";

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
      // Sort by course_id first so each course's tees are contiguous — required for named range generation
      admin.from("course_tee_boxes").select("id,name,course_id").order("course_id").order("sort_order"),
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

    // Group members first in the player dropdown
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

  // Version cell — read by the preview/import routes to detect outdated templates
  ws.mergeCells("A1:C1");
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `Season Import Template — ${groupName}`;
  titleCell.font  = { bold: true, size: 14, color: { argb: "FF1F497D" } };
  ws.getRow(1).height = 24;
  // Hidden version marker in a named cell
  ws.getCell(1, 4).value = TEMPLATE_VERSION;
  ws.getColumn(4).hidden = true;
  r++;

  r = addBlank(ws, r);
  r = addSection(ws, r, "Entity Hierarchy", 3);
  r = addText(ws, r, "Group → Seasons → Events → Rounds", 3);
  r = addBlank(ws, r);
  r = addText(ws, r, "Season  — A named time window (e.g. '2024 League Season'). Created in the Seasons sheet.", 3);
  r = addText(ws, r, "Event   — A single golf competition (e.g. 'Club Championship'). Can be an existing event OR a new one you define here.", 3);
  r = addText(ws, r, "Round   — A scorecard per player per event round. Always created by this import.", 3);
  r = addBlank(ws, r);
  r = addText(ws, r, "EXISTING event: type the Event Name exactly as it appears in the database. The RED columns will resolve the ID automatically.", 3);
  r = addText(ws, r, "NEW event: type any new name. Fill in Event Date, Event Type, Scoring Model, Course, and Tee. A new event is created on import.", 3);

  r = addBlank(ws, r);
  r = addSection(ws, r, "Colour Legend", 3);
  const legend: [Fill, string, string][] = [
    [GREEN_FILL, "GREEN", "Required — most have dropdown lists"],
    [AMBER_FILL, "AMBER", "Optional for existing events, required for NEW events"],
    [RED_FILL,   "RED",   "Auto-filled by formula — do NOT edit these cells"],
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
  r = addSection(ws, r, "Competitions (Events) sheet — columns", 3);
  const compCols: [string, string, string][] = [
    ["Event Name",          "Type an existing event name to reference it, or a new name to create it.", "Green"],
    ["Event Date",          "YYYY-MM-DD. Required if creating a new event.", "Amber"],
    ["Event Type",          "Dropdown: Stroke / Stableford / Matchplay / Skins / Scramble / Best Ball. Required for new events.", "Amber"],
    ["Scoring Model",       "Dropdown: Gross / Net. Required for new events.", "Amber"],
    ["Season Name",         "Dropdown from the Seasons sheet. Required.", "Green"],
    ["Course Name",         "Dropdown — pick a course. Required.", "Green"],
    ["Tee Name",            "Dropdown — shows only tees for the selected course. Required.", "Green"],
    ["Entry Fee Override",  "Leave blank to use the default fee. Enter a number to override.", "Amber"],
    ["Notes",               "Free text — ignored on import.", "Amber"],
    ["event_id",            "Auto-resolved. Blank = new event will be created.", "Red"],
    ["is_new",              "NEW or EXISTING — visual indicator only.", "Red"],
    ["course_id",           "Auto-resolved — do not edit.", "Red"],
    ["tee_box_id",          "Auto-resolved — do not edit.", "Red"],
    ["tee_found",           "✓ Found or ✗ Not found. Check this is ✓ for every row before uploading.", "Red"],
    ["season_id",           "Auto-resolved — do not edit.", "Red"],
    ["default_entry_fee",   "Auto-resolved — do not edit.", "Red"],
  ];
  ws.getRow(r).values = ["Column", "Description", "Colour"]; ws.getRow(r).font = { bold: true }; r++;
  for (const [col, desc, colour] of compCols) { ws.getRow(r).values = [col, desc, colour]; r++; }

  r = addBlank(ws, r);
  r = addSection(ws, r, "Scores sheet — columns", 3);
  const scoreCols: [string, string, string][] = [
    ["Event Name",          "Dropdown from Competitions sheet. New events added there appear automatically.", "Green"],
    ["Player Email or Name","Dropdown — group members listed first.", "Green"],
    ["Handicap Used",       "The handicap index used for this event.", "Green"],
    ["Round",               "Round number (1, 2, 3…). Leave blank or 1 for single-round events.", "Green"],
    ["Hole 1 … Hole 18",    "Strokes per hole (integer 0–30).", "Green"],
    ["event_id",            "Auto-resolved via Competitions sheet — do not edit.", "Red"],
    ["profile_id",          "Auto-resolved — do not edit.", "Red"],
  ];
  ws.getRow(r).values = ["Column", "Description", "Colour"]; ws.getRow(r).font = { bold: true }; r++;
  for (const [col, desc, colour] of scoreCols) { ws.getRow(r).values = [col, desc, colour]; r++; }

  r = addBlank(ws, r);
  r = addSection(ws, r, "Workflow", 3);
  const steps = [
    "1. Fill Seasons sheet — one row per season.",
    "2. Fill Competitions (Events) sheet — one row per event. Use dropdowns. Check column N (tee_found) shows ✓ for every row.",
    "3. Fill Scores sheet — one row per player per round. The Event Name dropdown shows events from the Competitions sheet.",
    "4. Upload this .xlsx, click Preview, review, then Confirm Import.",
  ];
  for (const s of steps) { r = addText(ws, r, s, 3); }

  r = addBlank(ws, r);
  r = addSection(ws, r, "Notes", 3);
  r = addText(ws, r, `Requires Excel 365 or Excel 2019+ for XLOOKUP and INDIRECT data validation. Template version: ${TEMPLATE_VERSION}.`, 3);
  r = addText(ws, r, "Tee Name dropdown shows only tees for the selected course. If the dropdown is empty, the course has no tee boxes configured.", 3);
  r = addText(ws, r, "Re-importing is safe: seasons and events are upserted by name, rounds already imported are skipped.", 3);
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
// Redesigned 16-column layout (v2):
// A  Event Name          GREEN  dropdown from _Events!$B (existing) + free text for new
// B  Event Date          AMBER  YYYY-MM-DD, required for new events
// C  Event Type          AMBER  dropdown: Stroke/Stableford/Matchplay/Skins/Scramble/Best Ball
// D  Scoring Model       AMBER  dropdown: Gross/Net
// E  Season Name         GREEN  dropdown: Seasons!$A
// F  Course Name         GREEN  dropdown: _Courses!$B
// G  Tee Name            GREEN  cascading dropdown via INDIRECT based on col L (course_id)
// H  Entry Fee Override  AMBER
// I  Notes               AMBER
// J  event_id            RED  ← XLOOKUP(A, _Events!$B, $A) — blank = new event
// K  is_new              RED  ← IF(J="","NEW","EXISTING")
// L  course_id           RED  ← XLOOKUP(F, _Courses!$B, $A)
// M  tee_box_id          RED  ← XLOOKUP(L&"|"&G, _TeeBoxes!$D, $A)
// N  tee_found           RED  ← IF(A="","",IF(M<>"","✓ Found","✗ Not found"))
// O  season_id           RED  ← XLOOKUP(E, _Seasons!$B, $A)
// P  default_entry_fee   RED  ← XLOOKUP(J, _Events!$A, $D)

const COMP_COLS = [
  { header: "Event Name",         width: 32, fill: GREEN_FILL }, // A col 1
  { header: "Event Date",         width: 14, fill: AMBER_FILL }, // B col 2
  { header: "Event Type",         width: 16, fill: AMBER_FILL }, // C col 3
  { header: "Scoring Model",      width: 14, fill: AMBER_FILL }, // D col 4
  { header: "Season Name",        width: 20, fill: GREEN_FILL }, // E col 5
  { header: "Course Name",        width: 28, fill: GREEN_FILL }, // F col 6
  { header: "Tee Name",           width: 14, fill: GREEN_FILL }, // G col 7
  { header: "Entry Fee Override", width: 18, fill: AMBER_FILL }, // H col 8
  { header: "Notes",              width: 28, fill: AMBER_FILL }, // I col 9
  { header: "event_id",           width: 38, fill: RED_FILL   }, // J col 10
  { header: "is_new",             width: 12, fill: RED_FILL   }, // K col 11
  { header: "course_id",          width: 38, fill: RED_FILL   }, // L col 12
  { header: "tee_box_id",         width: 38, fill: RED_FILL   }, // M col 13
  { header: "tee_found",          width: 16, fill: RED_FILL   }, // N col 14
  { header: "season_id",          width: 38, fill: RED_FILL   }, // O col 15
  { header: "default_entry_fee",  width: 18, fill: RED_FILL   }, // P col 16
] as const;

const EVENT_TYPES    = ["Stroke", "Stableford", "Matchplay", "Skins", "Scramble", "Best Ball"];
const SCORING_MODELS = ["Gross", "Net"];

function buildCompetitionsSheet(wb: ExcelJS.Workbook, eventCount: number, courseCount: number) {
  const ws = wb.addWorksheet("Competitions");
  ws.properties.tabColor = { argb: "FFFF8000" };

  COMP_COLS.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

  type CellVal = string | number | null | { formula: string };
  const rows: CellVal[][] = [];

  for (let i = 0; i < COMP_DATA_ROWS; i++) {
    const r = i + 2;
    rows.push([
      null, null, null, null, null, null, null, null, null, // A-I user input
      { formula: `IFERROR(XLOOKUP(A${r},_Events!$B:$B,_Events!$A:$A),"")` },            // J event_id
      { formula: `IF(J${r}="","NEW","EXISTING")` },                                       // K is_new
      { formula: `IFERROR(XLOOKUP(F${r},_Courses!$B:$B,_Courses!$A:$A),"")` },           // L course_id
      { formula: `IFERROR(XLOOKUP(L${r}&"|"&G${r},_TeeBoxes!$D:$D,_TeeBoxes!$A:$A),"")` }, // M tee_box_id
      { formula: `IF(A${r}="","",IF(M${r}<>"","✓ Found","✗ Not found"))` },              // N tee_found
      { formula: `IFERROR(XLOOKUP(E${r},_Seasons!$B:$B,_Seasons!$A:$A),"")` },           // O season_id
      { formula: `IFERROR(XLOOKUP(J${r},_Events!$A:$A,_Events!$D:$D),"")` },             // P default_entry_fee
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
    for (let col = 10; col <= 16; col++) ws.getCell(row, col).fill = LIGHT_RED;
  }

  // Data validation dropdowns
  const eventEnd  = Math.max(eventCount + 1, 2);
  const courseEnd = Math.max(courseCount + 1, 2);
  const seasonEnd = SEASON_DATA_ROWS + 1;

  // Col A: Event Name — dropdown from existing events (free text also allowed)
  applyListValidation(ws, 1, 2, COMP_DATA_ROWS + 1, `_Events!$B$2:$B$${eventEnd}`);
  // Col C: Event Type
  applyListValidation(ws, 3, 2, COMP_DATA_ROWS + 1, `"${EVENT_TYPES.join(",")}"`);
  // Col D: Scoring Model
  applyListValidation(ws, 4, 2, COMP_DATA_ROWS + 1, `"${SCORING_MODELS.join(",")}"`);
  // Col E: Season Name
  applyListValidation(ws, 5, 2, COMP_DATA_ROWS + 1, `Seasons!$A$2:$A$${seasonEnd}`);
  // Col F: Course Name
  applyListValidation(ws, 6, 2, COMP_DATA_ROWS + 1, `_Courses!$B$2:$B$${courseEnd}`);

  // Col G: Tee Name — cascading dropdown via INDIRECT on course_id (col L)
  for (let row = 2; row <= COMP_DATA_ROWS + 1; row++) {
    ws.getCell(row, 7).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`INDIRECT("tees_"&SUBSTITUTE(L${row},"-","_"))`],
      showErrorMessage: false,
    };
  }

  // Conditional formatting for tee_found column (N = col 14)
  ws.addConditionalFormatting({
    ref: `N2:N${COMP_DATA_ROWS + 1}`,
    rules: [
      {
        type: "containsText",
        operator: "containsText",
        text: "✓",
        style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF92D050" } } },
        priority: 1,
      } as any,
      {
        type: "containsText",
        operator: "containsText",
        text: "✗",
        style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFDDDD" } } },
        priority: 2,
      } as any,
    ],
  });

  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// ── Scores sheet ──────────────────────────────────────────────────────────────
// A   Event Name          GREEN  dropdown: Competitions!$A$2:$A$[COMP_DATA_ROWS+1]
// B   Player Email/Name   GREEN  dropdown: _Members!$B$2:$B$N
// C   Handicap Used       GREEN
// D   Round               GREEN  integer 1+, blank=1
// E-V Hole 1–18           GREEN  cols 5-22
// W   event_id            RED    col 23  ← XLOOKUP(A, Competitions!$A, Competitions!$J) [col J = event_id]
// X   profile_id          RED    col 24

function buildScoresSheet(wb: ExcelJS.Workbook, memberCount: number) {
  const ws = wb.addWorksheet("Scores");
  ws.properties.tabColor = { argb: "FF00B050" };

  const SCORE_COLS: Array<{ header: string; width: number; fill: Fill }> = [
    { header: "Event Name",          width: 30, fill: GREEN_FILL }, // A  col 1
    { header: "Player Email or Name",width: 28, fill: GREEN_FILL }, // B  col 2
    { header: "Handicap Used",       width: 14, fill: GREEN_FILL }, // C  col 3
    { header: "Round",               width: 9,  fill: GREEN_FILL }, // D  col 4
    ...Array.from({ length: 18 }, (_, i) => ({                      // E-V cols 5-22
      header: `Hole ${i + 1}`,
      width: 8,
      fill: GREEN_FILL,
    })),
    { header: "event_id",   width: 38, fill: RED_FILL }, // W  col 23
    { header: "profile_id", width: 38, fill: RED_FILL }, // X  col 24
  ];

  SCORE_COLS.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

  type CellVal = string | number | null | { formula: string };
  const rows: CellVal[][] = [];

  for (let i = 0; i < DATA_ROWS; i++) {
    const r = i + 2;
    const row: CellVal[] = [
      null, // A Event Name
      null, // B Player
      null, // C Handicap
      1,    // D Round (default 1)
      ...Array.from({ length: 18 }, () => null as CellVal), // E-V holes
      // W: event_id — references Competitions!$J (col 10 = event_id in the new layout)
      { formula: `IFERROR(XLOOKUP(A${r},Competitions!$A:$A,Competitions!$J:$J),"")` },
      // X: profile_id — email first, name fallback
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

  const compEnd   = COMP_DATA_ROWS + 1;
  const memberEnd = Math.max(memberCount + 1, 2);

  applyListValidation(ws, 1, 2, DATA_ROWS + 1, `Competitions!$A$2:$A$${compEnd}`);
  applyListValidation(ws, 2, 2, DATA_ROWS + 1, `_Members!$B$2:$B$${memberEnd}`);

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
  // _Events (formerly _Competitions): A=id, B=name, C=event_date, D=entry_fee_amount, E=course_id
  const wsEvents = wb.addWorksheet("_Events");
  wsEvents.state = "hidden";
  wsEvents.addRow(["id", "name", "event_date", "entry_fee_amount", "course_id"]);
  events.forEach(e =>
    wsEvents.addRow([e.id, e.name, e.event_date ?? "", e.entry_fee_amount ?? "", e.course_id ?? ""])
  );

  // _Members: A=id, B="name (email)" display label, C=email (for direct email lookup)
  const wsMembers = wb.addWorksheet("_Members");
  wsMembers.state = "hidden";
  wsMembers.addRow(["id", "name (email)", "email"]);
  allProfiles.forEach(p => wsMembers.addRow([p.id, `${p.name ?? ""} (${p.email ?? ""})`, p.email ?? ""]));

  // _TeeBoxes: A=id, B=name, C=course_id, D=key(course_id|name)
  // IMPORTANT: teeBoxes must be sorted by course_id (done in the DB query) so each course's
  // tees form a contiguous block — required for named range generation below.
  const wsTeeBoxes = wb.addWorksheet("_TeeBoxes");
  wsTeeBoxes.state = "hidden";
  wsTeeBoxes.addRow(["id", "name", "course_id", "key"]);
  teeBoxes.forEach(t => wsTeeBoxes.addRow([t.id, t.name, t.course_id, `${t.course_id}|${t.name}`]));

  // Generate one named range per course for the cascading tee dropdown in the Competitions sheet.
  // Named range: tees_<course_id with hyphens replaced by underscores>
  // Each range points to the tee name column (B) for that course's contiguous block of rows.
  const courseRowRanges = new Map<string, { start: number; end: number }>();
  let currentTeeRow = 2; // header is row 1
  for (const t of teeBoxes) {
    if (!courseRowRanges.has(t.course_id)) {
      courseRowRanges.set(t.course_id, { start: currentTeeRow, end: currentTeeRow });
    } else {
      courseRowRanges.get(t.course_id)!.end = currentTeeRow;
    }
    currentTeeRow++;
  }
  for (const [courseId, range] of courseRowRanges.entries()) {
    const safeName = `tees_${courseId.replace(/-/g, "_")}`;
    wb.definedNames.add(safeName, `_TeeBoxes!$B$${range.start}:$B$${range.end}`);
  }

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
