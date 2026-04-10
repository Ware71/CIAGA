import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/events/[eventTemplateId]/history
// Returns precomputed event_history_summaries for a recurring event template.
// Falls back to computing from leaderboard entries if no summary rows exist yet.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ eventTemplateId: string }> }
) {
  try {
    await getAuthedProfileOrThrow(req);
    const { eventTemplateId } = await params;

    // Fetch the event template for context
    const { data: template, error: tmplErr } = await supabaseAdmin
      .from("series_event_templates")
      .select("id, name, series_id")
      .eq("id", eventTemplateId)
      .maybeSingle();

    if (tmplErr) throw tmplErr;
    if (!template) return NextResponse.json({ error: "Event template not found" }, { status: 404 });

    // Try precomputed summaries first
    const { data: summaries, error: summariesErr } = await supabaseAdmin
      .from("event_history_summaries")
      .select(`
        series_event_template_id, season_id, competition_id, season_year,
        winning_score_summary, field_size, completed_at,
        winner:profiles!winner_profile_id(id, name, avatar_url),
        runner_up:profiles!runner_up_profile_id(id, name, avatar_url),
        competition:competitions(id, name, competition_date, majors_status)
      `)
      .eq("series_event_template_id", eventTemplateId)
      .order("season_year", { ascending: false });

    if (summariesErr) throw summariesErr;

    // If we have precomputed data, return it
    if (summaries && summaries.length > 0) {
      return NextResponse.json(
        { event_template: template, history: summaries },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // Fallback: compute from leaderboard entries (for un-backfilled data)
    const { data: comps } = await supabaseAdmin
      .from("competitions")
      .select("id, name, competition_date, competition_year, majors_status")
      .eq("series_event_template_id", eventTemplateId)
      .order("competition_year", { ascending: false });

    if (!comps || comps.length === 0) {
      return NextResponse.json(
        { event_template: template, history: [] },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const compIds = (comps as any[]).map((c) => c.id as string);

    const [winnersRes, fieldRes] = await Promise.all([
      supabaseAdmin
        .from("competition_leaderboard_entries")
        .select("competition_id, profile_id, position, net_score, profile:profiles(id, name, avatar_url)")
        .in("competition_id", compIds)
        .in("position", [1, 2]),
      supabaseAdmin
        .from("competition_leaderboard_entries")
        .select("competition_id", { count: "exact" })
        .in("competition_id", compIds),
    ]);

    const winnersByComp = new Map<string, { winner: any; runner_up: any; winning_score: string | null }>();
    for (const entry of ((winnersRes.data ?? []) as any[])) {
      const e = winnersByComp.get(entry.competition_id) ?? { winner: null, runner_up: null, winning_score: null };
      if (entry.position === 1) {
        e.winner = entry.profile;
        e.winning_score = entry.net_score?.toString() ?? null;
      }
      if (entry.position === 2) e.runner_up = entry.profile;
      winnersByComp.set(entry.competition_id, e);
    }

    const fieldCountMap = new Map<string, number>();
    for (const row of ((winnersRes.data ?? []) as any[])) {
      fieldCountMap.set(row.competition_id, (fieldCountMap.get(row.competition_id) ?? 0) + 1);
    }

    const history = (comps as any[]).map((c) => {
      const w = winnersByComp.get(c.id);
      return {
        series_event_template_id: eventTemplateId,
        season_id: null,
        competition_id: c.id,
        season_year: c.competition_year ?? new Date(c.competition_date ?? "").getFullYear(),
        winning_score_summary: w?.winning_score ?? null,
        field_size: fieldCountMap.get(c.id) ?? 0,
        completed_at: null,
        winner: w?.winner ?? null,
        runner_up: w?.runner_up ?? null,
        competition: c,
      };
    });

    return NextResponse.json(
      { event_template: template, history },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
