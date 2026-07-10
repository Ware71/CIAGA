import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { readFantasyConfig } from "@/lib/fantasy/config";
import { getWalletSummary, resolveWalletScope } from "@/lib/fantasy/wallet";
import {
  buildFinishesTable,
  toPreviewRows,
  type BoardMarket,
  type PreviewTableModel,
  type Selection,
} from "@/lib/fantasy/board/groupBoard";

export const runtime = "nodejs";

// GET /api/fantasy/me — the caller's fantasy-enabled groups with wallet summaries.
// Event-budget groups get pnl only (balance is per-event, shown on event pages).
export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);

    const { data: memberships, error: memErr } = await supabaseAdmin
      .from("major_group_memberships")
      .select("group_id, role, major_groups!inner(id, name, image_url, fantasy_config)")
      .eq("profile_id", profileId)
      .eq("status", "active");
    if (memErr) throw memErr;

    const groups: {
      group: { id: string; name: string; image_url: string | null };
      role: string;
      config: NonNullable<ReturnType<typeof readFantasyConfig>>;
      balance: number | null;
      pnl: number;
    }[] = [];

    for (const row of (memberships ?? []) as any[]) {
      const g = row.major_groups;
      const config = readFantasyConfig(g?.fantasy_config);
      if (!config) continue;

      if (config.budgetScope === "event") {
        // Balance is per-event; compute PnL from the full ledger without a grant.
        const { data: txs, error } = await supabaseAdmin
          .from("fantasy_wallet_transactions")
          .select("type, amount")
          .eq("group_id", g.id)
          .eq("profile_id", profileId)
          .in("type", ["stake", "payout", "cashout", "void_refund"]);
        if (error) throw error;
        const pnl = (txs ?? []).reduce((s, t: any) => s + Number(t.amount), 0);
        groups.push({
          group: { id: g.id, name: g.name, image_url: g.image_url },
          role: row.role,
          config,
          balance: null,
          pnl: Math.round(pnl * 100) / 100,
        });
      } else {
        const scope = await resolveWalletScope(g.id, config);
        const { summary } = await getWalletSummary(g.id, profileId, config, scope);
        groups.push({
          group: { id: g.id, name: g.name, image_url: g.image_url },
          role: row.role,
          config,
          balance: summary.balance,
          pnl: summary.pnl,
        });
      }
    }

    // Upcoming/live events across my fantasy-enabled groups (pick targets).
    let events: {
      id: string; name: string; group_id: string; group_name: string;
      event_date: string | null; majors_status: string; has_markets: boolean;
      preview: PreviewTableModel | null;
    }[] = [];
    const groupIds = groups.map((g) => g.group.id);
    if (groupIds.length > 0) {
      const { data: eventRows, error: eventErr } = await supabaseAdmin
        .from("events")
        .select("id, name, group_id, event_date, majors_status")
        .in("group_id", groupIds)
        .not("majors_status", "in", '("completed","cancelled")')
        .order("event_date", { ascending: true, nullsFirst: false })
        .limit(20);
      if (eventErr) throw eventErr;
      const rows = (eventRows ?? []) as {
        id: string; name: string; group_id: string; event_date: string | null; majors_status: string;
      }[];
      const withMarkets = new Set<string>();
      if (rows.length > 0) {
        const { data: states } = await supabaseAdmin
          .from("fantasy_event_state")
          .select("event_id")
          .in("event_id", rows.map((r) => r.id));
        for (const s of (states ?? []) as { event_id: string }[]) withMarkets.add(s.event_id);
      }

      // Batched Win/Top-3 preview for every event with markets — three
      // queries total regardless of event count, no N+1.
      const previewByEvent = new Map<string, PreviewTableModel>();
      const previewEventIds = rows.filter((r) => withMarkets.has(r.id)).map((r) => r.id);
      if (previewEventIds.length > 0) {
        const { data: mktRows } = await supabaseAdmin
          .from("fantasy_markets")
          .select("id, event_id, market_type, params")
          .in("event_id", previewEventIds)
          .in("market_type", ["outright_winner", "top_n"])
          .eq("status", "open");
        const mkts = (mktRows ?? []) as {
          id: string; event_id: string; market_type: string; params: Record<string, unknown>;
        }[];
        const { data: snapRows } = mkts.length
          ? await supabaseAdmin
              .from("fantasy_odds_snapshots")
              .select("market_id, selection_key, probability, decimal_odds")
              .in("market_id", mkts.map((m) => m.id))
              .eq("status", "active")
          : { data: [] };
        const snaps = (snapRows ?? []) as {
          market_id: string; selection_key: string; probability: number | string; decimal_odds: number | string;
        }[];
        const previewNames: Record<string, string> = {};
        const selectionIds = [...new Set(snaps.map((s) => s.selection_key))];
        if (selectionIds.length > 0) {
          const { data: profs } = await supabaseAdmin.from("profiles").select("id, name").in("id", selectionIds);
          for (const p of (profs ?? []) as { id: string; name: string | null }[]) {
            previewNames[p.id] = p.name ?? "Player";
          }
        }
        const byEvent = new Map<string, BoardMarket[]>();
        for (const m of mkts) {
          const board: BoardMarket = {
            id: m.id,
            market_type: m.market_type,
            group: "winner",
            display_name: "",
            status: "open",
            params: m.params ?? {},
            subject_profile_id: null,
            opponent_profile_id: null,
            selections: snaps
              .filter((s) => s.market_id === m.id)
              .map((s): Selection => ({
                key: s.selection_key,
                label: previewNames[s.selection_key] ?? "Player",
                probability: Number(s.probability),
                decimal_odds: Number(s.decimal_odds),
                snapshot_id: "",
                event_version: 0,
              })),
          };
          const list = byEvent.get(m.event_id) ?? [];
          list.push(board);
          byEvent.set(m.event_id, list);
        }
        for (const [eventId, ms] of byEvent) {
          const table = buildFinishesTable(ms);
          if (table) previewByEvent.set(eventId, toPreviewRows(table, 3));
        }
      }

      const nameByGroup = new Map(groups.map((g) => [g.group.id, g.group.name]));
      events = rows.map((r) => ({
        id: r.id,
        name: r.name,
        group_id: r.group_id,
        group_name: nameByGroup.get(r.group_id) ?? "",
        event_date: r.event_date,
        majors_status: r.majors_status,
        has_markets: withMarkets.has(r.id),
        preview: previewByEvent.get(r.id) ?? null,
      }));
    }

    return NextResponse.json({ groups, events }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
