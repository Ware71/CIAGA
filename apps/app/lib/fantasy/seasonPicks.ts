import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { seasonMarketLabel } from "@/lib/fantasy/seasonOdds";
import { estimateSeasonCashouts } from "@/lib/fantasy/seasonCashout";

/**
 * The viewer's season-long picks (winner / top-N in the standings), for the
 * My Picks list. Parallel to getMyPicks / getMyParlays but over the separate
 * season tables. `cashout_estimate` is the indicative on-book value for open
 * picks (see estimateSeasonCashouts); the firm offer is quoted on tap.
 */

export type MySeasonPick = {
  id: string;
  group_id: string;
  group_season_id: string;
  season_market_id: string;
  selection_key: string;
  stake: number;
  decimal_odds: number;
  potential_return: number;
  status: "open" | "won" | "lost" | "void" | "cashed_out";
  cashout_value: number | null;
  cashout_estimate: number | null;
  placed_at: string;
  settled_at: string | null;
  market_label: string;
  selection_label: string;
  season_name: string;
  group_name: string;
};

export async function getMySeasonPicks(profileId: string): Promise<MySeasonPick[]> {
  const { data, error } = await supabaseAdmin
    .from("fantasy_season_picks")
    .select(
      "*, market:fantasy_season_markets(id, market_type, params, status), season:group_seasons(id, name), group:major_groups(id, name)"
    )
    .eq("profile_id", profileId)
    .order("placed_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const rows = (data ?? []) as any[];

  // Selection keys are profile ids → resolve player names for the label.
  const nameIds = new Set<string>();
  for (const row of rows) {
    if (/^[0-9a-f-]{36}$/i.test(row.selection_key)) nameIds.add(row.selection_key);
  }
  const names: Record<string, string> = {};
  if (nameIds.size > 0) {
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, name")
      .in("id", [...nameIds]);
    for (const p of (profs ?? []) as { id: string; name: string | null }[]) {
      names[p.id] = p.name ?? "Player";
    }
  }

  const estimates = await estimateSeasonCashouts(
    rows
      .filter((r) => r.status === "open")
      .map((r) => ({
        id: r.id,
        group_season_id: r.group_season_id,
        season_market_id: r.season_market_id,
        selection_key: r.selection_key,
        potential_return: Number(r.potential_return),
        status: r.status,
        market_status: r.market?.status ?? "open",
      }))
  );

  return rows.map((row) => ({
    id: row.id,
    group_id: row.group_id,
    group_season_id: row.group_season_id,
    season_market_id: row.season_market_id,
    selection_key: row.selection_key,
    stake: Number(row.stake),
    decimal_odds: Number(row.decimal_odds),
    potential_return: Number(row.potential_return),
    status: row.status,
    cashout_value: row.cashout_value != null ? Number(row.cashout_value) : null,
    cashout_estimate: estimates.get(row.id) ?? null,
    placed_at: row.placed_at,
    settled_at: row.settled_at,
    market_label: row.market ? seasonMarketLabel(row.market.market_type, row.market.params) : "Season",
    selection_label: names[row.selection_key] ?? "Player",
    season_name: row.season?.name ?? "Season",
    group_name: row.group?.name ?? "",
  }));
}
