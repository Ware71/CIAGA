import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getGroupMembers, getGroupById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// GET /api/majors/groups/[id]/members
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;
    const members = await getGroupMembers(id);
    return NextResponse.json({ members }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// POST /api/majors/groups/[id]/members — invite a user by profile_id
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    // Must be owner or admin to invite
    const { data: membership } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", id)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership || !["owner", "admin"].includes((membership as any).role)) {
      return NextResponse.json({ error: "Only owner or admin can invite members" }, { status: 403 });
    }

    const body = await req.json();
    if (!body.profile_id) {
      return NextResponse.json({ error: "profile_id required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("major_group_memberships")
      .upsert({
        group_id: id,
        profile_id: body.profile_id,
        role: "member",
        status: "invited",
      }, { onConflict: "group_id,profile_id", ignoreDuplicates: false })
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ membership: data }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// PATCH /api/majors/groups/[id]/members — set tournament_index for a member
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const { data: membership } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", id)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership || !["owner", "admin"].includes((membership as any).role)) {
      return NextResponse.json({ error: "Only owner or admin can set tournament index" }, { status: 403 });
    }

    const body = await req.json();
    if (!body.profile_id) {
      return NextResponse.json({ error: "profile_id required" }, { status: 400 });
    }

    const tournamentIndex =
      body.tournament_index === null || body.tournament_index === undefined
        ? null
        : Number(body.tournament_index);

    if (tournamentIndex !== null && isNaN(tournamentIndex)) {
      return NextResponse.json({ error: "tournament_index must be a number or null" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("major_group_memberships")
      .update({ tournament_index: tournamentIndex })
      .eq("group_id", id)
      .eq("profile_id", body.profile_id);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// DELETE /api/majors/groups/[id]/members?profile_id=xxx — remove a member
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;
    const url = new URL(req.url);
    const targetProfileId = url.searchParams.get("profile_id");

    if (!targetProfileId) {
      return NextResponse.json({ error: "profile_id required" }, { status: 400 });
    }

    // Must be owner/admin, or removing yourself
    if (targetProfileId !== profileId) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", id)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json({ error: "Only owner or admin can remove other members" }, { status: 403 });
      }
    }

    // Cannot remove the owner
    const group = await getGroupById(id);
    if (group?.owner_profile_id === targetProfileId) {
      return NextResponse.json({ error: "Cannot remove the group owner" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("major_group_memberships")
      .delete()
      .eq("group_id", id)
      .eq("profile_id", targetProfileId);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
