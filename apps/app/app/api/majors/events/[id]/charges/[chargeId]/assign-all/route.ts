import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// POST /api/majors/events/[id]/charges/[chargeId]/assign-all
// Assigns a charge to all current event_entries (skips already-assigned players).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; chargeId: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id, chargeId } = await params;

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

    const { data: charge, error: chargeErr } = await supabaseAdmin
      .from("event_charges")
      .select("*")
      .eq("id", chargeId)
      .eq("event_id", id)
      .maybeSingle();
    if (chargeErr || !charge) return NextResponse.json({ error: "Charge not found." }, { status: 404 });

    // Fetch all event entries
    const { data: entries } = await supabaseAdmin
      .from("event_entries")
      .select("profile_id")
      .eq("event_id", id);

    if (!entries || entries.length === 0) {
      return NextResponse.json({ results: [], message: "No entries found." });
    }

    // Fetch already-assigned players for this charge
    const { data: existing } = await supabaseAdmin
      .from("event_player_charges")
      .select("profile_id")
      .eq("charge_id", chargeId);

    const alreadyAssigned = new Set((existing ?? []).map((r: any) => r.profile_id));

    const chargeAmount: number = (charge as any).amount;
    const txType = (charge as any).category === "green_fee" ? "green_fee" : "extra_charge";

    const results: { profile_id: string; status: "assigned" | "skipped" }[] = [];

    for (const entry of entries) {
      const pid = (entry as any).profile_id as string;

      if (alreadyAssigned.has(pid)) {
        results.push({ profile_id: pid, status: "skipped" });
        continue;
      }

      const { data: tx, error: txErr } = await supabaseAdmin
        .from("group_balance_transactions")
        .insert({
          group_id: event.group_id,
          profile_id: pid,
          event_id: id,
          type: txType,
          amount: chargeAmount,
          note: `${(charge as any).name} — ${event.name}`,
          recorded_by: profileId,
        })
        .select("id")
        .single();

      if (txErr) {
        results.push({ profile_id: pid, status: "skipped" });
        continue;
      }

      await supabaseAdmin.from("event_player_charges").insert({
        event_id: id,
        charge_id: chargeId,
        profile_id: pid,
        name: (charge as any).name,
        amount: chargeAmount,
        category: (charge as any).category,
        charge_transaction_id: (tx as any).id,
        created_by: profileId,
      });

      results.push({ profile_id: pid, status: "assigned" });
    }

    return NextResponse.json({ results });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
