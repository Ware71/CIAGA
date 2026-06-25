import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCaller } from "@/lib/server/auth";
import { sendInviteForProfile } from "@/lib/server/managedProfiles";

/**
 * Issue (or re-issue) an invite to the email currently assigned to an unclaimed profile.
 * Any authenticated user may do this; the email is taken from the profile (not the caller),
 * so it can't be used to spam arbitrary addresses.
 */
export async function POST(req: Request) {
  try {
    const auth = await getCaller(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const profileId = typeof body?.profile_id === "string" ? body.profile_id.trim() : "";
    if (!profileId) return NextResponse.json({ error: "Missing profile_id" }, { status: 400 });

    const { data: prof, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, email, owner_user_id")
      .eq("id", profileId)
      .maybeSingle();

    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
    if (!prof) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    if (prof.owner_user_id) {
      return NextResponse.json({ error: "This profile is already claimed" }, { status: 409 });
    }
    if (!prof.email) {
      return NextResponse.json({ error: "This profile has no email to invite" }, { status: 400 });
    }

    const result = await sendInviteForProfile({
      profileId: prof.id,
      email: prof.email,
      creatorProfileId: auth.caller.profileId,
      siteOrigin: new URL(req.url).origin,
    });

    if (!result.invited) {
      const status = result.error === "rate_limited" ? 429 : 500;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({ ok: true, sent: true, email: prof.email });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
