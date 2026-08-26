import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// GET /api/majors/events/[id]/round-leaderboard?event_round_id=...
// Standings for ONE round of a multi-round event.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const eventRoundId = new URL(req.url).searchParams.get("event_round_id");
    if (!eventRoundId) {
      return NextResponse.json({ error: "event_round_id is required" }, { status: 400 });
    }

    const event = await getEventById(id);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    // A frozen leaderboard is hiding the closing holes for the reveal. A
    // per-round board would show exactly what the freeze is withholding, so it
    // stays closed until the organiser reveals.
    if ((event as any).leaderboard_freeze_state === "frozen") {
      return NextResponse.json(
        { rows: [], frozen: true },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // Confirm the round belongs to this event before reading it.
    const { data: eventRound } = await supabaseAdmin
      .from("event_rounds")
      .select("id")
      .eq("id", eventRoundId)
      .eq("event_id", id)
      .maybeSingle();

    if (!eventRound) {
      return NextResponse.json({ error: "Round not found for this event" }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin.rpc("ciaga_event_round_leaderboard", {
      p_event_round_id: eventRoundId,
    });
    if (error) throw error;

    const rows = (data ?? []) as any[];

    // Attach profiles for display.
    const profileIds = rows.map((r) => r.profile_id).filter(Boolean);
    const { data: profiles } = profileIds.length
      ? await supabaseAdmin.from("profiles").select("id, name, avatar_url").in("id", profileIds)
      : { data: [] as any[] };
    const profileById = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));

    return NextResponse.json(
      {
        rows: rows.map((r) => ({ ...r, profile: profileById[r.profile_id] ?? null })),
        frozen: false,
        scoring_model: (event as any).scoring_model ?? "net",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
