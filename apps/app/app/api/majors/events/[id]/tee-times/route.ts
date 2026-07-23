import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";
import { getEventTeeTimes } from "@/lib/majors/eventDetailQueries";
import { createNotificationsForMany } from "@/lib/notifications/notify";

export const runtime = "nodejs";

// GET /api/majors/competitions/[id]/tee-times
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const result = await getEventTeeTimes(id);

    return NextResponse.json({ tee_times: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// POST /api/majors/competitions/[id]/tee-times
// Body: { tee_time: string, group_number?: number, notes?: string, players: Array<{profile_id?: string, is_guest?: boolean, display_name?: string}> }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const event = await getEventById(id);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    // Must be group owner or admin
    if (!event.group_id) {
      return NextResponse.json({ error: "Event is not linked to a group" }, { status: 400 });
    }

    const { data: membership } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", event.group_id)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership || !["owner", "admin"].includes((membership as any).role)) {
      return NextResponse.json({ error: "Only group owner or admin can manage tee times" }, { status: 403 });
    }

    const body = await req.json();
    const { tee_time, group_number, notes, players, event_round_id: bodyEventRoundId } = body as {
      tee_time: string;
      group_number?: number;
      notes?: string;
      event_round_id?: string;
      players?: Array<{
        profile_id?: string;
        is_guest?: boolean;
        display_name?: string;
        charge_to?: string | null;
        tee_box_id?: string | null;
      }>;
    };

    if (!tee_time) return NextResponse.json({ error: "tee_time is required" }, { status: 400 });

    // Resolve which event round this tee time belongs to.
    // Explicit event_round_id takes priority (multi-round events).
    // For single-round events, auto-link to the sole event_round.
    let eventRoundId: string | null = bodyEventRoundId ?? null;
    let eventRoundLabel: string | null = null;
    if (!eventRoundId) {
      const { data: rounds } = await supabaseAdmin
        .from("event_rounds")
        .select("id, round_number, name, default_tee_box_id_male, default_tee_box_id_female")
        .eq("event_id", id)
        .order("round_number", { ascending: true });
      if (rounds && rounds.length === 1) {
        eventRoundId = (rounds[0] as any).id;
        eventRoundLabel = (rounds[0] as any).name ?? `Round ${(rounds[0] as any).round_number}`;
      }
    } else {
      const { data: er } = await supabaseAdmin
        .from("event_rounds")
        .select("round_number, name, default_tee_box_id_male, default_tee_box_id_female")
        .eq("id", eventRoundId)
        .maybeSingle();
      if (er) eventRoundLabel = (er as any).name ?? `Round ${(er as any).round_number}`;
    }

    const playerList = players ?? [];
    if (playerList.length > 4) {
      return NextResponse.json({ error: "Maximum 4 players per tee time" }, { status: 400 });
    }

    // Ensure no player is already assigned to a tee time in this event (per round).
    // Only check/move players who are explicitly in the player list — don't pull the creating
    // admin out of their own tee time when they're just organising a group for other players.
    const nonGuestProfileIds = playerList
      .filter((p) => !p.is_guest && p.profile_id)
      .map((p) => p.profile_id as string);
    const checkProfileIds = nonGuestProfileIds;

    let existingTTQuery = supabaseAdmin
      .from("event_tee_times")
      .select("round_id")
      .eq("event_id", id);
    if (eventRoundId) {
      existingTTQuery = existingTTQuery.eq("event_round_id", eventRoundId);
    }
    const { data: existingTTs } = await existingTTQuery;
    const existingRoundIds = (existingTTs ?? []).map((t) => t.round_id).filter(Boolean) as string[];

    if (existingRoundIds.length > 0 && checkProfileIds.length > 0) {
      const { data: conflicts } = await supabaseAdmin
        .from("round_participants")
        .select("profile_id")
        .in("round_id", existingRoundIds)
        .in("profile_id", checkProfileIds);
      if (conflicts && conflicts.length > 0) {
        // Remove conflicting players from their current tee times so they can be moved
        const conflictingIds = conflicts.map((c: any) => c.profile_id);
        await supabaseAdmin
          .from("round_participants")
          .delete()
          .in("round_id", existingRoundIds)
          .in("profile_id", conflictingIds);
      }
    }

    // Derive round format and handicap settings from the event
    const formatType =
      event.event_type === "stableford"
        ? "stableford"
        : event.event_type === "matchplay" ||
          event.event_type === "matchplay_knockout_match" ||
          event.event_type === "matchplay_fixture"
        ? "matchplay"
        : "strokeplay";

    const handicapRules = (event.handicap_rules ?? {}) as Record<string, unknown>;
    const handicapMode = (handicapRules.mode as string) ?? "allowance_pct";
    const handicapValue =
      (handicapMode === "allowance_pct" || handicapMode === "compare_against_lowest")
        ? (typeof handicapRules.allowance_pct === "number" ? handicapRules.allowance_pct : 100)
        : 0;

    // Create the scheduled round — locked by default so participants see read-only setup + Start Match
    const { data: round, error: roundErr } = await supabaseAdmin
      .from("rounds")
      .insert({
        created_by: profileId,
        status: "scheduled",
        scheduled_at: tee_time,
        course_id: event.course_id ?? null,
        name: eventRoundLabel ? `${event.name} · ${eventRoundLabel}` : event.name,
        visibility: "private",
        format_type: formatType,
        default_playing_handicap_mode: handicapMode,
        default_playing_handicap_value: handicapValue,
        setup_locked: true,
      })
      .select("id")
      .single();

    if (roundErr) throw roundErr;

    // Build participant inserts. The admin/creator is only added if they're in the explicit
    // player list — otherwise they're just the organiser and the round's created_by is enough
    // for management (rounds are setup_locked so any participant can start them).
    const adminInPlayerList = nonGuestProfileIds.includes(profileId);
    const participantInserts: any[] = [];

    if (adminInPlayerList) {
      participantInserts.push({
        round_id: round.id,
        profile_id: profileId,
        role: "owner",
        is_guest: false,
        pending_tee_box_id:
          playerList.find((p) => p.profile_id === profileId)?.tee_box_id ?? null,
      });
    }

    for (const player of playerList) {
      if (player.profile_id === profileId) continue;
      participantInserts.push({
        round_id: round.id,
        profile_id: player.profile_id ?? null,
        is_guest: player.is_guest ?? false,
        display_name: player.display_name ?? null,
        role: "player",
        pending_tee_box_id: player.tee_box_id ?? null,
      });
    }

    if (participantInserts.length > 0) {
      const { error: participantErr } = await supabaseAdmin
        .from("round_participants")
        .insert(participantInserts);
      if (participantErr) throw participantErr;
    }

    // Set the round's default tee box from the first player with an assigned tee
    const defaultTeeBoxId = playerList.find((p) => p.tee_box_id)?.tee_box_id ?? null;
    if (defaultTeeBoxId) {
      await supabaseAdmin
        .from("rounds")
        .update({ pending_tee_box_id: defaultTeeBoxId })
        .eq("id", round.id);
    }

    // Create the tee time record, linking it to the event round it belongs to
    const { data: teeTimeRow, error: ttErr } = await supabaseAdmin
      .from("event_tee_times")
      .insert({
        event_id: id,
        round_id: round.id,
        tee_time,
        group_number: group_number ?? null,
        notes: notes ?? null,
        created_by: profileId,
        event_round_id: eventRoundId,
      })
      .select("*")
      .single();

    if (ttErr) throw ttErr;

    // Back-link the round to this tee time so the rounds page can identify it.
    // Non-critical: all leaderboard queries use ett.round_id (the reliable direction).
    const { error: backLinkErr } = await supabaseAdmin
      .from("rounds")
      .update({ event_tee_time_id: teeTimeRow.id })
      .eq("id", round.id);
    if (backLinkErr) console.error("[tee-times] back-link update failed:", backLinkErr);

    // Charge guest entry fees to host players if requested
    if (event.group_id && (event as any).entry_fee_amount > 0) {
      for (const player of playerList) {
        if (player.is_guest && player.charge_to) {
          await supabaseAdmin.from("group_balance_transactions").insert({
            group_id: event.group_id,
            profile_id: player.charge_to,
            event_id: id,
            type: "extra_charge",
            amount: (event as any).entry_fee_amount,
            note: `Guest entry fee — ${player.display_name ?? "Guest"}`,
            recorded_by: profileId,
          });
        }
      }
    }

    // Send tee_time_assigned notifications to all non-guest participants
    // (in-app + push, best-effort).
    const notifRecipients = participantInserts
      .filter((p) => p.profile_id && !p.is_guest)
      .map((p) => p.profile_id as string);

    if (notifRecipients.length > 0) {
      await createNotificationsForMany(notifRecipients, "tee_time_assigned", {
        event_id: id,
        event_name: event.name,
        tee_time,
        group_number: group_number ?? null,
        round_id: round.id,
      });
    }

    return NextResponse.json({ tee_time: teeTimeRow }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
