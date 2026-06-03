import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

type ProposedPayout = {
  profile_id: string;
  profile: { id: string; name: string | null; avatar_url: string | null } | null;
  position: number | null;
  amount: number | null;
  note: string;
};

// POST /api/majors/prize-pots/[potId]/distribute
// Body: { confirm: boolean }
// confirm=false → propose payouts (read-only, returns calculated amounts)
// confirm=true  → write prize_pot_payouts + group_balance_transactions + set pot status='distributed'
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
      return NextResponse.json({ error: "This pot has already been distributed." }, { status: 400 });
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

    const body = await req.json();
    const confirm: boolean = body.confirm === true;

    const distributionType: string = (pot as any).distribution_type;

    if (distributionType === "entry_only") {
      return NextResponse.json({ error: "This pot is entry-only — there is nothing to distribute." }, { status: 400 });
    }

    // Get all entries with profile data
    const { data: entries } = await supabaseAdmin
      .from("prize_pot_entries")
      .select("*, profile:profiles!profile_id(id, name, avatar_url)")
      .eq("prize_pot_id", potId);

    if (!entries || entries.length === 0) {
      return NextResponse.json({ error: "No players are enrolled in this pot." }, { status: 400 });
    }

    const totalPot = (entries as any[]).reduce((sum, e) => sum + (e.amount_contributed ?? 0), 0);

    let proposed: ProposedPayout[] = [];

    switch (distributionType) {
      case "non_monetary": {
        // No amounts — admin will provide notes via manual record; propose empty list
        proposed = [];
        break;
      }

      case "equal_split": {
        const share = totalPot > 0 ? Math.round((totalPot / entries.length) * 100) / 100 : 0;
        proposed = (entries as any[]).map((e) => ({
          profile_id: e.profile_id,
          profile: e.profile ?? null,
          position: null,
          amount: share,
          note: `Equal split (${entries.length} players)`,
        }));
        break;
      }

      case "metric_weighted": {
        const totalMetric = (entries as any[]).reduce((sum, e) => sum + (e.metric_value ?? 0), 0);
        if (totalMetric === 0) {
          return NextResponse.json({ error: "No metric values recorded — cannot distribute." }, { status: 400 });
        }
        proposed = (entries as any[])
          .filter((e) => (e.metric_value ?? 0) > 0)
          .map((e) => ({
            profile_id: e.profile_id,
            profile: e.profile ?? null,
            position: null,
            amount: Math.round((totalPot * e.metric_value) / totalMetric * 100) / 100,
            note: `${e.metric_value} ${(pot as any).metric_type ?? "metric"} (weighted share)`,
          }));
        break;
      }

      case "metric_equal": {
        const qualifiers = (entries as any[]).filter((e) => (e.metric_value ?? 0) >= 1);
        if (qualifiers.length === 0) {
          return NextResponse.json({ error: "No players qualified (metric_value >= 1 required)." }, { status: 400 });
        }
        const share = Math.round((totalPot / qualifiers.length) * 100) / 100;
        proposed = qualifiers.map((e) => ({
          profile_id: e.profile_id,
          profile: e.profile ?? null,
          position: null,
          amount: share,
          note: `${e.metric_value} ${(pot as any).metric_type ?? "metric"} (equal share among ${qualifiers.length} qualifiers)`,
        }));
        break;
      }

      case "position_based": {
        const prizeTable = (pot as any).prize_table as Array<{ position: number; pct: number }> | null;
        if (!prizeTable || prizeTable.length === 0) {
          return NextResponse.json({ error: "No prize table configured for this pot." }, { status: 400 });
        }

        // Resolve positions — for event pots use event leaderboard; for group-season pots use group season standings
        let positionMap: Record<number, { profile_id: string; profile: unknown }> = {};

        if ((pot as any).event_id) {
          const { data: lb } = await supabaseAdmin
            .from("event_leaderboard_entries")
            .select("profile_id, position, profile:profiles!profile_id(id, name, avatar_url)")
            .eq("event_id", (pot as any).event_id)
            .not("position", "is", null);

          for (const row of lb ?? [] as any[]) {
            positionMap[row.position] = { profile_id: row.profile_id, profile: row.profile };
          }
        } else if ((pot as any).group_season_id) {
          const { data: standings } = await supabaseAdmin
            .from("group_season_standings_entries")
            .select("profile_id, position, profile:profiles!profile_id(id, name, avatar_url)")
            .eq("group_season_id", (pot as any).group_season_id)
            .not("position", "is", null);

          for (const row of standings ?? [] as any[]) {
            positionMap[row.position] = { profile_id: row.profile_id, profile: row.profile };
          }
        }

        proposed = prizeTable
          .flatMap((entry) => {
            const player = positionMap[entry.position];
            if (!player) return [];
            const p: ProposedPayout = {
              profile_id: player.profile_id,
              profile: player.profile as any,
              position: entry.position,
              amount: totalPot > 0 ? Math.round((totalPot * entry.pct) / 100 * 100) / 100 : 0,
              note: `Position ${entry.position} (${entry.pct}% of pot)`,
            };
            return [p];
          });

        if (proposed.length === 0) {
          return NextResponse.json({ error: "No leaderboard/standings data found to determine positions." }, { status: 400 });
        }
        break;
      }

      default:
        return NextResponse.json({ error: `Unknown distribution_type: ${distributionType}` }, { status: 400 });
    }

    if (!confirm) {
      return NextResponse.json({ total_pot: totalPot, proposed });
    }

    // ── Confirm: write payouts + transactions ──────────────────────────────────

    const payoutRows = proposed.map((p) => ({
      prize_pot_id: potId,
      profile_id: p.profile_id,
      position: p.position ?? null,
      amount: p.amount ?? null,
      note: p.note,
      recorded_by: profileId,
    }));

    const { data: insertedPayouts, error: payoutErr } = await supabaseAdmin
      .from("prize_pot_payouts")
      .insert(payoutRows)
      .select("id, profile_id, amount");

    if (payoutErr) throw payoutErr;

    // Create credit transactions for monetary payouts
    const monetaryPayouts = (insertedPayouts ?? []).filter((p: any) => p.amount != null && p.amount > 0);
    if (monetaryPayouts.length > 0) {
      const txns = monetaryPayouts.map((p: any) => ({
        group_id: (pot as any).group_id,
        profile_id: p.profile_id,
        event_id: (pot as any).event_id ?? null,
        type: "winnings",
        amount: -Math.abs(p.amount), // negative = credit to player
        note: `${(pot as any).name} payout`,
        recorded_by: profileId,
      }));

      const { data: txnRows, error: txnErr } = await supabaseAdmin
        .from("group_balance_transactions")
        .insert(txns)
        .select("id, profile_id");

      if (txnErr) throw txnErr;

      // Link transactions back to payout rows
      const txnByProfile: Record<string, string> = {};
      for (const t of txnRows ?? [] as any[]) {
        txnByProfile[t.profile_id] = t.id;
      }

      for (const payout of monetaryPayouts as any[]) {
        const txnId = txnByProfile[payout.profile_id];
        if (txnId) {
          await supabaseAdmin
            .from("prize_pot_payouts")
            .update({ transaction_id: txnId })
            .eq("id", payout.id);
        }
      }
    }

    // Mark pot as distributed
    await supabaseAdmin
      .from("prize_pots")
      .update({ status: "distributed", updated_at: new Date().toISOString() })
      .eq("id", potId);

    return NextResponse.json({ ok: true, total_pot: totalPot, payouts: insertedPayouts?.length ?? 0 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
