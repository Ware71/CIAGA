import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getMyPicks, placePick, PickError } from "@/lib/fantasy/picks";
import { getGroupRole } from "@/lib/fantasy/wallet";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/fantasy/picks — place a pick.
// Body: { marketId, selectionKey, snapshotId, stake }
// The snapshot must still be active at the current event version — placing
// against stale odds is rejected by the RPC (anti-sniping).
export async function POST(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const body = await req.json();

    const { marketId, selectionKey, snapshotId, stake } = body ?? {};
    if (!marketId || !selectionKey || !snapshotId) {
      return NextResponse.json(
        { error: "marketId, selectionKey and snapshotId are required" },
        { status: 400 }
      );
    }

    // Membership check against the market's group.
    const { data: marketRow } = await supabaseAdmin
      .from("fantasy_markets")
      .select("group_id")
      .eq("id", marketId)
      .maybeSingle();
    const groupId = (marketRow as { group_id: string } | null)?.group_id;
    if (!groupId) return NextResponse.json({ error: "Market not found" }, { status: 404 });
    const role = await getGroupRole(groupId, profileId);
    if (!role) return NextResponse.json({ error: "Not a group member" }, { status: 403 });

    const { pickId } = await placePick({ profileId, marketId, selectionKey, snapshotId, stake });
    return NextResponse.json({ ok: true, pickId });
  } catch (e: any) {
    if (e instanceof PickError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// GET /api/fantasy/picks — the caller's picks across all groups.
export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const picks = await getMyPicks(profileId);
    return NextResponse.json({ picks }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
