import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { requestCashout } from "@/lib/fantasy/cashout";
import { PickError } from "@/lib/fantasy/picks";

export const runtime = "nodejs";
// Cash-out pricing may run the simulation inline (force-fresh odds).
export const maxDuration = 60;

// POST /api/fantasy/picks/[pickId]/cashout — request a cash-out quote.
// Returns a short-lived offer (≈15s) priced on fresh odds.
export async function POST(req: Request, { params }: { params: Promise<{ pickId: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { pickId } = await params;
    const { offer } = await requestCashout({ profileId, pickId });
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
