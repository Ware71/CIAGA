import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/events/invites
// Returns all pending event invitations for the current user.
export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);

    const { data: invites, error } = await supabaseAdmin
      .from("event_invitations")
      .select(`
        id,
        event_id,
        created_at,
        event:events!event_id(id, name, group_id, group:major_groups!group_id(name)),
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
