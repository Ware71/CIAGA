import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/groups/invites
// Returns all pending group invitations for the current user
export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);

    const { data: invites, error } = await supabaseAdmin
      .from("major_group_memberships")
      .select(`
        id,
        group_id,
        joined_at,
        group:major_groups!group_id(id, name, type, image_url, owner_profile_id),
        inviter:profiles!invited_by(id, name, avatar_url)
      `)
      .eq("profile_id", profileId)
      .eq("status", "invited");

    if (error) throw error;

    return NextResponse.json({ invites: invites ?? [] });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
