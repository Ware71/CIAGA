import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// POST /api/majors/competitions/[id]/enter
// Enters the authenticated user into an event, snapshotting their handicap index.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const event = await getEventById(id);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    if (event.majors_status === "cancelled") {
      return NextResponse.json({ error: "Event is cancelled" }, { status: 400 });
    }
    if (event.majors_status === "completed") {
      return NextResponse.json({ error: "Event is already completed" }, { status: 400 });
    }

    // Check entry window
    const now = new Date();
    if (event.entry_window_start && new Date(event.entry_window_start) > now) {
      return NextResponse.json({ error: "Entry window has not opened yet" }, { status: 400 });
    }
    if (event.entry_window_end && new Date(event.entry_window_end) < now) {
      return NextResponse.json({ error: "Entry window has closed" }, { status: 400 });
    }

    // Check if group membership required
    if (event.group_id) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("status")
        .eq("group_id", event.group_id)
        .eq("profile_id", profileId)
        .maybeSingle();

      if (!membership || (membership as any).status !== "active") {
        return NextResponse.json({ error: "You must be a group member to enter this event" }, { status: 403 });
      }
    }

    // Check not already entered
    const { data: existing } = await supabaseAdmin
      .from("event_entries")
      .select("id")
      .eq("event_id", id)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "Already entered" }, { status: 409 });
    }

    // Snapshot current handicap index
    const { data: hiData } = await supabaseAdmin.rpc("ciaga_current_true_hi", { p_profile_id: profileId });
    const handicapIndex = typeof hiData === "number" ? hiData : 0;

    // Check max_entries cap
    const maxEntries = (event as any).max_entries as number | null;
    if (maxEntries != null) {
      const { count } = await supabaseAdmin
        .from("event_entries")
        .select("id", { count: "exact", head: true })
        .eq("event_id", id);

      if ((count ?? 0) >= maxEntries) {
        // Event is full — direct to waitlist if enabled
        if ((event as any).waitlist_enabled) {
          return NextResponse.json(
            { error: "This event is full. You can join the waitlist instead.", full: true, waitlist_available: true },
            { status: 409 }
          );
        }
        return NextResponse.json({ error: "This event is full." }, { status: 409 });
      }
    }

    // Check allow_credit policy: if group disallows credit, player must have zero or positive balance
    if (event.group_id) {
      const { data: group } = await supabaseAdmin
        .from("major_groups")
        .select("allow_credit")
        .eq("id", event.group_id)
        .maybeSingle();

      if (group && (group as any).allow_credit === false) {
        // Calculate current balance
        const { data: txRows } = await supabaseAdmin
          .from("group_balance_transactions")
          .select("amount")
          .eq("group_id", event.group_id)
          .eq("profile_id", profileId);

        const balance = (txRows ?? []).reduce((s: number, r: any) => s + r.amount, 0);
        if (balance > 0) {
          return NextResponse.json(
            { error: `You have an outstanding balance of £${balance.toFixed(2)}. Please settle your account before entering.` },
            { status: 402 }
          );
        }
      }
    }

    const { data: entry, error } = await supabaseAdmin
      .from("event_entries")
      .insert({
        event_id: id,
        profile_id: profileId,
        assigned_handicap_index: handicapIndex,
        source: "manual",
        locked: false,
      })
      .select("*")
      .single();

    if (error) throw error;

    // Auto-charge entry fee if one is set
    const entryFee = (event as any).entry_fee_amount as number | null;
    if (entryFee && entryFee > 0 && event.group_id) {
      await supabaseAdmin.from("group_balance_transactions").insert({
        group_id: event.group_id,
        profile_id: profileId,
        event_id: id,
        type: "entry_fee",
        amount: entryFee, // positive = charged to player
        note: `Entry fee — ${event.name}`,
      });
    }

    // Mark as joined if player was on the waitlist with 'offered' status
    if ((event as any).waitlist_enabled) {
      await supabaseAdmin
        .from("event_waitlist")
        .update({ status: "joined", joined_at: new Date().toISOString() })
        .eq("event_id", id)
        .eq("profile_id", profileId)
        .eq("status", "offered");
    }

    return NextResponse.json({ entry }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
