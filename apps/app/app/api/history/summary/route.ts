import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getRoundHistorySummary } from "@/lib/rounds/historySummary";

export const runtime = "nodejs";

// GET /api/history/summary?profile_id=<id>
//
// Whole-career finished-round summary for the history screen, in one call.
// Requires a signed-in caller; `profile_id` defaults to the caller's own
// profile. Viewing another player's finished history (the ?profile= path on the
// history page) is existing behaviour — finished rounds are viewable in-app.
export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const target = new URL(req.url).searchParams.get("profile_id")?.trim() || profileId;

    const rounds = await getRoundHistorySummary(target);

    return NextResponse.json({ rounds }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = /unauthor|bearer|token/i.test(String(msg)) ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
