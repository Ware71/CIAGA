import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";

export const runtime = "nodejs";

async function assertAdminOrOwner(eventId: string, profileId: string) {
  const event = await getEventById(eventId);
  if (!event) return null;
  if (!event.group_id) return null;
  const { data: m } = await supabaseAdmin
    .from("major_group_memberships")
    .select("role")
    .eq("group_id", event.group_id)
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle();
  if (!m || !["owner", "admin"].includes((m as any).role)) return null;
  return event;
}

// GET /api/majors/events/[id]/prize-pots
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const { data: pots, error: potsErr } = await supabaseAdmin
      .from("prize_pots")
      .select("*")
      .eq("event_id", id)
      .order("created_at", { ascending: true });

    if (potsErr) throw potsErr;

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

// POST /api/majors/events/[id]/prize-pots
// Body: { name, description?, distribution_type, entry_fee_amount?, entry_fee_currency?, entry_fee_notes?,
//         prize_table?, metric_type?, metric_description?, is_monetary?, prize_description? }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const event = await assertAdminOrOwner(id, profileId);
    if (!event) return NextResponse.json({ error: "Not authorised or event not found." }, { status: 403 });

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
      is_mandatory = false,
    } = body as {
      name: string;
      description?: string;
      distribution_type?: string;
      entry_fee_amount?: number;
      entry_fee_currency?: string;
      entry_fee_notes?: string;
      prize_table?: Array<{ position: number; pct: number }>;
      metric_type?: string;
      metric_description?: string;
      is_monetary?: boolean;
      prize_description?: string;
      is_mandatory?: boolean;
    };

    if (!name?.trim()) {
      return NextResponse.json({ error: "name is required." }, { status: 400 });
    }

    const validDistTypes = ["position_based", "metric_weighted", "metric_equal", "equal_split", "non_monetary", "entry_only"];
    if (!validDistTypes.includes(distribution_type)) {
      return NextResponse.json({ error: "Invalid distribution_type." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("prize_pots")
      .insert({
        group_id: event.group_id,
        event_id: id,
        name: name.trim(),
        description: description ?? null,
        distribution_type,
        entry_fee_amount: entry_fee_amount ?? null,
        entry_fee_currency,
        entry_fee_notes: entry_fee_notes ?? null,
        prize_table: prize_table ?? null,
        metric_type: metric_type ?? null,
        metric_description: metric_description ?? null,
        is_monetary,
        prize_description: prize_description ?? null,
        is_mandatory,
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
