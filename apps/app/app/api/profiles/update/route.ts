import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = userData.user;

    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim() : null;
    const avatar_url = typeof body?.avatar_url === "string" ? body.avatar_url.trim() : null;

    // Only allow updating specific fields
    const patch: Record<string, any> = {};
    if (name != null) {
      if (!name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
      if (name.length > 30) return NextResponse.json({ error: "Name too long (max 30)" }, { status: 400 });
      patch.name = name;
    }
    if (avatar_url != null) patch.avatar_url = avatar_url;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    // Update only the caller's owned profile (Model B)
    const { data: updated, error: upErr } = await supabaseAdmin
      .from("profiles")
      .update(patch)
      .eq("owner_user_id", user.id)
      .select("id, owner_user_id, name, email, avatar_url")
      .maybeSingle();

    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    if (!updated) return NextResponse.json({ error: "Profile not found for user" }, { status: 404 });

    return NextResponse.json({ ok: true, profile: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
