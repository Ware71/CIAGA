import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/competitions — list events
export async function GET(req: Request) {
  try {
    await getAuthedProfileOrThrow(req);
    const url = new URL(req.url);

    const groupId = url.searchParams.get("group_id");
    const majorsStatus = url.searchParams.get("status");
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "30", 10), 100);

    let query = supabaseAdmin
      .from("events")
      .select("*, group:major_groups(id, name, ciaga_tag), course:courses(id, name)")
      .order("event_date", { ascending: true })
      .limit(limit);

    if (groupId) query = query.eq("group_id", groupId);
    if (majorsStatus) query = query.eq("majors_status", majorsStatus);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ events: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// POST /api/majors/competitions — create a new event
export async function POST(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const body = await req.json();

    const { name, group_id, description, event_type, format, course_id,
      default_tee_male_id, default_tee_female_id,
      event_date, entry_window_start, entry_window_end, rules_text,
      scoring_model, points_model, points_table, eligibility_rules, handicap_rules,
      num_rounds, round_rules, time_rules, membership_rules, standings_contribution,
      competition_id, competition_event_template_id, event_year, event_category, aggregate_config,
      // Leaderboard freeze / ceremony reveal
      leaderboard_freeze_last_holes, leaderboard_freeze_scope, leaderboard_freeze_top_x,
      leaderboard_freeze_auto_reveal, leaderboard_reveal_style, leaderboard_reveal_top_x,
    } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Event name is required" }, { status: 400 });
    }

    // If a group is specified, verify caller is owner or admin of that group
    if (group_id) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", group_id)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json({ error: "Only group owner or admin can create events" }, { status: 403 });
      }
    }

    // Auto-detect which group season this event falls into
    let group_season_id: string | null = null;
    if (group_id && event_date) {
      const { data: matchedSeason } = await supabaseAdmin
        .from("group_seasons")
        .select("id")
        .eq("group_id", group_id)
        .lte("start_date", event_date)
        .gte("end_date", event_date)
        .limit(1)
        .maybeSingle();
      group_season_id = (matchedSeason as any)?.id ?? null;
    }

    const { data: event, error } = await supabaseAdmin
      .from("events")
      .insert({
        name: name.trim(),
        description: description ?? null,
        group_id: group_id ?? null,
        event_type: event_type ?? "stroke",
        format: format ?? null,
        course_id: course_id ?? null,
        event_date: event_date ?? null,
        entry_window_start: entry_window_start ?? null,
        entry_window_end: entry_window_end ?? null,
        rules_text: rules_text ?? null,
        scoring_model: scoring_model ?? "net",
        points_model: points_model ?? "none",
        points_table: points_table ?? {},
        eligibility_rules: eligibility_rules ?? {},
        handicap_rules: handicap_rules ?? {},
        num_rounds: num_rounds ?? 1,
        round_rules: round_rules ?? {},
        time_rules: time_rules ?? {},
        membership_rules: membership_rules ?? {},
        standings_contribution: standings_contribution ?? "event_only",
        majors_status: "upcoming",
        created_by_profile_id: profileId,
        competition_id: competition_id ?? null,
        competition_event_template_id: competition_event_template_id ?? null,
        event_year: event_year ?? null,
        event_category: event_category ?? "round_based",
        aggregate_config: aggregate_config ?? {},
        group_season_id,
        leaderboard_freeze_last_holes: leaderboard_freeze_last_holes ?? null,
        leaderboard_freeze_scope: leaderboard_freeze_scope ?? "all",
        leaderboard_freeze_top_x: leaderboard_freeze_top_x ?? null,
        leaderboard_freeze_auto_reveal: leaderboard_freeze_auto_reveal ?? false,
        leaderboard_freeze_state: "live",
        leaderboard_reveal_style: leaderboard_reveal_style ?? "none",
        leaderboard_reveal_top_x: leaderboard_reveal_top_x ?? null,
      })
      .select("*")
      .single();

    if (error) throw error;

    // Auto-create event_rounds for every round in this event
    const numRounds = (event as any).num_rounds ?? 1;
    if (numRounds > 0) {
      const roundRows = Array.from({ length: numRounds }, (_, i) => ({
        event_id: (event as any).id,
        round_number: i + 1,
        name: `Round ${i + 1}`,
        status: "scheduled",
        course_id: course_id ?? null,
        default_tee_box_id_male: default_tee_male_id ?? null,
        default_tee_box_id_female: default_tee_female_id ?? null,
      }));
      await supabaseAdmin.from("event_rounds").insert(roundRows);
    }

    return NextResponse.json({ event }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
