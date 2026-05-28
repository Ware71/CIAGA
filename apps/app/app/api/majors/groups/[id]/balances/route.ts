import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/groups/[id]/balances
// Owner/admin only. Returns all members with their balance summary and transaction history.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    // Must be owner or admin
    const { data: membership } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", id)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership || !["owner", "admin"].includes((membership as any).role)) {
      return NextResponse.json({ error: "Only group owner or admin can view all balances." }, { status: 403 });
    }

    // Fetch all transactions for this group with profile + competition details
    const { data: transactions, error } = await supabaseAdmin
      .from("group_balance_transactions")
      .select(`
        id, group_id, profile_id, event_id, event_extra_id,
        type, amount, note, recorded_by, created_at,
        profile:profiles!profile_id(id, name, avatar_url),
        event:events!event_id(id, name)
      `)
      .eq("group_id", id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Group by player
    const byPlayer = new Map<string, {
      profile_id: string;
      profile: any;
      total_charged: number;
      total_paid: number;
      balance: number;
      transactions: any[];
    }>();

    for (const tx of transactions ?? []) {
      const pid = (tx as any).profile_id;
      if (!byPlayer.has(pid)) {
        byPlayer.set(pid, {
          profile_id: pid,
          profile: (tx as any).profile,
          total_charged: 0,
          total_paid: 0,
          balance: 0,
          transactions: [],
        });
      }
      const entry = byPlayer.get(pid)!;
      entry.transactions.push(tx);

      const amount = (tx as any).amount as number;
      if (amount > 0) {
        entry.total_charged += amount;
      } else {
        entry.total_paid += Math.abs(amount);
      }
      entry.balance += amount; // positive = owes, negative = in credit
    }

    const members = Array.from(byPlayer.values()).sort((a, b) =>
      (a.profile?.name ?? "").localeCompare(b.profile?.name ?? "")
    );

    return NextResponse.json({ members }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
