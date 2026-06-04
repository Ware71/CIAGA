import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// ── Fill colours ──────────────────────────────────────────────────────────────
type Fill = ExcelJS.Fill;

const GREEN_FILL: Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF92D050" } };
const AMBER_FILL: Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC000" } };
const RED_FILL:   Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFF6B6B" } };
const LIGHT_RED:  Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFDDDD" } };

// ── Column definitions (A–P) ──────────────────────────────────────────────────
//   Green  = mandatory user input  (A–G)
//   Amber  = optional              (H–K)
//   Red    = formula / auto        (L–P)
const IMPORT_COLS = [
  { header: "Player Name or Email", width: 26, fill: GREEN_FILL },  // A
  { header: "Course Name",          width: 28, fill: GREEN_FILL },  // B
  { header: "Tee Name",             width: 14, fill: GREEN_FILL },  // C
  { header: "hole_number",          width: 13, fill: GREEN_FILL },  // D
  { header: "strokes",              width:  9, fill: GREEN_FILL },  // E
  { header: "round_key",            width: 15, fill: GREEN_FILL },  // F
  { header: "played_at",            width: 13, fill: GREEN_FILL },  // G
  { header: "handicap_index",       width: 16, fill: AMBER_FILL }, // H
  { header: "role",                 width: 10, fill: AMBER_FILL }, // I
  { header: "status",               width: 11, fill: AMBER_FILL }, // J
  { header: "visibility",           width: 13, fill: AMBER_FILL }, // K
  { header: "profile_id",           width: 38, fill: RED_FILL   }, // L  ← XLOOKUP(A)
  { header: "display_name",         width: 22, fill: RED_FILL   }, // M  ← XLOOKUP(A)
  { header: "course_id",            width: 38, fill: RED_FILL   }, // N  ← XLOOKUP(B)
  { header: "round_name",           width: 34, fill: RED_FILL   }, // O  ← formula(B,G)
  { header: "tee_box_id",           width: 38, fill: RED_FILL   }, // P  ← XLOOKUP(N,C)
] as const;

const DATA_ROWS = 200;

