import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { PickError } from "@/lib/fantasy/picks";
import { getMyParlays, placeParlay, type ParlayLegInput } from "@/lib/fantasy/parlays";
import { getGroupRole } from "@/lib/fantasy/wallet";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/fantasy/parlays — place an accumulator.
// Body: { legs: [{ marketId, selectionKey, snapshotId }], stake }
// Every leg's snapshot must still be active at its event's current version;
// the RPC also enforces the correlation guard (one subject per event).
export async function POST(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const body = await req.json();

    const legs = Array.isArray(body?.legs) ? (body.legs as ParlayLegInput[]) : [];
    if (
      legs.length < 2 ||
      legs.some((l) => !l?.marketId || !l?.selectionKey || !l?.snapshotId)
    ) {
      return NextResponse.json(
        { error: "legs[] with marketId, selectionKey and snapshotId are required (min 2)" },
        { status: 400 }
      );
    }

    // Membership check against the first leg's group (the lib + RPC verify
    // every leg shares that group).
    const { data: marketRow } = await supabaseAdmin
      .from("fantasy_markets")
      .select("group_id")
      .eq("id", legs[0].marketId)
      .maybeSingle();
    const groupId = (marketRow as { group_id: string } | null)?.group_id;
    if (!groupId) return NextResponse.json({ error: "Market not found" }, { status: 404 });
    const role = await getGroupRole(groupId, profileId);
    if (!role) return NextResponse.json({ error: "Not a group member" }, { status: 403 });

    const { parlayId } = await placeParlay({ profileId, legs, stake: body?.stake });
    return NextResponse.json({ ok: true, parlayId });
  } catch (e: any) {
    if (e instanceof PickError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// GET /api/fantasy/parlays — the caller's accumulators across all groups.
export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const parlays = await getMyParlays(profileId);
    return NextResponse.json({ parlays }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
