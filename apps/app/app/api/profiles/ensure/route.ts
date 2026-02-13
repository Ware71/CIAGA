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

    // 2.5) Check for pending invite before creating new profile
    const { data: invite, error: invErr } = await supabaseAdmin
      .from("invites")
      .select("id, profile_id")
      .eq("email", email)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (invite?.profile_id) {
      // Check if invited profile is still unclaimed
      const { data: invitedProfile, error: profErr } = await supabaseAdmin
        .from("profiles")
        .select("id, owner_user_id, name, email, avatar_url")
        .eq("id", invite.profile_id)
        .maybeSingle();

      if (!profErr && invitedProfile && !invitedProfile.owner_user_id) {
        // Claim the invited profile
        const updatePayload: Record<string, any> = {
          owner_user_id: user.id,
        };

        // Fill blanks only (don't overwrite admin-set values)
        if (!invitedProfile.email) updatePayload.email = email;
        if (!invitedProfile.name) updatePayload.name = displayName;
        if (!invitedProfile.avatar_url) updatePayload.avatar_url = avatar_url;

        const { error: claimErr } = await supabaseAdmin
          .from("profiles")
          .update(updatePayload)
          .eq("id", invite.profile_id)
          .is("owner_user_id", null);

        if (claimErr) {
          console.warn("Failed to claim invited profile:", claimErr);
          // Fall through to create new profile
        } else {
          // Mark invite as accepted
          await supabaseAdmin
            .from("invites")
            .update({
              accepted_at: new Date().toISOString(),
              accepted_by: user.id,
            })
            .eq("id", invite.id);

          // Revoke other active invites for this email
          await supabaseAdmin
            .from("invites")
            .update({ revoked_at: new Date().toISOString() })
            .eq("email", email)
            .neq("id", invite.id)
            .is("accepted_at", null)
            .is("revoked_at", null);

          return NextResponse.json({
            ok: true,
            profile_id: invite.profile_id,
            existed: true,
            claimed_invite: true,
          });
        }
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
