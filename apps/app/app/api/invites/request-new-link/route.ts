import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const inviteId = String(body?.invite_id ?? "").trim();

    if (!UUID_RE.test(inviteId)) {
      return NextResponse.json({ error: "invalid_invite_id" }, { status: 400 });
    }

    const { data: invite, error: inviteErr } = await supabaseAdmin
      .from("invites")
      .select("id, email, profile_id, created_by, accepted_at, revoked_at")
      .eq("id", inviteId)
      .maybeSingle();

    if (inviteErr) return NextResponse.json({ error: "server_error" }, { status: 500 });
    if (!invite) return NextResponse.json({ error: "invite_not_found" }, { status: 404 });

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("id, owner_user_id")
      .eq("id", invite.profile_id)
      .maybeSingle();

    if (profileErr) return NextResponse.json({ error: "server_error" }, { status: 500 });
    if (!profile) return NextResponse.json({ error: "invite_not_found" }, { status: 404 });

    if (profile.owner_user_id) {
      await supabaseAdmin
        .from("invites")
        .update({ revoked_at: new Date().toISOString() })
        .eq("email", invite.email)
        .eq("profile_id", invite.profile_id)
        .is("accepted_at", null)
        .is("revoked_at", null);

      return NextResponse.json({ error: "already_claimed" }, { status: 409 });
    }

    const now = new Date().toISOString();

    await supabaseAdmin
      .from("invites")
      .update({ revoked_at: now })
      .eq("email", invite.email)
      .eq("profile_id", invite.profile_id)
      .is("accepted_at", null)
      .is("revoked_at", null);

    const { data: freshInvite, error: freshInviteErr } = await supabaseAdmin
      .from("invites")
      .insert({
        email: invite.email,
        profile_id: invite.profile_id,
        created_by: invite.created_by,
      })
      .select("id, email, profile_id")
      .single();

    if (freshInviteErr || !freshInvite) {
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }

    const requestOrigin = new URL(req.url).origin;
    const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL || requestOrigin;
    const redirectUrl = new URL("/invite/start", siteOrigin);
    redirectUrl.searchParams.set("invite_id", freshInvite.id);

    const { error: emailErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(freshInvite.email, {
      redirectTo: redirectUrl.toString(),
      data: { profile_id: freshInvite.profile_id, invite_id: freshInvite.id },
    });

    if (emailErr) {
      if (isRateLimited(emailErr)) {
        return NextResponse.json({ error: "rate_limited" }, { status: 429 });
      }
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, sent: true });
  } catch {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
