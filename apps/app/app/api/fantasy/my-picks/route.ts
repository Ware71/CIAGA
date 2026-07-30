import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getMyPicks } from "@/lib/fantasy/picks";
import { getMyParlays } from "@/lib/fantasy/parlays";
import { getMySeasonPicks } from "@/lib/fantasy/seasonPicks";
import { newPlacementContextCache } from "@/lib/fantasy/odds";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/fantasy/my-picks — everything the My Picks page shows, in one request.
//
// The page used to fan out to /picks, /parlays and /seasons/picks in parallel.
// That cost three independent auth resolutions (each an auth.getUser round trip
// plus an owned-profile lookup), and — because singles and accas are priced by
// separate estimators — a second placement-context load for every event the two
// have in common. Serving them together resolves auth once and lets the
// per-request memo on loadPlacementContext do its job across both estimators.
//
// The three original routes remain: BetSlip still POSTs to /picks and /parlays.
export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    // One placement context per event for the whole request, shared by the
    // singles and acca estimators. Safe to run concurrently: the memo stores the
    // in-flight PROMISE, so whichever estimator asks for an event first starts
    // the load and the other awaits it rather than issuing a second.
    const contextCache = newPlacementContextCache();
    const [picks, parlays, seasonPicks] = await Promise.all([
      getMyPicks(profileId, contextCache),
      getMyParlays(profileId, contextCache),
      getMySeasonPicks(profileId),
    ]);
    return NextResponse.json(
      { picks, parlays, seasonPicks },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
