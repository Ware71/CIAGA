import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/seasons?series_id=xxx — list seasons for a series
export async function GET(req: Request) {
  try {
    await getAuthedProfileOrThrow(req);
    const url = new URL(req.url);
    const seriesId = url.searchParams.get("series_id");

    if (!seriesId) {
      return NextResponse.json({ error: "series_id is required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("series_seasons")
      .select("*")
      .eq("series_id", seriesId)
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
