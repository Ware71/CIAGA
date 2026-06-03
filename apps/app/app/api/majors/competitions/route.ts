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

      // Latest season per competition (prefer completed/official, then live/published)
      const { data: seasons } = await supabaseAdmin
        .from("competition_seasons")
        .select("id, competition_id, season_label, status, end_date, season_year")
        .in("competition_id", compIds)
        .in("status", ["completed", "live", "published", "archived"])
        .order("season_year", { ascending: false })
        .order("end_date", { ascending: false });

      // Pick the best season per competition
      const latestSeasonMap = new Map<string, any>();
      const statusPriority: Record<string, number> = { live: 0, published: 1, completed: 2, archived: 3 };
      for (const s of (seasons ?? []) as any[]) {
        const existing = latestSeasonMap.get(s.competition_id);
        if (!existing) {
          latestSeasonMap.set(s.competition_id, s);
        } else {
          const ePrio = statusPriority[existing.status] ?? 99;
          const nPrio = statusPriority[s.status] ?? 99;
          if (nPrio < ePrio) latestSeasonMap.set(s.competition_id, s);
        }
      }

      // For completed/archived seasons, get the position-1 holder
      const completedSeasonIds = [...latestSeasonMap.values()]
        .filter((s: any) => s.status === "completed" || s.status === "archived")
        .map((s: any) => s.id as string);

      const holderMap = new Map<string, { name: string | null; avatar_url: string | null }>();
      if (completedSeasonIds.length > 0) {
        const { data: holders } = await supabaseAdmin
          .from("season_standings_entries")
          .select("season_id, profile:profiles(name, avatar_url)")
          .in("season_id", completedSeasonIds)
          .eq("position", 1);

        for (const h of (holders ?? []) as any[]) {
          holderMap.set(h.season_id, { name: h.profile?.name ?? null, avatar_url: h.profile?.avatar_url ?? null });
        }
      }

      for (const comp of competitions as any[]) {
        const latestSeason = latestSeasonMap.get(comp.id) ?? null;
        comp.latest_season = latestSeason
          ? { id: latestSeason.id, season_label: latestSeason.season_label, status: latestSeason.status }
          : null;
        comp.current_holder = latestSeason ? (holderMap.get(latestSeason.id) ?? null) : null;
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
