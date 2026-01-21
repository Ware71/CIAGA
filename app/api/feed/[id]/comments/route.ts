import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: feedItemId } = await ctx.params;

    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 50), 100));

    // Simple MVP: latest comments first (can switch to cursor later)
    // RLS will ensure the viewer can read this feed item via feed_item_targets.
    const { data, error } = await supabaseAdmin
      .from("feed_comments")
      .select("id, feed_item_id, profile_id, parent_comment_id, body, created_at")
      .eq("feed_item_id", feedItemId)
      .neq("visibility", "removed")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw error;

    // Basic profile embed (name/avatar) for each comment author
    const profileIds = Array.from(new Set((data ?? []).map((c: any) => c.profile_id))).filter(Boolean);

    let profileMap = new Map<string, { id: string; name: string; avatar_url: string | null }>();
    if (profileIds.length) {
      const { data: profiles, error: pErr } = await supabaseAdmin
        .from("profiles")
        .select("id, name, avatar_url")
        .in("id", profileIds);

      if (pErr) throw pErr;

      for (const p of profiles ?? []) {
        profileMap.set(p.id, {
          id: p.id,
          name: (p as any).name ?? "Player",
          avatar_url: (p as any).avatar_url ?? null,
        });
      }
    }

    const comments = (data ?? []).map((c: any) => ({
      ...c,
      author: profileMap.get(c.profile_id) ?? { id: c.profile_id, name: "Player", avatar_url: null },
      is_mine: c.profile_id === profileId,
    }));

    return NextResponse.json({ comments });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 400 }
    );
  }
}
