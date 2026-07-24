import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { PickError } from "@/lib/fantasy/picks";
import { acceptSeasonCashout } from "@/lib/fantasy/seasonCashout";

export const runtime = "nodejs";

// POST /api/fantasy/seasons/cashout/[offerId]/accept — accept a season offer.
// The RPC revalidates expiry, pick state, pick version and season version.
export async function POST(req: Request, { params }: { params: Promise<{ offerId: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { offerId } = await params;
    const { value } = await acceptSeasonCashout({ profileId, offerId });
    return NextResponse.json({ ok: true, value });
  } catch (e: any) {
    if (e instanceof PickError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
