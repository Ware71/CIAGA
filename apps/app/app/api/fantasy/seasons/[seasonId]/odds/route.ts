import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getGroupRole } from "@/lib/fantasy/wallet";
import { generateSeasonFantasy, refreshSeasonIfStale, SEASON_TOP_N } from "@/lib/fantasy/seasonOdds";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 60;

function marketLabel(type: string, params: Record<string, unknown>): string {
  if (type === "season_outright") return "Season Winner";
  if (type === "season_top_n") return `Season Top ${Number(params?.n ?? SEASON_TOP_N)}`;
  return type;
}

// GET /api/fantasy/seasons/[seasonId]/odds — season markets board (generates on
// first view for season-budget groups, else re-prices if stale).
export async function GET(req: Request, { params }: { params: Promise<{ seasonId: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { seasonId } = await params;

    const { data: seasonRow } = await supabaseAdmin
      .from("group_seasons")
      .select("id, group_id, name")
      .eq("id", seasonId)
      .maybeSingle();
    const season = seasonRow as { id: string; group_id: string; name: string } | null;
    if (!season) return NextResponse.json({ error: "Season not found" }, { status: 404 });
    const role = await getGroupRole(season.group_id, profileId);
    if (!role) return NextResponse.json({ error: "Not a group member" }, { status: 403 });

    const { data: existing } = await supabaseAdmin
      .from("fantasy_season_state")
      .select("group_season_id")
      .eq("group_season_id", seasonId)
      .maybeSingle();

    let generated = true;
    let genError: string | null = null;
    try {
      if (!existing) await generateSeasonFantasy(seasonId);
      else await refreshSeasonIfStale(seasonId);
    } catch (e: any) {
      generated = false;
      genError = e?.message ?? "Season markets are unavailable";
    }

    const { data: stateRow } = await supabaseAdmin
      .from("fantasy_season_state")
      .select("version, odds_stale, is_final, narrative, last_refreshed_at")
      .eq("group_season_id", seasonId)
      .maybeSingle();
    const state = stateRow as
      | { version: number; odds_stale: boolean; is_final: boolean; narrative: string | null; last_refreshed_at: string | null }
      | null;
    if (!state) {
      return NextResponse.json({ generated: false, error: genError ?? "No season markets", season });
    }

    const [{ data: marketRows }, { data: snapRows }] = await Promise.all([
      supabaseAdmin
        .from("fantasy_season_markets")
        .select("id, market_type, params, status")
        .eq("group_season_id", seasonId)
        .eq("status", "open"),
      supabaseAdmin
        .from("fantasy_season_odds_snapshots")
        .select("id, season_market_id, selection_key, decimal_odds, probability")
        .eq("group_season_id", seasonId)
        .eq("season_version", state.version)
        .eq("status", "active"),
    ]);

    const snaps = (snapRows ?? []) as {
      id: string; season_market_id: string; selection_key: string; decimal_odds: number | string; probability: number | string;
    }[];
    const selectionIds = [...new Set(snaps.map((s) => s.selection_key))];
    const names: Record<string, string> = {};
    if (selectionIds.length > 0) {
      const { data: profs } = await supabaseAdmin.from("profiles").select("id, name").in("id", selectionIds);
      for (const p of (profs ?? []) as { id: string; name: string | null }[]) names[p.id] = p.name ?? "Player";
    }

    const markets = ((marketRows ?? []) as {
      id: string; market_type: string; params: Record<string, unknown>; status: string;
    }[]).map((m) => ({
      id: m.id,
      market_type: m.market_type,
      label: marketLabel(m.market_type, m.params),
      selections: snaps
        .filter((s) => s.season_market_id === m.id)
        .map((s) => ({
          key: s.selection_key,
          label: names[s.selection_key] ?? "Player",
          decimal_odds: Number(s.decimal_odds),
          probability: Number(s.probability),
          snapshot_id: s.id,
        }))
        .sort((a, b) => b.probability - a.probability),
    }));

    return NextResponse.json(
      { generated, error: genError, season, state, markets },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
