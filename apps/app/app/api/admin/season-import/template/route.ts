import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { TEMPLATE_VERSION } from "@/lib/admin/season-import/parse";

type Fill = ExcelJS.Fill;

const GREEN_FILL: Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF92D050" } };
const AMBER_FILL: Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC000" } };
const RED_FILL:   Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF6B6B" } };
const LIGHT_RED:  Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFDDDD" } };

const DATA_ROWS          = 2000;
const COMP_DATA_ROWS     = 300;
const SEASON_DATA_ROWS   = 50;
const PRIZE_DATA_ROWS    = 300;
const PAYOUT_DATA_ROWS   = 600;
const CHARGE_DATA_ROWS   = 600;
const PAYMENT_DATA_ROWS  = 400;
const PLAYOFF_DATA_ROWS  = 100;


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

    // Event templates — sourced from two levels:
    //   1. competitions (series) themselves — prefixed "comp_<uuid>" so import can distinguish
    //   2. competition_event_templates (named slots within a series) — plain uuid
    // This ensures the dropdown is populated even when a group has series but no named slots.
    const { data: groupComps, error: gcErr } = await admin
      .from("competitions")
      .select("id,name,template_event_type,template_scoring_model,template_points_model,template_settings")
      .eq("group_id", groupId)
      .order("name");
    if (gcErr) throw new Error(gcErr.message);
    const compNameById = new Map((groupComps ?? []).map((c: any) => [c.id, c.name as string]));
    const compIds = (groupComps ?? []).map((c: any) => c.id as string);

    const templates: TemplateRow[] = [];

    // Series-level entries first (id prefixed with "comp_")
    for (const c of groupComps ?? []) {
      const settings = ((c as any).template_settings ?? {}) as Record<string, any>;
      templates.push({
        id:            `comp_${(c as any).id}`,
        label:         (c as any).name,
        event_type:    (c as any).template_event_type ?? null,
        scoring_model: (c as any).template_scoring_model ?? null,
        points_model:  (c as any).template_points_model ?? null,
        allowance_pct: settings.handicap_allowance_pct ?? null,
        max_handicap:  settings.max_handicap ?? null,
      });
    }

    // Named event-template slots (indented label, plain uuid)
    if (compIds.length) {
      const { data: tmplRows, error: tmplErr } = await admin
        .from("competition_event_templates")
        .select("id,name,competition_id,template_event_type,template_scoring_model,template_points_model,template_settings")
        .in("competition_id", compIds)
        .order("name");
      if (tmplErr) throw new Error(tmplErr.message);
      for (const t of tmplRows ?? []) {
        const settings = ((t as any).template_settings ?? {}) as Record<string, any>;
        const compName = compNameById.get((t as any).competition_id) ?? "";
        templates.push({
          id:            (t as any).id,
          label:         compName ? `${compName} — ${(t as any).name}` : (t as any).name,
          event_type:    (t as any).template_event_type ?? null,
          scoring_model: (t as any).template_scoring_model ?? null,
          points_model:  (t as any).template_points_model ?? null,
          allowance_pct: settings.handicap_allowance_pct ?? null,
          max_handicap:  settings.max_handicap ?? null,
        });
      }
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
    buildEventRoundsSheet(wb);
    buildPrizesSheet(wb);
    buildPayoutsSheet(wb, orderedProfiles.length);
    buildChargesSheet(wb, orderedProfiles.length);
    buildPaymentsSheet(wb, orderedProfiles.length);
    buildPlayoffsSheet(wb, orderedProfiles.length);
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

// Excel stores post-2007 functions with an "_xlfn." prefix in the file format;
// ExcelJS writes formula strings verbatim, so a bare XLOOKUP( makes Excel treat
// it as an unknown name (rendered "@XLOOKUP" → #NAME?). Prefixing here makes the
// cell open as a clean, working =XLOOKUP(...).
function fx(s: string): { formula: string } {
  return { formula: s.replace(/XLOOKUP\(/g, "_xlfn.XLOOKUP(") };
}

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
  ws.getColumn(1).width = 30;
  ws.getColumn(2).width = 80;
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
  r = addSection(ws, r, "What this does", 3);
  r = addText(ws, r, "This workbook imports complete historical seasons into the app — events, scorecards, prize money, charges and payments — so they look exactly as if they were played and recorded live.", 3);
  r = addText(ws, r, "You can put several seasons in one file. The importer processes them one season at a time automatically — just upload the whole file once.", 3);

  r = addBlank(ws, r);
  r = addSection(ws, r, "Colour code (every sheet)", 3);
  const legend: [Fill, string, string][] = [
    [GREEN_FILL, "GREEN", "Fill these in. Most have dropdown lists — use them."],
    [AMBER_FILL, "AMBER", "Optional. Fill in to override a default."],
    [RED_FILL,   "RED",   "Calculated automatically. NEVER type in red columns."],
  ];
  for (const [fill, label, desc] of legend) {
    const c1 = ws.getCell(r, 1);
    c1.value = label; c1.fill = fill; c1.font = { bold: true };
    ws.mergeCells(`B${r}:C${r}`);
    ws.getCell(r, 2).value = desc;
    r++;
  }

  r = addBlank(ws, r);
  r = addSection(ws, r, "Step-by-step", 3);
  const steps = [
    "STEP 1 — Seasons sheet: one row per season. Just a name and a year (e.g. '2024 Season', 2024). Dates fill themselves in unless you override them.",
    "STEP 2 — Competitions sheet: one row per event. Pick a Template from the dropdown to inherit its format, scoring, points model, allowance and default prize pot — or fill those columns yourself. Pick the Course and Tee from the dropdowns (pick the Course FIRST — the Tee list depends on it). Check the tee_found column shows ✓ on every row before you go further.",
    "STEP 3 — Scores sheet: one row per player per round. Pick the Event and Player from the dropdowns, enter ONLY the player's Handicap Index, then the 18 hole scores. Course and Playing Handicap calculate automatically. Leave Handicap Index blank to use the player's handicap in the app on the day before the event.",
    "STEP 4 — Tee Time on the Scores sheet (optional): players who share a tee time become one scorecard group, exactly like a real fourball. Leave it blank for one big group at the default time. Example: 3 players at 14:08 and 3 at 14:16 = two scorecards.",
    "STEP 5 — Optional sheets (skip any you don't need):",
    "   • Event Rounds — only for multi-round events where rounds are on different courses, dates or times. One row per round.",
    "   • Prizes — one row per prize pot per event (sweep, two's club…). Every player who scored is enrolled and charged the buy-in. Events using a Template with a default pot get it automatically.",
    "   • Payouts — one row per winner per pot: who won, position, amount.",
    "   • Charges — green fees, buggies, food etc. Leave Player blank to charge EVERYONE who played; add player rows for individual charges. 'Paid = Yes' also records their payment so balances settle.",
    "   • Payments — money received from a member. Leave Amount blank to settle everything they owe for that event in one go.",
    "   • Playoffs — if 1st place was tied, one row per tied player with their final position (winner = 1) and whether it was a playoff or countback.",
    "STEP 6 — Upload: save the file, upload it on the Season Import page, click Preview. Fix anything it flags, re-upload, then Confirm Import.",
  ];
  for (const s of steps) { r = addText(ws, r, s, 3); }

  r = addBlank(ws, r);
  r = addSection(ws, r, "Existing vs new events", 3);
  r = addText(ws, r, "EXISTING event: pick its name from the Event Name dropdown — scores import into it.", 3);
  r = addText(ws, r, "NEW event: type any new name and fill in Event Date + Course + Tee (plus Event Type/Scoring or a Template). It is created on import.", 3);

  r = addBlank(ws, r);
  r = addSection(ws, r, "Sheet reference", 3);

  const sheetRef: [string, string][] = [
    ["Seasons",      "Season Name + Year required. Start/End Date only if the season isn't a calendar year."],
    ["Competitions", "Event Name, Season Name, Course Name, Tee Name required. Event Date required for new events. Template / Event Type / Scoring Model / Handicap Allowance % / Entry Fee Override / points_model_override / field_size_override / tee_time are optional — blank means 'inherit from the Template, else use the default'."],
    ["Scores",       "Event Name, Player, holes 1–18 required. Round defaults to 1. Handicap Index blank = looked up automatically. Tee Time optional (HH:MM) — splits the field into scorecard groups."],
    ["Event Rounds", "Only for multi-round events needing a different course/date/time per round: Event Name, Round Number, Course Name, Tee Name (+ optional Round Date, Tee Time)."],
    ["Prizes",       "Event Name, Pot Name, Distribution Type required. Entry Fee Amount = the per-player buy-in. Metric Type needed for metric pots (e.g. twos)."],
    ["Payouts",      "Event Name, Pot Name, Player required. Position and Payout Amount as applicable."],
    ["Charges",      "Event Name, Charge Name, Category, Amount required. Player blank = all players. Paid defaults to Yes."],
    ["Payments",     "Player required. Event Name blank = a general payment toward their group balance. Amount blank = auto-settle what they owe."],
    ["Playoffs",     "Event Name, Resolution Type (playoff/countback), Player, Final Position. Exactly one player per event must have position 1."],
  ];
  ws.getRow(r).values = ["Sheet", "What to fill in"]; ws.getRow(r).font = { bold: true }; r++;
  for (const [sheet, desc] of sheetRef) {
    ws.getCell(r, 1).value = sheet;
    ws.getCell(r, 1).font = { bold: true };
    ws.mergeCells(`B${r}:C${r}`);
    const cell = ws.getCell(r, 2);
    cell.value = desc;
    cell.alignment = { wrapText: true };
    r++;
  }

  r = addBlank(ws, r);
  r = addSection(ws, r, "Good to know", 3);
  const notes = [
    "Multiple seasons in one file: yes. Upload once — the importer handles one season at a time and finishes with standings, handicaps and feed in a final pass.",
    "Re-importing the same file is safe: anything already imported is skipped and nobody is ever charged twice.",
    "Imported scorecards are backdated to the event date and tee time, and they COUNT toward players' WHS handicap history — handicaps are replayed from the earliest imported round.",
    "Tee Name dropdown empty? Pick the Course first. Still empty = that course has no tee boxes set up in the app.",
    "Don't change tee times for an event after it has been imported — the round names would no longer match and re-import protection wouldn't recognise them.",
    `Needs Excel 2021 or Microsoft 365 (uses XLOOKUP). Template version: ${TEMPLATE_VERSION} — always download a fresh template rather than reusing an old file.`,
  ];
  for (const n of notes) { r = addText(ws, r, `• ${n}`, 3); }
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
      fx(`IFERROR(XLOOKUP(A${r},_Seasons!$B:$B,_Seasons!$A:$A),"")`),
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
// X  points_model_override AMBER  dropdown; blank ⇒ inherit from Template, else none
// Y  field_size_override  AMBER  whole ≥1 → points_config.num_participants
// Z  tee_time             AMBER  HH:MM; blank ⇒ 09:00. Base time for backdated scorecards.
// AA points_model_resolved RED ← IF(X<>"",X,IFERROR(XLOOKUP(S,_Templates!$A,_Templates!$E),"none"))

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
  { header: "points_model_override",width: 20, fill: AMBER_FILL }, // X col 24
  { header: "field_size_override",  width: 16, fill: AMBER_FILL }, // Y col 25
  { header: "tee_time",             width: 10, fill: AMBER_FILL }, // Z col 26
  { header: "points_model_resolved",width: 20, fill: RED_FILL   }, // AA col 27
] as const;

const EVENT_TYPES    = ["Stroke", "Stableford", "Matchplay", "Skins", "Scramble", "Best Ball"];
const SCORING_MODELS = ["Gross", "Net"];
const POINTS_MODELS  = ["none", "position_based", "custom_table", "fedex_style", "ciaga_formula", "custom_formula"];

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
      fx(`IFERROR(XLOOKUP(A${r},_Events!$B:$B,_Events!$A:$A),"")`),              // L event_id
      fx(`IF(L${r}="","NEW","EXISTING")`),                                        // M is_new
      fx(`IFERROR(XLOOKUP(H${r},_Courses!$B:$B,_Courses!$A:$A),"")`),            // N course_id
      fx(`IFERROR(XLOOKUP(N${r}&"|"&I${r},_TeeBoxes!$D:$D,_TeeBoxes!$A:$A),"")`), // O tee_box_id
      fx(`IF(A${r}="","",IF(O${r}<>"","✓ Found","✗ Not found"))`),               // P tee_found
      fx(`IFERROR(XLOOKUP(G${r},_Seasons!$B:$B,_Seasons!$A:$A),"")`),            // Q season_id
      fx(`IFERROR(XLOOKUP(L${r},_Events!$A:$A,_Events!$D:$D),"")`),              // R default_entry_fee
      fx(`IFERROR(XLOOKUP(E${r},_Templates!$B:$B,_Templates!$A:$A),"")`),        // S template_id
      fx(`IFERROR(XLOOKUP(O${r},_TeeBoxes!$A:$A,_TeeBoxes!$F:$F),"")`),          // T tee_slope
      fx(`IFERROR(XLOOKUP(O${r},_TeeBoxes!$A:$A,_TeeBoxes!$E:$E),"")`),          // U tee_rating
      fx(`IFERROR(XLOOKUP(O${r},_TeeBoxes!$A:$A,_TeeBoxes!$G:$G),"")`),          // V tee_par
      fx(`IF(F${r}<>"",F${r},IFERROR(XLOOKUP(S${r},_Templates!$A:$A,_Templates!$F:$F),100))`), // W allowance_resolved
      null, null, null,                                                                    // X-Z user input
      fx(`IF(X${r}<>"",X${r},IFERROR(XLOOKUP(S${r},_Templates!$A:$A,_Templates!$E:$E),"none"))`), // AA points_model_resolved
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
    ws.getCell(row, 27).fill = LIGHT_RED; // AA points_model_resolved
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

  // Col X: points_model_override
  applyListValidation(ws, 24, 2, COMP_DATA_ROWS + 1, `"${POINTS_MODELS.join(",")}"`);

  // Col F: Handicap Allowance % — whole 0–100; Col Y: field size — whole ≥ 1
  for (let row = 2; row <= COMP_DATA_ROWS + 1; row++) {
    ws.getCell(row, 6).dataValidation = {
      type: "whole",
      operator: "between",
      formulae: [0, 100],
      allowBlank: true,
      showErrorMessage: false,
    };
    ws.getCell(row, 25).dataValidation = {
      type: "whole",
      operator: "greaterThanOrEqual",
      formulae: [1],
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
// E   Tee Time            AMBER  HH:MM — players sharing a tee time form one scorecard
//                                group (their own round). Blank = the round/event default.
// F-W Hole 1–18           GREEN  cols 6-23
// X   Course Handicap     RED    col 24  ← ROUND(HI*slope/113 + (rating-par)); slope/rating/par from EventRounds
//                                           if a per-round entry exists, else from Competitions (event-level tee)
// Y   Playing Handicap    RED    col 25  ← ROUND(CH * allowance/100)
// Z   event_id            RED    col 26  ← XLOOKUP(A, Competitions!$A, Competitions!$L) [col L = event_id]
// AA  profile_id          RED    col 27

function buildScoresSheet(wb: ExcelJS.Workbook, memberCount: number) {
  const ws = wb.addWorksheet("Scores");
  ws.properties.tabColor = { argb: "FF00B050" };

  const SCORE_COLS: Array<{ header: string; width: number; fill: Fill }> = [
    { header: "Event Name",          width: 30, fill: GREEN_FILL }, // A  col 1
    { header: "Player Email or Name",width: 28, fill: GREEN_FILL }, // B  col 2
    { header: "Handicap Index",      width: 14, fill: GREEN_FILL }, // C  col 3
    { header: "Round",               width: 9,  fill: GREEN_FILL }, // D  col 4
    { header: "Tee Time",            width: 10, fill: AMBER_FILL }, // E  col 5
    ...Array.from({ length: 18 }, (_, i) => ({                      // F-W cols 6-23
      header: `Hole ${i + 1}`,
      width: 8,
      fill: GREEN_FILL,
    })),
    { header: "Course Handicap",  width: 14, fill: RED_FILL }, // X  col 24
    { header: "Playing Handicap", width: 14, fill: RED_FILL }, // Y  col 25
    { header: "event_id",         width: 38, fill: RED_FILL }, // Z  col 26
    { header: "profile_id",       width: 38, fill: RED_FILL }, // AA col 27
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
      null, // E Tee Time (blank = round/event default)
      ...Array.from({ length: 18 }, () => null as CellVal), // F-W holes
      // X: Course Handicap — tries Event Rounds sheet first (per-round tee), falls back to Competitions (event-level tee)
      // round_key in EventRounds!$N = EventName&"|"&RoundNumber (slope=K, rating=L, par=M)
      fx(`IF(OR($A${r}="",$C${r}=""),"",ROUND($C${r}*IFERROR(XLOOKUP($A${r}&"|"&$D${r},'Event Rounds'!$N:$N,'Event Rounds'!$K:$K),XLOOKUP($A${r},Competitions!$A:$A,Competitions!$T:$T))/113+(IFERROR(XLOOKUP($A${r}&"|"&$D${r},'Event Rounds'!$N:$N,'Event Rounds'!$L:$L),XLOOKUP($A${r},Competitions!$A:$A,Competitions!$U:$U))-IFERROR(XLOOKUP($A${r}&"|"&$D${r},'Event Rounds'!$N:$N,'Event Rounds'!$M:$M),XLOOKUP($A${r},Competitions!$A:$A,Competitions!$V:$V))),0))`),
      // Y: Playing Handicap — Course Handicap × event allowance %
      fx(`IF(X${r}="","",ROUND(X${r}*XLOOKUP($A${r},Competitions!$A:$A,Competitions!$W:$W)/100,0))`),
      // Z: event_id — references Competitions!$L (col 12 = event_id)
      fx(`IFERROR(XLOOKUP(A${r},Competitions!$A:$A,Competitions!$L:$L),"")`),
      // AA: profile_id — email first, name fallback
      fx(`IFERROR(XLOOKUP(B${r},_Members!$C:$C,_Members!$A:$A,XLOOKUP(B${r},_Members!$B:$B,_Members!$A:$A,"")),"")`),
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
    for (let col = 24; col <= 27; col++) ws.getCell(row, col).fill = LIGHT_RED;
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

  ws.views = [{ state: "frozen", xSplit: 5, ySplit: 1 }];
}

// ── Event Rounds sheet ────────────────────────────────────────────────────────
// Optional. One row per round per multi-course event.
// Leave blank for single-round events or multi-round same-course events.
// When populated, overrides the Competitions-sheet course/tee for that specific round.
// A  Event Name   GREEN  dropdown from Competitions!$A
// B  Round Number GREEN  integer ≥ 1
// C  Round Date   AMBER  YYYY-MM-DD override; blank = use event date
// D  Tee Time     AMBER  HH:MM override for this round; blank = event tee_time, else 09:00
// E  Course Name  GREEN  dropdown from _Courses!$B
// F  Tee Name     GREEN  cascading INDIRECT on course_id (col H)
// G  event_id     RED    XLOOKUP(A, Competitions!$A, Competitions!$L)
// H  course_id    RED    XLOOKUP(E, _Courses!$B, _Courses!$A)
// I  tee_box_id   RED    XLOOKUP(H&"|"&F, _TeeBoxes!$D, _TeeBoxes!$A)
// J  tee_found    RED    ✓/✗ indicator
// K  tee_slope    RED    XLOOKUP(I, _TeeBoxes!$A, _TeeBoxes!$F)
// L  tee_rating   RED    XLOOKUP(I, _TeeBoxes!$A, _TeeBoxes!$E)
// M  tee_par      RED    XLOOKUP(I, _TeeBoxes!$A, _TeeBoxes!$G)
// N  round_key    RED    A&"|"&B  ← used by Scores CH/PH to find per-round slope/rating/par

const EVENT_ROUNDS_DATA_ROWS = 500;

function buildEventRoundsSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet("Event Rounds");
  ws.properties.tabColor = { argb: "FF00B0F0" };

  const ER_COLS: Array<{ header: string; width: number; fill: Fill }> = [
    { header: "Event Name",   width: 30, fill: GREEN_FILL }, // A col 1
    { header: "Round Number", width: 12, fill: GREEN_FILL }, // B col 2
    { header: "Round Date",   width: 14, fill: AMBER_FILL }, // C col 3
    { header: "Tee Time",     width: 10, fill: AMBER_FILL }, // D col 4
    { header: "Course Name",  width: 28, fill: GREEN_FILL }, // E col 5
    { header: "Tee Name",     width: 14, fill: GREEN_FILL }, // F col 6
    { header: "event_id",     width: 38, fill: RED_FILL   }, // G col 7
    { header: "course_id",    width: 38, fill: RED_FILL   }, // H col 8
    { header: "tee_box_id",   width: 38, fill: RED_FILL   }, // I col 9
    { header: "tee_found",    width: 14, fill: RED_FILL   }, // J col 10
    { header: "tee_slope",    width: 10, fill: RED_FILL   }, // K col 11
    { header: "tee_rating",   width: 10, fill: RED_FILL   }, // L col 12
    { header: "tee_par",      width: 10, fill: RED_FILL   }, // M col 13
    { header: "round_key",    width: 30, fill: RED_FILL   }, // N col 14
  ];

  ER_COLS.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

  type CellVal = string | number | null | { formula: string };
  const rows: CellVal[][] = [];
  for (let i = 0; i < EVENT_ROUNDS_DATA_ROWS; i++) {
    const r = i + 2;
    rows.push([
      null, null, null, null, null, null, // A-F user input
      fx(`IFERROR(XLOOKUP(A${r},Competitions!$A:$A,Competitions!$L:$L),"")`),            // G event_id
      fx(`IFERROR(XLOOKUP(E${r},_Courses!$B:$B,_Courses!$A:$A),"")`),                    // H course_id
      fx(`IFERROR(XLOOKUP(H${r}&"|"&F${r},_TeeBoxes!$D:$D,_TeeBoxes!$A:$A),"")`),       // I tee_box_id
      fx(`IF(A${r}="","",IF(I${r}<>"","✓ Found","✗ Not found"))`),                       // J tee_found
      fx(`IFERROR(XLOOKUP(I${r},_TeeBoxes!$A:$A,_TeeBoxes!$F:$F),"")`),                 // K tee_slope
      fx(`IFERROR(XLOOKUP(I${r},_TeeBoxes!$A:$A,_TeeBoxes!$E:$E),"")`),                 // L tee_rating
      fx(`IFERROR(XLOOKUP(I${r},_TeeBoxes!$A:$A,_TeeBoxes!$G:$G),"")`),                 // M tee_par
      fx(`IF(A${r}="","",A${r}&"|"&IF(B${r}="","",B${r}))`),                             // N round_key
    ]);
  }

  ws.addTable({
    name: "EventRoundsImport",
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium1", showRowStripes: true } as any,
    columns: ER_COLS.map(col => ({ name: col.header, filterButton: true })),
    rows: rows as any,
  });

  const headerRow = ws.getRow(1);
  ER_COLS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.fill = col.fill; cell.font = { bold: true }; cell.alignment = { horizontal: "center" };
  });

  for (let row = 2; row <= EVENT_ROUNDS_DATA_ROWS + 1; row++) {
    for (let col = 7; col <= 14; col++) ws.getCell(row, col).fill = LIGHT_RED;
  }

  const compEnd = COMP_DATA_ROWS + 1;
  applyListValidation(ws, 1, 2, EVENT_ROUNDS_DATA_ROWS + 1, `Competitions!$A$2:$A$${compEnd}`);
  applyListValidation(ws, 5, 2, EVENT_ROUNDS_DATA_ROWS + 1, `_Courses!$B$2:$B$2001`);

  // Round Number — whole ≥ 1
  for (let row = 2; row <= EVENT_ROUNDS_DATA_ROWS + 1; row++) {
    ws.getCell(row, 2).dataValidation = {
      type: "whole", operator: "greaterThanOrEqual", formulae: [1],
      allowBlank: true, showErrorMessage: false,
    };
    // Tee Name — cascading INDIRECT on course_id (col H)
    ws.getCell(row, 6).dataValidation = {
      type: "list", allowBlank: true,
      formulae: [`INDIRECT("tees_"&SUBSTITUTE(H${row},"-","_"))`],
      showErrorMessage: false,
    };
  }

  // Conditional format: tee_found (col J = 10)
  ws.addConditionalFormatting({
    ref: `J2:J${EVENT_ROUNDS_DATA_ROWS + 1}`,
    rules: [
      { type: "containsText", operator: "containsText", text: "✓",
        style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF92D050" } } }, priority: 1 } as any,
      { type: "containsText", operator: "containsText", text: "✗",
        style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFDDDD" } } }, priority: 2 } as any,
    ],
  });

  ws.views = [{ state: "frozen", ySplit: 1 }];
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
      fx(`IFERROR(XLOOKUP(A${r},Competitions!$A:$A,Competitions!$L:$L),"")`), // I event_id
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
      fx(`IFERROR(XLOOKUP(A${r},Competitions!$A:$A,Competitions!$L:$L),"")`), // H event_id
      fx(`IFERROR(XLOOKUP(C${r},_Members!$C:$C,_Members!$A:$A,XLOOKUP(C${r},_Members!$B:$B,_Members!$A:$A,"")),"")`), // I profile_id
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

// ── Charges sheet ─────────────────────────────────────────────────────────────
// Per-player event billing (green fees, buggies, food…). One row per charge —
// leave Player blank to assign it to EVERY player who scored the event, or add
// per-player rows (which also override the all-entrants assignment).
// A  Event Name            GREEN  dropdown: Competitions!$A
// B  Charge Name           GREEN  e.g. 'Green fee', 'Buggy'
// C  Category              GREEN  dropdown: green_fee/buggy/food/drink/other
// D  Amount                GREEN  default amount per player
// E  Player Email or Name  AMBER  blank = applies to all entrants
// F  Amount Override       AMBER  per-player amount (explicit player rows only)
// G  Paid                  AMBER  Yes/No (default Yes) — Yes creates a settling payment
// H  Note                  AMBER
// I  event_id              RED
// J  profile_id            RED

const CHARGE_CATEGORIES = ["green_fee", "buggy", "food", "drink", "other"];

function buildChargesSheet(wb: ExcelJS.Workbook, memberCount: number) {
  const ws = wb.addWorksheet("Charges");
  ws.properties.tabColor = { argb: "FFB4A7D6" };

  const CHARGE_COLS: Array<{ header: string; width: number; fill: Fill }> = [
    { header: "Event Name",           width: 30, fill: GREEN_FILL }, // A col 1
    { header: "Charge Name",          width: 24, fill: GREEN_FILL }, // B col 2
    { header: "Category",             width: 14, fill: GREEN_FILL }, // C col 3
    { header: "Amount",               width: 12, fill: GREEN_FILL }, // D col 4
    { header: "Player Email or Name", width: 28, fill: AMBER_FILL }, // E col 5
    { header: "Amount Override",      width: 16, fill: AMBER_FILL }, // F col 6
    { header: "Paid",                 width: 8,  fill: AMBER_FILL }, // G col 7
    { header: "Note",                 width: 28, fill: AMBER_FILL }, // H col 8
    { header: "event_id",             width: 38, fill: RED_FILL   }, // I col 9
    { header: "profile_id",           width: 38, fill: RED_FILL   }, // J col 10
  ];

  CHARGE_COLS.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

  type CellVal = string | number | null | { formula: string };
  const rows: CellVal[][] = [];
  for (let i = 0; i < CHARGE_DATA_ROWS; i++) {
    const r = i + 2;
    rows.push([
      null, null, null, null, null, null, null, null, // A-H input
      fx(`IFERROR(XLOOKUP(A${r},Competitions!$A:$A,Competitions!$L:$L),"")`), // I event_id
      fx(`IF(E${r}="","",IFERROR(XLOOKUP(E${r},_Members!$C:$C,_Members!$A:$A,XLOOKUP(E${r},_Members!$B:$B,_Members!$A:$A,"")),""))`), // J profile_id
    ]);
  }

  ws.addTable({
    name: "ChargesImport",
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium4", showRowStripes: true } as any,
    columns: CHARGE_COLS.map(col => ({ name: col.header, filterButton: true })),
    rows: rows as any,
  });

  const headerRow = ws.getRow(1);
  CHARGE_COLS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.fill = col.fill; cell.font = { bold: true }; cell.alignment = { horizontal: "center" };
  });

  for (let row = 2; row <= CHARGE_DATA_ROWS + 1; row++) {
    ws.getCell(row, 9).fill = LIGHT_RED;
    ws.getCell(row, 10).fill = LIGHT_RED;
  }

  const compEnd   = COMP_DATA_ROWS + 1;
  const memberEnd = Math.max(memberCount + 1, 2);
  applyListValidation(ws, 1, 2, CHARGE_DATA_ROWS + 1, `Competitions!$A$2:$A$${compEnd}`);
  applyListValidation(ws, 3, 2, CHARGE_DATA_ROWS + 1, `"${CHARGE_CATEGORIES.join(",")}"`);
  applyListValidation(ws, 5, 2, CHARGE_DATA_ROWS + 1, `_Members!$B$2:$B$${memberEnd}`);
  applyListValidation(ws, 7, 2, CHARGE_DATA_ROWS + 1, `"Yes,No"`);

  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// ── Payments sheet ────────────────────────────────────────────────────────────
// Standalone payments settling a member's balance. Leave Amount blank to
// auto-settle their outstanding imported debits for the event (or whole group
// balance when Event Name is blank too).
// A  Player Email or Name GREEN  dropdown
// B  Event Name           AMBER  blank = group-level payment
// C  Amount               AMBER  blank = auto-settle outstanding
// D  Payment Date         AMBER  YYYY-MM-DD; blank = event date
// E  Note                 AMBER
// F  event_id             RED
// G  profile_id           RED

function buildPaymentsSheet(wb: ExcelJS.Workbook, memberCount: number) {
  const ws = wb.addWorksheet("Payments");
  ws.properties.tabColor = { argb: "FF93C47D" };

  const PAYMENT_COLS: Array<{ header: string; width: number; fill: Fill }> = [
    { header: "Player Email or Name", width: 28, fill: GREEN_FILL }, // A col 1
    { header: "Event Name",           width: 30, fill: AMBER_FILL }, // B col 2
    { header: "Amount",               width: 12, fill: AMBER_FILL }, // C col 3
    { header: "Payment Date",         width: 14, fill: AMBER_FILL }, // D col 4
    { header: "Note",                 width: 28, fill: AMBER_FILL }, // E col 5
    { header: "event_id",             width: 38, fill: RED_FILL   }, // F col 6
    { header: "profile_id",           width: 38, fill: RED_FILL   }, // G col 7
  ];

  PAYMENT_COLS.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

  type CellVal = string | number | null | { formula: string };
  const rows: CellVal[][] = [];
  for (let i = 0; i < PAYMENT_DATA_ROWS; i++) {
    const r = i + 2;
    rows.push([
      null, null, null, null, null, // A-E input
      fx(`IF(B${r}="","",IFERROR(XLOOKUP(B${r},Competitions!$A:$A,Competitions!$L:$L),""))`), // F event_id
      fx(`IFERROR(XLOOKUP(A${r},_Members!$C:$C,_Members!$A:$A,XLOOKUP(A${r},_Members!$B:$B,_Members!$A:$A,"")),"")`), // G profile_id
    ]);
  }

  ws.addTable({
    name: "PaymentsImport",
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium6", showRowStripes: true } as any,
    columns: PAYMENT_COLS.map(col => ({ name: col.header, filterButton: true })),
    rows: rows as any,
  });

  const headerRow = ws.getRow(1);
  PAYMENT_COLS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.fill = col.fill; cell.font = { bold: true }; cell.alignment = { horizontal: "center" };
  });

  for (let row = 2; row <= PAYMENT_DATA_ROWS + 1; row++) {
    ws.getCell(row, 6).fill = LIGHT_RED;
    ws.getCell(row, 7).fill = LIGHT_RED;
  }

  const compEnd   = COMP_DATA_ROWS + 1;
  const memberEnd = Math.max(memberCount + 1, 2);
  applyListValidation(ws, 1, 2, PAYMENT_DATA_ROWS + 1, `_Members!$B$2:$B$${memberEnd}`);
  applyListValidation(ws, 2, 2, PAYMENT_DATA_ROWS + 1, `Competitions!$A$2:$A$${compEnd}`);

  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// ── Playoffs sheet ────────────────────────────────────────────────────────────
// Resolved ties: one row per tied player, with the final position after the
// playoff/countback. The player with Final Position 1 is recorded as the winner.
// A  Event Name      GREEN  dropdown: Competitions!$A
// B  Resolution Type GREEN  dropdown: playoff / countback
// C  Player          GREEN  dropdown, one row per tied player
// D  Final Position  GREEN  whole ≥ 1 — exactly one row per event must be 1
// E  Note            AMBER
// F  event_id        RED
// G  profile_id      RED

function buildPlayoffsSheet(wb: ExcelJS.Workbook, memberCount: number) {
  const ws = wb.addWorksheet("Playoffs");
  ws.properties.tabColor = { argb: "FFE06666" };

  const PLAYOFF_COLS: Array<{ header: string; width: number; fill: Fill }> = [
    { header: "Event Name",           width: 30, fill: GREEN_FILL }, // A col 1
    { header: "Resolution Type",      width: 16, fill: GREEN_FILL }, // B col 2
    { header: "Player Email or Name", width: 28, fill: GREEN_FILL }, // C col 3
    { header: "Final Position",       width: 14, fill: GREEN_FILL }, // D col 4
    { header: "Note",                 width: 28, fill: AMBER_FILL }, // E col 5
    { header: "event_id",             width: 38, fill: RED_FILL   }, // F col 6
    { header: "profile_id",           width: 38, fill: RED_FILL   }, // G col 7
  ];

  PLAYOFF_COLS.forEach((col, i) => { ws.getColumn(i + 1).width = col.width; });

  type CellVal = string | number | null | { formula: string };
  const rows: CellVal[][] = [];
  for (let i = 0; i < PLAYOFF_DATA_ROWS; i++) {
    const r = i + 2;
    rows.push([
      null, null, null, null, null, // A-E input
      fx(`IFERROR(XLOOKUP(A${r},Competitions!$A:$A,Competitions!$L:$L),"")`), // F event_id
      fx(`IFERROR(XLOOKUP(C${r},_Members!$C:$C,_Members!$A:$A,XLOOKUP(C${r},_Members!$B:$B,_Members!$A:$A,"")),"")`), // G profile_id
    ]);
  }

  ws.addTable({
    name: "PlayoffsImport",
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium3", showRowStripes: true } as any,
    columns: PLAYOFF_COLS.map(col => ({ name: col.header, filterButton: true })),
    rows: rows as any,
  });

  const headerRow = ws.getRow(1);
  PLAYOFF_COLS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.fill = col.fill; cell.font = { bold: true }; cell.alignment = { horizontal: "center" };
  });

  for (let row = 2; row <= PLAYOFF_DATA_ROWS + 1; row++) {
    ws.getCell(row, 6).fill = LIGHT_RED;
    ws.getCell(row, 7).fill = LIGHT_RED;
  }

  const compEnd   = COMP_DATA_ROWS + 1;
  const memberEnd = Math.max(memberCount + 1, 2);
  applyListValidation(ws, 1, 2, PLAYOFF_DATA_ROWS + 1, `Competitions!$A$2:$A$${compEnd}`);
  applyListValidation(ws, 2, 2, PLAYOFF_DATA_ROWS + 1, `"playoff,countback"`);
  applyListValidation(ws, 3, 2, PLAYOFF_DATA_ROWS + 1, `_Members!$B$2:$B$${memberEnd}`);

  for (let row = 2; row <= PLAYOFF_DATA_ROWS + 1; row++) {
    ws.getCell(row, 4).dataValidation = {
      type: "whole", operator: "greaterThanOrEqual", formulae: [1],
      allowBlank: true, showErrorMessage: false,
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
    // ExcelJS signature is add(location, name) — location FIRST. Reversed args
    // here silently produced no usable named ranges (broken tee dropdowns).
    wb.definedNames.add(`_TeeBoxes!$B$${range.start}:$B$${range.end}`, safeName);
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
