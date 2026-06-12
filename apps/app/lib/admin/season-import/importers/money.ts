import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedCharge, ParsedPayment } from "../parse";

type Admin = SupabaseClient;

/**
 * Note prefix used for imported payment transactions. This exact string is the
 * idempotency key for re-imports (matched with eq on the full note), so never
 * change the format — existing imported rows would stop being recognised and
 * re-importing would double-credit players.
 */
export function importedPaymentNote(playerLabel: string, eventName: string | null, userNote: string | null): string {
  const base = `Imported payment — ${playerLabel} — ${eventName || "group"}`;
  return userNote ? `${base} — ${userNote}` : base;
}

const DEBIT_TYPES = ["entry_fee", "green_fee", "extra_charge"];

// ── Charges ───────────────────────────────────────────────────────────────────
// One Excel row is either an "applies to all entrants" row (player blank) or a
// per-player assignment. Rows are grouped by (event, charge name) into one
// event_charges catalog row plus N event_player_charges, exactly mirroring the
// in-app assign flow (charges/[chargeId]/assign) and pay flow
// (player-charges/[playerChargeId]/pay): debit tx → assignment → optional
// settling payment tx. Idempotent: existing assignments are skipped.
export async function importCharges(args: {
  admin: Admin;
  groupId: string;
  recordedBy: string;
  chargeRows: ParsedCharge[];
  eventIdByName: Map<string, string>;
  eventDateByName: Map<string, string>;
  scoredByEvent: Map<string, Set<string>>;
  summary: any;
}) {
  const { admin, groupId, recordedBy, chargeRows, eventIdByName, eventDateByName, scoredByEvent, summary } = args;
  if (!chargeRows.length) return;

  type ChargeGroup = {
    event_name: string;
    charge_name: string;
    category: string;
    amount: number;
    note: string | null;
    applies_to_all: boolean;
    all_paid: boolean;
    explicit: Array<{ profile_id: string; amount: number; paid: boolean }>;
  };
  const groups = new Map<string, ChargeGroup>();

  for (const row of chargeRows) {
    const key = `${row.event_name}::${row.charge_name}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        event_name: row.event_name,
        charge_name: row.charge_name,
        category: row.category,
        amount: row.amount ?? 0,
        note: row.note,
        applies_to_all: false,
        all_paid: true,
        explicit: [],
      };
      groups.set(key, g);
    }
    if (g.amount === 0 && row.amount != null) g.amount = row.amount;
    if (!row.player_label) {
      g.applies_to_all = true;
      g.all_paid = row.paid;
    } else if (row.profile_id) {
      g.explicit.push({
        profile_id: row.profile_id,
        amount: row.amount_override ?? row.amount ?? g.amount,
        paid: row.paid,
      });
    }
  }

  for (const g of groups.values()) {
    const eventId = eventIdByName.get(g.event_name);
    if (!eventId) throw new Error(`Charge "${g.charge_name}": event "${g.event_name}" did not resolve`);
    const eventDate = eventDateByName.get(g.event_name);
    const chargedAt = eventDate ? `${eventDate}T12:00:00.000Z` : new Date().toISOString();
    const paidAt    = eventDate ? `${eventDate}T13:00:00.000Z` : new Date().toISOString();

    // Find or create the catalog row (idempotent by event_id + name)
    const { data: existingCharge, error: ecErr } = await admin
      .from("event_charges")
      .select("id")
      .eq("event_id", eventId)
      .eq("name", g.charge_name)
      .maybeSingle();
    if (ecErr) throw new Error(`Charge lookup failed for "${g.charge_name}": ${ecErr.message}`);

    let chargeId: string;
    if (existingCharge) {
      chargeId = (existingCharge as any).id;
    } else {
      const { data: newCharge, error: ncErr } = await admin
        .from("event_charges")
        .insert({
          event_id:               eventId,
          name:                   g.charge_name,
          amount:                 g.amount,
          category:               g.category,
          description:            g.note,
          applies_to_all_entries: g.applies_to_all,
          created_by:             recordedBy,
          created_at:             chargedAt,
        })
        .select("id")
        .single();
      if (ncErr || !newCharge) throw new Error(`Create charge "${g.charge_name}" failed: ${ncErr?.message}`);
      chargeId = (newCharge as any).id;
      summary.event_charges_created++;
    }

    // Build the assignment list: all entrants first, explicit rows override/add
    const assignments = new Map<string, { amount: number; paid: boolean }>();
    if (g.applies_to_all) {
      for (const pid of scoredByEvent.get(g.event_name) ?? []) {
        assignments.set(pid, { amount: g.amount, paid: g.all_paid });
      }
    }
    for (const ex of g.explicit) assignments.set(ex.profile_id, { amount: ex.amount, paid: ex.paid });
    if (!assignments.size) continue;

    const { data: existingAssignments, error: eaErr } = await admin
      .from("event_player_charges")
      .select("profile_id")
      .eq("charge_id", chargeId);
    if (eaErr) throw new Error(`Player charge lookup failed for "${g.charge_name}": ${eaErr.message}`);
    const alreadyAssigned = new Set((existingAssignments ?? []).map((a: any) => a.profile_id));

    const txType = g.category === "green_fee" ? "green_fee" : "extra_charge";

    for (const [profileId, a] of assignments.entries()) {
      if (alreadyAssigned.has(profileId)) continue;

      const { data: tx, error: txErr } = await admin
        .from("group_balance_transactions")
        .insert({
          group_id:    groupId,
          profile_id:  profileId,
          event_id:    eventId,
          type:        txType,
          amount:      a.amount,
          note:        `${g.charge_name} — ${g.event_name}`,
          recorded_by: recordedBy,
          created_at:  chargedAt,
        })
        .select("id")
        .single();
      if (txErr || !tx) throw new Error(`Charge transaction failed for "${g.charge_name}": ${txErr?.message}`);
      summary.charge_transactions_created++;

      const epcInsert: Record<string, unknown> = {
        event_id:              eventId,
        charge_id:             chargeId,
        profile_id:            profileId,
        name:                  g.charge_name,
        amount:                a.amount,
        category:              g.category,
        charge_transaction_id: (tx as any).id,
        created_by:            recordedBy,
        created_at:            chargedAt,
      };

      if (a.paid) {
        const { data: payTx, error: payErr } = await admin
          .from("group_balance_transactions")
          .insert({
            group_id:    groupId,
            profile_id:  profileId,
            event_id:    eventId,
            type:        "payment",
            amount:      -Math.abs(a.amount),
            note:        `Payment — ${g.charge_name} — ${g.event_name}`,
            recorded_by: recordedBy,
            created_at:  paidAt,
          })
          .select("id")
          .single();
        if (payErr || !payTx) throw new Error(`Charge payment transaction failed for "${g.charge_name}": ${payErr?.message}`);
        epcInsert.payment_transaction_id = (payTx as any).id;
        summary.payment_transactions_created++;
      }

      const { error: epcErr } = await admin.from("event_player_charges").insert(epcInsert);
      if (epcErr) throw new Error(`Assign charge "${g.charge_name}" failed: ${epcErr.message}`);
      summary.player_charges_created++;
    }
  }
}

// ── Payments ──────────────────────────────────────────────────────────────────
// Standalone payment records (e.g. a member settling their balance after the
// event). Amount blank = auto-settle: pay off the player's outstanding imported
// debits (entry fees + pot buy-ins + unpaid charges) for the event — or their
// whole group balance when no event is given. Idempotent via the exact note.
export async function importPayments(args: {
  admin: Admin;
  groupId: string;
  recordedBy: string;
  paymentRows: ParsedPayment[];
  eventIdByName: Map<string, string>;
  eventDateByName: Map<string, string>;
  summary: any;
}) {
  const { admin, groupId, recordedBy, paymentRows, eventIdByName, eventDateByName, summary } = args;

  for (const row of paymentRows) {
    if (!row.profile_id) throw new Error(`Payment: player "${row.player_label}" did not resolve to a profile`);
    const eventId = row.event_name ? (eventIdByName.get(row.event_name) ?? (row.event_id || null)) : null;
    if (row.event_name && !eventId) {
      throw new Error(`Payment for "${row.player_label}": event "${row.event_name}" did not resolve`);
    }

    const note = importedPaymentNote(row.player_label, row.event_name || null, row.note);

    // Idempotency: an identical imported payment already exists → skip
    const { data: existing, error: exErr } = await admin
      .from("group_balance_transactions")
      .select("id")
      .eq("group_id", groupId)
      .eq("profile_id", row.profile_id)
      .eq("type", "payment")
      .eq("note", note)
      .limit(1)
      .maybeSingle();
    if (exErr) throw new Error(`Payment lookup failed for "${row.player_label}": ${exErr.message}`);
    if (existing) {
      summary.payments_skipped++;
      continue;
    }

    let amount = row.amount;
    if (amount == null) {
      // Auto-settle: outstanding = debits + payments-to-date (payments are negative)
      let q = admin
        .from("group_balance_transactions")
        .select("type,amount")
        .eq("group_id", groupId)
        .eq("profile_id", row.profile_id);
      if (eventId) q = q.eq("event_id", eventId);
      const { data: txs, error: txErr } = await q;
      if (txErr) throw new Error(`Balance lookup failed for "${row.player_label}": ${txErr.message}`);
      let outstanding = 0;
      for (const t of txs ?? []) {
        const ty = (t as any).type as string;
        const amt = Number((t as any).amount) || 0;
        if (DEBIT_TYPES.includes(ty)) outstanding += amt;
        else if (ty === "payment") outstanding += amt; // negative
      }
      if (outstanding <= 0) {
        summary.payments_skipped++;
        continue;
      }
      amount = outstanding;
    }
    if (amount <= 0) {
      summary.payments_skipped++;
      continue;
    }

    const payDate = row.payment_date
      || (row.event_name ? eventDateByName.get(row.event_name) : null)
      || new Date().toISOString().slice(0, 10);

    const { error: insErr } = await admin.from("group_balance_transactions").insert({
      group_id:    groupId,
      profile_id:  row.profile_id,
      event_id:    eventId,
      type:        "payment",
      amount:      -Math.abs(amount),
      note,
      recorded_by: recordedBy,
      created_at:  `${payDate}T18:00:00.000Z`,
    });
    if (insErr) throw new Error(`Payment insert failed for "${row.player_label}": ${insErr.message}`);
    summary.payment_transactions_created++;
  }
}
