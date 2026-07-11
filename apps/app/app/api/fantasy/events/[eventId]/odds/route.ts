import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getGroupRole } from "@/lib/fantasy/wallet";
import { refreshIfStale } from "@/lib/fantasy/odds";
import { rankingBasisFromScoringModel } from "@/lib/fantasy/parlayRules";
import { getMarketDefinition, MARKET_TYPE_ORDER } from "@/lib/fantasy/markets/registry";
import type { FantasyMarket } from "@/lib/fantasy/markets/types";

export const runtime = "nodejs";
// Inline refresh may run the Monte Carlo simulation.
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/fantasy/events/[eventId]/odds — the market board.
// Serves cached snapshots; if odds are stale and past the debounce window,
// this request claims the refresh job and simulates inline (spec's lazy
// refresh). Others see { stale, refreshing } and refetch on the realtime
// fantasy_event_state flip.
export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { eventId } = await params;

    const { data: eventRow, error: eventErr } = await supabaseAdmin
      .from("events")
      .select("id, name, group_id, majors_status, event_date, course_id, scoring_model")
      .eq("id", eventId)
      .maybeSingle();
    if (eventErr) throw eventErr;
    if (!eventRow) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const event = eventRow as {
      id: string; name: string; group_id: string | null; majors_status: string; event_date: string | null;
      course_id: string | null; scoring_model: string | null;
    };
    if (!event.group_id) {
      return NextResponse.json({ error: "Event has no group" }, { status: 400 });
    }

    const role = await getGroupRole(event.group_id, profileId);
    if (!role) return NextResponse.json({ error: "Not a group member" }, { status: 403 });

    const { data: stateRow, error: stateErr } = await supabaseAdmin
      .from("fantasy_event_state")
      .select("*")
      .eq("event_id", eventId)
      .maybeSingle();
    if (stateErr) throw stateErr;

    if (!stateRow) {
      return NextResponse.json(
        {
          generated: false,
          event: { id: event.id, name: event.name, status: event.majors_status, group_id: event.group_id },
          canGenerate: role === "owner" || role === "admin",
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    let refreshing = false;
    const state = stateRow as { odds_stale: boolean; is_final: boolean };
    if (state.odds_stale && !state.is_final) {
      const result = await refreshIfStale(eventId);
      refreshing = !result.refreshed && result.refreshing;
    }

    const [{ data: freshState }, { data: marketData, error: marketErr }, { data: snapData, error: snapErr }] =
      await Promise.all([
        supabaseAdmin.from("fantasy_event_state").select("*").eq("event_id", eventId).single(),
        supabaseAdmin.from("fantasy_markets").select("*").eq("event_id", eventId),
        supabaseAdmin
          .from("fantasy_odds_snapshots")
          .select("id, market_id, selection_key, probability, decimal_odds, event_version, computed_at")
          .eq("event_id", eventId)
          .eq("status", "active"),
      ]);
    if (marketErr) throw marketErr;
    if (snapErr) throw snapErr;

    const markets = (marketData ?? []) as FantasyMarket[];
    const snapshots = (snapData ?? []) as {
      id: string; market_id: string; selection_key: string;
      probability: number; decimal_odds: number; event_version: number; computed_at: string;
    }[];

    // Names for player-scoped markets and player selection keys.
    const nameIds = new Set<string>();
    for (const m of markets) {
      if (m.subject_profile_id) nameIds.add(m.subject_profile_id);
      if (m.opponent_profile_id) nameIds.add(m.opponent_profile_id);
    }
    for (const s of snapshots) {
      if (UUID_RE.test(s.selection_key)) nameIds.add(s.selection_key);
    }
    const names: Record<string, string> = {};
    // Stats for the info popups (PlayerStatsSheet) — one query, keyed by player.
    const playerStats: Record<string, unknown> = {};
    if (nameIds.size > 0) {
      const [{ data: profs }, { data: statRows }] = await Promise.all([
        supabaseAdmin.from("profiles").select("id, name").in("id", [...nameIds]),
        supabaseAdmin
          .from("fantasy_player_profiles")
          .select(
            "profile_id, handicap_index, avg_gross, score_stddev, recent_form, birdies_per_round, eagles_per_round, sample_size, confidence, recent_rounds"
          )
          .eq("group_id", event.group_id)
          .in("profile_id", [...nameIds]),
      ]);
      for (const p of (profs ?? []) as { id: string; name: string | null }[]) {
        names[p.id] = p.name ?? "Player";
      }
      for (const s of (statRows ?? []) as { profile_id: string }[]) {
        playerStats[s.profile_id] = s;
      }
    }

    const snapsByMarket = new Map<string, typeof snapshots>();
    for (const s of snapshots) {
      const list = snapsByMarket.get(s.market_id);
      if (list) list.push(s);
      else snapsByMarket.set(s.market_id, [s]);
    }

    const boardMarkets = markets
      .map((m) => {
        const def = getMarketDefinition(m.market_type);
        if (!def) return null;
        const selections = (snapsByMarket.get(m.id) ?? [])
          .map((s) => ({
            key: s.selection_key,
            label: def.selectionLabel(m, s.selection_key, names),
            probability: Number(s.probability),
            decimal_odds: Number(s.decimal_odds),
            snapshot_id: s.id,
            event_version: s.event_version,
          }))
          .sort((a, b) => b.probability - a.probability);
        return {
          id: m.id,
          market_type: m.market_type,
          group: def.group,
          display_name: def.displayName(m, names),
          status: m.status,
          params: m.params,
          subject_profile_id: m.subject_profile_id,
          opponent_profile_id: m.opponent_profile_id,
          selections,
        };
      })
      .filter(Boolean)
      .sort(
        (a, b) =>
          MARKET_TYPE_ORDER.indexOf(a!.market_type) - MARKET_TYPE_ORDER.indexOf(b!.market_type)
      );

    return NextResponse.json(
      {
        generated: true,
        event: {
          id: event.id,
          name: event.name,
          status: event.majors_status,
          group_id: event.group_id,
          course_id: event.course_id,
          // The sim's ranking basis — the slip needs it to tell which h2h
          // legs can joint-price with finishing legs.
          ranking_basis: rankingBasisFromScoringModel(event.scoring_model),
        },
        state: freshState,
        refreshing,
        markets: boardMarkets,
        names,
        players: playerStats,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
