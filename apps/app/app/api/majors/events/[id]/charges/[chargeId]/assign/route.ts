import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// POST /api/majors/events/[id]/charges/[chargeId]/assign
// Body: { profile_ids: string[], amount_override?: number }
// Assigns a charge to specified players, creating debit transactions for each.
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

    const body = await req.json();
    const { profile_ids, amount_override } = body as { profile_ids: string[]; amount_override?: number };
    if (!Array.isArray(profile_ids) || profile_ids.length === 0) {
      return NextResponse.json({ error: "profile_ids must be a non-empty array." }, { status: 400 });
    }

    const chargeAmount: number = amount_override != null ? amount_override : (charge as any).amount;
    const txType = (charge as any).category === "green_fee" ? "green_fee" : "extra_charge";

    const results: { profile_id: string; status: "assigned" | "skipped" }[] = [];

    for (const pid of profile_ids) {
      // Skip if already assigned
      const { data: existing } = await supabaseAdmin
        .from("event_player_charges")
        .select("id")
        .eq("charge_id", chargeId)
        .eq("profile_id", pid)
        .maybeSingle();

      if (existing) {
        results.push({ profile_id: pid, status: "skipped" });
        continue;
      }

      // Create debit transaction
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

      // Create player charge record
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

    return NextResponse.json({ results }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
