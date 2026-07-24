import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { PickError } from "@/lib/fantasy/picks";
import { requestSeasonCashout } from "@/lib/fantasy/seasonCashout";

export const runtime = "nodejs";
// Cash-out pricing may re-price the season inline (fresh odds).
export const maxDuration = 60;

// POST /api/fantasy/seasons/picks/[seasonPickId]/cashout — request a quote.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ seasonPickId: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { seasonPickId } = await params;
    const { offer } = await requestSeasonCashout({ profileId, seasonPickId });
    return NextResponse.json({ offer });
  } catch (e: any) {
    if (e instanceof PickError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
