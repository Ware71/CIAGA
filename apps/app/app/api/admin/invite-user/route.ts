// /app/api/admin/invite-user/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    // 1) Verify caller is logged in + admin (using the access token they send)
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const adminAuthUserId = userData.user.id;

    // Check admin using owner_user_id model
    const { data: rows, error: adminErr } = await supabaseAdmin
      .from("profiles")
      .select("id, is_admin")
      .eq("owner_user_id", adminAuthUserId)
      .limit(1);

    if (adminErr) return NextResponse.json({ error: adminErr.message }, { status: 500 });

    if (!rows?.[0]?.is_admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Model B: admin profile id
    const adminProfileId = rows[0].id;

    // 2) Parse payload
    const body = await req.json();
    const email = String(body?.email ?? "").trim().toLowerCase();
    const profile_id = String(body?.profile_id ?? "").trim();

    if (!email || !profile_id) {
      return NextResponse.json({ error: "email and profile_id required" }, { status: 400 });
    }

    // 3) Revoke any active invite for this profile (optional)
    await supabaseAdmin
      .from("invites")
      .update({ revoked_at: new Date().toISOString() })
      .eq("profile_id", profile_id)
      .is("accepted_at", null)
      .is("revoked_at", null);

    // 4) Insert invite row (created_by = profiles.id)
    const { data: inviteRow, error: inviteErr } = await supabaseAdmin
      .from("invites")
      .insert({
        email,
        profile_id,
        created_by: adminProfileId,
      })
      .select("*")
      .single();

    if (inviteErr) {
      return NextResponse.json(
        { error: "Invites insert failed", detail: inviteErr.message },
        { status: 500 }
      );
    }

    // 5) Send Supabase invite email
    const requestOrigin = new URL(req.url).origin;
    const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL || requestOrigin;
    const redirectUrl = new URL("/auth/callback", siteOrigin);
    redirectUrl.searchParams.set("next", "/onboarding/set-password");

    const { data: inviteData, error: inviteEmailErr } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: redirectUrl.toString(),
        data: { profile_id, invite_id: inviteRow.id },
      });

    if (inviteEmailErr) {
      return NextResponse.json({ error: inviteEmailErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, invite: inviteRow, auth: inviteData });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
