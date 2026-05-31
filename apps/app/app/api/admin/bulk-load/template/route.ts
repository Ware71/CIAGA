import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

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

    // Fetch all lookup data in parallel
    const [coursesRes, teeBoxesRes, profilesRes] = await Promise.all([
      admin.from("courses").select("id,name,city,country").order("name"),
      admin.from("course_tee_boxes").select("id,name,course_id").order("sort_order"),
      admin.from("profiles").select("id,name,email").order("name").limit(2000),
    ]);

    if (coursesRes.error) throw new Error(coursesRes.error.message);
    if (teeBoxesRes.error) throw new Error(teeBoxesRes.error.message);
    if (profilesRes.error) throw new Error(profilesRes.error.message);

    const courses = coursesRes.data ?? [];
    const teeBoxes = teeBoxesRes.data ?? [];
    const profiles = profilesRes.data ?? [];

    // ── Lookup sheets ─────────────────────────────────────────────────────────

    const wsCourses = XLSX.utils.aoa_to_sheet([
      ["id", "name", "city", "country"],
      ...courses.map((c) => [c.id, c.name, c.city ?? "", c.country ?? ""]),
    ]);

    const wsTeeBoxes = XLSX.utils.aoa_to_sheet([
      ["id", "name", "course_id", "key"],
      // key = course_id|name — used by the XLOOKUP composite in the Import sheet
      ...teeBoxes.map((t) => [t.id, t.name, t.course_id, `${t.course_id}|${t.name}`]),
    ]);

    const wsProfiles = XLSX.utils.aoa_to_sheet([
      ["id", "name", "email"],
      ...profiles.map((p) => [p.id, p.name, p.email ?? ""]),
    ]);

    // ── Import sheet ──────────────────────────────────────────────────────────

    const headers = [
      "round_key",        // A — admin types
      "Course Name",      // B — admin types
      "course_id",        // C — XLOOKUP
      "played_at",        // D — admin types (YYYY-MM-DD)
      "round_name",       // E — formula
      "Tee Name",         // F — admin types
      "tee_box_id",       // G — XLOOKUP
      "Player Name or Email", // H — admin types
      "profile_id",       // I — XLOOKUP
      "display_name",     // J — XLOOKUP
      "hole_number",      // K — admin types (1–18)
      "strokes",          // L — admin types
      "handicap_index",   // M — optional
      "role",             // N — pre-filled
      "status",           // O — pre-filled
      "visibility",       // P — pre-filled
    ];

    const wsImport = XLSX.utils.aoa_to_sheet([headers]);

    const DATA_ROWS = 20;
    for (let row = 2; row <= DATA_ROWS + 1; row++) {
      wsImport[`C${row}`] = {
        f: `IFERROR(XLOOKUP(B${row},Courses!$B:$B,Courses!$A:$A),"")`,
      };
      wsImport[`E${row}`] = {
        f: `IF(AND(B${row}<>"",D${row}<>""),B${row}&" — "&TEXT(D${row},"DD MMM YYYY"),"")`,
      };
      wsImport[`G${row}`] = {
        f: `IFERROR(XLOOKUP(C${row}&"|"&F${row},TeeBoxes!$D:$D,TeeBoxes!$A:$A),"")`,
      };
      wsImport[`I${row}`] = {
        f: `IFERROR(XLOOKUP(H${row},Profiles!$B:$B,Profiles!$A:$A,XLOOKUP(H${row},Profiles!$C:$C,Profiles!$A:$A,"")),"")`,
      };
      wsImport[`J${row}`] = {
        f: `IFERROR(XLOOKUP(H${row},Profiles!$B:$B,Profiles!$B:$B,H${row}),"")`,
      };
      wsImport[`N${row}`] = { t: "s", v: "player" };
      wsImport[`O${row}`] = { t: "s", v: "finished" };
      wsImport[`P${row}`] = { t: "s", v: "private" };
    }

    wsImport["!ref"] = `A1:P${DATA_ROWS + 1}`;
    wsImport["!cols"] = [
      { wch: 15 }, // A round_key
      { wch: 28 }, // B Course Name
      { wch: 38 }, // C course_id
      { wch: 12 }, // D played_at
      { wch: 32 }, // E round_name
      { wch: 12 }, // F Tee Name
      { wch: 38 }, // G tee_box_id
      { wch: 26 }, // H Player Name or Email
      { wch: 38 }, // I profile_id
      { wch: 20 }, // J display_name
      { wch: 12 }, // K hole_number
      { wch: 8  }, // L strokes
      { wch: 15 }, // M handicap_index
      { wch: 8  }, // N role
      { wch: 10 }, // O status
      { wch: 12 }, // P visibility
    ];

    // ── Workbook ──────────────────────────────────────────────────────────────

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsImport, "Import");
    XLSX.utils.book_append_sheet(wb, wsCourses, "Courses");
    XLSX.utils.book_append_sheet(wb, wsTeeBoxes, "TeeBoxes");
    XLSX.utils.book_append_sheet(wb, wsProfiles, "Profiles");

    // Hide the three lookup sheets
    wb.Workbook = {
      Sheets: [
        { Hidden: 0 }, // Import
        { Hidden: 1 }, // Courses
        { Hidden: 1 }, // TeeBoxes
        { Hidden: 1 }, // Profiles
      ],
    };

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    return new Response(buf, {
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
