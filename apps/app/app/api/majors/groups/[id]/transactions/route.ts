import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// POST /api/majors/groups/[id]/transactions
// Owner/admin manually records a transaction for a player (payment received, adjustment, ad-hoc charge).
// Body: { profile_id, type, amount, competition_id?, competition_extra_id?, note? }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const { data: membership } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", id)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership || !["owner", "admin"].includes((membership as any).role)) {
      return NextResponse.json({ error: "Only group owner or admin can record transactions." }, { status: 403 });
    }

    const body = await req.json();
    const { profile_id, type, amount, competition_id, competition_extra_id, note } = body as {
      profile_id: string;
      type: "entry_fee" | "extra_charge" | "payment" | "winnings" | "adjustment";
      amount: number;
      competition_id?: string;
      competition_extra_id?: string;
      note?: string;
    };

    const VALID_TYPES = ["entry_fee", "extra_charge", "payment", "winnings", "adjustment"];
    if (!profile_id || !type || amount == null) {
      return NextResponse.json({ error: "profile_id, type, and amount are required." }, { status: 400 });
    }
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: `type must be one of: ${VALID_TYPES.join(", ")}` }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("group_balance_transactions")
      .insert({
        group_id: id,
        profile_id,
        type,
        amount,
        competition_id: competition_id ?? null,
        competition_extra_id: competition_extra_id ?? null,
        note: note ?? null,
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
