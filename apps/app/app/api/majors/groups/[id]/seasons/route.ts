import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/groups/[id]/seasons — list seasons for a group
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const { data: seasons, error } = await supabaseAdmin
      .from("group_seasons")
      .select("id, name, start_date, end_date, status")
      .eq("group_id", id)
      .order("start_date", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ seasons: seasons ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
