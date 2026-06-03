import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/profiles/search?q=xxx&exclude_group_id=yyy
// Returns profiles matching name query, optionally excluding members of a group
export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const excludeGroupId = url.searchParams.get("exclude_group_id");

    if (q.length < 2) {
      return NextResponse.json({ profiles: [] });
    }

    let query = supabaseAdmin
      .from("profiles")
      .select("id, name, avatar_url")
      .ilike("name", `%${q}%`)
      .neq("id", profileId) // exclude self
      .limit(10);

    const { data: profiles, error } = await query;
    if (error) throw error;

    // Exclude profiles already in the group (as active, invited, or pending members)
    if (excludeGroupId && profiles && profiles.length > 0) {
      const profileIds = profiles.map((p: any) => p.id);
      const { data: existingMembers } = await supabaseAdmin
        .from("major_group_memberships")
        .select("profile_id")
        .eq("group_id", excludeGroupId)
        .in("profile_id", profileIds)
        .in("status", ["active", "invited", "pending"]);

      const memberSet = new Set((existingMembers ?? []).map((m: any) => m.profile_id));
      const filtered = (profiles as any[]).filter((p) => !memberSet.has(p.id));
      return NextResponse.json({ profiles: filtered });
    }

    return NextResponse.json({ profiles: profiles ?? [] });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
