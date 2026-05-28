import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/seasons?competition_id=xxx — list seasons for a competition
// GET /api/majors/seasons?group_id=xxx — list all seasons for a group (across competitions)
export async function GET(req: Request) {
  try {
    await getAuthedProfileOrThrow(req);
    const url = new URL(req.url);
    const competitionId = url.searchParams.get("competition_id");
    const groupId = url.searchParams.get("group_id");

    if (!competitionId && !groupId) {
      return NextResponse.json({ error: "competition_id or group_id is required" }, { status: 400 });
    }

    let query = supabaseAdmin
      .from("competition_seasons")
      .select("*, competition:competitions(id, name, group_id)")
      .order("season_year", { ascending: false, nullsFirst: false })
      .order("end_date", { ascending: false, nullsFirst: false });

    if (competitionId) {
      query = query.eq("competition_id", competitionId);
    } else if (groupId) {
      // Filter via the competitions join
      query = query.eq("competition.group_id", groupId);
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json(
      { seasons: data ?? [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
