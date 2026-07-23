import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventLeagueTable } from "@/lib/majors/eventDetailQueries";

export const runtime = "nodejs";

// GET /api/majors/competitions/[id]/league-table — get matchplay league table
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const data = await getEventLeagueTable(id);

    return NextResponse.json(
      { entries: data },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
