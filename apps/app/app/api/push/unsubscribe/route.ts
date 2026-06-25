import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

type Body = { endpoint?: string };

// POST /api/push/unsubscribe — remove this device's Web Push subscription.
export async function POST(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const body = (await req.json()) as Body;
    if (!body.endpoint) {
      return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .delete()
      .eq("endpoint", body.endpoint)
      .eq("profile_id", profileId);

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
