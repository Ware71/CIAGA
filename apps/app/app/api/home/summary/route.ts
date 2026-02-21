import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { ServerTiming } from "@/lib/perf/serverTiming";
import { getHomeSummary } from "@/lib/home/getHomeSummary";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const timing = new ServerTiming();

    const { profileId } = await timing.measure("auth", () => getAuthedProfileOrThrow(req));

    const data = await timing.measure("queries", () => getHomeSummary(profileId));

    const headers = new Headers();
    headers.set("Cache-Control", "no-store");
    timing.applyTo(headers);

    return NextResponse.json(data, { headers });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
