import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// DELETE /api/majors/events/[id]/player-charges/[playerChargeId]
// Removes the player charge and reverses the debit transaction.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; playerChargeId: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id, playerChargeId } = await params;

    const event = await getEventById(id);
    if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });
    if (!event.group_id) return NextResponse.json({ error: "Event has no group." }, { status: 400 });

    const { data: m } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", event.group_id)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();
    if (!m || !["owner", "admin"].includes((m as any).role)) {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const { data: pc, error: pcErr } = await supabaseAdmin
      .from("event_player_charges")
      .select("*")
      .eq("id", playerChargeId)
      .eq("event_id", id)
      .maybeSingle();

    if (pcErr || !pc) return NextResponse.json({ error: "Player charge not found." }, { status: 404 });

    // Reverse the charge transaction (insert a credit reversal)
    if ((pc as any).charge_transaction_id) {
      await supabaseAdmin.from("group_balance_transactions").insert({
        group_id: event.group_id,
        profile_id: (pc as any).profile_id,
        event_id: id,
        type: "adjustment",
        amount: -Math.abs((pc as any).amount),
        note: `Reversal — ${(pc as any).name} removed`,
        recorded_by: profileId,
      });
    }

    // Delete the player charge (payment_transaction_id remains in ledger if paid)
    await supabaseAdmin.from("event_player_charges").delete().eq("id", playerChargeId);

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
