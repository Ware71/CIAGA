import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    // 1) Verify caller is logged in + admin
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

    // 2) Parse payload
    const body = await req.json();
    const name = body?.name ? String(body.name).trim() : null;
    const email = body?.email ? String(body.email).trim().toLowerCase() : null;

    // 3) Create unowned profile
    const { data: profile, error: insertErr } = await supabaseAdmin
      .from("profiles")
      .insert({
        name,
        email,
        owner_user_id: null,
        is_admin: false,
      })
      .select("id, name, email, owner_user_id, created_at")
      .single();

    if (insertErr) {
      return NextResponse.json(
        { error: "Profile creation failed", detail: insertErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, profile });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
