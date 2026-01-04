import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = userData.user;
    const email = (user.email || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ pending: false, profile_id: null });

    // 1) Find latest active invite for this email
    const { data: invite, error: invErr } = await supabaseAdmin
      .from("invites")
      .select("id, profile_id, created_at")
      .eq("email", email)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 });

    if (!invite?.profile_id) {
      return NextResponse.json({ pending: false, profile_id: null });
    }

    // 2) Only pending if the invited profile is STILL unclaimed
    const { data: prof, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, owner_user_id")
      .eq("id", invite.profile_id)
      .maybeSingle();

    if (profErr) return NextResponse.json({ error: profErr.message }, { status: 500 });

    // If profile already claimed, auto-revoke this invite to stop future loops
    if (prof?.owner_user_id) {
      await supabaseAdmin
        .from("invites")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", invite.id);

      return NextResponse.json({ pending: false, profile_id: null });
    }

    // Profile unclaimed => pending true
    return NextResponse.json({ pending: true, profile_id: invite.profile_id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
