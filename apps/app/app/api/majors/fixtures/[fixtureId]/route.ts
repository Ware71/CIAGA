import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// PATCH /api/majors/fixtures/[fixtureId] — record or update a fixture result
// Body: { result_type, winning_entry_id?, margin_holes?, holes_remaining?, extra_holes_played?, notes? }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ fixtureId: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { fixtureId } = await params;
    const body = await req.json();

    // Fetch fixture to get competition for auth
    const { data: fixture } = await supabaseAdmin
      .from("matchplay_fixtures")
      .select("competition_id, home_entry_id, away_entry_id, status")
      .eq("id", fixtureId)
      .maybeSingle();

    if (!fixture) return NextResponse.json({ error: "Fixture not found" }, { status: 404 });

    // Auth: must be owner/admin of competition's group
    const { data: comp } = await supabaseAdmin
      .from("competitions")
      .select("group_id")
      .eq("id", (fixture as any).competition_id)
      .maybeSingle();

    const groupId = (comp as any)?.group_id;
    if (groupId) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", groupId)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json({ error: "Only group owner or admin can update fixture results" }, { status: 403 });
      }
    }

    const validResultTypes = [
      "home_win", "away_win", "halved",
      "walkover_home", "walkover_away", "double_withdrawal",
    ];

    const updates: Record<string, unknown> = {};

    if (body.result_type) {
      if (!validResultTypes.includes(body.result_type)) {
        return NextResponse.json({ error: "Invalid result_type" }, { status: 400 });
      }
      updates.result_type = body.result_type;
      updates.status = "completed";

      // Derive winning_entry_id if not explicitly provided
      const f = fixture as any;
      if (body.result_type === "home_win" || body.result_type === "walkover_home") {
        updates.winning_entry_id = f.home_entry_id;
      } else if (body.result_type === "away_win" || body.result_type === "walkover_away") {
        updates.winning_entry_id = f.away_entry_id;
      } else {
        updates.winning_entry_id = null;
      }
    }

    if (body.winning_entry_id !== undefined) updates.winning_entry_id = body.winning_entry_id;
    if (body.margin_holes !== undefined) updates.margin_holes = body.margin_holes;
    if (body.holes_remaining !== undefined) updates.holes_remaining = body.holes_remaining;
    if (body.extra_holes_played !== undefined) updates.extra_holes_played = body.extra_holes_played;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.scheduled_at !== undefined) updates.scheduled_at = body.scheduled_at;
    if (body.status !== undefined) updates.status = body.status;

    if (updates.result_type) {
      updates.approved_at = new Date().toISOString();
      updates.approved_by_profile_id = profileId;
    }

    const { data: updated, error } = await supabaseAdmin
      .from("matchplay_fixtures")
      .update(updates)
      .eq("id", fixtureId)
      .select("*")
      .single();

    if (error) throw error;

    // Emit audit log
    if (updates.result_type) {
      await supabaseAdmin.from("competition_audit_log").insert({
        competition_id: (fixture as any).competition_id,
        actor_profile_id: profileId,
        action_type: "fixture_result_updated",
        payload: { fixture_id: fixtureId, result_type: updates.result_type },
      });

      // Trigger bracket advancement if applicable
      await supabaseAdmin.rpc("ciaga_advance_matchplay_bracket", {
        p_competition_id: (fixture as any).competition_id,
      });
    }

    return NextResponse.json({ fixture: updated });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
