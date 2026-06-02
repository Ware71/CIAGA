import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// POST /api/majors/prize-pots/[potId]/entries/[profileId]
// Enroll an individual player into a pot and optionally charge an entry fee.
export async function POST(req: Request, { params }: { params: Promise<{ potId: string; profileId: string }> }) {
  try {
    const { profileId: authedId } = await getAuthedProfileOrThrow(req);
    const { potId, profileId: targetId } = await params;

    const { data: pot } = await supabaseAdmin
      .from("prize_pots")
      .select("*")
      .eq("id", potId)
      .maybeSingle();

    if (!pot) return NextResponse.json({ error: "Prize pot not found." }, { status: 404 });
    if ((pot as any).status === "distributed") {
      return NextResponse.json({ error: "Cannot enroll into a distributed pot." }, { status: 400 });
    }

    const { data: m } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", (pot as any).group_id)
      .eq("profile_id", authedId)
      .eq("status", "active")
      .maybeSingle();

    if (!m || !["owner", "admin"].includes((m as any).role)) {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    // Check not already enrolled
    const { data: existing } = await supabaseAdmin
      .from("prize_pot_entries")
      .select("id")
      .eq("prize_pot_id", potId)
      .eq("profile_id", targetId)
      .maybeSingle();

    if (existing) return NextResponse.json({ error: "Player is already enrolled in this pot." }, { status: 409 });

    const entryFee: number = (pot as any).entry_fee_amount ?? 0;
    let txnId: string | null = null;

    if (entryFee > 0) {
      const { data: txn, error: txnErr } = await supabaseAdmin
        .from("group_balance_transactions")
        .insert({
          group_id: (pot as any).group_id,
          profile_id: targetId,
          event_id: (pot as any).event_id ?? null,
          type: "entry_fee",
          amount: entryFee,
          note: `Entry fee: ${(pot as any).name}`,
          recorded_by: authedId,
        })
        .select("id")
        .single();
      if (txnErr) throw txnErr;
      txnId = (txn as any).id;
    }

    const { data: entry, error: entryErr } = await supabaseAdmin
      .from("prize_pot_entries")
      .insert({ prize_pot_id: potId, profile_id: targetId, amount_contributed: entryFee, transaction_id: txnId })
      .select("*, profile:profiles!profile_id(id, name, avatar_url)")
      .single();

    if (entryErr) throw entryErr;
    return NextResponse.json({ entry }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

// DELETE /api/majors/prize-pots/[potId]/entries/[profileId]
// Remove a player from a pot. Reverses the entry-fee transaction if present.
export async function DELETE(req: Request, { params }: { params: Promise<{ potId: string; profileId: string }> }) {
  try {
    const { profileId: authedId } = await getAuthedProfileOrThrow(req);
    const { potId, profileId: targetId } = await params;

    const { data: pot } = await supabaseAdmin
      .from("prize_pots")
      .select("*")
      .eq("id", potId)
      .maybeSingle();

    if (!pot) return NextResponse.json({ error: "Prize pot not found." }, { status: 404 });
    if ((pot as any).status === "distributed") {
      return NextResponse.json({ error: "Cannot remove from a distributed pot." }, { status: 400 });
    }

    const { data: m } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", (pot as any).group_id)
      .eq("profile_id", authedId)
      .eq("status", "active")
      .maybeSingle();

    if (!m || !["owner", "admin"].includes((m as any).role)) {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const { data: entry } = await supabaseAdmin
      .from("prize_pot_entries")
      .select("*")
      .eq("prize_pot_id", potId)
      .eq("profile_id", targetId)
      .maybeSingle();

    if (!entry) return NextResponse.json({ error: "Player is not enrolled in this pot." }, { status: 404 });

    // Delete entry (FK cascade will not remove the transaction — do it manually to reverse the charge)
    const { error: delErr } = await supabaseAdmin
      .from("prize_pot_entries")
      .delete()
      .eq("prize_pot_id", potId)
      .eq("profile_id", targetId);

    if (delErr) throw delErr;

    // Reverse the entry-fee transaction if one was created
    if ((entry as any).transaction_id) {
      await supabaseAdmin
        .from("group_balance_transactions")
        .delete()
        .eq("id", (entry as any).transaction_id);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
