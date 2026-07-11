import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getGroupRole } from "@/lib/fantasy/wallet";
import { ACTIVE_ENTRY_STATUSES, loadEvent, refreshIfStale } from "@/lib/fantasy/odds";
import { refreshPlayerProfile } from "@/lib/fantasy/profiles";

export const runtime = "nodejs";
// Rebuilds every field profile, then forces a re-simulation.
export const maxDuration = 60;

// POST /api/fantasy/events/[eventId]/rebuild-profiles — inspector companion
// action. Sandbox-only + group owner/admin. Body (optional):
// { profileIds?: string[] } to rebuild a subset; defaults to the whole field.
export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    if (process.env.NEXT_PUBLIC_APP_ENV !== "sandbox") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { profileId } = await getAuthedProfileOrThrow(req);
    const { eventId } = await params;

    const event = await loadEvent(eventId);
    if (!event.group_id) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const role = await getGroupRole(event.group_id, profileId);
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    let targetIds: string[] | null = null;
    try {
      const body = await req.json();
      if (Array.isArray(body?.profileIds) && body.profileIds.length > 0) {
        targetIds = body.profileIds.map(String);
      }
    } catch {
      // No/invalid body → whole field.
    }

    if (!targetIds) {
      const { data: entryData, error: entryErr } = await supabaseAdmin
        .from("event_entries")
        .select("profile_id")
        .eq("event_id", eventId)
        .in("entry_status", ACTIVE_ENTRY_STATUSES);
      if (entryErr) throw entryErr;
      targetIds = ((entryData ?? []) as { profile_id: string }[]).map((e) => e.profile_id);
    }

    const CONCURRENCY = 5;
    let rebuilt = 0;
    for (let i = 0; i < targetIds.length; i += CONCURRENCY) {
      const chunk = targetIds.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map((pid) => refreshPlayerProfile(event.group_id!, pid)));
      rebuilt += chunk.length;
    }

    // Re-price with the fresh inputs (force skips the debounce window).
    const refresh = await refreshIfStale(eventId, { force: true });

    return NextResponse.json({ ok: true, rebuilt, ...refresh });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
