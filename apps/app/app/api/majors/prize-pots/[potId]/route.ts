import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

async function getPotAndAssertAdminOrOwner(potId: string, profileId: string) {
  const { data: pot } = await supabaseAdmin
    .from("prize_pots")
    .select("*")
    .eq("id", potId)
    .maybeSingle();
  if (!pot) return { pot: null, authorized: false };

  const { data: m } = await supabaseAdmin
    .from("major_group_memberships")
    .select("role")
    .eq("group_id", (pot as any).group_id)
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle();

  return { pot, authorized: !!(m && ["owner", "admin"].includes((m as any).role)) };
}

// PATCH /api/majors/prize-pots/[potId]
// Update pot name/description/prize_table/metric_description/prize_description (not distribution_type or scope)
export async function PATCH(req: Request, { params }: { params: Promise<{ potId: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { potId } = await params;

    const { pot, authorized } = await getPotAndAssertAdminOrOwner(potId, profileId);
    if (!pot) return NextResponse.json({ error: "Prize pot not found." }, { status: 404 });
    if (!authorized) return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    if ((pot as any).status === "distributed") {
      return NextResponse.json({ error: "Cannot edit a distributed pot." }, { status: 400 });
    }

    const body = await req.json();
    const allowed = ["name", "description", "prize_table", "metric_description", "prize_description",
      "entry_fee_amount", "entry_fee_currency", "entry_fee_notes", "distribution_type", "metric_type",
      "is_monetary", "is_mandatory"];
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (key in body) updates[key] = body[key];
    }

    const { data, error } = await supabaseAdmin
      .from("prize_pots")
      .update(updates)
      .eq("id", potId)
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ pot: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

// DELETE /api/majors/prize-pots/[potId]
export async function DELETE(req: Request, { params }: { params: Promise<{ potId: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { potId } = await params;

    const { pot, authorized } = await getPotAndAssertAdminOrOwner(potId, profileId);
    if (!pot) return NextResponse.json({ error: "Prize pot not found." }, { status: 404 });
    if (!authorized) return NextResponse.json({ error: "Not authorised." }, { status: 403 });

    const { count } = await supabaseAdmin
      .from("prize_pot_entries")
      .select("id", { count: "exact", head: true })
      .eq("prize_pot_id", potId);

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: "Cannot delete a pot with existing entries. Remove all entries first." },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin.from("prize_pots").delete().eq("id", potId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
