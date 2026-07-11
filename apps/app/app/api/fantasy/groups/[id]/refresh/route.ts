import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getGroupRole } from "@/lib/fantasy/wallet";
import { ACTIVE_ENTRY_STATUSES, refreshIfStale } from "@/lib/fantasy/odds";
import { refreshPlayerProfile } from "@/lib/fantasy/profiles";
import { generateSeasonFantasy } from "@/lib/fantasy/seasonOdds";

export const runtime = "nodejs";
// Rebuilds profiles across the whole group then force-reprices every active
// event + the season. Bounded to non-completed events to stay under the cap.
export const maxDuration = 60;

// POST /api/fantasy/groups/[id]/refresh — group owner/admin only. The "Refresh
// all" companion to the per-event rebuild: rebuilds every distinct field
// profile once, force-reprices each active fantasy event, and regenerates the
// season markets. Profiles are per-group so they are rebuilt a single time even
// when a player is in several events.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: groupId } = await params;

    const role = await getGroupRole(groupId, profileId);
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    // Active fantasy events for the group (has a state row, not completed).
    const { data: stateRows, error: stateErr } = await supabaseAdmin
      .from("fantasy_event_state")
      .select("event_id, events!inner(group_id, majors_status)")
      .eq("events.group_id", groupId)
      .not("events.majors_status", "in", '("completed","cancelled")');
    if (stateErr) throw stateErr;
    const eventIds = [...new Set(((stateRows ?? []) as { event_id: string }[]).map((r) => r.event_id))];

    // Union of active fields across those events → rebuild each profile once.
    let profileIds: string[] = [];
    if (eventIds.length > 0) {
      const { data: entryData, error: entryErr } = await supabaseAdmin
        .from("event_entries")
        .select("profile_id")
        .in("event_id", eventIds)
        .in("entry_status", ACTIVE_ENTRY_STATUSES);
      if (entryErr) throw entryErr;
      profileIds = [...new Set(((entryData ?? []) as { profile_id: string }[]).map((e) => e.profile_id))];
    }

    const CONCURRENCY = 5;
    let profilesRebuilt = 0;
    for (let i = 0; i < profileIds.length; i += CONCURRENCY) {
      const chunk = profileIds.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map((pid) => refreshPlayerProfile(groupId, pid)));
      profilesRebuilt += chunk.length;
    }

    // Re-price each event sequentially with the fresh inputs (force skips the
    // debounce). One failure shouldn't abort the rest.
    let eventsRepriced = 0;
    const errors: string[] = [];
    for (const eventId of eventIds) {
      try {
        await refreshIfStale(eventId, { force: true });
        eventsRepriced += 1;
      } catch (e: any) {
        errors.push(`event ${eventId}: ${e?.message ?? "reprice failed"}`);
      }
    }

    // Regenerate season markets (throws for event-budget groups / empty field).
    let seasonsRefreshed = 0;
    const { data: seasonRows, error: seasonErr } = await supabaseAdmin
      .from("group_seasons")
      .select("id")
      .eq("group_id", groupId);
    if (seasonErr) throw seasonErr;
    for (const s of (seasonRows ?? []) as { id: string }[]) {
      const { data: st } = await supabaseAdmin
        .from("fantasy_season_state")
        .select("is_final")
        .eq("group_season_id", s.id)
        .maybeSingle();
      if (st && (st as { is_final: boolean }).is_final) continue; // settled — leave it
      try {
        await generateSeasonFantasy(s.id);
        seasonsRefreshed += 1;
      } catch {
        /* not eligible (event-budget) or no standings model yet — skip */
      }
    }

    return NextResponse.json({
      ok: true,
      profilesRebuilt,
      eventsRepriced,
      seasonsRefreshed,
      ...(errors.length > 0 ? { errors } : {}),
    });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
