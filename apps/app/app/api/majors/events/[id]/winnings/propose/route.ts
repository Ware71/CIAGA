import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// POST /api/majors/competitions/[id]/winnings/propose
// Reads the leaderboard and prize_table config, returns proposed payout amounts.
// The admin reviews these and confirms by hitting POST /winnings for each.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const event = await getEventById(id);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    if (!event.group_id) {
      return NextResponse.json({ error: "Event must be linked to a group." }, { status: 400 });
    }

    const { data: membership } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", event.group_id)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership || !["owner", "admin"].includes((membership as any).role)) {
      return NextResponse.json({ error: "Only group owner or admin can propose winnings." }, { status: 403 });
    }

    const prizeTable = (event as any).prize_table as Array<{ position: number; pct: number }> | null;
    if (!prizeTable || prizeTable.length === 0) {
      return NextResponse.json(
        { error: "No prize table configured for this event. Set one in event settings." },
        { status: 400 }
      );
    }

    // Calculate total pot from entry fees collected for this event
    const { data: feeRows } = await supabaseAdmin
      .from("group_balance_transactions")
      .select("amount")
      .eq("event_id", id)
      .eq("type", "entry_fee");

    const totalPot = (feeRows ?? []).reduce((sum: number, r: any) => sum + Math.abs(r.amount), 0);

    if (totalPot === 0) {
      return NextResponse.json(
        { error: "No entry fees have been collected for this event — nothing to distribute." },
        { status: 400 }
      );
    }

    // Fetch leaderboard sorted by position
    const { data: leaderboard } = await supabaseAdmin
      .from("event_leaderboard_entries")
      .select(`
        profile_id, position,
        profile:profiles!profile_id(id, name, avatar_url)
      `)
      .eq("event_id", id)
      .not("position", "is", null)
      .order("position", { ascending: true });

    if (!leaderboard || leaderboard.length === 0) {
      return NextResponse.json({ error: "No leaderboard data yet." }, { status: 400 });
    }

    const proposed = prizeTable
      .map((entry) => {
        const player = (leaderboard as any[]).find((l) => l.position === entry.position);
        if (!player) return null;
        const amount = Math.round((totalPot * entry.pct) / 100 * 100) / 100;
        return {
          profile_id: player.profile_id,
          profile: player.profile,
          position: entry.position,
          amount,
        };
      })
      .filter(Boolean);

    return NextResponse.json({ total_pot: totalPot, proposed });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
