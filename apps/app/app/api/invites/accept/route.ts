import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveClaimableProfile } from "@/lib/server/managedProfiles";

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

    // 1) Resolve which profile this user may claim (active invite, else unclaimed profile by email)
    const claimable = await resolveClaimableProfile(email);
    if (!claimable) {
      return NextResponse.json({ error: "Nothing to claim" }, { status: 404 });
    }

    // 2) Read current profile (don't overwrite admin-entered fields)
    const { data: currentProfile, error: curErr } = await supabaseAdmin
      .from("profiles")
      .select("id, owner_user_id, email, name")
      .eq("id", claimable.profileId)
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
      .eq("id", claimable.profileId)
      .is("owner_user_id", null)
      .select("id, owner_user_id, email, name")
      .single();

    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });

    const now = new Date().toISOString();

    // 4) Mark the originating invite accepted (if the claim came from one)
    if (claimable.inviteId) {
      const { error: acceptErr } = await supabaseAdmin
        .from("invites")
        .update({ accepted_at: now, accepted_by: user.id })
        .eq("id", claimable.inviteId);

      if (acceptErr) return NextResponse.json({ error: acceptErr.message }, { status: 500 });
    }

    // 5) Revoke any OTHER active invites for this email (prevents "pending invite" loops)
    let revokeQuery = supabaseAdmin
      .from("invites")
      .update({ revoked_at: now })
      .eq("email", email)
      .is("accepted_at", null)
      .is("revoked_at", null);
    if (claimable.inviteId) revokeQuery = revokeQuery.neq("id", claimable.inviteId);
    await revokeQuery;

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
