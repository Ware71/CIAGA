import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCaller } from "@/lib/server/auth";

/**
 * Self-service account deletion (UK GDPR right to erasure).
 *
 * Strategy — MINIMISE identity, keep shared records. Competition and social
 * content are shared with other members, so we do not destroy it. Instead:
 *
 *   1. Hard-delete the caller's private, non-shared data only: login/auth,
 *      email, profile photo, push subscriptions, calendar, follows, invites,
 *      notifications, and reports they filed.
 *   2. Reduce the profile to the minimum: shorten the name to an initial +
 *      surname (e.g. "James Ware" -> "J.Ware"), null the email/avatar, detach
 *      from the person (owner_user_id -> null), and set deleted_at.
 *   3. Delete the auth user last, which permanently removes the login + email.
 *
 * Shared records — rounds, handicaps, group ledger, fantasy, AND the user's own
 * feed posts, comments and reactions — are RETAINED and simply re-attributed to
 * the reduced name via the single renamed profile row (we don't touch those
 * tables). This keeps shared cards and round line-ups intact while removing the
 * account, contact details and full name. It is data minimisation /
 * pseudonymisation, not full anonymisation (see the Privacy Policy).
 *
 * Table deletes are best-effort: if one fails, we continue.
 */
export async function POST(req: Request) {
  try {
    const auth = await getCaller(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { profileId, authUserId, isAdmin } = auth.caller;

    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== true) {
      return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
    }

    // Safety guard: admins can't self-delete here (avoids accidentally removing
    // the group's only admin). They can request erasure manually.
    if (isAdmin) {
      return NextResponse.json(
        {
          error:
            "Admin accounts can't be deleted from here. Please contact support to delete an admin account.",
        },
        { status: 400 }
      );
    }

    const errors: string[] = [];
    const del = async (
      table: string,
      apply: (q: any) => any
    ): Promise<void> => {
      const { error } = await apply(supabaseAdmin.from(table).delete());
      if (error) errors.push(`${table}: ${error.message}`);
    };

    // --- 1. Hard-delete private, non-shared data only ---
    // NOTE: we deliberately DO NOT delete the user's feed posts, comments or
    // reactions — those are shared content and stay, re-attributed to the
    // reduced name via the profile rename below. We remove only private data.
    await del("feed_reports", (q) => q.eq("reporter_profile_id", profileId));

    await del("announcement_views", (q) => q.eq("profile_id", profileId));
    await del("push_subscriptions", (q) => q.eq("profile_id", profileId));
    await del("user_notifications", (q) => q.eq("profile_id", profileId));

    await del("calendar_circle_members", (q) => q.eq("profile_id", profileId));
    await del("calendar_circles", (q) => q.eq("owner_profile_id", profileId));
    await del("calendar_events", (q) => q.eq("profile_id", profileId));

    await del("follows", (q) => q.eq("follower_id", profileId));
    await del("follows", (q) => q.eq("following_id", profileId));

    await del("invites", (q) => q.eq("created_by", profileId));
    await del("invites", (q) => q.eq("profile_id", profileId));

    // --- 2. Read current name + avatar, then delete the avatar from storage ---
    let currentName: string | null = null;
    try {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("name, avatar_url")
        .eq("id", profileId)
        .maybeSingle();
      currentName = prof?.name ?? null;
      const path = extractStoragePath(prof?.avatar_url ?? null, "avatars");
      if (path) {
        const { error } = await supabaseAdmin.storage.from("avatars").remove([path]);
        if (error) errors.push(`avatars storage: ${error.message}`);
      }
    } catch (e: any) {
      errors.push(`avatars storage: ${e?.message || "failed"}`);
    }

    // --- 3. Reduce the profile to the minimum, retained for shared records ---
    const { error: scrubErr } = await supabaseAdmin
      .from("profiles")
      .update({
        name: reduceName(currentName),
        email: null,
        avatar_url: null,
        owner_user_id: null,
        deleted_at: new Date().toISOString(),
      })
      .eq("id", profileId);

    if (scrubErr) {
      // If we can't scrub the profile, abort BEFORE deleting the auth user so the
      // account isn't left in a broken half-deleted state.
      return NextResponse.json(
        { error: `Could not anonymise profile: ${scrubErr.message}` },
        { status: 500 }
      );
    }

    // --- 4. Delete the auth user last (removes login + email permanently) ---
    const { error: authDelErr } = await supabaseAdmin.auth.admin.deleteUser(authUserId);
    if (authDelErr) errors.push(`auth user: ${authDelErr.message}`);

    return NextResponse.json({ ok: true, warnings: errors });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

/**
 * Reduce a display name to the minimum recognisable form for retained shared
 * records: first initial + surname (e.g. "James Ware" -> "J.Ware"). Single-word
 * names are kept as-is; empty names fall back to "Former member".
 */
function reduceName(name: string | null): string {
  const n = (name || "").trim().replace(/\s+/g, " ");
  if (!n) return "Former member";
  const parts = n.split(" ");
  if (parts.length === 1) return parts[0];
  const initial = parts[0].charAt(0).toUpperCase();
  const surname = parts[parts.length - 1];
  return `${initial}.${surname}`;
}

/** Extract the object path from a Supabase public storage URL for a given bucket. */
function extractStoragePath(url: string | null, bucket: string): string | null {
  if (!url) return null;
  const marker = `/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const path = url.slice(idx + marker.length).split("?")[0];
  return path ? decodeURIComponent(path) : null;
}