async function fetchAllRows<T>(
  query: () => ReturnType<ReturnType<typeof getSupabaseAdmin>["from"]>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await (query() as any).range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

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

    // Paginate all lookup data to bypass PostgREST's server-side max-rows cap
    const [courses, teeBoxes, profiles] = await Promise.all([
      fetchAllRows<{ id: string; name: string; city: string | null; country: string | null }>(
        () => admin.from("courses").select("id,name,city,country").order("name"),
      ),
      fetchAllRows<{ id: string; name: string; course_id: string }>(
        () => admin.from("course_tee_boxes").select("id,name,course_id").order("sort_order"),
      ),
      fetchAllRows<{ id: string; name: string; email: string | null }>(
        () => admin.from("profiles").select("id,name,email").order("name"),
      ),
    ]);

    // ── Build workbook ────────────────────────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator  = "CIAGA Admin";
    wb.created  = new Date();

    buildGuideSheet(wb);
    buildImportSheet(wb);
    buildLookupSheets(wb, courses, teeBoxes, profiles);

    const buf = await wb.xlsx.writeBuffer();

    return new Response(new Uint8Array(buf as ArrayBuffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="bulk-rounds-template.xlsx"',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}

// ── Guide sheet ───────────────────────────────────────────────────────────────

function buildGuideSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet("Guide");
  ws.properties.tabColor = { argb: "FF0070C0" };

  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 62;
  ws.getColumn(3).width = 18;
  ws.getColumn(4).width = 12;

  let r = 1;

  // Title
  ws.mergeCells(`A${r}:D${r}`);
  const titleCell = ws.getCell(r, 1);
  titleCell.value = "Bulk Round Import — User Guide";
  titleCell.font  = { bold: true, size: 14, color: { argb: "FF1F497D" } };
  ws.getRow(r).height = 24;
  r++;

  r = addBlank(ws, r);

  // Overview
  r = addSection(ws, r, "Overview");
  r = addText(ws, r, "This template lets you bulk-import golf round scores into CIAGA.");
  r = addText(ws, r, "Each row represents one hole score for one player in one round.");
  r = addText(ws, r, "You need 18 rows per player per round — one row per hole.");

  r = addBlank(ws, r);

  // Colour Legend
  r = addSection(ws, r, "Colour Legend");
  const legend: [Fill, string, string][] = [
    [GREEN_FILL, "GREEN columns", "You must fill these in (mandatory)"],
    [AMBER_FILL, "AMBER columns", "Optional — leave blank to use the default value"],
    [RED_FILL,   "RED columns",   "Auto-filled by formula — do NOT type in these cells"],
  ];
  for (const [fill, label, desc] of legend) {
    const cell1 = ws.getCell(r, 1);
    cell1.value = label;
    cell1.fill  = fill;
    cell1.font  = { bold: true };
    ws.mergeCells(`B${r}:D${r}`);
    ws.getCell(r, 2).value = desc;
    r++;
  }

  r = addBlank(ws, r);

  // Step-by-step
  r = addSection(ws, r, "Step-by-Step Workflow");
  const steps = [
    "1.  Fill in all GREEN columns for every row of data.",
    "2.  Check the RED formula columns — they should show UUIDs, not blank cells.",
    "3.  Use the same round_key value for every row that belongs to the same round.",
    "4.  Enter 18 rows per player (one per hole). Multiple players share the same round_key.",
    "5.  Save as CSV (UTF-8): Excel → File → Save As → CSV UTF-8 (*.csv).",
    "6.  On the Bulk Load admin page, upload the saved CSV file and click Preview, then Import.",
  ];
  for (const step of steps) {
    ws.mergeCells(`A${r}:D${r}`);
    const cell = ws.getCell(r, 1);
    cell.value  = step;
    cell.alignment = { indent: 1 };
    r++;
  }

  r = addBlank(ws, r);

  // Column reference table
  r = addSection(ws, r, "Column Reference");

  // Header row
  const hdr = ws.getRow(r);
  ["Column", "Description", "Example", "Colour"].forEach((v, i) => {
    const c = hdr.getCell(i + 1);
    c.value = v;
    c.font  = { bold: true };
    c.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
    c.border = { bottom: { style: "thin" } };
  });
  r++;

  const lightFill: Record<string, Fill> = {
    Green: { type: "pattern", pattern: "solid", fgColor: { argb: "FFCCFFCC" } },
    Amber: { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } },
    Red:   { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFCCCC" } },
  };

  const colRef: [string, string, string, string][] = [
    ["Player Name or Email", "Full player name or email — must match a registered profile",       "John Smith",     "Green"],
    ["Course Name",           "Exact course name as it appears in the system (case-sensitive)",    "Wentworth West", "Green"],
    ["Tee Name",              "Tee colour/name as it appears for that course (case-sensitive)",    "White",          "Green"],
    ["hole_number",           "Hole number 1 through 18",                                         "1",              "Green"],
    ["strokes",               "Shots taken on this hole (integer 0–30)",                          "4",              "Green"],
    ["round_key",             "Unique code grouping all rows into one round — you choose it",      "round_001",      "Green"],
    ["played_at",             "Date the round was played, in YYYY-MM-DD format",                  "2024-06-15",     "Green"],
    ["handicap_index",        "Player handicap at time of play (optional numeric)",               "12.4",           "Amber"],
    ["role",                  "player / scorer / owner — defaults to player",                     "player",         "Amber"],
    ["status",                "draft / live / finished — defaults to finished",                   "finished",       "Amber"],
    ["visibility",            "private / link / public — defaults to private",                    "private",        "Amber"],
    ["profile_id",            "Auto-resolved UUID from Player Name or Email — do not edit",       "(auto)",         "Red"],
    ["display_name",          "Auto-resolved display name — do not edit",                         "(auto)",         "Red"],
    ["course_id",             "Auto-resolved UUID from Course Name — do not edit",                "(auto)",         "Red"],
    ["round_name",            "Auto-generated from Course + Date — do not edit",                  "(auto)",         "Red"],
    ["tee_box_id",            "Auto-resolved UUID from Course + Tee Name — do not edit",          "(auto)",         "Red"],
  ];

  for (const [name, desc, ex, colour] of colRef) {
    const row = ws.getRow(r);
    row.getCell(1).value = name;
    row.getCell(1).fill  = lightFill[colour];
    row.getCell(1).font  = { bold: true };
    row.getCell(2).value = desc;
    row.getCell(3).value = ex;
    row.getCell(4).value = colour;
    r++;
  }

  r = addBlank(ws, r);

  // Troubleshooting
  r = addSection(ws, r, "Troubleshooting");
  const troubles: [string, string][] = [
    ['"Unknown course_id"',    "Course Name in column B doesn't match any course. Check spelling exactly."],
    ['"Unknown tee_box_id"',   "Tee Name in column C doesn't match any tee for that course. Check spelling."],
    ['"Email not found"',      "Player Name/Email in column A isn't registered in the system."],
    ["RED cell is blank",      "XLOOKUP couldn't find a match — recheck the value in the GREEN input column."],
    ["#N/A in RED cell",       "Formula cannot run — check the GREEN column isn't empty."],
  ];
  const tblHdr = ws.getRow(r);
  ["Error / Symptom", "Cause & Fix"].forEach((v, i) => {
    tblHdr.getCell(i + 1).value = v;
    tblHdr.getCell(i + 1).font  = { bold: true };
  });
  r++;
  for (const [err, fix] of troubles) {
    ws.getCell(r, 1).value = err;
    ws.getCell(r, 1).font  = { italic: true };
    ws.mergeCells(`B${r}:D${r}`);
    ws.getCell(r, 2).value = fix;
    r++;
  }

  r = addBlank(ws, r);

  // Notes
  r = addSection(ws, r, "Notes");
  r = addText(ws, r, "Requires Excel 365 or Excel 2019+ for the XLOOKUP formulas to work.");
  r = addText(ws, r, "Lookup data (courses, tees, players) is embedded when the template is downloaded.");
  r = addText(ws, r, "If courses or players are added after download, regenerate the template.");
  r = addText(ws, r, "The lookup data always comes from the same environment the import writes to.");
}

function addSection(ws: ExcelJS.Worksheet, r: number, title: string): number {
  ws.mergeCells(`A${r}:D${r}`);
  const cell = ws.getCell(r, 1);
  cell.value = title;
  cell.font  = { bold: true, size: 12, color: { argb: "FF1F497D" } };
  return r + 1;
}

function addText(ws: ExcelJS.Worksheet, r: number, text: string): number {
  ws.mergeCells(`A${r}:D${r}`);
  const cell = ws.getCell(r, 1);
  cell.value     = text;
  cell.alignment = { indent: 1 };
  return r + 1;
}

function addBlank(ws: ExcelJS.Worksheet, r: number): number {
  ws.getRow(r); // touch to ensure row exists
  return r + 1;
}

// ── Import sheet ──────────────────────────────────────────────────────────────

function buildImportSheet(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet("Import");
  ws.properties.tabColor = { argb: "FF00B050" };

  // Column widths
  IMPORT_COLS.forEach((col, i) => {
    ws.getColumn(i + 1).width = col.width;
  });

  // Build 200 data rows — null for user-input cells, formula objects for auto cells
  type CellVal = string | number | null | { formula: string };
  const rows: CellVal[][] = [];

  for (let i = 0; i < DATA_ROWS; i++) {
    const r = i + 2; // row 1 is the header
    rows.push([
      null,        // A  Player Name or Email
      null,        // B  Course Name
      null,        // C  Tee Name
      null,        // D  Hole Number
      null,        // E  Strokes
      null,        // F  round_key
      null,        // G  played_at
      null,        // H  handicap_index
      "player",    // I  role
      "finished",  // J  status
      "private",   // K  visibility
      { formula: `IFERROR(XLOOKUP(A${r},Profiles!$B:$B,Profiles!$A:$A,XLOOKUP(A${r},Profiles!$C:$C,Profiles!$A:$A,"")),"")` }, // L profile_id
      { formula: `IFERROR(XLOOKUP(A${r},Profiles!$B:$B,Profiles!$B:$B,A${r}),"")` },                                            // M display_name
      { formula: `IFERROR(XLOOKUP(B${r},Courses!$B:$B,Courses!$A:$A),"")` },                                                    // N course_id
      { formula: `IF(AND(B${r}<>"",G${r}<>""),B${r}&" — "&TEXT(G${r},"DD MMM YYYY"),"")` },                                // O round_name
      { formula: `IFERROR(XLOOKUP(N${r}&"|"&C${r},TeeBoxes!$D:$D,TeeBoxes!$A:$A),"")` },                                       // P tee_box_id
    ]);
  }

  // Create the Excel Table
  ws.addTable({
    name: "RoundsImport",
    ref: "A1",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleMedium2", showRowStripes: true } as any,
    columns: IMPORT_COLS.map(col => ({ name: col.header, filterButton: true })),
    rows: rows as any,
  });

  // Apply header fills + bold
  const headerRow = ws.getRow(1);
  IMPORT_COLS.forEach((col, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.fill      = col.fill;
    cell.font      = { bold: true };
    cell.alignment = { horizontal: "center", wrapText: false };
  });

  // Light-red tint on formula data cells (cols L–P = 12–16) to signal "don't type here"
  for (let row = 2; row <= DATA_ROWS + 1; row++) {
    for (let col = 12; col <= 16; col++) {
      ws.getCell(row, col).fill = LIGHT_RED;
    }
  }

  // Freeze header row
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// ── Hidden lookup sheets ──────────────────────────────────────────────────────

function buildLookupSheets(
  wb: ExcelJS.Workbook,
  courses:  { id: string; name: string; city: string | null; country: string | null }[],
  teeBoxes: { id: string; name: string; course_id: string }[],
  profiles: { id: string; name: string; email: string | null }[],
) {
  const wsCourses = wb.addWorksheet("Courses");
  wsCourses.state = "hidden";
  wsCourses.addRow(["id", "name", "city", "country"]);
  courses.forEach(c => wsCourses.addRow([c.id, c.name, c.city ?? "", c.country ?? ""]));

  const wsTeeBoxes = wb.addWorksheet("TeeBoxes");
  wsTeeBoxes.state = "hidden";
  wsTeeBoxes.addRow(["id", "name", "course_id", "key"]);
  teeBoxes.forEach(t => wsTeeBoxes.addRow([t.id, t.name, t.course_id, `${t.course_id}|${t.name}`]));

  const wsProfiles = wb.addWorksheet("Profiles");
  wsProfiles.state = "hidden";
  wsProfiles.addRow(["id", "name", "email"]);
  profiles.forEach(p => wsProfiles.addRow([p.id, p.name, p.email ?? ""]));
}
