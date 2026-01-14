import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = userData.user;
    const email = (user.email || "").trim().toLowerCase();

    const displayName =
      (user.user_metadata as any)?.full_name ||
      (user.user_metadata as any)?.name ||
      (email ? email.split("@")[0] : "Player");

    const avatar_url = (user.user_metadata as any)?.avatar_url || null;

    // 1) Find existing owned profile for this auth user
    const { data: existing, error: findErr } = await supabaseAdmin
      .from("profiles")
      .select("id, name, email, avatar_url")
      .eq("owner_user_id", user.id)
      .maybeSingle();

    if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 });

    // 2) If exists, fill blanks only (don’t overwrite real edits)
    if (existing?.id) {
      const nextName = existing.name && existing.name.trim() ? existing.name : displayName;
      const nextEmail = existing.email ?? (email || null);
      const nextAvatar = existing.avatar_url ?? avatar_url;

      const { error: upErr } = await supabaseAdmin
        .from("profiles")
        .update({ name: nextName, email: nextEmail, avatar_url: nextAvatar })
        .eq("id", existing.id);

      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

      return NextResponse.json({ ok: true, profile_id: existing.id, existed: true });
    }

    // 3) Otherwise create a new owned profile (normal signup)
    const { data: created, error: insErr } = await supabaseAdmin
      .from("profiles")
      .insert({
        owner_user_id: user.id,
        name: displayName,
        email: email || null,
        avatar_url,
        is_admin: false,
      })
      .select("id")
      .single();

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, profile_id: created.id, existed: false });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
