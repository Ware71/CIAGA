import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import type { EventViewerStats } from "@/lib/majors/types";

export const runtime = "nodejs";

// GET /api/majors/events/[eventTemplateId]/history
// Returns precomputed event_history_summaries for a recurring event template.
// Also returns the viewer's own results per year and aggregated career stats.
// Falls back to computing from leaderboard entries if no summary rows exist yet.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ eventTemplateId: string }> }
) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { eventTemplateId } = await params;

    // Fetch the event template for context
    const { data: template, error: tmplErr } = await supabaseAdmin
      .from("competition_event_templates")
      .select("id, name, competition_id")
      .eq("id", eventTemplateId)
      .maybeSingle();

    if (tmplErr) throw tmplErr;
    if (!template) return NextResponse.json({ error: "Event template not found" }, { status: 404 });

    // Try precomputed summaries first
    const { data: summaries, error: summariesErr } = await supabaseAdmin
      .from("event_history_summaries")
      .select(`
        competition_event_template_id, season_id, event_id, season_year,
        winning_score_summary, field_size, completed_at,
        winner:profiles!winner_profile_id(id, name, avatar_url),
        runner_up:profiles!runner_up_profile_id(id, name, avatar_url),
        event:events(id, name, event_date, majors_status)
      `)
      .eq("competition_event_template_id", eventTemplateId)
      .order("season_year", { ascending: false });

    if (summariesErr) throw summariesErr;

    // If we have precomputed data, enrich with viewer entries and return
    if (summaries && summaries.length > 0) {
      const compIds = (summaries as any[])
        .map((s) => s.event_id as string)
        .filter(Boolean);

      const { viewer_stats, viewerMap } = await fetchViewerData(profileId, compIds);

      const annotatedHistory = (summaries as any[]).map((row) => ({
        ...row,
        viewer_entry: viewerMap.get(row.event_id) ?? null,
      }));

      return NextResponse.json(
        { event_template: template, history: annotatedHistory, viewer_stats },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // Fallback: compute from leaderboard entries (for un-backfilled data)
    const { data: comps } = await supabaseAdmin
      .from("events")
      .select("id, name, event_date, event_year, majors_status")
      .eq("competition_event_template_id", eventTemplateId)
      .order("event_year", { ascending: false });

    if (!comps || comps.length === 0) {
      return NextResponse.json(
        { event_template: template, history: [], viewer_stats: null },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const compIds = (comps as any[]).map((c) => c.id as string);

    const [winnersRes, { viewer_stats, viewerMap }] = await Promise.all([
      supabaseAdmin
        .from("event_leaderboard_entries")
        .select("event_id, profile_id, position, net_score, profile:profiles(id, name, avatar_url)")
        .in("event_id", compIds)
        .in("position", [1, 2]),
      fetchViewerData(profileId, compIds),
    ]);

    const fieldCountMap = new Map<string, number>();
    const winnersByComp = new Map<string, { winner: any; runner_up: any; winning_score: string | null }>();
    for (const entry of ((winnersRes.data ?? []) as any[])) {
      const e = winnersByComp.get(entry.event_id) ?? { winner: null, runner_up: null, winning_score: null };
      if (entry.position === 1) {
        e.winner = entry.profile;
        e.winning_score = entry.net_score?.toString() ?? null;
      }
      if (entry.position === 2) e.runner_up = entry.profile;
      winnersByComp.set(entry.event_id, e);
      fieldCountMap.set(entry.event_id, (fieldCountMap.get(entry.event_id) ?? 0) + 1);
    }

    const history = (comps as any[]).map((c) => {
      const w = winnersByComp.get(c.id);
      return {
        competition_event_template_id: eventTemplateId,
        season_id: null,
        event_id: c.id,
        season_year: c.event_year ?? new Date(c.event_date ?? "").getFullYear(),
        winning_score_summary: w?.winning_score ?? null,
        field_size: fieldCountMap.get(c.id) ?? 0,
        completed_at: null,
        winner: w?.winner ?? null,
        runner_up: w?.runner_up ?? null,
        event: c,
        viewer_entry: viewerMap.get(c.id) ?? null,
      };
    });

    return NextResponse.json(
      { event_template: template, history, viewer_stats },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchViewerData(
  profileId: string,
  compIds: string[]
): Promise<{
  viewer_stats: EventViewerStats | null;
  viewerMap: Map<string, { position: number | null; net_score: number | null }>;
}> {
  if (compIds.length === 0) {
    return { viewer_stats: null, viewerMap: new Map() };
  }

  const { data: viewerEntries } = await supabaseAdmin
    .from("event_leaderboard_entries")
    .select("event_id, position, net_score")
    .eq("profile_id", profileId)
    .in("event_id", compIds);

  const viewerMap = new Map<string, { position: number | null; net_score: number | null }>();
  for (const e of ((viewerEntries ?? []) as any[])) {
    viewerMap.set(e.event_id, { position: e.position ?? null, net_score: e.net_score ?? null });
  }

  const appearances = viewerMap.size;
  if (appearances === 0) {
    return { viewer_stats: null, viewerMap };
  }

  const entries = [...viewerMap.values()];
  const wins = entries.filter((e) => e.position === 1).length;
  const positions = entries.map((e) => e.position).filter((p): p is number => p != null);
  const scores = entries.map((e) => e.net_score).filter((s): s is number => s != null);

  const viewer_stats: EventViewerStats = {
    appearances,
    wins,
    avg_finish: positions.length > 0
      ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10
      : null,
    best_finish: positions.length > 0 ? Math.min(...positions) : null,
    avg_net_score: scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
      : null,
    best_net_score: scores.length > 0 ? Math.min(...scores) : null,
  };

  return { viewer_stats, viewerMap };
}
