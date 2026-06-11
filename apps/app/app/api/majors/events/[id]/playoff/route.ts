import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getEventById } from "@/lib/majors/queries";
import { computeCountback } from "@/lib/majors/countback";
import { strokesReceivedOnHole } from "@/lib/rounds/handicapUtils";

export const runtime = "nodejs";

async function checkAdminPermission(event: any, profileId: string) {
  if (event.group_id) {
    const { data: mem } = await supabaseAdmin
      .from("major_group_memberships")
      .select("role")
      .eq("group_id", event.group_id)
      .eq("profile_id", profileId)
      .eq("status", "active")
      .maybeSingle();
    if (!mem || !["owner", "admin"].includes((mem as any).role)) {
      return false;
    }
  } else if (event.created_by_profile_id !== profileId) {
    return false;
  }
  return true;
}

/**
 * Resolve each player's event playing handicap (the handicap they were scored off in
 * the event), from their accepted round's round_participants. Playoff strokes are
 * allocated from this by stroke index. event_entries.assigned_course_handicap is often
 * null, so we use the round's playing/course handicap instead.
 */
async function getPlayoffPlayingHandicaps(
  eventId: string,
  profileIds: string[],
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const pid of profileIds) {
    const { data: sub } = await supabaseAdmin
      .from("event_round_submissions")
      .select("round_id")
      .eq("event_id", eventId)
      .eq("profile_id", pid)
      .eq("accepted", true)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub) { result[pid] = 0; continue; }
    const { data: rp } = await supabaseAdmin
      .from("round_participants")
      .select("playing_handicap_used, course_handicap_used")
      .eq("round_id", (sub as any).round_id)
      .eq("profile_id", pid)
      .maybeSingle();
    result[pid] = (rp as any)?.playing_handicap_used ?? (rp as any)?.course_handicap_used ?? 0;
  }
  return result;
}

