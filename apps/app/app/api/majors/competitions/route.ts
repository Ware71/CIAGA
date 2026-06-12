import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/competitions?group_id=... — list competitions for a group
export async function GET(req: Request) {
  try {
    await getAuthedProfileOrThrow(req);
    const url = new URL(req.url);
    const groupId = url.searchParams.get("group_id");

    if (!groupId) {
      return NextResponse.json({ error: "group_id is required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("competitions")
      .select("*, event_templates:competition_event_templates(id)")
      .eq("group_id", groupId)
      .order("name", { ascending: true });

    if (error) throw error;
    const competitions = data ?? [];

    // Enrich with current_holder and latest_season
    if (competitions.length > 0) {
      const compIds = competitions.map((c: any) => c.id as string);

      // Current group season (shared across all competitions in this group)
      const { data: groupSeasons } = await supabaseAdmin
        .from("group_seasons")
        .select("id, season_label, name, status, end_date, season_year")
        .eq("group_id", groupId)
        .in("status", ["live", "published", "completed", "archived"])
        .order("season_year", { ascending: false })
        .order("end_date", { ascending: false });

      const statusPriority: Record<string, number> = { live: 0, published: 1, completed: 2, archived: 3 };
      let currentGroupSeason: any = null;
      if ((groupSeasons ?? []).length > 0) {
        const sorted = [...(groupSeasons as any[])].sort((a, b) => {
          const pa = statusPriority[a.status] ?? 99;
          const pb = statusPriority[b.status] ?? 99;
          if (pa !== pb) return pa - pb;
          return (b.season_year ?? 0) - (a.season_year ?? 0);
        });
        currentGroupSeason = sorted[0];
      }

      // Current holder: position-1 winner of the most recent completed/official event per competition
      const { data: compEvents } = await supabaseAdmin
        .from("events")
        .select("id, competition_id, event_date")
        .in("competition_id", compIds)
        .eq("group_id", groupId)
        .in("majors_status", ["completed", "official"])
        .order("event_date", { ascending: false });

      const latestEventByComp = new Map<string, string>();
      for (const ev of (compEvents ?? []) as any[]) {
        if (ev.competition_id && !latestEventByComp.has(ev.competition_id)) {
          latestEventByComp.set(ev.competition_id, ev.id);
        }
      }

      const holderEventIds = [...latestEventByComp.values()];
      const holderMap = new Map<string, { name: string | null; avatar_url: string | null }>();

      if (holderEventIds.length > 0) {
        const { data: winners } = await supabaseAdmin
          .from("event_leaderboard_entries")
          .select("event_id, profile:profiles(name, avatar_url), position, playoff_final_position")
          .in("event_id", holderEventIds)
          .eq("position", 1);

        // event_id → competition_id reverse map
        const eventToComp = new Map<string, string>(
          [...latestEventByComp.entries()].map(([cid, eid]) => [eid, cid])
        );

        for (const w of (winners ?? []) as any[]) {
          const compId = eventToComp.get(w.event_id);
          if (compId && ((w.playoff_final_position ?? w.position) === 1)) {
            holderMap.set(compId, { name: w.profile?.name ?? null, avatar_url: w.profile?.avatar_url ?? null });
          }
        }
      }

      for (const comp of competitions as any[]) {
        comp.latest_season = currentGroupSeason
          ? { id: currentGroupSeason.id, season_label: currentGroupSeason.season_label ?? currentGroupSeason.name, status: currentGroupSeason.status }
          : null;
        comp.current_holder = holderMap.get(comp.id) ?? null;
      }
    }

    return NextResponse.json({ competitions }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// POST /api/majors/competitions — create a competition
export async function POST(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const body = await req.json();

    const {
      group_id,
      name,
      description,
      recur_annually,
      typical_month,
      template_event_type,
      template_event_category,
      template_scoring_model,
      template_points_model,
      template_rules_text,
      template_settings,
      default_prize_pots,
    } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Competition name is required" }, { status: 400 });
    }

    // Caller must be owner or admin of the group
    if (group_id) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", group_id)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json(
          { error: "Only group owner or admin can create a competition" },
          { status: 403 }
        );
      }
    }

    const { data: competition, error } = await supabaseAdmin
      .from("competitions")
      .insert({
        group_id: group_id ?? null,
        name: name.trim(),
        description: description ?? null,
        recur_annually: recur_annually ?? true,
        typical_month: typical_month ?? null,
        template_event_type: template_event_type ?? "stroke",
        template_event_category: template_event_category ?? "round_based",
        template_scoring_model: template_scoring_model ?? "net",
        template_points_model: template_points_model ?? "none",
        template_rules_text: template_rules_text ?? null,
        template_settings: template_settings ?? {},
        default_prize_pots: default_prize_pots ?? null,
        created_by_profile_id: profileId,
      })
      .select("*")
      .single();

    if (error) throw error;
    return NextResponse.json({ competition }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
