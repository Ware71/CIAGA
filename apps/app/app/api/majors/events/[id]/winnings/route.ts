import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";

export const runtime = "nodejs";

async function isAdminOrOwner(groupId: string, profileId: string) {
  const { data } = await supabaseAdmin
    .from("major_group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle();
  return data && ["owner", "admin"].includes((data as any).role);
}

// GET /api/majors/competitions/[id]/winnings
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const [{ data: manualWinnings, error }, { data: eventPots }] = await Promise.all([
      supabaseAdmin
        .from("event_winnings")
        .select(`
          id, event_id, profile_id, position, amount, note, recorded_by, created_at,
          profile:profiles!profile_id(id, name, avatar_url)
        `)
        .eq("event_id", id)
        .order("position", { ascending: true, nullsFirst: false }),
      supabaseAdmin
        .from("prize_pots")
        .select("id, name")
        .eq("event_id", id),
    ]);

    if (error) throw error;

    // Fetch pot payouts for any prize pots scoped to this event
    const potIds = (eventPots ?? []).map((p: any) => p.id as string);
    const potNameMap = new Map((eventPots ?? []).map((p: any) => [p.id as string, p.name as string]));
    let potWinnings: any[] = [];
    if (potIds.length > 0) {
      const { data: potPayouts } = await supabaseAdmin
        .from("prize_pot_payouts")
        .select(`
          id, prize_pot_id, profile_id, position, amount, recorded_at,
          profile:profiles!profile_id(id, name, avatar_url)
        `)
        .in("prize_pot_id", potIds)
        .order("position", { ascending: true, nullsFirst: false });
      potWinnings = (potPayouts ?? []).map((p: any) => ({
        ...p,
        event_id: id,
        note: potNameMap.get(p.prize_pot_id) ?? null,
        recorded_by: null,
        created_at: p.recorded_at,
        source: "pot",
      }));
    }

    const winnings = [...(manualWinnings ?? []), ...potWinnings].sort(
      (a, b) => (a.position ?? 9999) - (b.position ?? 9999)
    );

    return NextResponse.json({ winnings }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

// POST /api/majors/competitions/[id]/winnings
// Body: { profile_id: string, amount: number, position?: number, note?: string }
// Records a winner and creates the corresponding credit transaction.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const event = await getEventById(id);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    if (!event.group_id || !(await isAdminOrOwner(event.group_id, profileId))) {
      return NextResponse.json({ error: "Only group owner or admin can record winnings." }, { status: 403 });
    }

    const body = await req.json();
    const { profile_id, amount, position, note } = body as {
      profile_id: string;
      amount: number;
      position?: number;
      note?: string;
    };

    if (!profile_id || amount == null) {
      return NextResponse.json({ error: "profile_id and amount are required." }, { status: 400 });
    }

    // Insert winning record
    const { data: winning, error: winErr } = await supabaseAdmin
      .from("event_winnings")
      .insert({
        event_id: id,
        profile_id,
        amount,
        position: position ?? null,
        note: note ?? null,
        recorded_by: profileId,
      })
      .select("*")
      .single();

    if (winErr) throw winErr;

    // Auto-create a credit transaction (negative = credit to player)
    await supabaseAdmin.from("group_balance_transactions").insert({
      group_id: event.group_id,
      profile_id,
      event_id: id,
      type: "winnings",
      amount: -Math.abs(amount), // credit
      note: note ?? `Position ${position ?? "?"}`,
      recorded_by: profileId,
    });

    return NextResponse.json({ winning }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
