import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { requestParlayCashout } from "@/lib/fantasy/parlayCashout";
import { PickError } from "@/lib/fantasy/picks";

export const runtime = "nodejs";
// Cash-out pricing force-refreshes EVERY event with an open leg — a
// multi-event acca runs several simulations inline, sequentially.
export const maxDuration = 60;

// POST /api/fantasy/parlays/[parlayId]/cashout — request an acca cash-out
// quote. Returns a short-lived offer (≈15s) priced on fresh joint odds;
// accepted via the shared /api/fantasy/cashout/[offerId]/accept endpoint.
export async function POST(req: Request, { params }: { params: Promise<{ parlayId: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { parlayId } = await params;
    const { offer } = await requestParlayCashout({ profileId, parlayId });
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
