import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// POST /api/majors/groups/[id]/withdraw
// Admin records that prize money has been physically handed to a player.
// Creates a positive 'withdrawal' transaction — reduces balance but does not affect winnings stats.
// Body: { profile_id, amount, note? }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: groupId } = await params;

    // Must be owner or admin
    const { data: membership } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", groupId)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership || !["owner", "admin"].includes((membership as any).role)) {
      return NextResponse.json({ error: "Only group owner or admin can record withdrawals." }, { status: 403 });
    }

    const body = await req.json();
    const { profile_id, amount, note } = body as {
      profile_id: string;
      amount: number;
      note?: string;
    };

    if (!profile_id) return NextResponse.json({ error: "profile_id is required." }, { status: 400 });
    if (!amount || amount <= 0) return NextResponse.json({ error: "amount must be positive." }, { status: 400 });

    // Verify the player is in the group
    const { data: targetMember } = await supabaseAdmin
      .from("major_group_memberships")
      .select("status")
      .eq("group_id", groupId)
      .eq("profile_id", profile_id)
      .maybeSingle();

    if (!targetMember) {
      return NextResponse.json({ error: "Player is not a member of this group." }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin
      .from("group_balance_transactions")
      .insert({
        group_id: groupId,
        profile_id,
        type: "withdrawal",
        amount: Math.abs(amount), // positive = debit (reduces credit)
        note: note ?? "Winnings withdrawn",
        recorded_by: profileId,
      })
      .select("*")
      .single();

    if (error) throw error;

    return NextResponse.json({ transaction: data }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
