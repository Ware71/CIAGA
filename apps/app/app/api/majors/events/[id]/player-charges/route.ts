import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// GET /api/majors/events/[id]/player-charges
// Admin/owner: all player charges for the event.
// Member: only their own charges.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const event = await getEventById(id);
    if (!event) return NextResponse.json({ error: "Event not found." }, { status: 404 });

    let isAdmin = false;
    if (event.group_id) {
      const { data: m } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", event.group_id)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();
      isAdmin = !!m && ["owner", "admin"].includes((m as any).role);
    }

    let query = supabaseAdmin
      .from("event_player_charges")
      .select("*, profile:profiles(id, name, avatar_url)")
      .eq("event_id", id)
      .order("created_at", { ascending: true });

    if (!isAdmin) {
      query = query.eq("profile_id", profileId) as typeof query;
    }

    const { data, error } = await query;
    if (error) throw error;

    // Derive is_paid from payment_transaction_id
    const charges = (data ?? []).map((c: any) => ({
      ...c,
      is_paid: c.payment_transaction_id != null,
    }));

    return NextResponse.json({ player_charges: charges }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
