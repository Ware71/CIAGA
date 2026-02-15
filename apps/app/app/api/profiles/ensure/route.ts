import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = userData.user;
    const email = (user.email || "").trim().toLowerCase();

    const displayName =
      (user.user_metadata as any)?.full_name ||
      (user.user_metadata as any)?.name ||
      (email ? email.split("@")[0] : "Player");

    const avatar_url = (user.user_metadata as any)?.avatar_url || null;

    // 1) Find existing owned profile for this auth user
    const { data: existing, error: findErr } = await supabaseAdmin
      .from("profiles")
      .select("id, name, email, avatar_url")
      .eq("owner_user_id", user.id)
      .maybeSingle();

    if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });

    // 2) If exists, fill blanks only (don’t overwrite real edits)
    if (existing?.id) {
      const nextName = existing.name && existing.name.trim() ? existing.name : displayName;
      const nextEmail = existing.email ?? (email || null);
      const nextAvatar = existing.avatar_url ?? avatar_url;

      const { error: upErr } = await supabaseAdmin
        .from("profiles")
        .update({ name: nextName, email: nextEmail, avatar_url: nextAvatar })
        .eq("id", existing.id);

      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

      return NextResponse.json({ ok: true, profile_id: existing.id, existed: true });
    }

    // 2.5) Check for pending invite — do NOT auto-claim; return flag so client can present choice
    // If X-Force-Create header is set, the user explicitly chose "Create new profile" — skip invite check
    const forceCreate = req.headers.get("x-force-create") === "true";

    const { data: invite } = !forceCreate ? await supabaseAdmin
      .from("invites")
      .select("id, profile_id")
      .eq("email", email)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle() : { data: null };

    if (invite?.profile_id) {
      const { data: invitedProfile } = await supabaseAdmin
        .from("profiles")
        .select("id, owner_user_id, name, email, created_at")
        .eq("id", invite.profile_id)
        .maybeSingle();

      if (invitedProfile && !invitedProfile.owner_user_id) {
        // Profile is unclaimed — tell the client so it can show the claim-or-create modal
        return NextResponse.json({
          ok: false,
          pending_invite: true,
          profile_id: invitedProfile.id,
          profile_preview: {
            name: invitedProfile.name,
            email: invitedProfile.email,
            created_at: invitedProfile.created_at,
          },
        });
      }
    }

    // 3) Otherwise create a new owned profile (normal signup)
    const { data: created, error: insErr } = await supabaseAdmin
      .from("profiles")
      .insert({
        owner_user_id: user.id,
        name: displayName,
        email: email || null,
        avatar_url,
        is_admin: false,
      })
      .select("id")
      .single();

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, profile_id: created.id, existed: false });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
