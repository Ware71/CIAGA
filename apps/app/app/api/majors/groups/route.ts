import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getDiscoverGroups, getGroupsByProfile } from "@/lib/majors/queries";

export const runtime = "nodejs";

// GET /api/majors/groups — list groups (my groups or discover)
export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") ?? "mine"; // "mine" | "discover"

    if (mode === "discover") {
      const groups = await getDiscoverGroups(30);
      return NextResponse.json({ groups }, { headers: { "Cache-Control": "no-store" } });
    }

    const groups = await getGroupsByProfile(profileId);
    return NextResponse.json({ groups }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// POST /api/majors/groups — create a new group
export async function POST(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const body = await req.json();

    const { name, description, type, privacy, join_method, max_members, season_start, season_end, ciaga_tag, image_url } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Group name is required" }, { status: 400 });
    }

    // Generate a random join code
    const join_code = Math.random().toString(36).slice(2, 8).toUpperCase();

    const { data: group, error: groupErr } = await supabaseAdmin
      .from("major_groups")
      .insert({
        name: name.trim(),
        description: description ?? null,
        type: type ?? "league",
        privacy: privacy ?? "public",
        join_method: join_method ?? "open",
        image_url: image_url ?? null,
        owner_profile_id: profileId,
        max_members: max_members ?? null,
        season_start: season_start ?? null,
        season_end: season_end ?? null,
        ciaga_tag: ciaga_tag ?? "none",
        join_code,
      })
      .select("*")
      .single();

    if (groupErr) throw groupErr;

    // Auto-add creator as owner member
    const { error: memberErr } = await supabaseAdmin
      .from("major_group_memberships")
      .insert({
        group_id: (group as any).id,
        profile_id: profileId,
        role: "owner",
        status: "active",
      });

    if (memberErr) throw memberErr;

    return NextResponse.json({ group }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
