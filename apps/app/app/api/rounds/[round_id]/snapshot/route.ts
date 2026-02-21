import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { ServerTiming } from "@/lib/perf/serverTiming";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ round_id: string }> }) {
  try {
    const timing = new ServerTiming();

    const [{ profileId }, { round_id: roundId }] = await Promise.all([
      timing.measure("auth", () => getAuthedProfileOrThrow(req)),
      params,
    ]);

    const { data, error } = await timing.measure("rpc", async () => {
      const res = await supabaseAdmin.rpc("get_round_detail_snapshot", { _round_id: roundId });
      return res;
    });

    if (error) throw error;
    if (!data?.round) {
      return NextResponse.json({ error: "Round not found" }, { status: 404 });
    }

    const headers = new Headers();
    headers.set("Cache-Control", "no-store");
    timing.applyTo(headers);

    return NextResponse.json({ ...data, viewer_profile_id: profileId }, { headers });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
