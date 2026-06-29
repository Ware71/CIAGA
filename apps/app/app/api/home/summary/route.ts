import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { ServerTiming } from "@/lib/perf/serverTiming";
import { getHomeSummary, getHomeCore, getHomeMiniFeed } from "@/lib/home/getHomeSummary";
import type { HomeCore, HomeMiniFeed, HomeSummary } from "@/lib/home/getHomeSummary";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const timing = new ServerTiming();

    const { profileId } = await timing.measure("auth", () => getAuthedProfileOrThrow(req));

    // `part=core` → essential player info only (gates the splash, fast).
    // `part=feed` → the curated social feed only (low priority, slower).
    // default     → the full summary (back-compat).
    const part = new URL(req.url).searchParams.get("part");
    const load: () => Promise<HomeCore | HomeMiniFeed | HomeSummary> =
      part === "core" ? () => getHomeCore(profileId)
      : part === "feed" ? () => getHomeMiniFeed(profileId)
      : () => getHomeSummary(profileId);

    const data = await timing.measure("queries", load);

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
