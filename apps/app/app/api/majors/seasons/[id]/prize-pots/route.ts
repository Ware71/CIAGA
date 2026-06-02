import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

async function getSeasonAndAssertAdminOrOwner(seasonId: string, profileId: string) {
  const { data: season } = await supabaseAdmin
    .from("competition_seasons")
    .select("id, competition_id, competitions!inner(group_id)")
    .eq("id", seasonId)
    .maybeSingle();

  if (!season) return { season: null, groupId: null, authorized: false };

  const groupId = (season as any).competitions?.group_id as string | null;
  if (!groupId) return { season, groupId: null, authorized: false };

  const { data: m } = await supabaseAdmin
    .from("major_group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle();

  return {
    season,
    groupId,
    authorized: !!(m && ["owner", "admin"].includes((m as any).role)),
  };
}

// GET /api/majors/seasons/[id]/prize-pots
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const { data: pots, error } = await supabaseAdmin
      .from("prize_pots")
      .select("*")
      .eq("competition_season_id", id)
      .order("created_at", { ascending: true });

    if (error) throw error;
    if (!pots || pots.length === 0) {
      return NextResponse.json({ pots: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    const potIds = pots.map((p: any) => p.id);
    const [{ data: entries }, { data: payouts }] = await Promise.all([
      supabaseAdmin
        .from("prize_pot_entries")
        .select("*, profile:profiles!profile_id(id, name, avatar_url)")
        .in("prize_pot_id", potIds),
      supabaseAdmin
        .from("prize_pot_payouts")
        .select("*, profile:profiles!profile_id(id, name, avatar_url)")
        .in("prize_pot_id", potIds)
        .order("position", { ascending: true, nullsFirst: false }),
    ]);

    const enriched = pots.map((pot: any) => {
      const potEntries = (entries ?? []).filter((e: any) => e.prize_pot_id === pot.id);
      const potPayouts = (payouts ?? []).filter((p: any) => p.prize_pot_id === pot.id);
      const total_pot = potEntries.reduce((sum: number, e: any) => sum + (e.amount_contributed ?? 0), 0);
      return { ...pot, entries: potEntries, payouts: potPayouts, total_pot };
    });

    return NextResponse.json({ pots: enriched }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

// POST /api/majors/seasons/[id]/prize-pots
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const { season, groupId, authorized } = await getSeasonAndAssertAdminOrOwner(id, profileId);
    if (!season) return NextResponse.json({ error: "Season not found." }, { status: 404 });
    if (!authorized || !groupId) return NextResponse.json({ error: "Not authorised." }, { status: 403 });

    const body = await req.json();
    const {
      name,
      description,
      distribution_type = "position_based",
      entry_fee_amount,
      entry_fee_currency = "GBP",
      entry_fee_notes,
      prize_table,
      metric_type,
      metric_description,
      is_monetary = true,
      prize_description,
    } = body as Record<string, unknown>;

    if (!String(name ?? "").trim()) {
      return NextResponse.json({ error: "name is required." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("prize_pots")
      .insert({
        group_id: groupId,
        competition_season_id: id,
        name: String(name).trim(),
        description: description ?? null,
        distribution_type,
        entry_fee_amount: entry_fee_amount ?? null,
        entry_fee_currency: entry_fee_currency ?? "GBP",
        entry_fee_notes: entry_fee_notes ?? null,
        prize_table: prize_table ?? null,
        metric_type: metric_type ?? null,
        metric_description: metric_description ?? null,
        is_monetary: is_monetary ?? true,
        prize_description: prize_description ?? null,
        created_by: profileId,
      })
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ pot: { ...data, entries: [], payouts: [], total_pot: 0 } }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
