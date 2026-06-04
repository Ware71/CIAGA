import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

async function assertAdminOrOwner(groupId: string, profileId: string) {
  const { data } = await supabaseAdmin
    .from("major_group_memberships")
    .select("role")
    .eq("group_id", groupId)
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle();
  if (!data) return false;
  return ["owner", "admin"].includes((data as any).role);
}

// PATCH /api/majors/groups/[id]/group-charges/[chargeId]
// Body: { name?, amount?, category?, description?, is_mandatory?, is_active? }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; chargeId: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: groupId, chargeId } = await params;

    if (!(await assertAdminOrOwner(groupId, profileId))) {
      return NextResponse.json({ error: "Only group owner or admin can update group charges." }, { status: 403 });
    }

    const body = await req.json();
    const updates: Record<string, any> = {};
    if (body.name !== undefined) updates.name = body.name.trim();
    if (body.amount !== undefined) updates.amount = body.amount;
    if (body.category !== undefined) updates.category = body.category;
    if (body.description !== undefined) updates.description = body.description;
    if (body.is_mandatory !== undefined) updates.is_mandatory = body.is_mandatory;
    if (body.is_active !== undefined) updates.is_active = body.is_active;

    const { data, error } = await supabaseAdmin
      .from("group_charges")
      .update(updates)
      .eq("id", chargeId)
      .eq("group_id", groupId)
      .select("*")
      .single();

    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Charge not found." }, { status: 404 });

    return NextResponse.json({ charge: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

// DELETE /api/majors/groups/[id]/group-charges/[chargeId]
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; chargeId: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: groupId, chargeId } = await params;

    if (!(await assertAdminOrOwner(groupId, profileId))) {
      return NextResponse.json({ error: "Only group owner or admin can delete group charges." }, { status: 403 });
    }

    const { error } = await supabaseAdmin
      .from("group_charges")
      .delete()
      .eq("id", chargeId)
      .eq("group_id", groupId);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
