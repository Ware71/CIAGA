import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/seasons/[id]/financials
// Returns a financial summary aggregated across all events in the season.
// Owner/admin only.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: seasonId } = await params;

    // Fetch the season to get its competition/group
    const { data: season } = await supabaseAdmin
      .from("competition_seasons")
      .select("id, competition_id, season_year, name")
      .eq("id", seasonId)
      .maybeSingle();

    if (!season) return NextResponse.json({ error: "Season not found" }, { status: 404 });

    // Get the group via the competition
    const { data: competition } = await supabaseAdmin
      .from("competitions")
      .select("group_id")
      .eq("id", (season as any).competition_id)
      .maybeSingle();

    const groupId = (competition as any)?.group_id;

    if (groupId) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", groupId)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json({ error: "Only group owner or admin can view season financials." }, { status: 403 });
      }
    }

    // Get all events in this season
    const { data: events } = await supabaseAdmin
      .from("events")
      .select("id, name")
      .eq("season_id", seasonId);

    const eventIds = (events ?? []).map((e: any) => e.id);

    if (eventIds.length === 0) {
      return NextResponse.json({
        season_id: seasonId,
        total_entry_fees: 0,
        total_extras: 0,
        total_winnings_paid: 0,
        pot_balance: 0,
        per_player: [],
      });
    }

    // Fetch all balance transactions for these events
    const { data: transactions, error } = await supabaseAdmin
      .from("group_balance_transactions")
      .select(`
        profile_id, type, amount,
        profile:profiles!profile_id(id, name, avatar_url)
      `)
      .in("event_id", eventIds);

    if (error) throw error;

    let total_entry_fees = 0;
    let total_extras = 0;
    let total_winnings_paid = 0;

    const byPlayer = new Map<string, {
      profile_id: string;
      profile: any;
      charged: number;
      paid: number;
      winnings: number;
    }>();

    for (const tx of transactions ?? []) {
      const pid = (tx as any).profile_id;
      if (!byPlayer.has(pid)) {
        byPlayer.set(pid, {
          profile_id: pid,
          profile: (tx as any).profile,
          charged: 0,
          paid: 0,
          winnings: 0,
        });
      }
      const entry = byPlayer.get(pid)!;
      const amount = (tx as any).amount as number;
      const type = (tx as any).type as string;

      if (type === "entry_fee") {
        total_entry_fees += amount;
        entry.charged += amount;
      } else if (type === "extra_charge") {
        total_extras += amount;
        entry.charged += amount;
      } else if (type === "payment") {
        entry.paid += Math.abs(amount);
      } else if (type === "winnings") {
        total_winnings_paid += Math.abs(amount);
        entry.winnings += Math.abs(amount);
      }
    }

    const per_player = Array.from(byPlayer.values())
      .map((p) => ({
        ...p,
        net_balance: p.charged - p.paid - p.winnings,
      }))
      .sort((a, b) => (a.profile?.name ?? "").localeCompare(b.profile?.name ?? ""));

    return NextResponse.json(
      {
        season_id: seasonId,
        total_entry_fees,
        total_extras,
        total_winnings_paid,
        pot_balance: total_entry_fees + total_extras - total_winnings_paid,
        per_player,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
