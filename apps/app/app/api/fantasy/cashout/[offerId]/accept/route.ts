import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { acceptCashout } from "@/lib/fantasy/cashout";
import { PickError } from "@/lib/fantasy/picks";

export const runtime = "nodejs";

// POST /api/fantasy/cashout/[offerId]/accept — accept a cash-out offer.
// The RPC revalidates expiry, pick state, pick version and event version;
// any movement since the quote invalidates the offer.
export async function POST(req: Request, { params }: { params: Promise<{ offerId: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { offerId } = await params;
    const { value } = await acceptCashout({ profileId, offerId });
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
