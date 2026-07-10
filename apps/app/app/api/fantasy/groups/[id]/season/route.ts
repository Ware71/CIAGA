import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getGroupRole } from "@/lib/fantasy/wallet";
import { generateSeasonFantasy } from "@/lib/fantasy/seasonOdds";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildFinishesTable, toPreviewRows, type BoardMarket, type Selection } from "@/lib/fantasy/board/groupBoard";

export const runtime = "nodejs";
export const maxDuration = 60;

type SeasonStateRow = { group_season_id: string; version: number };

async function readState(groupId: string): Promise<SeasonStateRow | null> {
  const { data } = await supabaseAdmin
    .from("fantasy_season_state")
    .select("group_season_id, version")
    .eq("group_id", groupId)
    .eq("is_final", false)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as SeasonStateRow | null) ?? null;
}

// GET /api/fantasy/groups/[id]/season — headline season markets for the coupon.
// Generates on first view for season-budget groups (mirrors the event board's
// lazy-generate pattern). Returns { headline: null } when the group has no
// live season markets (event-budget group, or generation genuinely failed).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: groupId } = await params;
    const role = await getGroupRole(groupId, profileId);
    if (!role) return NextResponse.json({ error: "Not a group member" }, { status: 403 });

    let state = await readState(groupId);
    if (!state) {
      const { data: activeSeason } = await supabaseAdmin
        .from("group_seasons")
        .select("id")
        .eq("group_id", groupId)
        .eq("status", "active")
        .maybeSingle();
      if (activeSeason) {
        try {
          await generateSeasonFantasy((activeSeason as { id: string }).id);
        } catch {
          /* event-budget group, or no season context yet — degrade gracefully */
        }
        state = await readState(groupId);
      }
    }
    if (!state) return NextResponse.json({ headline: null });

    const [{ data: seasonRow }, { data: marketRows }] = await Promise.all([
      supabaseAdmin.from("group_seasons").select("name").eq("id", state.group_season_id).maybeSingle(),
      supabaseAdmin
        .from("fantasy_season_markets")
        .select("id, market_type, params")
        .eq("group_season_id", state.group_season_id)
        .in("market_type", ["season_outright", "season_top_n"]),
    ]);
    const markets = (marketRows ?? []) as { id: string; market_type: string; params: Record<string, unknown> }[];
    if (markets.length === 0) return NextResponse.json({ headline: null });

    const { data: snapRows } = await supabaseAdmin
      .from("fantasy_season_odds_snapshots")
      .select("season_market_id, selection_key, decimal_odds, probability")
      .in("season_market_id", markets.map((m) => m.id))
      .eq("season_version", state.version)
      .eq("status", "active");
    const snaps = (snapRows ?? []) as {
      season_market_id: string; selection_key: string; decimal_odds: number | string; probability: number | string;
    }[];
    if (snaps.length === 0) return NextResponse.json({ headline: null });

    const names: Record<string, string> = {};
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, name")
      .in("id", [...new Set(snaps.map((s) => s.selection_key))]);
    for (const p of (profs ?? []) as { id: string; name: string | null }[]) names[p.id] = p.name ?? "Player";

    // Translate season markets into the board's vocabulary so the same
    // buildFinishesTable helper the event board uses can build the preview.
    const boardMarkets: BoardMarket[] = markets.map((m) => ({
      id: m.id,
      market_type: m.market_type === "season_top_n" ? "top_n" : "outright_winner",
      group: "winner",
      display_name: m.market_type === "season_top_n" ? "Season Top 3" : "Season Winner",
      status: "open",
      params: m.params ?? {},
      subject_profile_id: null,
      opponent_profile_id: null,
      selections: snaps
        .filter((s) => s.season_market_id === m.id)
        .map((s): Selection => ({
          key: s.selection_key,
          label: names[s.selection_key] ?? "Player",
          probability: Number(s.probability),
          decimal_odds: Number(s.decimal_odds),
          snapshot_id: "",
          event_version: state.version,
        })),
    }));

    const table = buildFinishesTable(boardMarkets);
    if (!table) return NextResponse.json({ headline: null });

    return NextResponse.json({
      headline: {
        seasonId: state.group_season_id,
        seasonName: (seasonRow as { name: string } | null)?.name ?? "Season",
        preview: toPreviewRows(table, 3),
      },
    });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
