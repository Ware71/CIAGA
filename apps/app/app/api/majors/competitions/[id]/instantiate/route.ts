import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// POST /api/majors/competitions/[id]/instantiate
// Creates a competition_seasons row and one event per event template for the given year.
// Body: { year: number, season_name?: string, standings_model?: string }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: competitionId } = await params;
    const body = await req.json();
    const year = Number(body.year);

    if (!year || year < 2000 || year > 2100) {
      return NextResponse.json({ error: "Valid year is required" }, { status: 400 });
    }

    // Optional per-event overrides: dates and/or course IDs
    const eventOverrides: Array<{ template_id: string; event_date?: string; course_id?: string }> =
      Array.isArray(body.event_overrides) ? body.event_overrides : [];
    const overrideMap = new Map<string, { event_date?: string; course_id?: string }>();
    for (const ov of eventOverrides) {
      if (ov.template_id) overrideMap.set(ov.template_id, ov);
    }

    // Fetch competition with its event templates
    const { data: competition, error: competitionErr } = await supabaseAdmin
      .from("competitions")
      .select("*, event_templates:competition_event_templates(*)")
      .eq("id", competitionId)
      .maybeSingle();

    if (competitionErr) throw competitionErr;
    if (!competition) return NextResponse.json({ error: "Competition not found" }, { status: 404 });

    const s = competition as any;

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
        return NextResponse.json({ error: "Only group owner or admin can instantiate a competition" }, { status: 403 });
      }
    }

    // Check if a season already exists for this competition+year
    const { data: existingSeason } = await supabaseAdmin
      .from("competition_seasons")
      .select("id")
      .eq("competition_id", competitionId)
      .eq("season_year", year)
      .maybeSingle();

    if (existingSeason) {
      return NextResponse.json(
        { error: `A season for ${year} already exists in this competition` },
        { status: 409 }
      );
    }

    const eventTemplates: any[] = (s.event_templates ?? []).sort(
      (a: any, b: any) => a.sort_order - b.sort_order
    );

    if (eventTemplates.length === 0) {
      return NextResponse.json(
        { error: "Add event templates to the competition before creating a season" },
        { status: 400 }
      );
    }

    // ── 1. Create the competition_seasons row ────────────────────────
    const seasonName = body.season_name ?? `${s.name} ${year}`;
    const standingsModel = body.standings_model ?? "season_points";

    const { data: season, error: seasonErr } = await supabaseAdmin
      .from("competition_seasons")
      .insert({
        competition_id: competitionId,
        season_year: year,
        name: seasonName,
        status: "draft",
        standings_model: standingsModel,
      })
      .select("*")
      .single();

    if (seasonErr) throw seasonErr;

    // ── 2. Build and insert event rows ─────────────────────
    const inserts = eventTemplates.map((et: any) => {
      const eventType = et.template_event_type ?? s.template_event_type ?? "stroke";
      const scoringModel = et.template_scoring_model ?? s.template_scoring_model ?? "net";
      const pointsModel = et.template_points_model ?? s.template_points_model ?? "none";
      const rulesText = et.template_rules_text ?? s.template_rules_text ?? null;
      const settings = { ...(s.template_settings ?? {}), ...(et.template_settings ?? {}) };
      const numRounds = s.template_num_rounds ?? 1;

      const handicapRules: Record<string, unknown> = {};
      if (settings.handicap_allowance_pct != null) {
        handicapRules.allowance_pct = settings.handicap_allowance_pct;
      }
      if (settings.max_handicap != null) {
        handicapRules.max_handicap = settings.max_handicap;
      }

      const override = overrideMap.get(et.id);

      return {
        name: `${et.name} ${year}`,
        group_id: s.group_id ?? null,
        event_type: eventType,
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
        majors_status: "draft",
        event_category: s.template_event_category ?? "round_based",
        aggregate_config: {},
        competition_id: competitionId,
        competition_event_template_id: et.id,
        event_year: year,
        season_id: (season as any).id,
        event_structure: "season_event",
        created_by_profile_id: profileId,
        // Apply optional per-event overrides (date, course)
        event_date: override?.event_date ?? null,
        course_id: override?.course_id ?? null,
        // _et_id used below to build rules versions — not a real column
        _et_id: et.id,
        _scoring_model: scoringModel,
        _handicap_rules: handicapRules,
      };
    });

    // Strip underscore-prefixed helper fields before inserting
    const dbInserts = inserts.map(({ _et_id, _scoring_model, _handicap_rules, ...row }) => row);

    const { data: created, error: insertErr } = await supabaseAdmin
      .from("events")
      .insert(dbInserts)
      .select("*");

    if (insertErr) throw insertErr;
    if (!created || created.length === 0) throw new Error("No events created");

    // ── 3. Create frozen rules_version per event ───────────
    const rulesInserts = created.map((evt: any, i: number) => {
      const src = inserts[i];
      return {
        event_id: evt.id,
        source_template_id: src._et_id,
        rules_version: 1,
        event_format: evt.event_type,
        event_structure: "season_event",
        scoring_basis: src._scoring_model === "gross" ? "gross"
          : src._scoring_model === "stableford_points" ? "stableford_points"
          : src._scoring_model === "match_result" ? "match_result"
          : "net",
        handicap_config: src._handicap_rules ?? {},
        points_config: {},
        tie_break_config: {},
        eligibility_config: {},
        created_by_profile_id: profileId,
      };
    });

    const { data: rulesVersions, error: rulesErr } = await supabaseAdmin
      .from("event_rules_versions")
      .insert(rulesInserts)
      .select("id, event_id");

    if (rulesErr) throw rulesErr;

    // ── 4. Back-link each event to its rules version ───────
    if (rulesVersions && rulesVersions.length > 0) {
      const updatePromises = (rulesVersions as any[]).map((rv: any) =>
        supabaseAdmin
          .from("events")
          .update({ published_rules_version_id: rv.id })
          .eq("id", rv.event_id)
      );
      await Promise.all(updatePromises);
    }

    return NextResponse.json(
      { season, events: created, rules_versions: rulesVersions ?? [] },
      { status: 201 }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
