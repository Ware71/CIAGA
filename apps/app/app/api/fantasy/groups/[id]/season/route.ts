import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getGroupRole } from "@/lib/fantasy/wallet";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

// GET /api/fantasy/groups/[id]/season — headline season market for the coupon.
// Returns { headline: null } when the group has no live season markets.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: groupId } = await params;
    const role = await getGroupRole(groupId, profileId);
    if (!role) return NextResponse.json({ error: "Not a group member" }, { status: 403 });

    const { data: stateRow } = await supabaseAdmin
      .from("fantasy_season_state")
      .select("group_season_id, version")
      .eq("group_id", groupId)
      .eq("is_final", false)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const state = stateRow as { group_season_id: string; version: number } | null;
    if (!state) return NextResponse.json({ headline: null });

    const [{ data: seasonRow }, { data: marketRow }] = await Promise.all([
      supabaseAdmin.from("group_seasons").select("name").eq("id", state.group_season_id).maybeSingle(),
      supabaseAdmin
        .from("fantasy_season_markets")
        .select("id")
        .eq("group_season_id", state.group_season_id)
        .eq("market_type", "season_outright")
        .maybeSingle(),
    ]);
    const market = marketRow as { id: string } | null;
    if (!market) return NextResponse.json({ headline: null });

    const { data: snapRows } = await supabaseAdmin
      .from("fantasy_season_odds_snapshots")
      .select("selection_key, decimal_odds, probability")
      .eq("season_market_id", market.id)
      .eq("season_version", state.version)
      .eq("status", "active")
      .order("probability", { ascending: false })
      .limit(3);
    const snaps = (snapRows ?? []) as { selection_key: string; decimal_odds: number | string }[];
    if (snaps.length === 0) return NextResponse.json({ headline: null });

    const names: Record<string, string> = {};
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, name")
      .in("id", snaps.map((s) => s.selection_key));
    for (const p of (profs ?? []) as { id: string; name: string | null }[]) names[p.id] = p.name ?? "Player";

    return NextResponse.json({
      headline: {
        seasonId: state.group_season_id,
        seasonName: (seasonRow as { name: string } | null)?.name ?? "Season",
        marketLabel: "Season Winner",
        selections: snaps.map((s) => ({
          label: names[s.selection_key] ?? "Player",
          decimal_odds: Number(s.decimal_odds),
        })),
      },
    });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
