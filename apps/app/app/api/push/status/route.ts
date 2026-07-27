import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/push/status?endpoint=… — can the server actually reach this device?
//
// Browser permission alone does not answer that: a subscription is pruned
// server-side after a 404/410, while Notification.permission stays "granted"
// forever. Without this the settings pane showed push as on for a device the
// server could no longer reach.
export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const endpoint = new URL(req.url).searchParams.get("endpoint");

    const { data, error } = await supabaseAdmin
      .from("push_subscriptions")
      .select("endpoint")
      .eq("profile_id", profileId);

    if (error) throw error;

    const endpoints = (data ?? []).map((r: any) => r.endpoint as string);
    return NextResponse.json({
      // Whether THIS device is registered (when it told us its endpoint).
      registered: endpoint ? endpoints.includes(endpoint) : endpoints.length > 0,
      // How many devices this profile can be reached on at all.
      device_count: endpoints.length,
    });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
