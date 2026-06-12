import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/groups/[id]/winnings
// Any active group member can view the prize pot P&L summary.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: groupId } = await params;

    const { data: membership } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", groupId)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: "Not a member of this group." }, { status: 403 });
    }

    // ── Fetch all prize pots for this group ────────────────────────────────
    const { data: pots } = await supabaseAdmin
      .from("prize_pots")
      .select("id, name, event_id, group_season_id, distribution_type, is_monetary")
      .eq("group_id", groupId);

    if (!pots || pots.length === 0) {
      return NextResponse.json({ members: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const potIds = pots.map((p: any) => p.id);

    // ── Fetch entries, payouts, and winnings/withdrawal transactions ───────
    const [
      { data: entries },
      { data: payouts },
      { data: winningsTxs },
      { data: members },
    ] = await Promise.all([
      supabaseAdmin
        .from("prize_pot_entries")
        .select("prize_pot_id, profile_id, amount_contributed, enrolled_at")
        .in("prize_pot_id", potIds),
      supabaseAdmin
        .from("prize_pot_payouts")
        .select("prize_pot_id, profile_id, amount, position, recorded_at")
        .in("prize_pot_id", potIds),
      supabaseAdmin
        .from("group_balance_transactions")
        .select("profile_id, type, amount, created_at")
        .eq("group_id", groupId)
        .in("type", ["winnings", "withdrawal"]),
      supabaseAdmin
        .from("major_group_memberships")
        .select("profile_id, profile:profiles!profile_id(id, name, avatar_url)")
        .eq("group_id", groupId)
        .eq("status", "active"),
    ]);

    // ── Resolve event/season names ─────────────────────────────────────────
    const eventIds = [...new Set(pots.filter((p: any) => p.event_id).map((p: any) => p.event_id))];
    const groupSeasonIds = [...new Set(pots.filter((p: any) => p.group_season_id).map((p: any) => p.group_season_id))];

    const [{ data: events }, { data: groupSeasons }] = await Promise.all([
      eventIds.length > 0
        ? supabaseAdmin.from("events").select("id, name, group_season_id").in("id", eventIds)
        : Promise.resolve({ data: [] }),
      groupSeasonIds.length > 0
        ? supabaseAdmin.from("group_seasons").select("id, name").in("id", groupSeasonIds)
        : Promise.resolve({ data: [] }),
    ]);

    const eventMap = new Map((events ?? []).map((e: any) => [e.id, e]));
    const groupSeasonMap = new Map((groupSeasons ?? []).map((s: any) => [s.id, s]));

    // Build pot metadata lookup
    const potMeta = new Map(
      pots.map((p: any) => {
        const event = p.event_id ? eventMap.get(p.event_id) : null;
        const effectiveGroupSeasonId = p.group_season_id ?? (event?.group_season_id ?? null);
        const groupSeason = effectiveGroupSeasonId ? groupSeasonMap.get(effectiveGroupSeasonId) : null;
        const seasonName = groupSeason?.name ?? null;

        return [
          p.id,
          {
            pot_id: p.id,
            pot_name: p.name,
            event_id: p.event_id,
            event_name: event?.name ?? null,
            season_id: effectiveGroupSeasonId ?? null,
            season_name: seasonName,
            group_season_id: effectiveGroupSeasonId,
          },
        ];
      })
    );

    // ── Aggregate per player ───────────────────────────────────────────────
    type SeasonBucket = {
      group_season_id: string | null;
      season_name: string;
      spent: number;
      won: number;
    };

    const byPlayer = new Map<
      string,
      {
        profile_id: string;
        profile: any;
        all_time_spent: number;
        all_time_won: number;
        undrawn_winnings: number;
        seasons: Map<string, SeasonBucket>;
        pot_history: any[];
      }
    >();

    const ensurePlayer = (pid: string, profile: any) => {
      if (!byPlayer.has(pid)) {
        byPlayer.set(pid, {
          profile_id: pid,
          profile,
          all_time_spent: 0,
          all_time_won: 0,
          undrawn_winnings: 0,
          seasons: new Map(),
          pot_history: [],
        });
      }
      return byPlayer.get(pid)!;
    };

    // Seed from member list so all active members appear even with no history
    for (const m of members ?? []) {
      ensurePlayer((m as any).profile_id, (m as any).profile);
    }

    for (const entry of entries ?? []) {
      const meta = potMeta.get((entry as any).prize_pot_id);
      if (!meta) continue;
      const pid = (entry as any).profile_id;
      const p = ensurePlayer(pid, null);
      const spent = Number((entry as any).amount_contributed ?? 0);
      p.all_time_spent += spent;

      const seasonKey = meta.season_id ?? "__none__";
      if (!p.seasons.has(seasonKey)) {
        p.seasons.set(seasonKey, {
          group_season_id: meta.group_season_id,
          season_name: meta.season_name ?? "Standalone Events",
          spent: 0,
          won: 0,
        });
      }
      p.seasons.get(seasonKey)!.spent += spent;

      p.pot_history.push({
        pot_id: meta.pot_id,
        pot_name: meta.pot_name,
        event_id: meta.event_id,
        event_name: meta.event_name,
        season_id: meta.season_id,
        season_name: meta.season_name,
        entry_fee: spent,
        payout_amount: null,
        payout_position: null,
        date: (entry as any).enrolled_at,
      });
    }

    for (const payout of payouts ?? []) {
      const meta = potMeta.get((payout as any).prize_pot_id);
      if (!meta) continue;
      const pid = (payout as any).profile_id;
      const p = ensurePlayer(pid, null);
      const won = Number((payout as any).amount ?? 0);
      p.all_time_won += won;

      const seasonKey = meta.season_id ?? "__none__";
      if (p.seasons.has(seasonKey)) {
        p.seasons.get(seasonKey)!.won += won;
      }

      // Update the matching pot_history entry with payout info
      const histEntry = p.pot_history.find(
        (h) => h.pot_id === meta.pot_id && h.payout_amount === null
      );
      if (histEntry) {
        histEntry.payout_amount = won;
        histEntry.payout_position = (payout as any).position ?? null;
      } else {
        p.pot_history.push({
          pot_id: meta.pot_id,
          pot_name: meta.pot_name,
          event_id: meta.event_id,
          event_name: meta.event_name,
          season_id: meta.season_id,
          season_name: meta.season_name,
          entry_fee: 0,
          payout_amount: won,
          payout_position: (payout as any).position ?? null,
          date: (payout as any).recorded_at,
        });
      }
    }

    // Compute undrawn winnings from ledger transactions
    for (const tx of winningsTxs ?? []) {
      const pid = (tx as any).profile_id;
      const p = byPlayer.get(pid);
      if (!p) continue;
      if ((tx as any).type === "winnings") {
        // winnings are stored as negative amounts (credit)
        p.undrawn_winnings += Math.abs(Number((tx as any).amount));
      } else if ((tx as any).type === "withdrawal") {
        // withdrawal is positive (reduces credit)
        p.undrawn_winnings -= Number((tx as any).amount);
      }
    }

    const result = Array.from(byPlayer.values()).map((p) => ({
      profile_id: p.profile_id,
      profile: p.profile,
      all_time_spent: p.all_time_spent,
      all_time_won: p.all_time_won,
      all_time_net: p.all_time_won - p.all_time_spent,
      undrawn_winnings: Math.max(0, p.undrawn_winnings),
      by_season: Array.from(p.seasons.values()),
      pot_history: p.pot_history.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      ),
    }));

    return NextResponse.json({ members: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
