import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getMySeasonPicks } from "@/lib/fantasy/seasonPicks";

export const runtime = "nodejs";

// GET /api/fantasy/seasons/picks — the caller's season-long picks across groups.
export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const picks = await getMySeasonPicks(profileId);
    return NextResponse.json({ picks }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
