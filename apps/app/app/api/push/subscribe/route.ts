import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

type Body = {
  endpoint?: string;
  p256dh?: string;
  auth?: string;
  user_agent?: string;
};

// POST /api/push/subscribe — store/refresh this device's Web Push subscription.
export async function POST(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const body = (await req.json()) as Body;

    if (!body.endpoint || !body.p256dh || !body.auth) {
      return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
    }

    // Upsert by endpoint: a device may re-subscribe, or move to a new owner.
    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .upsert(
        {
          profile_id: profileId,
          endpoint: body.endpoint,
          p256dh: body.p256dh,
          auth: body.auth,
          user_agent: body.user_agent ?? null,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" }
      );

    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
