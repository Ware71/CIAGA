import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// PATCH /api/majors/prize-pots/[potId]/entries/[profileId]/metric
// Manually set the metric_value (and optional detail) for a player's pot entry.
// Used for nearest_pin, longest_drive, season_points, and custom metric types.
// Body: { metric_value: number, metric_detail?: object }
export async function PATCH(req: Request, { params }: { params: Promise<{ potId: string; profileId: string }> }) {
  try {
    const { profileId: authedId } = await getAuthedProfileOrThrow(req);
    const { potId, profileId: targetId } = await params;

    const { data: pot } = await supabaseAdmin
      .from("prize_pots")
      .select("group_id, status, metric_type")
      .eq("id", potId)
      .maybeSingle();

    if (!pot) return NextResponse.json({ error: "Prize pot not found." }, { status: 404 });
    if ((pot as any).status === "distributed") {
      return NextResponse.json({ error: "Cannot update metric on a distributed pot." }, { status: 400 });
    }

    const { data: m } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", (pot as any).group_id)
      .eq("profile_id", authedId)
      .eq("status", "active")
      .maybeSingle();

    if (!m || !["owner", "admin"].includes((m as any).role)) {
      return NextResponse.json({ error: "Not authorised." }, { status: 403 });
    }

    const body = await req.json();
    const { metric_value, metric_detail } = body as { metric_value: number; metric_detail?: unknown };

    if (metric_value == null || typeof metric_value !== "number") {
      return NextResponse.json({ error: "metric_value (number) is required." }, { status: 400 });
    }

    const { data: entry } = await supabaseAdmin
      .from("prize_pot_entries")
      .select("id")
      .eq("prize_pot_id", potId)
      .eq("profile_id", targetId)
      .maybeSingle();

    if (!entry) return NextResponse.json({ error: "Player is not enrolled in this pot." }, { status: 404 });

    const { data: updated, error } = await supabaseAdmin
      .from("prize_pot_entries")
      .update({ metric_value, metric_detail: metric_detail ?? null })
      .eq("prize_pot_id", potId)
      .eq("profile_id", targetId)
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ entry: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
