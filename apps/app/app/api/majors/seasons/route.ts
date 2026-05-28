import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/seasons?competition_id=xxx — list seasons for a competition
export async function GET(req: Request) {
  try {
    await getAuthedProfileOrThrow(req);
    const url = new URL(req.url);
    const competitionId = url.searchParams.get("competition_id");

    if (!competitionId) {
      return NextResponse.json({ error: "competition_id is required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("competition_seasons")
      .select("*")
      .eq("competition_id", competitionId)
      .order("season_year", { ascending: false });

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
