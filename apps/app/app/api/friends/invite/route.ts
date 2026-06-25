import { NextResponse } from "next/server";
import { getCaller } from "@/lib/server/auth";
import { createManagedProfile } from "@/lib/server/managedProfiles";

/**
 * Any authenticated member can create a profile for a friend and invite them to join.
 * The new profile is attributed to the caller (profiles.created_by) and mutually follows them.
 */
export async function POST(req: Request) {
  try {
    const auth = await getCaller(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    // Invite button: send by default when an email is present, unless explicitly disabled.
    const sendInvite = body?.send_invite === false ? false : !!email;

    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    if (name.length > 30) {
      return NextResponse.json({ error: "Name too long (max 30)" }, { status: 400 });
    }
    if (sendInvite && !email) {
      return NextResponse.json({ error: "Email is required to send an invite" }, { status: 400 });
    }

    const result = await createManagedProfile({
      name,
      email: email || null,
      creatorProfileId: auth.caller.profileId,
      sendInvite,
      siteOrigin: new URL(req.url).origin,
    });

    if (result.inviteError) {
      const warning =
        result.inviteError === "rate_limited"
          ? "Profile created, but the invite email was rate-limited. Try sending it again shortly from their profile."
          : "Profile created, but we couldn't send the invite email. You can try again from their profile.";
      return NextResponse.json(
        { ok: true, profile_id: result.profileId, invited: false, warning },
        { status: 200 }
      );
    }

    return NextResponse.json({
      ok: true,
      profile_id: result.profileId,
      invited: result.invited,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
