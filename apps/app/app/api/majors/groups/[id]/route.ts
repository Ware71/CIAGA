import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getGroupById, getGroupMemberCount, getGroupMembers } from "@/lib/majors/queries";

export const runtime = "nodejs";

// GET /api/majors/groups/[id]
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const [group, memberCount] = await Promise.all([
      getGroupById(id),
      getGroupMemberCount(id),
    ]);

    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });

    return NextResponse.json({ group: { ...group, member_count: memberCount } }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// PATCH /api/majors/groups/[id] — update group (owner/admin only)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    // Check caller is owner or admin
    const { data: membership, error: memErr } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", id)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();

    if (memErr) throw memErr;
    if (!membership || !["owner", "admin"].includes((membership as any).role)) {
      return NextResponse.json({ error: "Only group owner or admin can update this group" }, { status: 403 });
    }

    const body = await req.json();
    const allowedFields = ["name", "description", "privacy", "join_method", "max_members",
      "season_start", "season_end", "image_url", "ciaga_tag"];
    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (field in body) updates[field] = body[field];
    }
    updates.updated_at = new Date().toISOString();

    const { data: group, error } = await supabaseAdmin
      .from("major_groups")
      .update(updates)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ group });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// DELETE /api/majors/groups/[id] — delete group (owner only)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const group = await getGroupById(id);
    if (!group) return NextResponse.json({ error: "Group not found" }, { status: 404 });
    if (group.owner_profile_id !== profileId) {
      return NextResponse.json({ error: "Only the group owner can delete this group" }, { status: 403 });
    }

    const { error } = await supabaseAdmin.from("major_groups").delete().eq("id", id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
