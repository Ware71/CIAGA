import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getCompetitionById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// DELETE /api/majors/competitions/[id]/extras/[extra_id]
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; extra_id: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id, extra_id } = await params;

    const competition = await getCompetitionById(id);
    if (!competition) return NextResponse.json({ error: "Competition not found" }, { status: 404 });

    if (competition.group_id) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", competition.group_id)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json({ error: "Only group owner or admin can delete extras." }, { status: 403 });
      }
    }

    const { error } = await supabaseAdmin
      .from("competition_extras")
      .delete()
      .eq("id", extra_id)
      .eq("competition_id", id);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
