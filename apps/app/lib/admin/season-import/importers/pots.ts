import type { SupabaseClient } from "@supabase/supabase-js";
import type { ParsedPot, ParsedPayout } from "../parse";

type Admin = SupabaseClient;

// ── Prize pots + payouts ────────────────────────────────────────────────────────
// Creates event-scoped pots, auto-enrols every player who scored the event (charging
// the buy-in once), and records winners from the Payouts sheet. Idempotent: existing
// pots/entries/payouts are reused/skipped so re-import never double-charges.
// Transactions are backdated: buy-ins to the event morning, winnings to just after
// the last round finished (i.e. after any playoff completed).
export async function importPrizePots(args: {
  admin: Admin;
  groupId: string;
  recordedBy: string;
  potRows: ParsedPot[];
  payoutRows: ParsedPayout[];
  eventIdByName: Map<string, string>;
  scoredByEvent: Map<string, Set<string>>;
  eventDateByName: Map<string, string>;
  eventFinishTimes: Map<string, string>; // event_id → ISO finish of last imported round
  summary: any;
}) {
  const { admin, groupId, recordedBy, potRows, payoutRows, eventIdByName, scoredByEvent, eventDateByName, eventFinishTimes, summary } = args;
  if (!potRows.length) return;

  for (const pot of potRows) {
    const eventId = eventIdByName.get(pot.event_name) ?? (pot.event_id || null);
    if (!eventId) throw new Error(`Prize pot "${pot.pot_name}": event "${pot.event_name}" did not resolve`);

    const eventDate  = eventDateByName.get(pot.event_name);
    const enrolledAt = eventDate ? `${eventDate}T09:30:00.000Z` : new Date().toISOString();
    const finishIso  = eventFinishTimes.get(eventId);
    const paidOutAt  = finishIso
      ? new Date(new Date(finishIso).getTime() + 40 * 60_000).toISOString()
      : (eventDate ? `${eventDate}T18:00:00.000Z` : new Date().toISOString());

    // Find or create the pot (idempotent by event_id + name)
    const { data: existingPot, error: epErr } = await admin
      .from("prize_pots")
      .select("id,status")
      .eq("event_id", eventId)
      .eq("name", pot.pot_name)
      .maybeSingle();
    if (epErr) throw new Error(`Prize pot lookup failed for "${pot.pot_name}": ${epErr.message}`);

    let potId: string;
    let potStatus: string;
    if (existingPot) {
      potId = (existingPot as any).id;
      potStatus = (existingPot as any).status;
    } else {
      const { data: newPot, error: npErr } = await admin
        .from("prize_pots")
        .insert({
          group_id:          groupId,
          event_id:          eventId,
          name:              pot.pot_name,
          description:       pot.description,
          entry_fee_amount:  pot.entry_fee_amount,
          distribution_type: pot.distribution_type,
          metric_type:       pot.metric_type || null,
          is_monetary:       pot.is_monetary,
          prize_description: pot.prize_description,
          status:            "active",
          created_by:        recordedBy,
          created_at:        enrolledAt,
        })
        .select("id,status")
        .single();
      if (npErr || !newPot) throw new Error(`Create prize pot "${pot.pot_name}" failed: ${npErr?.message}`);
      potId = (newPot as any).id;
      potStatus = (newPot as any).status;
      summary.prize_pots_created++;
    }

    // Auto-enrol players who scored the event (skip already-enrolled; charge fee once)
    const scored = Array.from(scoredByEvent.get(pot.event_name) ?? new Set<string>());
    if (scored.length) {
      const { data: existingEntries } = await admin
        .from("prize_pot_entries")
        .select("profile_id")
        .eq("prize_pot_id", potId)
        .in("profile_id", scored);
      const enrolled = new Set((existingEntries ?? []).map((e: any) => e.profile_id));
      const toEnrol  = scored.filter(p => !enrolled.has(p));
      const fee      = pot.entry_fee_amount ?? 0;

      const txnByProfile = new Map<string, string>();
      if (fee > 0 && toEnrol.length) {
        const txns = toEnrol.map(pid => ({
          group_id: groupId, profile_id: pid, event_id: eventId,
          type: "entry_fee", amount: fee, note: `Entry fee: ${pot.pot_name}`, recorded_by: recordedBy,
          created_at: enrolledAt,
        }));
        const { data: txnRows, error: txnErr } = await admin
          .from("group_balance_transactions").insert(txns).select("id,profile_id");
        if (txnErr) throw new Error(`Pot entry-fee transaction failed for "${pot.pot_name}": ${txnErr.message}`);
        for (const t of txnRows ?? []) txnByProfile.set((t as any).profile_id, (t as any).id);
        summary.pot_entry_fee_transactions += txnRows?.length ?? 0;
      }

      if (toEnrol.length) {
        const entries = toEnrol.map(pid => ({
          prize_pot_id: potId, profile_id: pid,
          amount_contributed: fee, transaction_id: txnByProfile.get(pid) ?? null,
          enrolled_at: enrolledAt,
        }));
        const { error: entErr } = await admin.from("prize_pot_entries").insert(entries);
        if (entErr) throw new Error(`Pot enrolment failed for "${pot.pot_name}": ${entErr.message}`);
        summary.pot_entries_created += entries.length;
      }
    }

    // Payouts (winners listed on the Payouts sheet)
    const potPayouts = payoutRows.filter(p => p.event_name === pot.event_name && p.pot_name === pot.pot_name && p.profile_id);
    if (potPayouts.length) {
      const { data: existingPayouts } = await admin
        .from("prize_pot_payouts").select("profile_id,position").eq("prize_pot_id", potId);
      const payoutKey = (pid: string, pos: number | null) => `${pid}::${pos ?? ""}`;
      const existingKeys = new Set((existingPayouts ?? []).map((p: any) => payoutKey(p.profile_id, p.position)));
      const toInsert = potPayouts.filter(p => !existingKeys.has(payoutKey(p.profile_id, p.position)));

      if (toInsert.length) {
        const rows = toInsert.map(p => ({
          prize_pot_id: potId, profile_id: p.profile_id,
          position: p.position, amount: p.amount, note: p.note ?? null, recorded_by: recordedBy,
          recorded_at: paidOutAt,
        }));
        const { data: inserted, error: poErr } = await admin
          .from("prize_pot_payouts").insert(rows).select("id,profile_id,amount");
        if (poErr) throw new Error(`Pot payout insert failed for "${pot.pot_name}": ${poErr.message}`);
        summary.pot_payouts_created += inserted?.length ?? 0;

        const monetary = (inserted ?? []).filter((p: any) => p.amount != null && p.amount > 0);
        if (monetary.length) {
          const txns = monetary.map((p: any) => ({
            group_id: groupId, profile_id: p.profile_id, event_id: eventId,
            type: "winnings", amount: -Math.abs(p.amount), note: `${pot.pot_name} payout`, recorded_by: recordedBy,
            created_at: paidOutAt,
          }));
          const { data: txnRows, error: txnErr } = await admin
            .from("group_balance_transactions").insert(txns).select("id,profile_id");
          if (txnErr) throw new Error(`Pot winnings transaction failed for "${pot.pot_name}": ${txnErr.message}`);
          summary.pot_winnings_transactions += txnRows?.length ?? 0;
          const txnByProfile = new Map<string, string>();
          for (const t of txnRows ?? []) txnByProfile.set((t as any).profile_id, (t as any).id);
          for (const p of monetary as any[]) {
            const tid = txnByProfile.get(p.profile_id);
            if (tid) await admin.from("prize_pot_payouts").update({ transaction_id: tid }).eq("id", p.id);
          }
        }
      }

      if (potStatus !== "distributed") {
        await admin.from("prize_pots")
          .update({ status: "distributed", updated_at: paidOutAt })
          .eq("id", potId);
      }
    }
  }
}
