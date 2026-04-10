import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/competitions/[id]/fixtures — list fixtures with stages
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id } = await params;

    const [stagesResult, fixturesResult] = await Promise.all([
      supabaseAdmin
        .from("matchplay_stages")
        .select("*")
        .eq("competition_id", id)
        .order("sort_order", { ascending: true }),
      supabaseAdmin
        .from("matchplay_fixtures")
        .select(`
          *,
          home_entry:competition_entries!home_entry_id(id, profile_id, profile:profiles(id, name, avatar_url)),
          away_entry:competition_entries!away_entry_id(id, profile_id, profile:profiles(id, name, avatar_url))
        `)
        .eq("competition_id", id)
        .order("round_number", { ascending: true }),
    ]);

    if (stagesResult.error) throw stagesResult.error;
    if (fixturesResult.error) throw fixturesResult.error;

    return NextResponse.json(
      { stages: stagesResult.data ?? [], fixtures: fixturesResult.data ?? [] },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// POST /api/majors/competitions/[id]/fixtures/generate
// Generates fixtures for a league stage from entries, or first-round bracket.
// Body: { stage_id?: string, stage_type?: string, stage_name?: string, mode: "league_round_robin" | "knockout_first_round" }
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id } = await params;
    const body = await req.json();

    // Auth check
    const { data: comp } = await supabaseAdmin
      .from("competitions")
      .select("group_id")
      .eq("id", id)
      .maybeSingle();

    if (!comp) return NextResponse.json({ error: "Competition not found" }, { status: 404 });

    const groupId = (comp as any).group_id;
    if (groupId) {
      const { data: membership } = await supabaseAdmin
        .from("major_group_memberships")
        .select("role")
        .eq("group_id", groupId)
        .eq("profile_id", profileId)
        .eq("status", "active")
        .maybeSingle();

      if (!membership || !["owner", "admin"].includes((membership as any).role)) {
        return NextResponse.json({ error: "Only group owner or admin can generate fixtures" }, { status: 403 });
      }
    }

    const mode = body.mode ?? "league_round_robin";

    // Fetch entries
    const { data: entries, error: entriesErr } = await supabaseAdmin
      .from("competition_entries")
      .select("id, profile_id")
      .eq("competition_id", id)
      .in("entry_status", ["entered", "approved"]);

    if (entriesErr) throw entriesErr;
    if (!entries || entries.length < 2) {
      return NextResponse.json({ error: "At least 2 entries required to generate fixtures" }, { status: 400 });
    }

    // Create or use existing stage
    let stageId = body.stage_id ?? null;
    if (!stageId) {
      const stageType = body.stage_type ?? (mode === "knockout_first_round" ? "round_of_16" : "league_phase");
      const stageName = body.stage_name ?? (mode === "knockout_first_round" ? "Knockout" : "League Phase");

      const { data: stage, error: stageErr } = await supabaseAdmin
        .from("matchplay_stages")
        .insert({ competition_id: id, stage_type: stageType, name: stageName, sort_order: 0 })
        .select("id")
        .single();

      if (stageErr) throw stageErr;
      stageId = (stage as any).id;
    }

    const fixtures: Record<string, unknown>[] = [];

    if (mode === "league_round_robin") {
      // Generate all pairs (round-robin)
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          fixtures.push({
            competition_id: id,
            stage_id: stageId,
            home_entry_id: entries[i].id,
            away_entry_id: entries[j].id,
            status: "scheduled",
          });
        }
      }
    } else if (mode === "knockout_first_round") {
      // Pair entries sequentially: 1v2, 3v4, etc.
      const shuffled = [...entries];
      for (let i = 0; i < shuffled.length - 1; i += 2) {
        fixtures.push({
          competition_id: id,
          stage_id: stageId,
          round_number: 1,
          home_entry_id: shuffled[i].id,
          away_entry_id: shuffled[i + 1].id,
          status: "scheduled",
        });
      }
    } else {
      return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 });
    }

    const { data: created, error: fixtureErr } = await supabaseAdmin
      .from("matchplay_fixtures")
      .insert(fixtures)
      .select("*");

    if (fixtureErr) throw fixtureErr;

    return NextResponse.json({ stage_id: stageId, fixtures: created ?? [] }, { status: 201 });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
