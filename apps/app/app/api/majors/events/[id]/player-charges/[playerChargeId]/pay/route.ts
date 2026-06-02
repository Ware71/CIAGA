import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// POST /api/majors/events/[id]/player-charges/[playerChargeId]/pay
// Marks an individual player charge as paid by creating a payment transaction
// and linking it back to the event_player_charges record.
export async function POST(
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
    if ((pc as any).payment_transaction_id) {
      return NextResponse.json({ error: "Already marked as paid." }, { status: 409 });
    }

    // Create payment transaction (negative amount = credit to player)
    const { data: tx, error: txErr } = await supabaseAdmin
      .from("group_balance_transactions")
      .insert({
        group_id: event.group_id,
        profile_id: (pc as any).profile_id,
        event_id: id,
        type: "payment",
        amount: -Math.abs((pc as any).amount),
        note: `Payment — ${(pc as any).name} — ${event.name}`,
        recorded_by: profileId,
      })
      .select("id")
      .single();

    if (txErr) throw txErr;

    // Link payment transaction to the player charge
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("event_player_charges")
      .update({ payment_transaction_id: (tx as any).id })
      .eq("id", playerChargeId)
      .select("*")
      .single();

    if (updateErr) throw updateErr;

    return NextResponse.json({ player_charge: { ...(updated as any), is_paid: true } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
