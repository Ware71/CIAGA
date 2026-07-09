import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { priceAcca, type ParlayLegInput } from "@/lib/fantasy/parlays";
import { getGroupRole } from "@/lib/fantasy/wallet";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

// POST /api/fantasy/parlays/price — live combined odds for an acca slip, with
// finishing-position legs jointly priced. Read-only; drives the slip display
// (placement recomputes authoritatively).
// Body: { legs: [{ marketId, selectionKey, snapshotId }] }
export async function POST(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const body = await req.json();
    const legs = Array.isArray(body?.legs) ? (body.legs as ParlayLegInput[]) : [];
    if (legs.length < 2 || legs.some((l) => !l?.marketId || !l?.selectionKey || !l?.snapshotId)) {
      return NextResponse.json(
        { error: "legs[] with marketId, selectionKey and snapshotId are required (min 2)" },
        { status: 400 }
      );
    }

    const { data: marketRow } = await supabaseAdmin
      .from("fantasy_markets")
      .select("group_id")
      .eq("id", legs[0].marketId)
      .maybeSingle();
    const groupId = (marketRow as { group_id: string } | null)?.group_id;
    if (!groupId) return NextResponse.json({ error: "Market not found" }, { status: 404 });
    const role = await getGroupRole(groupId, profileId);
    if (!role) return NextResponse.json({ error: "Not a group member" }, { status: 403 });

    const { combinedOdds, jointPriced } = await priceAcca(legs);
    return NextResponse.json({ combinedOdds, jointPriced }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
