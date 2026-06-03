import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getGroupById, getGroupMemberCount } from "@/lib/majors/queries";

export const runtime = "nodejs";

// POST /api/majors/groups/[id]/join
// Body: { join_code?: string } — required if group join_method is 'code'
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const group = await getGroupById(id);
    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

    // Check not already a member
    const { data: existing } = await supabaseAdmin
      .from("major_group_memberships")
      .select("id, status")
      .eq("group_id", id)
      .eq("profile_id", profileId)
      .maybeSingle();

    // Accept a pending invite
    if (existing && (existing as any).status === "invited") {
      const { data: updated, error: upErr } = await supabaseAdmin
        .from("major_group_memberships")
        .update({ status: "active" })
        .eq("id", (existing as any).id)
        .select("*")
        .single();
      if (upErr) throw upErr;
      return NextResponse.json({ membership: updated });
    }

    if (existing) {
      return NextResponse.json({ error: "Already a member or pending" }, { status: 409 });
    }

    // Check max_members
    if (group.max_members != null) {
      const count = await getGroupMemberCount(id);
      if (count >= group.max_members) {
        return NextResponse.json({ error: "Group is full" }, { status: 400 });
      }
    }

    if (group.join_method === "invite_only") {
      return NextResponse.json({ error: "This group is invite-only" }, { status: 403 });
    }

    if (group.join_method === "code") {
      const body = await req.json().catch(() => ({}));
      if (!body.join_code || body.join_code !== group.join_code) {
        return NextResponse.json({ error: "Invalid join code" }, { status: 400 });
      }
    }

    // open or request
    const status = group.join_method === "request" ? "pending" : "active";

    const { data: membership, error } = await supabaseAdmin
      .from("major_group_memberships")
      .insert({
        group_id: id,
        profile_id: profileId,
        role: "member",
        status,
      })
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ membership }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
