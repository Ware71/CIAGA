import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// POST /api/majors/prize-pots/[potId]/enroll
// Bulk-enrolls players into a pot. For event pots, uses all entered players.
// For season pots, body must include { profile_ids: string[] }.
// If entry_fee_amount > 0, creates debit transactions for each player enrolled.
// Already-enrolled players are skipped.
export async function POST(req: Request, { params }: { params: Promise<{ potId: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { potId } = await params;

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
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();

    if (!m || !["owner", "admin"].includes((m as any).role)) {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    let targetProfileIds: string[] = [];

    if ((pot as any).event_id) {
      // Event pot: enroll all entered players
      const { data: participants } = await supabaseAdmin
        .from("event_participants")
        .select("profile_id")
        .eq("event_id", (pot as any).event_id)
        .eq("status", "entered");

      targetProfileIds = (participants ?? []).map((p: any) => p.profile_id).filter(Boolean);
    } else {
      // Season pot: caller provides profile_ids
      const body = await req.json().catch(() => ({}));
      targetProfileIds = (body.profile_ids ?? []) as string[];
    }

    if (targetProfileIds.length === 0) {
      return NextResponse.json({ enrolled: 0, skipped: 0 });
    }

    // Find already-enrolled to skip
    const { data: existing } = await supabaseAdmin
      .from("prize_pot_entries")
      .select("profile_id")
      .eq("prize_pot_id", potId)
      .in("profile_id", targetProfileIds);

    const alreadyEnrolled = new Set((existing ?? []).map((e: any) => e.profile_id));
    const toEnroll = targetProfileIds.filter((pid) => !alreadyEnrolled.has(pid));

    if (toEnroll.length === 0) {
      return NextResponse.json({ enrolled: 0, skipped: alreadyEnrolled.size });
    }

    const entryFee: number = (pot as any).entry_fee_amount ?? 0;
    const groupId: string = (pot as any).group_id;

    // Insert entries + transactions in parallel batches
    const entries: Array<Record<string, unknown>> = [];
    const txns: Array<Record<string, unknown>> = [];

    for (const pid of toEnroll) {
      if (entryFee > 0) {
        txns.push({
          group_id: groupId,
          profile_id: pid,
          event_id: (pot as any).event_id ?? null,
          type: "entry_fee",
          amount: entryFee, // positive = charge to player
          note: `Entry fee: ${(pot as any).name}`,
          recorded_by: profileId,
        });
      }
    }

    // Insert transactions first so we get IDs for linking
    let txnMap: Record<string, string> = {};
    if (txns.length > 0) {
      const { data: txnRows, error: txnErr } = await supabaseAdmin
        .from("group_balance_transactions")
        .insert(txns)
        .select("id, profile_id");
      if (txnErr) throw txnErr;
      txnMap = Object.fromEntries((txnRows ?? []).map((r: any) => [r.profile_id, r.id]));
    }

    for (const pid of toEnroll) {
      entries.push({
        prize_pot_id: potId,
        profile_id: pid,
        amount_contributed: entryFee,
        transaction_id: txnMap[pid] ?? null,
      });
    }

    const { error: entryErr } = await supabaseAdmin.from("prize_pot_entries").insert(entries);
    if (entryErr) throw entryErr;

    return NextResponse.json({ enrolled: toEnroll.length, skipped: alreadyEnrolled.size });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
