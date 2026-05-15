import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getCompetitionById } from "@/lib/majors/queries";

export const runtime = "nodejs";

// GET /api/majors/competitions/[id]/tee-times
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const { data: teeTimes, error } = await supabaseAdmin
      .from("competition_tee_times")
      .select("*")
      .eq("competition_id", id)
      .order("tee_time", { ascending: true });

    if (error) throw error;

    if (!teeTimes || teeTimes.length === 0) {
      return NextResponse.json({ tee_times: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    // Fetch competition rounds for grouping context
    const { data: compRounds } = await supabaseAdmin
      .from("competition_rounds")
      .select("id, round_number, name, scheduled_date")
      .eq("competition_id", id);

    const compRoundById: Record<string, { id: string; round_number: number; name: string; scheduled_date: string | null }> =
      Object.fromEntries((compRounds ?? []).map((r: any) => [r.id, r]));

    // Fetch linked rounds with participants + profiles
    const roundIds = teeTimes.map((t) => t.round_id).filter(Boolean) as string[];

    let roundMap: Record<string, { id: string; status: string; participants: any[] }> = {};

    if (roundIds.length > 0) {
      const { data: participants } = await supabaseAdmin
        .from("round_participants")
        .select(`
          round_id,
          profile_id,
          is_guest,
          display_name,
          role,
          profiles:profile_id (id, name, avatar_url)
        `)
        .in("round_id", roundIds);

      const { data: rounds } = await supabaseAdmin
        .from("rounds")
        .select("id, status")
        .in("id", roundIds);

      for (const round of rounds ?? []) {
        roundMap[round.id] = {
          id: round.id,
          status: round.status,
          participants: [],
        };
      }

      for (const p of participants ?? []) {
        if (roundMap[p.round_id]) {
          roundMap[p.round_id].participants.push({
            profile_id: p.profile_id,
            is_guest: p.is_guest,
            display_name: p.display_name,
            role: p.role,
            profile: p.profiles ?? null,
          });
        }
      }
    }

    const result = teeTimes.map((t) => ({
      ...t,
      competition_round: t.competition_round_id ? (compRoundById[t.competition_round_id] ?? null) : null,
      round: t.round_id ? (roundMap[t.round_id] ?? null) : null,
    }));

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

    const competition = await getCompetitionById(id);
    if (!competition) return NextResponse.json({ error: "Competition not found" }, { status: 404 });

    // Must be group owner or admin
    if (!competition.group_id) {
      return NextResponse.json({ error: "Competition is not linked to a group" }, { status: 400 });
    }

    const { data: membership } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", competition.group_id)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();

    if (!membership || !["owner", "admin"].includes((membership as any).role)) {
      return NextResponse.json({ error: "Only group owner or admin can manage tee times" }, { status: 403 });
    }

    const body = await req.json();
    const { tee_time, group_number, notes, players, competition_round_id: bodyCompetitionRoundId } = body as {
      tee_time: string;
      group_number?: number;
      notes?: string;
      competition_round_id?: string;
      players?: Array<{
        profile_id?: string;
        is_guest?: boolean;
        display_name?: string;
        charge_to?: string | null;
        tee_box_id?: string | null;
      }>;
    };

    if (!tee_time) return NextResponse.json({ error: "tee_time is required" }, { status: 400 });

    // Resolve which competition round this tee time belongs to.
    // Explicit competition_round_id takes priority (multi-round competitions).
    // For single-round competitions, auto-link to the sole competition_round.
    let competitionRoundId: string | null = bodyCompetitionRoundId ?? null;
    if (!competitionRoundId) {
      const { data: rounds } = await supabaseAdmin
        .from("competition_rounds")
        .select("id")
        .eq("competition_id", id)
        .order("round_number", { ascending: true });
      if (rounds && rounds.length === 1) {
        competitionRoundId = (rounds[0] as any).id;
      }
    }

    const playerList = players ?? [];
    if (playerList.length > 4) {
      return NextResponse.json({ error: "Maximum 4 players per tee time" }, { status: 400 });
    }

    // Ensure no player is already assigned to a tee time in this competition (per round).
    // Only check/move players who are explicitly in the player list — don't pull the creating
    // admin out of their own tee time when they're just organising a group for other players.
    const nonGuestProfileIds = playerList
      .filter((p) => !p.is_guest && p.profile_id)
      .map((p) => p.profile_id as string);
    const checkProfileIds = nonGuestProfileIds;

    let existingTTQuery = supabaseAdmin
      .from("competition_tee_times")
      .select("round_id")
      .eq("competition_id", id);
    if (competitionRoundId) {
      existingTTQuery = existingTTQuery.eq("competition_round_id", competitionRoundId);
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

    // Derive round format and handicap settings from the competition
    const isMatchplay =
      competition.competition_type === "matchplay" ||
      competition.competition_type === "matchplay_knockout_match" ||
      competition.competition_type === "matchplay_fixture";
    const formatType = isMatchplay ? "matchplay" : "strokeplay";

    const handicapRules = (competition.handicap_rules ?? {}) as Record<string, unknown>;
    const handicapMode = (handicapRules.mode as string) ?? "allowance_pct";
    const handicapValue =
      handicapMode === "allowance_pct"
        ? (typeof handicapRules.allowance_pct === "number" ? handicapRules.allowance_pct : 100)
        : 0;

    // Create the scheduled round — locked by default so participants see read-only setup + Start Match
    const { data: round, error: roundErr } = await supabaseAdmin
      .from("rounds")
      .insert({
        created_by: profileId,
        status: "scheduled",
        scheduled_at: tee_time,
        course_id: competition.course_id ?? null,
        name: competition.name,
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

    // Create the tee time record, linking it to the competition round it belongs to
    const { data: teeTimeRow, error: ttErr } = await supabaseAdmin
      .from("competition_tee_times")
      .insert({
        competition_id: id,
        round_id: round.id,
        tee_time,
        group_number: group_number ?? null,
        notes: notes ?? null,
        created_by: profileId,
        competition_round_id: competitionRoundId,
      })
      .select("*")
      .single();

    if (ttErr) throw ttErr;

    // Back-link the round to this tee time so the rounds page can identify it.
    // Non-critical: all leaderboard queries use ctt.round_id (the reliable direction).
    const { error: backLinkErr } = await supabaseAdmin
      .from("rounds")
      .update({ competition_tee_time_id: teeTimeRow.id })
      .eq("id", round.id);
    if (backLinkErr) console.error("[tee-times] back-link update failed:", backLinkErr);

    // Charge guest entry fees to host players if requested
    if (competition.group_id && (competition as any).entry_fee_amount > 0) {
      for (const player of playerList) {
        if (player.is_guest && player.charge_to) {
          await supabaseAdmin.from("group_balance_transactions").insert({
            group_id: competition.group_id,
            profile_id: player.charge_to,
            competition_id: id,
            type: "extra_charge",
            amount: (competition as any).entry_fee_amount,
            note: `Guest entry fee — ${player.display_name ?? "Guest"}`,
            recorded_by: profileId,
          });
        }
      }
    }

    // Send tee_time_assigned notifications to all non-guest participants
    const notifInserts = participantInserts
      .filter((p) => p.profile_id && !p.is_guest)
      .map((p) => ({
        profile_id: p.profile_id,
        type: "tee_time_assigned",
        payload: {
          competition_id: id,
          competition_name: competition.name,
          tee_time,
          group_number: group_number ?? null,
          round_id: round.id,
        },
      }));

    if (notifInserts.length > 0) {
      await supabaseAdmin.from("user_notifications").insert(notifInserts);
    }

    return NextResponse.json({ tee_time: teeTimeRow }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
