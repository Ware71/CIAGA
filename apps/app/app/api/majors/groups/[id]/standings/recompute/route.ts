import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// POST /api/majors/groups/[id]/standings/recompute — admin/owner trigger
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    // Must be owner/admin of the group
    const { data: membership } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", id)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();

    const isAdmin = await supabaseAdmin
      .from("profiles")
      .select("is_admin")
      .eq("id", profileId)
      .maybeSingle()
      .then((r) => (r.data as any)?.is_admin === true);

    if (!isAdmin && (!membership || !["owner", "admin"].includes((membership as any).role))) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    await supabaseAdmin.rpc("ciaga_compute_group_standings", { p_group_id: id });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
