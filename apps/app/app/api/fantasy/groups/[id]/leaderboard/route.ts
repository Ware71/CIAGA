import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { readFantasyConfig } from "@/lib/fantasy/config";
import { PNL_TRANSACTION_TYPES } from "@/lib/fantasy/types";
import { getGroupFantasyContext, getGroupRole, resolveWalletScope } from "@/lib/fantasy/wallet";

export const runtime = "nodejs";

// GET /api/fantasy/groups/[id]/leaderboard[?event_id=…]
// PnL rankings for the group's fantasy scope. PnL sums only
// stake/payout/cashout/void_refund rows, so top-ups can't game it.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const role = await getGroupRole(id, profileId);
    if (!role) return NextResponse.json({ error: "Not a group member" }, { status: 403 });

    const ctx = await getGroupFantasyContext(id);
    if (!ctx) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    const config = readFantasyConfig(ctx.fantasyConfig);
    if (!config) {
      return NextResponse.json({ error: "Fantasy picks are not enabled for this group" }, { status: 400 });
    }

    const eventId = new URL(req.url).searchParams.get("event_id");
    const scope =
      config.budgetScope === "event" && eventId
        ? ({ kind: "event", eventId } as const)
        : config.budgetScope === "event"
        ? null // event-scoped group, no event chosen → all-time PnL
        : await resolveWalletScope(id, config);

    let query = supabaseAdmin
      .from("fantasy_wallet_transactions")
      .select("profile_id, amount, type, group_season_id, event_id")
      .eq("group_id", id)
      .in("type", PNL_TRANSACTION_TYPES);
    if (scope?.kind === "season") query = query.eq("group_season_id", scope.groupSeasonId);
    if (scope?.kind === "event") query = query.eq("event_id", scope.eventId);

    const { data: txData, error: txErr } = await query;
    if (txErr) throw txErr;

    const pnlByProfile = new Map<string, { pnl: number; staked: number; picks: number }>();
    for (const tx of (txData ?? []) as { profile_id: string; amount: number; type: string }[]) {
      const row = pnlByProfile.get(tx.profile_id) ?? { pnl: 0, staked: 0, picks: 0 };
      const amount = Number(tx.amount);
      row.pnl += amount;
      if (tx.type === "stake") {
        row.staked += -amount;
        row.picks += 1;
      }
      pnlByProfile.set(tx.profile_id, row);
    }

    const profileIds = [...pnlByProfile.keys()];
    const names: Record<string, { name: string | null; avatar_url: string | null }> = {};
    if (profileIds.length > 0) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, name, avatar_url")
        .in("id", profileIds);
      for (const p of (profs ?? []) as { id: string; name: string | null; avatar_url: string | null }[]) {
        names[p.id] = { name: p.name, avatar_url: p.avatar_url };
      }
    }

    const entries = profileIds
      .map((pid) => {
        const row = pnlByProfile.get(pid)!;
        return {
          profile_id: pid,
          name: names[pid]?.name ?? "Player",
          avatar_url: names[pid]?.avatar_url ?? null,
          pnl: Math.round(row.pnl * 100) / 100,
          staked: Math.round(row.staked * 100) / 100,
          picks: row.picks,
        };
      })
      .sort((a, b) => b.pnl - a.pnl)
      .map((entry, i) => ({ ...entry, position: i + 1 }));

    return NextResponse.json(
      { config, scope: scope?.kind ?? "all_time", entries },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
