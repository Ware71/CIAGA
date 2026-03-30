import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getCompetitionLeaderboard, getGroupStandings } from "@/lib/majors/queries";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await getAuthedProfileOrThrow(req);
    const url = new URL(req.url);

    const competitionId = url.searchParams.get("competition_id");
    const groupId = url.searchParams.get("group_id");

    if (competitionId) {
      const rows = await getCompetitionLeaderboard(competitionId);
      return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store" } });
    }

    if (groupId) {
      const rows = await getGroupStandings(groupId);
      return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ error: "Provide competition_id or group_id" }, { status: 400 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
