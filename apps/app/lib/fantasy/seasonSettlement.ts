import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Settle season markets against the FINAL standings once the season is decided
 * (no constituent event left unplayed). Idempotent via the apply RPC; season
 * outright wins on position 1, season top-N on position ≤ n, no standings
 * row → void. Called from the event-completion hook + a cron safety net.
 */
export async function settleFantasySeason(groupSeasonId: string): Promise<{
  settled: boolean;
  won: number;
  lost: number;
  void: number;
}> {
  const { data: stateRow } = await supabaseAdmin
    .from("fantasy_season_state")
    .select("is_final")
    .eq("group_season_id", groupSeasonId)
    .maybeSingle();
  if (!stateRow || (stateRow as { is_final: boolean }).is_final) {
    return { settled: false, won: 0, lost: 0, void: 0 };
  }

  // Season is only decided when no contributing event is still to be played.
  const { data: remaining } = await supabaseAdmin
    .from("events")
    .select("id")
    .eq("group_season_id", groupSeasonId)
    .in("standings_contribution", ["season", "both"])
    .not("majors_status", "in", '("completed","official","cancelled")')
    .limit(1);
  if ((remaining ?? []).length > 0) {
    return { settled: false, won: 0, lost: 0, void: 0 };
  }

  // Ensure the standings reflect every completed event, then read final places.
  await supabaseAdmin.rpc("ciaga_compute_group_season_standings", { p_group_season_id: groupSeasonId });
  const { data: standRows } = await supabaseAdmin
    .from("group_season_standings_entries")
    .select("profile_id, position")
    .eq("group_season_id", groupSeasonId);
  const finalPos = new Map(
    ((standRows ?? []) as { profile_id: string; position: number | null }[]).map((s) => [s.profile_id, s.position])
  );

  const { data: marketRows } = await supabaseAdmin
    .from("fantasy_season_markets")
    .select("id, market_type, params")
    .eq("group_season_id", groupSeasonId)
    .eq("status", "open");
  const markets = new Map(
    ((marketRows ?? []) as { id: string; market_type: string; params: Record<string, unknown> }[]).map((m) => [m.id, m])
  );

  const { data: pickRows } = await supabaseAdmin
    .from("fantasy_season_picks")
    .select("id, season_market_id, selection_key")
    .eq("group_season_id", groupSeasonId)
    .eq("status", "open");

  const outcomes = ((pickRows ?? []) as { id: string; season_market_id: string; selection_key: string }[]).map((pk) => {
    const market = markets.get(pk.season_market_id);
    const pos = finalPos.get(pk.selection_key) ?? null;
    let outcome: "won" | "lost" | "void";
    if (!market || pos == null) {
      outcome = "void";
    } else if (market.market_type === "season_outright") {
      outcome = pos === 1 ? "won" : "lost";
    } else {
      const n = Number((market.params as { n?: unknown }).n ?? 3);
      outcome = pos <= n ? "won" : "lost";
    }
    return { pick_id: pk.id, outcome };
  });

  const { data: res, error } = await supabaseAdmin.rpc("ciaga_fantasy_apply_season_settlement", {
    p_group_season_id: groupSeasonId,
    p_outcomes: outcomes,
    p_market_ids: [...markets.keys()],
  });
  if (error) throw error;
  const r = (res ?? { won: 0, lost: 0, void: 0 }) as { won: number; lost: number; void: number };
  return { settled: true, won: r.won, lost: r.lost, void: r.void };
}
