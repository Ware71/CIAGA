import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = userData.user;
    const email = (user.email || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "No email on user" }, { status: 400 });

    // 1) Find newest active invite for this email
    const { data: invite, error: invErr } = await supabaseAdmin
      .from("invites")
      .select("id, email, profile_id, created_at, accepted_at, revoked_at")
      .eq("email", email)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (invErr || !invite) {
      return NextResponse.json({ error: "No active invite found" }, { status: 404 });
    }

    // 2) Read current profile (don't overwrite admin-entered fields)
    const { data: currentProfile, error: curErr } = await supabaseAdmin
      .from("profiles")
      .select("id, owner_user_id, email, name")
      .eq("id", invite.profile_id)
      .single();

    if (curErr) return NextResponse.json({ error: curErr.message }, { status: 500 });

    // If already claimed, revoke all remaining invites for this email and stop.
    if (currentProfile.owner_user_id) {
      await supabaseAdmin
        .from("invites")
        .update({ revoked_at: new Date().toISOString() })
        .eq("email", email)
        .is("accepted_at", null)
        .is("revoked_at", null);

      // Clear metadata to prevent client-side "pending" loops
      await supabaseAdmin.auth.admin.updateUserById(user.id, {
        user_metadata: { invite_id: null, profile_id: null },
      });

      return NextResponse.json({ ok: true, already_claimed: true, profile_id: currentProfile.id });
    }

    const displayName =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      (email ? email.split("@")[0] : null);

    const updatePayload: Record<string, any> = {
      owner_user_id: user.id,
    };

    // only fill blanks; don't overwrite existing values
    if (!currentProfile.email) updatePayload.email = email;
    if (!currentProfile.name) updatePayload.name = displayName;

    // 3) Claim the profile
    const { data: claimedProfile, error: profErr } = await supabaseAdmin
      .from("profiles")
      .update(updatePayload)
      .eq("id", invite.profile_id)
      .is("owner_user_id", null)
      .select("id, owner_user_id, email, name")
      .single();

    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });

    // 4) Mark this invite accepted
    const now = new Date().toISOString();

    const { error: acceptErr } = await supabaseAdmin
      .from("invites")
      .update({
        accepted_at: now,
        accepted_by: user.id,
      })
      .eq("id", invite.id);

    if (acceptErr) return NextResponse.json({ error: acceptErr.message }, { status: 500 });

    // 5) Revoke any OTHER active invites for this email (prevents "pending invite" loops)
    await supabaseAdmin
      .from("invites")
      .update({ revoked_at: now })
      .eq("email", email)
      .neq("id", invite.id)
      .is("accepted_at", null)
      .is("revoked_at", null);

    // 6) Clear invite markers from user metadata (prevents onboarding loop)
    await supabaseAdmin.auth.admin.updateUserById(user.id, {
      user_metadata: { invite_id: null, profile_id: null },
    });

    return NextResponse.json({
      ok: true,
      profile_id: claimedProfile.id,
      owner_user_id: claimedProfile.owner_user_id,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
