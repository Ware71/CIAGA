import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { PickError } from "@/lib/fantasy/picks";
import { placeSeasonPick } from "@/lib/fantasy/seasonOdds";
import { getGroupRole } from "@/lib/fantasy/wallet";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

// POST /api/fantasy/seasons/[seasonId]/pick — place a season pick.
// Body: { seasonMarketId, selectionKey, snapshotId, stake }
export async function POST(req: Request, { params }: { params: Promise<{ seasonId: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { seasonId } = await params;
    const body = await req.json();
    const { seasonMarketId, selectionKey, snapshotId, stake } = body ?? {};
    if (!seasonMarketId || !selectionKey || !snapshotId) {
      return NextResponse.json({ error: "seasonMarketId, selectionKey and snapshotId are required" }, { status: 400 });
    }

    const { data: marketRow } = await supabaseAdmin
      .from("fantasy_season_markets")
      .select("group_id, group_season_id")
      .eq("id", seasonMarketId)
      .maybeSingle();
    const market = marketRow as { group_id: string; group_season_id: string } | null;
    if (!market || market.group_season_id !== seasonId) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }
    const role = await getGroupRole(market.group_id, profileId);
    if (!role) return NextResponse.json({ error: "Not a group member" }, { status: 403 });

    const { pickId } = await placeSeasonPick({ profileId, seasonMarketId, selectionKey, snapshotId, stake });
    return NextResponse.json({ ok: true, pickId });
  } catch (e: any) {
    if (e instanceof PickError) return NextResponse.json({ error: e.message }, { status: e.status });
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
