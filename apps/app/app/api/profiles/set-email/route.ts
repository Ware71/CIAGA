import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCaller } from "@/lib/server/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Change the email assigned to an unclaimed profile. Only the profile's creator (or an admin)
 * may do this, and only while the profile is unclaimed.
 */
export async function POST(req: Request) {
  try {
    const auth = await getCaller(req);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await req.json().catch(() => ({}));
    const profileId = typeof body?.profile_id === "string" ? body.profile_id.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!profileId) return NextResponse.json({ error: "Missing profile_id" }, { status: 400 });
    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
    }

    const { data: prof, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, owner_user_id, created_by")
      .eq("id", profileId)
      .maybeSingle();

    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });
    if (!prof) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    if (prof.owner_user_id) {
      return NextResponse.json({ error: "This profile is already claimed" }, { status: 409 });
    }

    const isCreator = !!prof.created_by && prof.created_by === auth.caller.profileId;
    if (!isCreator && !auth.caller.isAdmin) {
      return NextResponse.json({ error: "Only the profile creator can change the email" }, { status: 403 });
    }

    const { error: upErr } = await supabaseAdmin
      .from("profiles")
      .update({ email })
      .eq("id", profileId)
      .is("owner_user_id", null);

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, email });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
