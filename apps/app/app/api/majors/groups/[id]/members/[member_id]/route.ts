import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// PATCH /api/majors/groups/[id]/members/[member_id]
// Body: { status?: "active" | "pending", role?: "admin" | "member" }
// Used by group admins to approve/decline join requests and manage roles
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; member_id: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: groupId, member_id } = await params;

    // Must be owner or admin
    const { data: actorMembership } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", groupId)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();

    if (!actorMembership || !["owner", "admin"].includes((actorMembership as any).role)) {
      return NextResponse.json({ error: "Only owner or admin can manage members" }, { status: 403 });
    }

    // Fetch the target membership
    const { data: target } = await supabaseAdmin
      .from("major_group_memberships")
      .select("*")
      .eq("id", member_id)
      .eq("group_id", groupId)
      .maybeSingle();

    if (!target) return NextResponse.json({ error: "Membership not found" }, { status: 404 });

    const body = await req.json();
    const updates: Record<string, unknown> = {};

    if (body.status !== undefined) {
      if (!["active", "pending", "invited"].includes(body.status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      updates.status = body.status;
    }

    if (body.role !== undefined) {
      // Only owner can promote to admin
      if (body.role === "admin" && (actorMembership as any).role !== "owner") {
        return NextResponse.json({ error: "Only the owner can promote to admin" }, { status: 403 });
      }
      if (!["admin", "member"].includes(body.role)) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }
      // Cannot change the owner's role
      if ((target as any).role === "owner") {
        return NextResponse.json({ error: "Cannot change the owner's role" }, { status: 400 });
      }
      updates.role = body.role;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("major_group_memberships")
      .update(updates)
      .eq("id", member_id)
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ membership: data });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
