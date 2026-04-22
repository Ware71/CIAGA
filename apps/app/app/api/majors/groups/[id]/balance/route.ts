import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/groups/[id]/balance
// Returns the authenticated player's own balance and transaction history for this group.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    // Confirm membership
    const { data: membership } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role, status")
      .eq("group_id", id)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (!membership || (membership as any).status !== "active") {
      return NextResponse.json({ error: "You are not an active member of this group." }, { status: 403 });
    }

    const { data: transactions, error } = await supabaseAdmin
      .from("group_balance_transactions")
      .select(`
        id, competition_id, competition_extra_id, type, amount, note, created_at,
        competition:competitions!competition_id(id, name)
      `)
      .eq("group_id", id)
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const txList = transactions ?? [];
    const total_charged = txList.filter((t: any) => t.amount > 0).reduce((s: number, t: any) => s + t.amount, 0);
    const total_paid = txList.filter((t: any) => t.amount < 0).reduce((s: number, t: any) => s + Math.abs(t.amount), 0);
    const balance = txList.reduce((s: number, t: any) => s + t.amount, 0);

    return NextResponse.json(
      { balance, total_charged, total_paid, transactions: txList },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
