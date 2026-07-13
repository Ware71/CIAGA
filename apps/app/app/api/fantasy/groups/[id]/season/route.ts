import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getGroupRole } from "@/lib/fantasy/wallet";
import { generateSeasonFantasy, refreshSeasonIfStale } from "@/lib/fantasy/seasonOdds";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildFinishesTable, toPreviewRows, type BoardMarket, type Selection } from "@/lib/fantasy/board/groupBoard";

export const runtime = "nodejs";
export const maxDuration = 60;

type SeasonStateRow = { group_season_id: string; version: number; narrative: string | null };

async function readState(groupId: string): Promise<SeasonStateRow | null> {
  const { data } = await supabaseAdmin
    .from("fantasy_season_state")
    .select("group_season_id, version, narrative")
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
      // Resolve the group's current season and self-generate (mirrors the
      // season-odds route). group_seasons.status is one of upcoming / published
      // / live / completed / archived — there is no "active", so the previous
      // .eq("status","active") NEVER matched and season markets could only
      // appear once the cron had already created state. Prefer an in-progress
      // season (live/published) whose date range contains today, else the most
      // recent one.
      const { data: seasonRows } = await supabaseAdmin
        .from("group_seasons")
        .select("id, start_date, end_date")
        .eq("group_id", groupId)
        .in("status", ["live", "published"]);
      const rows = (seasonRows ?? []) as { id: string; start_date: string | null; end_date: string | null }[];
      const today = new Date().toISOString().slice(0, 10);
      const current =
        rows.find((s) => s.start_date && s.end_date && s.start_date <= today && today <= s.end_date) ??
        [...rows].sort((a, b) => (a.start_date ?? "").localeCompare(b.start_date ?? "")).at(-1) ??
        null;
      if (current) {
        try {
          await generateSeasonFantasy(current.id);
        } catch {
          /* event-budget group, or no season context yet — degrade gracefully */
        }
        state = await readState(groupId);
      }
    } else if (state.narrative == null) {
      // A prior narration attempt failed silently and odds_stale never got
      // set for it (narrative-only failures don't reprice) — give it another
      // shot on this view rather than leaving it null forever.
      try {
        const { refreshed } = await refreshSeasonIfStale(state.group_season_id);
        if (refreshed) state = await readState(groupId);
      } catch {
        /* best-effort — keep serving the existing (narrative-less) headline */
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
        narrative: state.narrative,
      },
    });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
