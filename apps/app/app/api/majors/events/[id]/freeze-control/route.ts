import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";
import { reconcileEventStatus } from "@/lib/majors/reconcileStatus";

export const runtime = "nodejs";

// POST /api/majors/competitions/[id]/freeze-control
// Body: { action: 'freeze' | 'reveal', force?: boolean }
// Allowed for group owner/admin. Transitions leaderboard_freeze_state.
// On reveal without force: returns a warning if any tee-time rounds are not finished,
// with details of who is still playing and how many holes they've completed.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const event = await getEventById(id);
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Check owner/admin permission
    if (event.group_id) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", event.group_id)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json({ error: "Only group owner or admin can control the freeze" }, { status: 403 });
      }
    } else if (event.created_by_profile_id !== profileId) {
      return NextResponse.json({ error: "Only the creator can control the freeze" }, { status: 403 });
    }

    const body = await req.json();
    const { action, force } = body as { action: string; force?: boolean };

    if (action !== "freeze" && action !== "reveal") {
      return NextResponse.json({ error: "action must be 'freeze' or 'reveal'" }, { status: 400 });
    }

    const currentState = (event as any).leaderboard_freeze_state ?? "live";

    // Validate state transitions
    if (action === "freeze" && currentState !== "live") {
      return NextResponse.json(
        { error: `Cannot freeze a leaderboard that is already '${currentState}'` },
        { status: 400 }
      );
    }
    if (action === "reveal" && currentState === "revealed") {
      return NextResponse.json(
        { error: "Leaderboard is already revealed" },
        { status: 400 }
      );
    }

    // On reveal without force: check for incomplete tee-time rounds and warn the caller
    if (action === "reveal" && !force) {
      const { data: teeTimesWithRounds } = await supabaseAdmin
        .from("event_tee_times")
        .select("id, tee_time, round_id, rounds(id, status, name)")
        .eq("event_id", id);

      const incompleteTeeTimes = (teeTimesWithRounds ?? []).filter((tt: any) => {
        const r = tt.rounds;
        return r && r.status !== "finished" && r.status !== "cancelled";
      });

      if (incompleteTeeTimes.length > 0) {
        // Fetch player details + holes completed for these rounds
        const incompleteRoundIds = incompleteTeeTimes.map((tt: any) => tt.rounds.id);

        const { data: participants } = await supabaseAdmin
          .from("round_participants")
          .select("round_id, profile_id, is_guest, display_name, profiles:profile_id(name)")
          .in("round_id", incompleteRoundIds)
          .eq("is_guest", false);

        const { data: leaderboardEntries } = await supabaseAdmin
          .from("event_leaderboard_entries")
          .select("profile_id, holes_completed, rounds_submitted")
          .eq("event_id", id);

        const entriesByProfile = Object.fromEntries(
          (leaderboardEntries ?? []).map((e: any) => [e.profile_id, e])
        );

        const participantsByRound: Record<string, any[]> = {};
        for (const p of participants ?? []) {
          if (!participantsByRound[p.round_id]) participantsByRound[p.round_id] = [];
          const entry = entriesByProfile[p.profile_id] ?? {};
          participantsByRound[p.round_id].push({
            name: (p.profiles as any)?.name ?? p.display_name ?? "Unknown",
            holes_completed: entry.holes_completed ?? 0,
            rounds_submitted: entry.rounds_submitted ?? 0,
          });
        }

        const incompleteRounds = incompleteTeeTimes.map((tt: any) => ({
          round_name: (tt.rounds as any).name ?? "Round",
          tee_time: tt.tee_time,
          players: participantsByRound[tt.rounds.id] ?? [],
        }));

        return NextResponse.json({ warning: true, incomplete_rounds: incompleteRounds });
      }
    }

    const newState = action === "freeze" ? "frozen" : "revealed";

    const { data, error } = await supabaseAdmin
      .from("events")
      .update({ leaderboard_freeze_state: newState })
      .eq("id", id)
      .select("id, leaderboard_freeze_state")
      .single();

    if (error) throw error;

    // On reveal: mark all event rounds as completed and sync event status
    if (action === "reveal") {
      await supabaseAdmin
        .from("event_rounds")
        .update({ status: "completed" })
        .eq("event_id", id)
        .not("status", "in", '("completed","cancelled")');

      await reconcileEventStatus(id);
    }

    // Emit audit log
    await supabaseAdmin.from("event_audit_log").insert({
      event_id: id,
      actor_profile_id: profileId,
      action_type: action === "freeze" ? "leaderboard_frozen" : "leaderboard_revealed",
      payload: { previous_state: currentState, new_state: newState },
    });

    return NextResponse.json({ ok: true, freeze_state: (data as any).leaderboard_freeze_state });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
