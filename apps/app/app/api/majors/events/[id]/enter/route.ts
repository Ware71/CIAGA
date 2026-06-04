import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";

export const runtime = "nodejs";

/** Assign a single charge to a player, creating the debit transaction. Skips if already assigned. */
async function assignChargeToPlayer(
  charge: any,
  profileId: string,
  groupId: string,
  eventId: string,
  recordedBy: string
) {
  const { data: existing } = await supabaseAdmin
    .from("event_player_charges")
    .select("id")
    .eq("charge_id", charge.id)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (existing) return;

  const txType = charge.category === "green_fee" ? "green_fee" : "extra_charge";
  const { data: tx } = await supabaseAdmin
    .from("group_balance_transactions")
    .insert({
      group_id: groupId,
      profile_id: profileId,
      event_id: eventId,
      type: txType,
      amount: charge.amount,
      note: charge.name,
      recorded_by: recordedBy,
    })
    .select("id")
    .single();

  await supabaseAdmin.from("event_player_charges").insert({
    event_id: eventId,
    charge_id: charge.id,
    profile_id: profileId,
    name: charge.name,
    amount: charge.amount,
    category: charge.category,
    charge_transaction_id: tx ? (tx as any).id : null,
    created_by: recordedBy,
  });
}

/** Enroll a single player in a prize pot. Skips if already enrolled or pot is distributed. */
async function enrollPlayerInPot(
  pot: any,
  profileId: string,
  eventId: string | null,
  recordedBy: string
) {
  if (pot.status === "distributed") return;

  const { data: existing } = await supabaseAdmin
    .from("prize_pot_entries")
    .select("id")
    .eq("prize_pot_id", pot.id)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (existing) return;

  const entryFee: number = pot.entry_fee_amount ?? 0;
  let txId: string | null = null;

  if (entryFee > 0) {
    const { data: tx } = await supabaseAdmin
      .from("group_balance_transactions")
      .insert({
        group_id: pot.group_id,
        profile_id: profileId,
        event_id: eventId,
        type: "entry_fee",
        amount: entryFee,
        note: `Entry fee: ${pot.name}`,
        recorded_by: recordedBy,
      })
      .select("id")
      .single();
    txId = tx ? (tx as any).id : null;
  }

  await supabaseAdmin.from("prize_pot_entries").insert({
    prize_pot_id: pot.id,
    profile_id: profileId,
    amount_contributed: entryFee,
    transaction_id: txId,
  });
}

// POST /api/majors/competitions/[id]/enter
// Enters the authenticated user into an event, snapshotting their handicap index.
// Body (optional): { optional_charge_ids?, optional_pot_ids?, optional_group_charge_ids? }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const body = await req.json().catch(() => ({}));
    const {
      optional_charge_ids = [],
      optional_pot_ids = [],
      optional_group_charge_ids = [],
    } = body as {
      optional_charge_ids?: string[];
      optional_pot_ids?: string[];
      optional_group_charge_ids?: string[];
    };

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

    // Check group membership
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
        if ((event as any).waitlist_enabled) {
          return NextResponse.json(
            { error: "This event is full. You can join the waitlist instead.", full: true, waitlist_available: true },
            { status: 409 }
          );
        }
        return NextResponse.json({ error: "This event is full." }, { status: 409 });
      }
    }

    // Check allow_credit policy
    if (event.group_id) {
      const { data: group } = await supabaseAdmin
        .from("major_groups")
        .select("allow_credit")
        .eq("id", event.group_id)
        .maybeSingle();

      if (group && (group as any).allow_credit === false) {
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

    // ── Create entry ──────────────────────────────────────────────────────────
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

    // ── Auto-charge event entry fee (legacy field) ────────────────────────────
    const entryFee = (event as any).entry_fee_amount as number | null;
    if (entryFee && entryFee > 0 && event.group_id) {
      await supabaseAdmin.from("group_balance_transactions").insert({
        group_id: event.group_id,
        profile_id: profileId,
        event_id: id,
        type: "entry_fee",
        amount: entryFee,
        note: `Entry fee — ${event.name}`,
      });
    }

    // ── Auto-assign mandatory event charges ───────────────────────────────────
    if (event.group_id) {
      const { data: allCharges } = await supabaseAdmin
        .from("event_charges")
        .select("*")
        .eq("event_id", id);

      const mandatoryCharges = (allCharges ?? []).filter((c: any) => c.is_mandatory);
      const optionalCharges = (allCharges ?? []).filter(
        (c: any) => !c.is_mandatory && optional_charge_ids.includes(c.id)
      );

      for (const charge of [...mandatoryCharges, ...optionalCharges]) {
        await assignChargeToPlayer(charge, profileId, event.group_id, id, profileId);
      }

      // ── Auto-enroll in mandatory/selected event prize pots ─────────────────
      const { data: eventPots } = await supabaseAdmin
        .from("prize_pots")
        .select("*")
        .eq("event_id", id)
        .in("status", ["active", "locked"]);

      const mandatoryEventPots = (eventPots ?? []).filter((p: any) => p.is_mandatory);
      const optionalEventPots = (eventPots ?? []).filter(
        (p: any) => !p.is_mandatory && optional_pot_ids.includes(p.id)
      );

      for (const pot of [...mandatoryEventPots, ...optionalEventPots]) {
        await enrollPlayerInPot(pot, profileId, id, profileId);
      }

      // ── Auto-enroll in mandatory/selected season prize pots ────────────────
      const seasonFilters: string[] = [];
      if ((event as any).season_id) {
        seasonFilters.push(`competition_season_id.eq.${(event as any).season_id}`);
      }
      if ((event as any).group_season_id) {
        seasonFilters.push(`group_season_id.eq.${(event as any).group_season_id}`);
      }

      if (seasonFilters.length > 0) {
        const { data: seasonPots } = await supabaseAdmin
          .from("prize_pots")
          .select("*")
          .eq("group_id", event.group_id)
          .in("status", ["active", "locked"])
          .or(seasonFilters.join(","));

        const mandatorySeasonPots = (seasonPots ?? []).filter((p: any) => p.is_mandatory);
        const optionalSeasonPots = (seasonPots ?? []).filter(
          (p: any) => !p.is_mandatory && optional_pot_ids.includes(p.id)
        );

        for (const pot of [...mandatorySeasonPots, ...optionalSeasonPots]) {
          await enrollPlayerInPot(pot, profileId, id, profileId);
        }
      }

      // ── Apply mandatory/selected group-level charges ───────────────────────
      const { data: allGroupCharges } = await supabaseAdmin
        .from("group_charges")
        .select("*")
        .eq("group_id", event.group_id)
        .eq("is_active", true);

      const mandatoryGroupCharges = (allGroupCharges ?? []).filter((c: any) => c.is_mandatory);
      const optionalGroupCharges = (allGroupCharges ?? []).filter(
        (c: any) => !c.is_mandatory && optional_group_charge_ids.includes(c.id)
      );

      for (const gc of [...mandatoryGroupCharges, ...optionalGroupCharges]) {
        await supabaseAdmin.from("group_balance_transactions").insert({
          group_id: event.group_id,
          profile_id: profileId,
          event_id: id,
          type: "extra_charge",
          amount: gc.amount,
          note: gc.name,
          recorded_by: profileId,
        });
      }
    }

    // ── Mark as joined if was on waitlist with 'offered' status ──────────────
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
