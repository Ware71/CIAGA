import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getCompetitionById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// POST /api/majors/competitions/[id]/enter
// Enters the authenticated user into a competition, snapshotting their handicap index.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const competition = await getCompetitionById(id);
    if (!competition) return NextResponse.json({ error: "Competition not found" }, { status: 404 });

    if (competition.majors_status === "cancelled") {
      return NextResponse.json({ error: "Competition is cancelled" }, { status: 400 });
    }
    if (competition.majors_status === "completed") {
      return NextResponse.json({ error: "Competition is already completed" }, { status: 400 });
    }

    // Check entry window
    const now = new Date();
    if (competition.entry_window_start && new Date(competition.entry_window_start) > now) {
      return NextResponse.json({ error: "Entry window has not opened yet" }, { status: 400 });
    }
    if (competition.entry_window_end && new Date(competition.entry_window_end) < now) {
      return NextResponse.json({ error: "Entry window has closed" }, { status: 400 });
    }

    // Check if group membership required
    if (competition.group_id) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("status")
        .eq("group_id", competition.group_id)
        .eq("profile_id", profileId)
        .maybeSingle();

      if (!membership || (membership as any).status !== "active") {
        return NextResponse.json({ error: "You must be a group member to enter this competition" }, { status: 403 });
      }
    }

    // Check not already entered
    const { data: existing } = await supabaseAdmin
      .from("competition_entries")
      .select("id")
      .eq("competition_id", id)
      .eq("profile_id", profileId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "Already entered" }, { status: 409 });
    }

    // Snapshot current handicap index
    const { data: hiData } = await supabaseAdmin.rpc("ciaga_current_true_hi", { p_profile_id: profileId });
    const handicapIndex = typeof hiData === "number" ? hiData : 0;

    // Check max_entries cap
    const maxEntries = (competition as any).max_entries as number | null;
    if (maxEntries != null) {
      const { count } = await supabaseAdmin
        .from("competition_entries")
        .select("id", { count: "exact", head: true })
        .eq("competition_id", id);

      if ((count ?? 0) >= maxEntries) {
        // Competition is full — direct to waitlist if enabled
        if ((competition as any).waitlist_enabled) {
          return NextResponse.json(
            { error: "This competition is full. You can join the waitlist instead.", full: true, waitlist_available: true },
            { status: 409 }
          );
        }
        return NextResponse.json({ error: "This competition is full." }, { status: 409 });
      }
    }

    // Check allow_credit policy: if group disallows credit, player must have zero or positive balance
    if (competition.group_id) {
      const { data: group } = await supabaseAdmin
        .from("major_groups")
        .select("allow_credit")
        .eq("id", competition.group_id)
        .maybeSingle();

      if (group && (group as any).allow_credit === false) {
        // Calculate current balance
        const { data: txRows } = await supabaseAdmin
          .from("group_balance_transactions")
          .select("amount")
          .eq("group_id", competition.group_id)
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
      .from("competition_entries")
      .insert({
        competition_id: id,
        profile_id: profileId,
        assigned_handicap_index: handicapIndex,
        source: "manual",
        locked: false,
      })
      .select("*")
      .single();

    if (error) throw error;

    // Auto-charge entry fee if one is set
    const entryFee = (competition as any).entry_fee_amount as number | null;
    if (entryFee && entryFee > 0 && competition.group_id) {
      await supabaseAdmin.from("group_balance_transactions").insert({
        group_id: competition.group_id,
        profile_id: profileId,
        competition_id: id,
        type: "entry_fee",
        amount: entryFee, // positive = charged to player
        note: `Entry fee — ${competition.name}`,
      });
    }

    // Mark as joined if player was on the waitlist with 'offered' status
    if ((competition as any).waitlist_enabled) {
      await supabaseAdmin
        .from("competition_waitlist")
        .update({ status: "joined", joined_at: new Date().toISOString() })
        .eq("competition_id", id)
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
