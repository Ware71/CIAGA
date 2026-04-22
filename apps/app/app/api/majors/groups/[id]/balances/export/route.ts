import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/groups/[id]/balances/export
// Returns a CSV of all member transactions for the group (owner/admin only).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const { data: membership } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", id)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership || !["owner", "admin"].includes((membership as any).role)) {
      return NextResponse.json({ error: "Only group owner or admin can export balances." }, { status: 403 });
    }

    const { data: group } = await supabaseAdmin
      .from("major_groups")
      .select("name")
      .eq("id", id)
      .maybeSingle();

    const { data: transactions, error } = await supabaseAdmin
      .from("group_balance_transactions")
      .select(`
        id, profile_id, competition_id, type, amount, note, created_at,
        profile:profiles!profile_id(id, name),
        competition:competitions!competition_id(id, name)
      `)
      .eq("group_id", id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    // Build per-player summaries
    const byPlayer = new Map<string, {
      name: string;
      total_charged: number;
      total_paid: number;
      balance: number;
    }>();

    const rows: string[] = [];

    for (const tx of transactions ?? []) {
      const pid = (tx as any).profile_id;
      const playerName = (tx as any).profile?.name ?? pid;
      const competitionName = (tx as any).competition?.name ?? "";
      const amount = (tx as any).amount as number;

      rows.push([
        JSON.stringify(playerName),
        JSON.stringify(competitionName),
        JSON.stringify((tx as any).type),
        amount.toFixed(2),
        JSON.stringify((tx as any).note ?? ""),
        JSON.stringify((tx as any).created_at),
      ].join(","));

      if (!byPlayer.has(pid)) {
        byPlayer.set(pid, { name: playerName, total_charged: 0, total_paid: 0, balance: 0 });
      }
      const entry = byPlayer.get(pid)!;
      if (amount > 0) entry.total_charged += amount;
      else entry.total_paid += Math.abs(amount);
      entry.balance += amount;
    }

    const headers = [
      "Player",
      "Competition",
      "Type",
      "Amount",
      "Note",
      "Date",
    ].join(",");

    // Summary section
    const summaryHeaders = "\n\nSummary\nPlayer,Total Charged,Total Paid,Balance";
    const summaryRows = Array.from(byPlayer.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) =>
        [
          JSON.stringify(p.name),
          p.total_charged.toFixed(2),
          p.total_paid.toFixed(2),
          p.balance.toFixed(2),
        ].join(",")
      );

    const csv = [headers, ...rows, summaryHeaders, ...summaryRows].join("\n");

    const groupName = (group as any)?.name ?? id;
    const date = new Date().toISOString().split("T")[0];
    const filename = `balances-${groupName.replace(/\s+/g, "-")}-${date}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
