import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const admin = getSupabaseAdmin();

    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing Authorization token" }, { status: 401 });

    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const { data: myProfile, error: pErr } = await admin
      .from("profiles")
      .select("id,is_admin")
      .eq("owner_user_id", userRes.user.id)
      .single();

    if (pErr) throw new Error(pErr.message);
    if (!myProfile?.is_admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    const { data, error } = await admin
      .from("major_groups")
      .select("id,name")
      .order("name");

    if (error) throw new Error(error.message);

    return NextResponse.json({ groups: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
