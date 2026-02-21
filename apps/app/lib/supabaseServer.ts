import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * Create a cookie-based Supabase client for use in server components
 * and server-side route handlers. Uses the anon key so RLS applies.
 */
export async function createSupabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — cookies are read-only.
            // The middleware handles token refresh via setAll.
          }
        },
      },
    }
  );
}

export type ServerViewerSession = {
  authUserId: string;
  profileId: string;
};

export type ServerViewerResolution =
  | { status: "signed_out" }
  | { status: "needs_onboarding" }
  | { status: "ready"; viewer: ServerViewerSession };

type AuthUserLite = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
};

async function resolveOwnedProfileId(user: AuthUserLite): Promise<{
  profileId: string | null;
  needsOnboarding: boolean;
}> {
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (existingErr) throw existingErr;
  if (existing?.id) {
    return { profileId: existing.id as string, needsOnboarding: false };
  }

  const email = (user.email || "").trim().toLowerCase();

  if (email) {
    const { data: invite, error: inviteErr } = await supabaseAdmin
      .from("invites")
      .select("profile_id")
      .eq("email", email)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (inviteErr) throw inviteErr;

    if (invite?.profile_id) {
      const { data: invitedProfile, error: invitedProfileErr } = await supabaseAdmin
        .from("profiles")
        .select("id, owner_user_id")
        .eq("id", invite.profile_id)
        .maybeSingle();

      if (invitedProfileErr) throw invitedProfileErr;

      if (invitedProfile?.id && !invitedProfile.owner_user_id) {
        return { profileId: null, needsOnboarding: true };
      }
    }
  }

  const metadata = (user.user_metadata || {}) as Record<string, unknown>;
  const fullName = typeof metadata.full_name === "string" ? metadata.full_name : null;
  const name = typeof metadata.name === "string" ? metadata.name : null;
  const avatarUrl = typeof metadata.avatar_url === "string" ? metadata.avatar_url : null;

  const displayName = fullName || name || (email ? email.split("@")[0] : "Player");

  const { data: created, error: createdErr } = await supabaseAdmin
    .from("profiles")
    .insert({
      owner_user_id: user.id,
      name: displayName,
      email: email || null,
      avatar_url: avatarUrl,
      is_admin: false,
    })
    .select("id")
    .single();

  if (createdErr) {
    if (createdErr.code === "23505") {
      const { data: conflicted, error: conflictedErr } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("owner_user_id", user.id)
        .maybeSingle();
      if (conflictedErr) throw conflictedErr;
      if (conflicted?.id) {
        return { profileId: conflicted.id as string, needsOnboarding: false };
      }
    }
    throw createdErr;
  }
  return { profileId: created.id as string, needsOnboarding: false };
}

/**
 * Resolve the current viewer from cookies.
 * - signed_out: no auth user
 * - needs_onboarding: signed in but has an unclaimed invite profile
 * - ready: signed in with a resolved owned profile id
 * For use in server components and server actions.
 */
export async function getServerViewer(): Promise<ServerViewerResolution> {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "signed_out" };

  const resolved = await resolveOwnedProfileId({
    id: user.id,
    email: user.email,
    user_metadata: user.user_metadata as Record<string, unknown> | null,
  });

  if (resolved.needsOnboarding || !resolved.profileId) {
    return { status: "needs_onboarding" };
  }

  return {
    status: "ready",
    viewer: { authUserId: user.id, profileId: resolved.profileId },
  };
}