// GET /api/majors/events/[id]/playoff
// Returns active playoff with holes+scores, and default tee info for the event.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: eventId } = await params;

    const [playoffRes, eventRoundsRes] = await Promise.all([
      supabaseAdmin
        .from("event_playoffs")
        .select("*")
        .eq("event_id", eventId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("event_rounds")
        .select("id, round_number, default_tee_box_id_male, default_tee_box_id_female, course_id")
        .eq("event_id", eventId)
        .order("round_number", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const playoff = playoffRes.data;
    let holes: any[] = [];
    let handicaps: Record<string, number> = {};
    if (playoff) {
      const { data: holesData } = await supabaseAdmin
        .from("event_playoff_holes")
        .select("*, event_playoff_scores(*)")
        .eq("playoff_id", playoff.id)
        .order("sequence", { ascending: true });
      // Expose the embedded scores under `scores` (the PlayoffHoleWithScores shape the
      // client consumes), not the raw Supabase relation key `event_playoff_scores`.
      holes = (holesData ?? []).map((h: any) => ({ ...h, scores: h.event_playoff_scores ?? [] }));
      handicaps = await getPlayoffPlayingHandicaps(eventId, (playoff as any).tied_profile_ids ?? []);
    }

    return NextResponse.json({
      playoff: playoff ?? null,
      holes,
      handicaps,
      default_tee_box_id: (eventRoundsRes.data as any)?.default_tee_box_id_male ?? null,
      default_course_id: (eventRoundsRes.data as any)?.course_id ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

// POST /api/majors/events/[id]/playoff
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const { id: eventId } = await params;

    const event = await getEventById(eventId);
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const isAdmin = await checkAdminPermission(event, profileId);
    if (!isAdmin) return NextResponse.json({ error: "Admin or owner required" }, { status: 403 });

    const body = await req.json();
    const { action } = body as { action: string };

    switch (action) {

      // ── create ────────────────────────────────────────────────────────────
      case "create": {
        const { resolution_type, hole_number, course_id, tee_box_id } = body as {
          resolution_type: "playoff" | "countback";
          hole_number?: number;
          course_id?: string;
          tee_box_id?: string;
        };

        // Fetch tied players (position=1 with no playoff result yet)
        const { data: entries } = await supabaseAdmin
          .from("event_leaderboard_entries")
          .select("profile_id")
          .eq("event_id", eventId)
          .eq("position", 1)
          .is("playoff_result", null);

        const tiedIds = (entries ?? []).map((e: any) => e.profile_id);
        if (tiedIds.length < 2) {
          return NextResponse.json({ error: "Need at least 2 tied players at position 1" }, { status: 400 });
        }

        const { data: playoff, error: pe } = await supabaseAdmin
          .from("event_playoffs")
          .insert({
            event_id: eventId,
            status: "active",
            resolution_type,
            tied_profile_ids: tiedIds,
            created_by: profileId,
          })
          .select()
          .single();
        if (pe) throw pe;

        if (resolution_type === "playoff" && hole_number && course_id && tee_box_id) {
          // Fetch hole details from the tee box
          const { data: holeData } = await supabaseAdmin
            .from("course_tee_holes")
            .select("hole_number, par, handicap")
            .eq("tee_box_id", tee_box_id)
            .eq("hole_number", hole_number)
            .maybeSingle();

          const { data: hole, error: he } = await supabaseAdmin
            .from("event_playoff_holes")
            .insert({
              playoff_id: (playoff as any).id,
              sequence: 1,
              course_id,
              tee_box_id,
              hole_number,
              par: (holeData as any)?.par ?? 4,
              stroke_index: (holeData as any)?.handicap ?? hole_number,
              remaining_profile_ids: tiedIds,
            })
            .select()
            .single();
          if (he) throw he;
          return NextResponse.json({ playoff, hole });
        }

        return NextResponse.json({ playoff });
      }

      // ── submit_score ──────────────────────────────────────────────────────
      case "submit_score": {
        const { playoff_hole_id, target_profile_id, gross_strokes } = body as {
          playoff_hole_id: string;
          target_profile_id: string;
          gross_strokes: number | null;
        };

        // Clearing a score (the entry sheet's "Clear score") removes the row.
        if (gross_strokes == null) {
          await supabaseAdmin
            .from("event_playoff_scores")
            .delete()
            .eq("playoff_hole_id", playoff_hole_id)
            .eq("profile_id", target_profile_id);
          return NextResponse.json({ ok: true });
        }

        // Load hole details for net calculation
        const { data: holeRow } = await supabaseAdmin
          .from("event_playoff_holes")
          .select("stroke_index, playoff_id, event_playoffs(event_id)")
          .eq("id", playoff_hole_id)
          .single();

        // Strokes are allocated from the player's event playing handicap by stroke index.
        const hcaps = await getPlayoffPlayingHandicaps(
          (holeRow as any)?.event_playoffs?.event_id ?? eventId,
          [target_profile_id],
        );
        const courseHcp = hcaps[target_profile_id] ?? 0;
        const strokesRecv = strokesReceivedOnHole(courseHcp, (holeRow as any)?.stroke_index ?? null);
        const net_strokes = gross_strokes - strokesRecv;

        const { data: score, error: se } = await supabaseAdmin
          .from("event_playoff_scores")
          .upsert(
            {
              playoff_hole_id,
              profile_id: target_profile_id,
              gross_strokes,
              net_strokes,
              eliminated: false,
            },
            { onConflict: "playoff_hole_id,profile_id" }
          )
          .select()
          .single();
        if (se) throw se;
        return NextResponse.json({ score });
      }

      // ── advance ───────────────────────────────────────────────────────────
      case "advance": {
        const { playoff_hole_id } = body as { playoff_hole_id: string };

        const { data: holeRow } = await supabaseAdmin
          .from("event_playoff_holes")
          .select("*, event_playoffs(*, event_id)")
          .eq("id", playoff_hole_id)
          .single();
        if (!holeRow) return NextResponse.json({ error: "Hole not found" }, { status: 404 });

        const remaining: string[] = (holeRow as any).remaining_profile_ids;
        const { data: scoresData } = await supabaseAdmin
          .from("event_playoff_scores")
          .select("profile_id, gross_strokes, net_strokes")
          .eq("playoff_hole_id", playoff_hole_id)
          .in("profile_id", remaining);

        const scores = scoresData ?? [];
        if (scores.length < remaining.length) {
          return NextResponse.json({ error: "Not all players have scored yet" }, { status: 400 });
        }

        // Recompute net from the players' event playing handicaps by stroke index, so
        // the result is robust even if an older score row stored a stale net.
        const scoringModel = (event as any).scoring_model ?? "net";
        const higherIsBetter = scoringModel === "stableford_points";
        const advHcaps = await getPlayoffPlayingHandicaps(eventId, remaining);
        const holeSi = (holeRow as any).stroke_index ?? null;
        const holePar = (holeRow as any).par ?? 4;
        const valueFor = (s: { profile_id: string; gross_strokes: number | null }) => {
          const gross = s.gross_strokes ?? 0;
          if (scoringModel === "gross") return gross;
          const net = gross - strokesReceivedOnHole(advHcaps[s.profile_id] ?? 0, holeSi);
          if (scoringModel === "stableford_points") return Math.max(0, 2 - (net - holePar));
          return net;
        };

        const best = scores.reduce<number>((acc, s) => {
          const v = valueFor(s as any);
          return higherIsBetter ? Math.max(acc, v) : Math.min(acc, v);
        }, higherIsBetter ? -Infinity : Infinity);

        const winners = scores.filter((s) => valueFor(s as any) === best).map((s) => s.profile_id);
        const losers = scores.filter((s) => valueFor(s as any) !== best).map((s) => s.profile_id);

        // Mark losers as eliminated
        if (losers.length > 0) {
          await supabaseAdmin
            .from("event_playoff_scores")
            .update({ eliminated: true })
            .eq("playoff_hole_id", playoff_hole_id)
            .in("profile_id", losers);
        }

        const playoffId = (holeRow as any).playoff_id;

        // Append losers to elimination_log
        const { data: playoffRow } = await supabaseAdmin
          .from("event_playoffs")
          .select("elimination_log")
          .eq("id", playoffId)
          .single();
        const currentLog: string[][] = (playoffRow as any)?.elimination_log ?? [];
        if (losers.length > 0) {
          await supabaseAdmin
            .from("event_playoffs")
            .update({ elimination_log: [...currentLog, losers] })
            .eq("id", playoffId);
        }

        if (winners.length === 1) {
          // One winner — complete the playoff
          return NextResponse.json({ complete: true, winner_profile_id: winners[0], remaining: winners });
        }

        // Still tied — return remaining players for admin to pick next hole
        return NextResponse.json({ complete: false, remaining: winners, tied_again: true });
      }

      // ── add_hole ──────────────────────────────────────────────────────────
      case "add_hole": {
        const { playoff_id, hole_number, course_id, tee_box_id, remaining_profile_ids } = body as {
          playoff_id: string;
          hole_number: number;
          course_id: string;
          tee_box_id: string;
          remaining_profile_ids: string[];
        };

        // Get current max sequence
        const { data: lastHole } = await supabaseAdmin
          .from("event_playoff_holes")
          .select("sequence")
          .eq("playoff_id", playoff_id)
          .order("sequence", { ascending: false })
          .limit(1)
          .maybeSingle();

        const nextSeq = ((lastHole as any)?.sequence ?? 0) + 1;

        const { data: holeData } = await supabaseAdmin
          .from("course_tee_holes")
          .select("hole_number, par, handicap")
          .eq("tee_box_id", tee_box_id)
          .eq("hole_number", hole_number)
          .maybeSingle();

        const { data: hole, error: he } = await supabaseAdmin
          .from("event_playoff_holes")
          .insert({
            playoff_id,
            sequence: nextSeq,
            course_id,
            tee_box_id,
            hole_number,
            par: (holeData as any)?.par ?? 4,
            stroke_index: (holeData as any)?.handicap ?? hole_number,
            remaining_profile_ids,
          })
          .select()
          .single();
        if (he) throw he;
        return NextResponse.json({ hole });
      }

      // ── update_hole ───────────────────────────────────────────────────────
      // Change the course / tee box / hole number of an existing playoff hole and
      // re-derive par + stroke index. Any scores already entered for it are cleared.
      case "update_hole": {
        const { playoff_hole_id, course_id, tee_box_id, hole_number } = body as {
          playoff_hole_id: string;
          course_id: string;
          tee_box_id: string;
          hole_number: number;
        };

        const { data: holeData } = await supabaseAdmin
          .from("course_tee_holes")
          .select("par, handicap")
          .eq("tee_box_id", tee_box_id)
          .eq("hole_number", hole_number)
          .maybeSingle();

        const { data: hole, error: ue } = await supabaseAdmin
          .from("event_playoff_holes")
          .update({
            course_id,
            tee_box_id,
            hole_number,
            par: (holeData as any)?.par ?? 4,
            stroke_index: (holeData as any)?.handicap ?? hole_number,
          })
          .eq("id", playoff_hole_id)
          .select()
          .single();
        if (ue) throw ue;

        // The hole changed — discard any scores already entered against it.
        await supabaseAdmin
          .from("event_playoff_scores")
          .delete()
          .eq("playoff_hole_id", playoff_hole_id);

        return NextResponse.json({ hole });
      }

      // ── complete ──────────────────────────────────────────────────────────
      case "complete": {
        const { playoff_id, winner_profile_id, final_positions, resolution_type } = body as {
          playoff_id: string;
          winner_profile_id: string;
          final_positions: Array<{ profile_id: string; position: number }>;
          resolution_type?: "playoff" | "countback";
        };

        const { data: playoffRow } = await supabaseAdmin
          .from("event_playoffs")
          .select("tied_profile_ids, elimination_log, resolution_type")
          .eq("id", playoff_id)
          .single();
        if (!playoffRow) return NextResponse.json({ error: "Playoff not found" }, { status: 404 });

        // Mark playoff complete (optionally relabel the resolution type, e.g. an
        // active sudden-death playoff that is decided by countback instead).
        await supabaseAdmin
          .from("event_playoffs")
          .update({
            status: "completed",
            winner_profile_id,
            completed_at: new Date().toISOString(),
            ...(resolution_type ? { resolution_type } : {}),
          })
          .eq("id", playoff_id);

        const effectiveType = resolution_type ?? (playoffRow as any).resolution_type;

        // Recompute the base leaderboard FIRST. The RPC deletes + re-inserts every entry
        // (dropping playoff columns), so the playoff result must be written AFTER it.
        await supabaseAdmin.rpc("ciaga_compute_event_leaderboard", { p_event_id: eventId });

        const { applyPlayoffResultToLeaderboard } = await import("@/lib/majors/playoffPoints");
        await applyPlayoffResultToLeaderboard({
          admin: supabaseAdmin,
          eventId,
          winnerProfileId: winner_profile_id,
          finalPositions: final_positions,
          resolutionType: effectiveType === "countback" ? "countback" : "playoff",
        });

        return NextResponse.json({ ok: true });
      }

      // ── resolve_countback ─────────────────────────────────────────────────
      case "resolve_countback": {
        // Optionally scope to a specific set of players (e.g. those still remaining in
        // an active sudden-death playoff). Default to the position-1 tied set.
        const { profile_ids } = body as { profile_ids?: string[] };
        let tiedIds: string[];
        if (Array.isArray(profile_ids) && profile_ids.length >= 2) {
          tiedIds = profile_ids;
        } else {
          const { data: entries } = await supabaseAdmin
            .from("event_leaderboard_entries")
            .select("profile_id")
            .eq("event_id", eventId)
            .eq("position", 1)
            .is("playoff_result", null);
          tiedIds = (entries ?? []).map((e: any) => e.profile_id);
        }
        if (tiedIds.length < 2) {
          return NextResponse.json({ error: "No tie to resolve" }, { status: 400 });
        }

        const scoringModel = (event as any).scoring_model as "gross" | "net" | "stableford_points" ?? "net";

        // For each tied player, load their most recent submitted round's hole scores
        const playerHoles: Array<{
          profile_id: string;
          holes: Array<{ hole_number: number; strokes: number; par: number; stroke_index: number; course_handicap: number }>;
          total_holes: number;
        }> = [];

        for (const pid of tiedIds) {
          // Find most recent accepted submission for this event
          const { data: sub } = await supabaseAdmin
            .from("event_round_submissions")
            .select("round_id")
            .eq("event_id", eventId)
            .eq("profile_id", pid)
            .eq("accepted", true)
            .order("submitted_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!sub) continue;

          const { data: rp } = await supabaseAdmin
            .from("round_participants")
            .select("id, course_handicap_used, playing_handicap_used, tee_snapshot_id")
            .eq("round_id", (sub as any).round_id)
            .eq("profile_id", pid)
            .maybeSingle();

          if (!rp) continue;

          const courseHcp = (rp as any).playing_handicap_used ?? (rp as any).course_handicap_used ?? 0;

          // Load scores (latest per hole)
          const { data: scoreEvents } = await supabaseAdmin
            .from("round_score_events")
            .select("hole_number, strokes, created_at")
            .eq("round_id", (sub as any).round_id)
            .eq("participant_id", (rp as any).id)
            .order("created_at", { ascending: false });

          // Deduplicate — keep latest score per hole
          const latestByHole: Record<number, number> = {};
          for (const se of scoreEvents ?? []) {
            if (!(se.hole_number in latestByHole)) {
              latestByHole[se.hole_number] = se.strokes;
            }
          }

          // Load hole snapshots for SI and par
          const { data: holeSnaps } = await supabaseAdmin
            .from("round_hole_snapshots")
            .select("hole_number, par, stroke_index")
            .eq("round_tee_snapshot_id", (rp as any).tee_snapshot_id);

          const holeSnapMap: Record<number, { par: number; stroke_index: number }> = {};
          for (const hs of holeSnaps ?? []) {
            holeSnapMap[hs.hole_number] = { par: hs.par, stroke_index: hs.stroke_index };
          }

          const holes = Object.entries(latestByHole).map(([hn, strokes]) => ({
            hole_number: Number(hn),
            strokes,
            par: holeSnapMap[Number(hn)]?.par ?? 4,
            stroke_index: holeSnapMap[Number(hn)]?.stroke_index ?? Number(hn),
            course_handicap: courseHcp,
          }));

          playerHoles.push({
            profile_id: pid,
            holes,
            total_holes: holes.length <= 9 ? 9 : 18,
          });
        }

        const result = computeCountback(playerHoles, scoringModel);
        return NextResponse.json({ result });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
