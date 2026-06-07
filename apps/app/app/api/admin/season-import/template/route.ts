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
const PRIZE_DATA_ROWS  = 100;
const PAYOUT_DATA_ROWS = 300;

export const TEMPLATE_VERSION = "v3";

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
      admin.from("course_tee_boxes").select("id,name,course_id,rating,slope,par").order("course_id").order("sort_order"),
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
    type TemplateRow = {
      id: string; label: string;
      event_type: string | null; scoring_model: string | null; points_model: string | null;
      allowance_pct: number | null; max_handicap: number | null;
    };

    const events      = (eventsRes.data     ?? []) as EventRow[];
    const allProfiles = (allProfilesRes.data ?? []) as ProfileRow[];
    const teeBoxes    = teeBoxesRes.data    ?? [];
    const courses     = coursesRes.data     ?? [];
    const seasons     = (seasonsRes.data    ?? []) as SeasonRow[];

    // Event templates for this group — competition_event_templates are group-scoped
    // only via their parent competitions row, so resolve the group's competitions first.
    const { data: groupComps, error: gcErr } = await admin
      .from("competitions")
      .select("id,name")
      .eq("group_id", groupId);
    if (gcErr) throw new Error(gcErr.message);
    const compNameById = new Map((groupComps ?? []).map((c: any) => [c.id, c.name as string]));
    const compIds = (groupComps ?? []).map((c: any) => c.id as string);

    let templates: TemplateRow[] = [];
    if (compIds.length) {
      const { data: tmplRows, error: tmplErr } = await admin
        .from("competition_event_templates")
        .select("id,name,competition_id,template_event_type,template_scoring_model,template_points_model,template_settings")
        .in("competition_id", compIds)
        .order("name");
      if (tmplErr) throw new Error(tmplErr.message);
      templates = (tmplRows ?? []).map((t: any) => {
        const settings = (t.template_settings ?? {}) as Record<string, any>;
        const compName = compNameById.get(t.competition_id) ?? "";
        return {
          id:            t.id,
          label:         compName ? `${compName} — ${t.name}` : t.name,
          event_type:    t.template_event_type ?? null,
          scoring_model: t.template_scoring_model ?? null,
          points_model:  t.template_points_model ?? null,
          allowance_pct: settings.handicap_allowance_pct ?? null,
          max_handicap:  settings.max_handicap ?? null,
        };
      });
    }

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
    buildCompetitionsSheet(wb, events.length, courses.length, templates.length);
    buildScoresSheet(wb, orderedProfiles.length);
    buildPrizesSheet(wb);
    buildPayoutsSheet(wb, orderedProfiles.length);
    buildLookupSheets(wb, events, orderedProfiles, teeBoxes, courses, seasons, templates);

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
    ["Event Type",          "Dropdown: Stroke / Stableford / Matchplay / Skins / Scramble / Best Ball. Inherits from Template when blank.", "Amber"],
    ["Scoring Model",       "Dropdown: Gross / Net. Inherits from Template when blank.", "Amber"],
    ["Template",            "Dropdown of this group's event templates. The new event links to it and inherits its type/scoring/allowance. Optional.", "Amber"],
    ["Handicap Allowance %","0–100. The % of Course Handicap used for net scoring (e.g. 95). Blank ⇒ inherit from Template, else 100%.", "Amber"],
    ["Season Name",         "Dropdown from the Seasons sheet. Required.", "Green"],
    ["Course Name",         "Dropdown — pick a course. Required.", "Green"],
    ["Tee Name",            "Dropdown — shows only tees for the selected course. Required.", "Green"],
    ["Entry Fee Override",  "Leave blank to use the default fee. Enter a number to override.", "Amber"],
    ["Notes",               "Free text — ignored on import.", "Amber"],
    ["event_id … tee_par",  "Auto-resolved by formula — do not edit.", "Red"],
    ["tee_found",           "✓ Found or ✗ Not found. Check this is ✓ for every row before uploading.", "Red"],
    ["tee_slope/rating/par","Auto-resolved tee details used to compute Course/Playing Handicap on the Scores sheet.", "Red"],
    ["allowance_resolved",  "The effective allowance % (your value, else the Template's, else 100).", "Red"],
  ];
  ws.getRow(r).values = ["Column", "Description", "Colour"]; ws.getRow(r).font = { bold: true }; r++;
  for (const [col, desc, colour] of compCols) { ws.getRow(r).values = [col, desc, colour]; r++; }

  r = addBlank(ws, r);
  r = addSection(ws, r, "Scores sheet — columns", 3);
  const scoreCols: [string, string, string][] = [
    ["Event Name",          "Dropdown from Competitions sheet. New events added there appear automatically.", "Green"],
    ["Player Email or Name","Dropdown — group members listed first.", "Green"],
    ["Handicap Index",      "Enter ONLY the player's Handicap Index. Course & Playing Handicap are calculated for you.", "Green"],
    ["Round",               "Round number (1, 2, 3…). Leave blank or 1 for single-round events.", "Green"],
    ["Hole 1 … Hole 18",    "Strokes per hole (integer 0–30).", "Green"],
    ["Course Handicap",     "Auto-calculated: ROUND(HI × slope/113 + (rating − par)). Read-only.", "Red"],
    ["Playing Handicap",    "Auto-calculated: ROUND(Course Handicap × allowance%). This is what's applied for net. Read-only.", "Red"],
    ["event_id / profile_id","Auto-resolved — do not edit.", "Red"],
  ];
  ws.getRow(r).values = ["Column", "Description", "Colour"]; ws.getRow(r).font = { bold: true }; r++;
  for (const [col, desc, colour] of scoreCols) { ws.getRow(r).values = [col, desc, colour]; r++; }

  r = addBlank(ws, r);
  r = addSection(ws, r, "Prizes sheet — columns (optional)", 3);
  const prizeCols: [string, string, string][] = [
    ["Event Name",        "Dropdown from Competitions sheet. Which event this pot belongs to.", "Green"],
    ["Pot Name",          "A name for the pot (e.g. 'Main Sweep', 'Two's Club'). Unique per event.", "Green"],
    ["Distribution Type", "position_based / metric_weighted / metric_equal / equal_split / non_monetary / entry_only.", "Green"],
    ["Entry Fee Amount",  "Per-player buy-in. Every player who scored the event is enrolled and charged this.", "Amber"],
    ["Metric Type",       "twos / nearest_pin / longest_drive / season_points / custom. Required for metric_* pots.", "Amber"],
    ["Is Monetary",       "Yes/No. No = prize is non-cash (use Prize Description).", "Amber"],
    ["Prize Description / Description", "Free text.", "Amber"],
  ];
  ws.getRow(r).values = ["Column", "Description", "Colour"]; ws.getRow(r).font = { bold: true }; r++;
  for (const [col, desc, colour] of prizeCols) { ws.getRow(r).values = [col, desc, colour]; r++; }

  r = addBlank(ws, r);
  r = addSection(ws, r, "Payouts sheet — columns (optional)", 3);
  const payoutCols: [string, string, string][] = [
    ["Event Name",          "Dropdown from Competitions sheet.", "Green"],
    ["Pot Name",            "Must match a Pot Name on the Prizes sheet.", "Green"],
    ["Player Email or Name","The winner — dropdown, members first.", "Green"],
    ["Position",            "Finishing position (1, 2, 3…) for position-based pots.", "Amber"],
    ["Payout Amount",       "Amount this player won.", "Amber"],
    ["Metric Value",        "e.g. number of twos — for metric pots.", "Amber"],
    ["Note",                "Free text shown on the payout record.", "Amber"],
  ];
  ws.getRow(r).values = ["Column", "Description", "Colour"]; ws.getRow(r).font = { bold: true }; r++;
  for (const [col, desc, colour] of payoutCols) { ws.getRow(r).values = [col, desc, colour]; r++; }

  r = addBlank(ws, r);
  r = addSection(ws, r, "Workflow", 3);
  const steps = [
    "1. Fill Seasons sheet — one row per season.",
    "2. Fill Competitions (Events) sheet — one row per event. Use dropdowns. Pick a Template to inherit settings. Check column P (tee_found) shows ✓ for every row.",
    "3. Fill Scores sheet — one row per player per round. Enter ONLY the Handicap Index; Course & Playing Handicap calculate automatically so you can sanity-check them.",
    "4. (Optional) Fill Prizes sheet — one row per prize pot per event.",
    "5. (Optional) Fill Payouts sheet — one row per winner per pot.",
    "6. Upload this .xlsx, click Preview, review, then Confirm Import.",
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
// Redesigned 23-column layout (v3):
// A  Event Name           GREEN  dropdown from _Events!$B (existing) + free text for new
// B  Event Date           AMBER  YYYY-MM-DD, required for new events
// C  Event Type           AMBER  dropdown: Stroke/Stableford/Matchplay/Skins/Scramble/Best Ball
// D  Scoring Model        AMBER  dropdown: Gross/Net
// E  Template             AMBER  dropdown: _Templates!$B (blank = none). Inherits type/scoring/allowance when blank.
// F  Handicap Allowance % AMBER  0–100; blank ⇒ inherit template, else 100
// G  Season Name          GREEN  dropdown: Seasons!$A
// H  Course Name          GREEN  dropdown: _Courses!$B
// I  Tee Name             GREEN  cascading dropdown via INDIRECT based on col N (course_id)
// J  Entry Fee Override   AMBER
// K  Notes                AMBER
// L  event_id             RED  ← XLOOKUP(A, _Events!$B, $A) — blank = new event
// M  is_new               RED  ← IF(L="","NEW","EXISTING")
// N  course_id            RED  ← XLOOKUP(H, _Courses!$B, $A)
// O  tee_box_id           RED  ← XLOOKUP(N&"|"&I, _TeeBoxes!$D, $A)
// P  tee_found            RED  ← IF(A="","",IF(O<>"","✓ Found","✗ Not found"))
// Q  season_id            RED  ← XLOOKUP(G, _Seasons!$B, $A)
// R  default_entry_fee    RED  ← XLOOKUP(L, _Events!$A, $D)
// S  template_id          RED  ← XLOOKUP(E, _Templates!$B, $A)
// T  tee_slope            RED  ← XLOOKUP(O, _TeeBoxes!$A, _TeeBoxes!$F)
// U  tee_rating           RED  ← XLOOKUP(O, _TeeBoxes!$A, _TeeBoxes!$E)
// V  tee_par              RED  ← XLOOKUP(O, _TeeBoxes!$A, _TeeBoxes!$G)
// W  allowance_resolved   RED  ← IF(F<>"",F,IFERROR(XLOOKUP(S,_Templates!$A,_Templates!$F),100))

const COMP_COLS = [
  { header: "Event Name",           width: 32, fill: GREEN_FILL }, // A col 1
  { header: "Event Date",           width: 14, fill: AMBER_FILL }, // B col 2
  { header: "Event Type",           width: 16, fill: AMBER_FILL }, // C col 3
  { header: "Scoring Model",        width: 14, fill: AMBER_FILL }, // D col 4
  { header: "Template",             width: 30, fill: AMBER_FILL }, // E col 5
  { header: "Handicap Allowance %", width: 18, fill: AMBER_FILL }, // F col 6
  { header: "Season Name",          width: 20, fill: GREEN_FILL }, // G col 7
  { header: "Course Name",          width: 28, fill: GREEN_FILL }, // H col 8
  { header: "Tee Name",             width: 14, fill: GREEN_FILL }, // I col 9
  { header: "Entry Fee Override",   width: 18, fill: AMBER_FILL }, // J col 10
  { header: "Notes",                width: 28, fill: AMBER_FILL }, // K col 11
  { header: "event_id",             width: 38, fill: RED_FILL   }, // L col 12
  { header: "is_new",               width: 12, fill: RED_FILL   }, // M col 13
  { header: "course_id",            width: 38, fill: RED_FILL   }, // N col 14
  { header: "tee_box_id",           width: 38, fill: RED_FILL   }, // O col 15
  { header: "tee_found",            width: 16, fill: RED_FILL   }, // P col 16
  { header: "season_id",            width: 38, fill: RED_FILL   }, // Q col 17
  { header: "default_entry_fee",    width: 18, fill: RED_FILL   }, // R col 18
  { header: "template_id",          width: 38, fill: RED_FILL   }, // S col 19
  { header: "tee_slope",            width: 10, fill: RED_FILL   }, // T col 20
  { header: "tee_rating",           width: 10, fill: RED_FILL   }, // U col 21
  { header: "tee_par",              width: 10, fill: RED_FILL   }, // V col 22
  { header: "allowance_resolved",   width: 16, fill: RED_FILL   }, // W col 23
] as const;

const EVENT_TYPES    = ["Stroke", "Stableford", "Matchplay", "Skins", "Scramble", "Best Ball"];
const SCORING_MODELS = ["Gross", "Net"];

const COMP_RED_START = 12; // col L
const COMP_RED_END   = 23; // col W

function buildCompetitionsSheet(wb: ExcelJS.Workbook, eventCount: number, courseCount: number, templateCount: number) {
  const ws = wb.addWorksheet("Competitions");
  ws.properties.tabColor = { argb: "FFFF8000" };

  COMP_COLS.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

  type CellVal = string | number | null | { formula: string };
  const rows: CellVal[][] = [];

  for (let i = 0; i < COMP_DATA_ROWS; i++) {
    const r = i + 2;
    rows.push([
      null, null, null, null, null, null, null, null, null, null, null, // A-K user input
      { formula: `IFERROR(XLOOKUP(A${r},_Events!$B:$B,_Events!$A:$A),"")` },              // L event_id
      { formula: `IF(L${r}="","NEW","EXISTING")` },                                        // M is_new
      { formula: `IFERROR(XLOOKUP(H${r},_Courses!$B:$B,_Courses!$A:$A),"")` },            // N course_id
      { formula: `IFERROR(XLOOKUP(N${r}&"|"&I${r},_TeeBoxes!$D:$D,_TeeBoxes!$A:$A),"")` }, // O tee_box_id
      { formula: `IF(A${r}="","",IF(O${r}<>"","✓ Found","✗ Not found"))` },               // P tee_found
      { formula: `IFERROR(XLOOKUP(G${r},_Seasons!$B:$B,_Seasons!$A:$A),"")` },            // Q season_id
      { formula: `IFERROR(XLOOKUP(L${r},_Events!$A:$A,_Events!$D:$D),"")` },              // R default_entry_fee
      { formula: `IFERROR(XLOOKUP(E${r},_Templates!$B:$B,_Templates!$A:$A),"")` },        // S template_id
      { formula: `IFERROR(XLOOKUP(O${r},_TeeBoxes!$A:$A,_TeeBoxes!$F:$F),"")` },          // T tee_slope
      { formula: `IFERROR(XLOOKUP(O${r},_TeeBoxes!$A:$A,_TeeBoxes!$E:$E),"")` },          // U tee_rating
      { formula: `IFERROR(XLOOKUP(O${r},_TeeBoxes!$A:$A,_TeeBoxes!$G:$G),"")` },          // V tee_par
      { formula: `IF(F${r}<>"",F${r},IFERROR(XLOOKUP(S${r},_Templates!$A:$A,_Templates!$F:$F),100))` }, // W allowance_resolved
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
    for (let col = COMP_RED_START; col <= COMP_RED_END; col++) ws.getCell(row, col).fill = LIGHT_RED;
  }

  // Data validation dropdowns
  const eventEnd    = Math.max(eventCount + 1, 2);
  const courseEnd   = Math.max(courseCount + 1, 2);
  const seasonEnd   = SEASON_DATA_ROWS + 1;
  const templateEnd = Math.max(templateCount + 1, 2);

  // Col A: Event Name — dropdown from existing events (free text also allowed)
  applyListValidation(ws, 1, 2, COMP_DATA_ROWS + 1, `_Events!$B$2:$B$${eventEnd}`);
  // Col C: Event Type
  applyListValidation(ws, 3, 2, COMP_DATA_ROWS + 1, `"${EVENT_TYPES.join(",")}"`);
  // Col D: Scoring Model
  applyListValidation(ws, 4, 2, COMP_DATA_ROWS + 1, `"${SCORING_MODELS.join(",")}"`);
  // Col E: Template
  applyListValidation(ws, 5, 2, COMP_DATA_ROWS + 1, `_Templates!$B$2:$B$${templateEnd}`);
  // Col G: Season Name
  applyListValidation(ws, 7, 2, COMP_DATA_ROWS + 1, `Seasons!$A$2:$A$${seasonEnd}`);
  // Col H: Course Name
  applyListValidation(ws, 8, 2, COMP_DATA_ROWS + 1, `_Courses!$B$2:$B$${courseEnd}`);

  // Col F: Handicap Allowance % — whole 0–100
  for (let row = 2; row <= COMP_DATA_ROWS + 1; row++) {
    ws.getCell(row, 6).dataValidation = {
      type: "whole",
      operator: "between",
      formulae: [0, 100],
      allowBlank: true,
      showErrorMessage: false,
    };
  }

  // Col I: Tee Name — cascading dropdown via INDIRECT on course_id (col N)
  for (let row = 2; row <= COMP_DATA_ROWS + 1; row++) {
    ws.getCell(row, 9).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`INDIRECT("tees_"&SUBSTITUTE(N${row},"-","_"))`],
      showErrorMessage: false,
    };
  }

  // Conditional formatting for tee_found column (P = col 16)
  ws.addConditionalFormatting({
    ref: `P2:P${COMP_DATA_ROWS + 1}`,
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
// C   Handicap Index      GREEN  enter HI only — CH/PH computed below
// D   Round               GREEN  integer 1+, blank=1
// E-V Hole 1–18           GREEN  cols 5-22
// W   Course Handicap     RED    col 23  ← ROUND(HI*slope/113 + (rating-par))
// X   Playing Handicap    RED    col 24  ← ROUND(CH * allowance/100)
// Y   event_id            RED    col 25  ← XLOOKUP(A, Competitions!$A, Competitions!$L) [col L = event_id]
// Z   profile_id          RED    col 26

function buildScoresSheet(wb: ExcelJS.Workbook, memberCount: number) {
  const ws = wb.addWorksheet("Scores");
  ws.properties.tabColor = { argb: "FF00B050" };

  const SCORE_COLS: Array<{ header: string; width: number; fill: Fill }> = [
    { header: "Event Name",          width: 30, fill: GREEN_FILL }, // A  col 1
    { header: "Player Email or Name",width: 28, fill: GREEN_FILL }, // B  col 2
    { header: "Handicap Index",      width: 14, fill: GREEN_FILL }, // C  col 3
    { header: "Round",               width: 9,  fill: GREEN_FILL }, // D  col 4
    ...Array.from({ length: 18 }, (_, i) => ({                      // E-V cols 5-22
      header: `Hole ${i + 1}`,
      width: 8,
      fill: GREEN_FILL,
    })),
    { header: "Course Handicap",  width: 14, fill: RED_FILL }, // W  col 23
    { header: "Playing Handicap", width: 14, fill: RED_FILL }, // X  col 24
    { header: "event_id",         width: 38, fill: RED_FILL }, // Y  col 25
    { header: "profile_id",       width: 38, fill: RED_FILL }, // Z  col 26
  ];

  SCORE_COLS.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

  type CellVal = string | number | null | { formula: string };
  const rows: CellVal[][] = [];

  for (let i = 0; i < DATA_ROWS; i++) {
    const r = i + 2;
    const row: CellVal[] = [
      null, // A Event Name
      null, // B Player
      null, // C Handicap Index
      1,    // D Round (default 1)
      ...Array.from({ length: 18 }, () => null as CellVal), // E-V holes
      // W: Course Handicap — live calc from the event's tee slope/rating/par
      { formula: `IF(OR($A${r}="",$C${r}=""),"",ROUND($C${r}*XLOOKUP($A${r},Competitions!$A:$A,Competitions!$T:$T)/113+(XLOOKUP($A${r},Competitions!$A:$A,Competitions!$U:$U)-XLOOKUP($A${r},Competitions!$A:$A,Competitions!$V:$V)),0))` },
      // X: Playing Handicap — Course Handicap × event allowance %
      { formula: `IF(W${r}="","",ROUND(W${r}*XLOOKUP($A${r},Competitions!$A:$A,Competitions!$W:$W)/100,0))` },
      // Y: event_id — references Competitions!$L (col 12 = event_id in the new layout)
      { formula: `IFERROR(XLOOKUP(A${r},Competitions!$A:$A,Competitions!$L:$L),"")` },
      // Z: profile_id — email first, name fallback
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
    for (let col = 23; col <= 26; col++) ws.getCell(row, col).fill = LIGHT_RED;
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

// ── Prizes sheet ──────────────────────────────────────────────────────────────
// One row per prize pot. A pot is keyed by (event, Pot Name).
// A  Event Name         GREEN  dropdown: Competitions!$A
// B  Pot Name           GREEN
// C  Distribution Type  GREEN  dropdown
// D  Entry Fee Amount   AMBER  per-player buy-in
// E  Metric Type        AMBER  dropdown (required for metric_* types)
// F  Is Monetary        AMBER  Yes/No (default Yes)
// G  Prize Description  AMBER  for non_monetary pots
// H  Description        AMBER
// I  event_id           RED    ← XLOOKUP(A, Competitions!$A, Competitions!$L)

const DISTRIBUTION_TYPES = ["position_based", "metric_weighted", "metric_equal", "equal_split", "non_monetary", "entry_only"];
const METRIC_TYPES       = ["twos", "nearest_pin", "longest_drive", "season_points", "custom"];

function buildPrizesSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet("Prizes");
  ws.properties.tabColor = { argb: "FFFFD966" };

  const PRIZE_COLS: Array<{ header: string; width: number; fill: Fill }> = [
    { header: "Event Name",        width: 30, fill: GREEN_FILL }, // A col 1
    { header: "Pot Name",          width: 24, fill: GREEN_FILL }, // B col 2
    { header: "Distribution Type", width: 18, fill: GREEN_FILL }, // C col 3
    { header: "Entry Fee Amount",  width: 16, fill: AMBER_FILL }, // D col 4
    { header: "Metric Type",       width: 16, fill: AMBER_FILL }, // E col 5
    { header: "Is Monetary",       width: 12, fill: AMBER_FILL }, // F col 6
    { header: "Prize Description", width: 28, fill: AMBER_FILL }, // G col 7
    { header: "Description",       width: 28, fill: AMBER_FILL }, // H col 8
    { header: "event_id",          width: 38, fill: RED_FILL   }, // I col 9
  ];

  PRIZE_COLS.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

  type CellVal = string | number | null | { formula: string };
  const rows: CellVal[][] = [];
  for (let i = 0; i < PRIZE_DATA_ROWS; i++) {
    const r = i + 2;
    rows.push([
      null, null, null, null, null, null, null, null, // A-H input
      { formula: `IFERROR(XLOOKUP(A${r},Competitions!$A:$A,Competitions!$L:$L),"")` }, // I event_id
    ]);
  }

  ws.addTable({
    name: "PrizesImport",
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium5", showRowStripes: true } as any,
    columns: PRIZE_COLS.map(col => ({ name: col.header, filterButton: true })),
    rows: rows as any,
  });

  const headerRow = ws.getRow(1);
  PRIZE_COLS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.fill = col.fill; cell.font = { bold: true }; cell.alignment = { horizontal: "center" };
  });

  for (let row = 2; row <= PRIZE_DATA_ROWS + 1; row++) ws.getCell(row, 9).fill = LIGHT_RED;

  const compEnd = COMP_DATA_ROWS + 1;
  applyListValidation(ws, 1, 2, PRIZE_DATA_ROWS + 1, `Competitions!$A$2:$A$${compEnd}`);
  applyListValidation(ws, 3, 2, PRIZE_DATA_ROWS + 1, `"${DISTRIBUTION_TYPES.join(",")}"`);
  applyListValidation(ws, 5, 2, PRIZE_DATA_ROWS + 1, `"${METRIC_TYPES.join(",")}"`);
  applyListValidation(ws, 6, 2, PRIZE_DATA_ROWS + 1, `"Yes,No"`);

  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// ── Payouts sheet ─────────────────────────────────────────────────────────────
// One row per winner per pot.
// A  Event Name           GREEN  dropdown: Competitions!$A
// B  Pot Name             GREEN  must match a Pot Name on the Prizes sheet
// C  Player Email or Name GREEN  dropdown: _Members!$B
// D  Position             AMBER  finishing position (position_based)
// E  Payout Amount        AMBER  amount won
// F  Metric Value         AMBER  for metric pots
// G  Note                 AMBER
// H  event_id             RED
// I  profile_id           RED

function buildPayoutsSheet(wb: ExcelJS.Workbook, memberCount: number) {
  const ws = wb.addWorksheet("Payouts");
  ws.properties.tabColor = { argb: "FFE69138" };

  const PAYOUT_COLS: Array<{ header: string; width: number; fill: Fill }> = [
    { header: "Event Name",          width: 30, fill: GREEN_FILL }, // A col 1
    { header: "Pot Name",            width: 24, fill: GREEN_FILL }, // B col 2
    { header: "Player Email or Name",width: 28, fill: GREEN_FILL }, // C col 3
    { header: "Position",            width: 10, fill: AMBER_FILL }, // D col 4
    { header: "Payout Amount",       width: 14, fill: AMBER_FILL }, // E col 5
    { header: "Metric Value",        width: 12, fill: AMBER_FILL }, // F col 6
    { header: "Note",                width: 28, fill: AMBER_FILL }, // G col 7
    { header: "event_id",            width: 38, fill: RED_FILL   }, // H col 8
    { header: "profile_id",          width: 38, fill: RED_FILL   }, // I col 9
  ];

  PAYOUT_COLS.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

  type CellVal = string | number | null | { formula: string };
  const rows: CellVal[][] = [];
  for (let i = 0; i < PAYOUT_DATA_ROWS; i++) {
    const r = i + 2;
    rows.push([
      null, null, null, null, null, null, null, // A-G input
      { formula: `IFERROR(XLOOKUP(A${r},Competitions!$A:$A,Competitions!$L:$L),"")` }, // H event_id
      { formula: `IFERROR(XLOOKUP(C${r},_Members!$C:$C,_Members!$A:$A,XLOOKUP(C${r},_Members!$B:$B,_Members!$A:$A,"")),"")` }, // I profile_id
    ]);
  }

  ws.addTable({
    name: "PayoutsImport",
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium5", showRowStripes: true } as any,
    columns: PAYOUT_COLS.map(col => ({ name: col.header, filterButton: true })),
    rows: rows as any,
  });

  const headerRow = ws.getRow(1);
  PAYOUT_COLS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.fill = col.fill; cell.font = { bold: true }; cell.alignment = { horizontal: "center" };
  });

  for (let row = 2; row <= PAYOUT_DATA_ROWS + 1; row++) {
    ws.getCell(row, 8).fill = LIGHT_RED;
    ws.getCell(row, 9).fill = LIGHT_RED;
  }

  const compEnd   = COMP_DATA_ROWS + 1;
  const memberEnd = Math.max(memberCount + 1, 2);
  applyListValidation(ws, 1, 2, PAYOUT_DATA_ROWS + 1, `Competitions!$A$2:$A$${compEnd}`);
  applyListValidation(ws, 3, 2, PAYOUT_DATA_ROWS + 1, `_Members!$B$2:$B$${memberEnd}`);

  for (let row = 2; row <= PAYOUT_DATA_ROWS + 1; row++) {
    ws.getCell(row, 4).dataValidation = {
      type: "whole",
      operator: "greaterThanOrEqual",
      formulae: [1],
      allowBlank: true,
      showErrorMessage: false,
    };
  }

  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// ── Hidden lookup sheets ──────────────────────────────────────────────────────

function buildLookupSheets(
  wb: ExcelJS.Workbook,
  events:      Array<{ id: string; name: string; event_date: string | null; entry_fee_amount: number | null; course_id: string | null }>,
  allProfiles: Array<{ id: string; name: string | null; email: string | null }>,
  teeBoxes:    Array<{ id: string; name: string; course_id: string; rating: number | null; slope: number | null; par: number | null }>,
  courses:     Array<{ id: string; name: string; city: string | null; country: string | null }>,
  seasons:     Array<{ id: string; name: string; season_year: number | null; start_date: string | null; end_date: string | null }>,
  templates:   Array<{ id: string; label: string; event_type: string | null; scoring_model: string | null; points_model: string | null; allowance_pct: number | null; max_handicap: number | null }>,
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

  // _TeeBoxes: A=id, B=name, C=course_id, D=key(course_id|name), E=rating, F=slope, G=par
  // IMPORTANT: teeBoxes must be sorted by course_id (done in the DB query) so each course's
  // tees form a contiguous block — required for named range generation below.
  const wsTeeBoxes = wb.addWorksheet("_TeeBoxes");
  wsTeeBoxes.state = "hidden";
  wsTeeBoxes.addRow(["id", "name", "course_id", "key", "rating", "slope", "par"]);
  teeBoxes.forEach(t => wsTeeBoxes.addRow([t.id, t.name, t.course_id, `${t.course_id}|${t.name}`, t.rating ?? "", t.slope ?? "", t.par ?? ""]));

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

  // _Templates: A=id, B=label, C=event_type, D=scoring_model, E=points_model, F=allowance_pct, G=max_handicap
  const wsTemplates = wb.addWorksheet("_Templates");
  wsTemplates.state = "hidden";
  wsTemplates.addRow(["id", "label", "event_type", "scoring_model", "points_model", "allowance_pct", "max_handicap"]);
  templates.forEach(t => wsTemplates.addRow([
    t.id, t.label, t.event_type ?? "", t.scoring_model ?? "", t.points_model ?? "", t.allowance_pct ?? "", t.max_handicap ?? "",
  ]));
}
