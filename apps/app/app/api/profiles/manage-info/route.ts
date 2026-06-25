import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCaller } from "@/lib/server/auth";

/**
 * Management metadata for a profile, used by the profile screen to decide whether the viewer
 * can edit the assigned email or send an invite. Unclaimed (owner_user_id IS NULL) profiles
 * are manageable; the creator (or an admin) can change the email, and any authenticated user
 * can (re)send an invite to the currently assigned email.
 */
export async function GET(req: Request) {
  try {
    const auth = await getCaller(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const profileId = new URL(req.url).searchParams.get("profile_id")?.trim();
    if (!profileId) return NextResponse.json({ error: "Missing profile_id" }, { status: 400 });

    const { data: prof, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, email, owner_user_id, created_by")
      .eq("id", profileId)
      .maybeSingle();

    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
    if (!prof) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

    const claimed = !!prof.owner_user_id;
    const isCreator = !!prof.created_by && prof.created_by === auth.caller.profileId;

    let createdByName: string | null = null;
    if (prof.created_by) {
      const { data: creator } = await supabaseAdmin
        .from("profiles")
        .select("name")
        .eq("id", prof.created_by)
        .maybeSingle();
      createdByName = creator?.name ?? null;
    }

    let hasActiveInvite = false;
    if (!claimed) {
      const { count } = await supabaseAdmin
        .from("invites")
        .select("id", { count: "exact", head: true })
        .eq("profile_id", prof.id)
        .is("accepted_at", null)
        .is("revoked_at", null);
      hasActiveInvite = (count ?? 0) > 0;
    }

    return NextResponse.json({
      profile_id: prof.id,
      email: prof.email ?? null,
      claimed,
      created_by: prof.created_by ?? null,
      created_by_name: createdByName,
      is_creator: isCreator,
      can_edit_email: !claimed && (isCreator || auth.caller.isAdmin),
      can_invite: !claimed && !!prof.email,
      has_active_invite: hasActiveInvite,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
