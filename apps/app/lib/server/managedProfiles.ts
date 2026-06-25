import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Server-side helpers (service role) for "managed" profiles: profiles created by a member
 * for someone who hasn't joined yet — via "invite a friend" or by adding a player to a round.
 *
 * The creating member is recorded in profiles.created_by and the new profile mutually follows
 * the creator. The profile can later be claimed by the real person (see resolveClaimableProfile
 * + /api/invites/accept).
 */

export type InviteResult =
  | { invited: true }
  | { invited: false; error: "rate_limited" | "server_error" };

function isRateLimited(err: any) {
  const status = Number(err?.status ?? err?.statusCode ?? 0);
  const code = String(err?.code ?? "").toLowerCase();
  const message = String(err?.message ?? "").toLowerCase();
  return (
    status === 429 ||
    code.includes("rate_limit") ||
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    message.includes("rate limit")
  );
}

function normalizeEmail(email?: string | null): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e || null;
}

function inviteRedirectUrl(inviteId: string, siteOrigin?: string | null): string {
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL || siteOrigin || "http://127.0.0.1:3000";
  const url = new URL("/invite/start", origin);
  url.searchParams.set("invite_id", inviteId);
  return url.toString();
}

/**
 * Create (or re-create) an invite for an existing profile's email and send the invite email.
 * Revokes any active invites for the profile first so only the newest link is valid.
 */
export async function sendInviteForProfile(params: {
  profileId: string;
  email: string;
  creatorProfileId: string | null;
  siteOrigin?: string | null;
}): Promise<InviteResult> {
  const email = normalizeEmail(params.email);
  if (!email) return { invited: false, error: "server_error" };

  const now = new Date().toISOString();

  // Revoke active invites for this profile (keep only the newest link valid).
  await supabaseAdmin
    .from("invites")
    .update({ revoked_at: now })
    .eq("profile_id", params.profileId)
    .is("accepted_at", null)
    .is("revoked_at", null);

  const { data: inviteRow, error: insErr } = await supabaseAdmin
    .from("invites")
    .insert({
      email,
      profile_id: params.profileId,
      created_by: params.creatorProfileId,
    })
    .select("id")
    .single();

  if (insErr || !inviteRow) return { invited: false, error: "server_error" };

  const { error: emailErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo: inviteRedirectUrl(inviteRow.id, params.siteOrigin),
    data: { profile_id: params.profileId, invite_id: inviteRow.id },
  });

  if (emailErr) {
    return { invited: false, error: isRateLimited(emailErr) ? "rate_limited" : "server_error" };
  }

  return { invited: true };
}

/**
 * Create an unclaimed profile owned-by-nobody, attributed to creatorProfileId, that mutually
 * follows the creator. Optionally send an invite email (only if an email is provided).
 */
export async function createManagedProfile(params: {
  name: string;
  email?: string | null;
  creatorProfileId: string;
  sendInvite?: boolean;
  siteOrigin?: string | null;
}): Promise<{ profileId: string; invited: boolean; inviteError?: string }> {
  const name = params.name.trim();
  if (!name) throw new Error("Name is required");
  const email = normalizeEmail(params.email);

  const { data: profile, error: insErr } = await supabaseAdmin
    .from("profiles")
    .insert({
      name,
      email,
      created_by: params.creatorProfileId,
      owner_user_id: null,
      is_admin: false,
    })
    .select("id")
    .single();

  if (insErr || !profile) {
    throw new Error(insErr?.message || "Failed to create profile");
  }

  // Mutual follow: creator <-> new profile. Ignore duplicates (unique on follower+following).
  await supabaseAdmin
    .from("follows")
    .upsert(
      [
        { follower_id: params.creatorProfileId, following_id: profile.id },
        { follower_id: profile.id, following_id: params.creatorProfileId },
      ],
      { onConflict: "follower_id,following_id", ignoreDuplicates: true }
    );

  let invited = false;
  let inviteError: string | undefined;

  if (params.sendInvite && email) {
    const res = await sendInviteForProfile({
      profileId: profile.id,
      email,
      creatorProfileId: params.creatorProfileId,
      siteOrigin: params.siteOrigin,
    });
    invited = res.invited;
    if (!res.invited) inviteError = res.error;
  }

  return { profileId: profile.id, invited, inviteError };
}

/**
 * Resolve which profile an authenticated user (by email) is allowed to claim:
 *  - the newest active invite's profile for that email, OR
 *  - failing that, the newest UNCLAIMED profile whose email matches (covers a user who simply
 *    signs up with an email that a member already created a profile for).
 * Returns null when there's nothing to claim.
 */
export async function resolveClaimableProfile(emailRaw: string): Promise<{
  profileId: string;
  inviteId: string | null;
} | null> {
  const email = normalizeEmail(emailRaw);
  if (!email) return null;

  // 1) Active invite for this email.
  const { data: invite } = await supabaseAdmin
    .from("invites")
    .select("id, profile_id")
    .eq("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (invite?.profile_id) {
    return { profileId: invite.profile_id, inviteId: invite.id };
  }

  // 2) Newest unclaimed profile whose email matches. Use exact (not ilike) so that an
  //    underscore/percent in a local-part can't wildcard-match a different profile;
  //    stored emails are lowercased on write so an exact lowercased compare is correct.
  const { data: prof } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("email", email)
    .is("owner_user_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (prof?.id) {
    return { profileId: prof.id, inviteId: null };
  }

  return null;
}
