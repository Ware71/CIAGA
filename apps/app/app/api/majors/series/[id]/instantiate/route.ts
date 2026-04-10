import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// POST /api/majors/series/[id]/instantiate
// Creates one competition per event template for the given year.
// Body: { year: number }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: seriesId } = await params;
    const body = await req.json();
    const year = Number(body.year);

    if (!year || year < 2000 || year > 2100) {
      return NextResponse.json({ error: "Valid year is required" }, { status: 400 });
    }

    // Fetch series with its event templates
    const { data: series, error: seriesErr } = await supabaseAdmin
      .from("competition_series")
      .select("*, event_templates:series_event_templates(*)")
      .eq("id", seriesId)
      .maybeSingle();

    if (seriesErr) throw seriesErr;
    if (!series) return NextResponse.json({ error: "Series not found" }, { status: 404 });

    const s = series as any;

    // Auth: caller must be owner/admin
    if (s.group_id) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", s.group_id)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json({ error: "Only group owner or admin can instantiate a series" }, { status: 403 });
      }
    }

    // Check if any competitions already exist for this series+year
    const { data: existing } = await supabaseAdmin
      .from("competitions")
      .select("id")
      .eq("series_id", seriesId)
      .eq("competition_year", year)
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json(
        { error: `Competitions for ${year} already exist in this series` },
        { status: 409 }
      );
    }

    const eventTemplates: any[] = (s.event_templates ?? []).sort(
      (a: any, b: any) => a.sort_order - b.sort_order
    );

    if (eventTemplates.length === 0) {
      return NextResponse.json(
        { error: "Add event templates to the series before creating a season" },
        { status: 400 }
      );
    }

    // Build competition rows — event template settings override series defaults
    const inserts = eventTemplates.map((et: any) => {
      const competitionType = et.template_competition_type ?? s.template_competition_type ?? "stroke";
      const scoringModel = et.template_scoring_model ?? s.template_scoring_model ?? "net";
      const pointsModel = et.template_points_model ?? s.template_points_model ?? "none";
      const rulesText = et.template_rules_text ?? s.template_rules_text ?? null;
      const settings = { ...(s.template_settings ?? {}), ...(et.template_settings ?? {}) };
      const numRounds = s.template_num_rounds ?? 1;

      // Build handicap_rules from merged settings
      const handicapRules: Record<string, unknown> = {};
      if (settings.handicap_allowance_pct != null) {
        handicapRules.allowance_pct = settings.handicap_allowance_pct;
      }
      if (settings.max_handicap != null) {
        handicapRules.max_handicap = settings.max_handicap;
      }

      return {
        name: `${et.name} ${year}`,
        group_id: s.group_id ?? null,
        competition_type: competitionType,
        scoring_model: scoringModel,
        points_model: pointsModel,
        rules_text: rulesText,
        handicap_rules: handicapRules,
        num_rounds: numRounds,
        points_table: {},
        eligibility_rules: {},
        round_rules: {},
        time_rules: {},
        membership_rules: {},
        standings_contribution: "event_only",
        majors_status: "upcoming",
        competition_category: s.template_competition_category ?? "round_based",
        aggregate_config: {},
        series_id: seriesId,
        series_event_template_id: et.id,
        competition_year: year,
        created_by_profile_id: profileId,
      };
    });

    const { data: created, error: insertErr } = await supabaseAdmin
      .from("competitions")
      .insert(inserts)
      .select("*");

    if (insertErr) throw insertErr;

    return NextResponse.json({ competitions: created ?? [] }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
