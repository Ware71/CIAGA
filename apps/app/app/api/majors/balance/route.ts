import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/balance
// Returns the authenticated user's aggregate balance across all their groups.
export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);

    // Get all active group memberships for this user
    const { data: memberships } = await supabaseAdmin
      .from("major_group_memberships")
      .select("group_id, group:major_groups!group_id(id, name)")
      .eq("profile_id", profileId)
      .eq("status", "active");

    if (!memberships || memberships.length === 0) {
      return NextResponse.json(
        { total_balance: 0, has_debt: false, groups: [] },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const groupIds = memberships.map((m: any) => m.group_id as string);

    // Fetch all transactions for this user across all groups
    const { data: transactions, error } = await supabaseAdmin
      .from("group_balance_transactions")
      .select(`
        id, group_id, event_id, type, amount, note, created_at,
        event:events!event_id(id, name)
      `)
      .eq("profile_id", profileId)
      .in("group_id", groupIds)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const txList = (transactions ?? []) as any[];

    // Build per-group breakdown
    const groupMap = new Map<string, { id: string; name: string }>(
      memberships.map((m: any) => [m.group_id as string, m.group as { id: string; name: string }])
    );

    const groupBalances = groupIds.map((groupId) => {
      const groupTxs = txList.filter((t) => t.group_id === groupId);
      const balance = groupTxs.reduce((s: number, t: any) => s + (t.amount ?? 0), 0);

      // Aggregate by event
      const eventMap = new Map<string | null, { event_id: string | null; event_name: string | null; net: number }>();
      for (const tx of groupTxs) {
        const key = tx.event_id ?? "__no_event__";
        const existing = eventMap.get(key);
        if (existing) {
          existing.net += tx.amount ?? 0;
        } else {
          eventMap.set(key, {
            event_id: tx.event_id ?? null,
            event_name: (tx.event as any)?.name ?? null,
            net: tx.amount ?? 0,
          });
        }
      }

      const by_event = [...eventMap.values()].filter((e) => e.net !== 0);

      return {
        group_id: groupId,
        group_name: groupMap.get(groupId)?.name ?? groupId,
        balance,
        by_event,
      };
    }).filter((g) => g.balance !== 0 || g.by_event.length > 0);

    // Sort: groups with debt (positive balance = owes money) first
    groupBalances.sort((a, b) => b.balance - a.balance);

    const total_balance = groupBalances.reduce((s, g) => s + g.balance, 0);

    return NextResponse.json(
      { total_balance, has_debt: total_balance > 0, groups: groupBalances },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
