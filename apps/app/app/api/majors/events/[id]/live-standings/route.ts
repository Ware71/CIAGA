import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

// GET /api/majors/competitions/[id]/live-standings
// Returns a merged leaderboard of all event participants:
//   - Players with live rounds: computed from current round scores
//   - Players with submitted rounds: from event_leaderboard_entries
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await getAuthedProfileOrThrow(req);
    const { id: eventId } = await params;

    // 1. Get all tee times with their linked round IDs
    const { data: teeTimes, error: ttErr } = await supabaseAdmin
      .from("event_tee_times")
      .select("id, round_id")
      .eq("event_id", eventId);

    if (ttErr) throw ttErr;

    const roundIds = (teeTimes ?? []).map((t) => t.round_id).filter(Boolean) as string[];
    if (!roundIds.length) {
      return NextResponse.json({ standings: [] }, { headers: { "Cache-Control": "no-store" } });
    }

    // 2. Fetch round statuses
    const { data: rounds, error: roundsErr } = await supabaseAdmin
      .from("rounds")
      .select("id, status")
      .in("id", roundIds);

    if (roundsErr) throw roundsErr;

    const roundStatusMap = new Map((rounds ?? []).map((r) => [r.id, r.status]));
    const liveRoundIds = roundIds.filter((id) => {
      const s = roundStatusMap.get(id);
      return s === "live" || s === "starting";
    });
    const finishedRoundIds = roundIds.filter((id) => roundStatusMap.get(id) === "finished");

    // 3. For live rounds: aggregate current scores from round_current_scores view
    const liveEntriesMap = new Map<string, { profileId: string; gross: number; thru: number; courseHcp: number }>();

    if (liveRoundIds.length) {
      const [scoresRes, participantsRes] = await Promise.all([
        supabaseAdmin
          .from("round_current_scores")
          .select("round_id, participant_id, hole_number, strokes")
          .in("round_id", liveRoundIds),
        supabaseAdmin
          .from("round_participants")
          .select("id, profile_id, course_handicap_used, playing_handicap_used, round_id")
          .in("round_id", liveRoundIds),
      ]);

      if (scoresRes.error) throw scoresRes.error;
      if (participantsRes.error) throw participantsRes.error;

      // Build participant lookup: participant_id → { profile_id, hcp }
      // Prefer playing_handicap_used (allowance-adjusted) over course_handicap_used for consistency
      // with submitted scores, which also use playing_handicap_used.
      const participantMap = new Map<string, { profileId: string; courseHcp: number }>();
      for (const p of participantsRes.data ?? []) {
        if (!p.profile_id) continue;
        const hcp =
          typeof (p as any).playing_handicap_used === "number"
            ? (p as any).playing_handicap_used
            : typeof p.course_handicap_used === "number"
            ? p.course_handicap_used
            : 0;
        participantMap.set(p.id, { profileId: p.profile_id, courseHcp: hcp });
      }

      // Aggregate scores per participant
      const scoreAgg = new Map<string, { gross: number; holes: Set<number> }>();
      for (const s of scoresRes.data ?? []) {
        if (typeof s.strokes !== "number" || s.strokes == null) continue;
        if (!scoreAgg.has(s.participant_id)) {
          scoreAgg.set(s.participant_id, { gross: 0, holes: new Set() });
        }
        const agg = scoreAgg.get(s.participant_id)!;
        agg.gross += s.strokes;
        agg.holes.add(s.hole_number);
      }

      // Build live entries indexed by profile_id (one per player)
      for (const [participantId, pInfo] of participantMap) {
        const agg = scoreAgg.get(participantId);
        const existing = liveEntriesMap.get(pInfo.profileId);
        // If a player appears in multiple live rounds, use the one with more holes played
        const thru = agg?.holes.size ?? 0;
        if (!existing || thru > existing.thru) {
          liveEntriesMap.set(pInfo.profileId, {
            profileId: pInfo.profileId,
            gross: agg?.gross ?? 0,
            thru,
            courseHcp: pInfo.courseHcp,
          });
        }
      }
    }

    // 4. For finished rounds: read from event_leaderboard_entries
    const finishedEntriesMap = new Map<string, { grossScore: number | null; netScore: number | null }>();

    if (finishedRoundIds.length) {
      const { data: leaderEntries, error: leaderErr } = await supabaseAdmin
        .from("event_leaderboard_entries")
        .select("profile_id, gross_score, net_score")
        .eq("event_id", eventId);

      if (leaderErr) throw leaderErr;

      // Only include entries whose profile played a finished round in this competition
      const { data: finParticipants, error: finPartErr } = await supabaseAdmin
        .from("round_participants")
        .select("profile_id")
        .in("round_id", finishedRoundIds);

      if (finPartErr) throw finPartErr;

      const finProfileIds = new Set(
        (finParticipants ?? []).map((p) => p.profile_id).filter(Boolean) as string[]
      );

      for (const le of leaderEntries ?? []) {
        if (!le.profile_id || !finProfileIds.has(le.profile_id)) continue;
        finishedEntriesMap.set(le.profile_id, {
          grossScore: le.gross_score,
          netScore: le.net_score,
        });
      }
    }

    // 5. Merge all profile IDs and fetch display info
    const allProfileIds = new Set<string>([
      ...liveEntriesMap.keys(),
      ...finishedEntriesMap.keys(),
    ]);

    const { data: profiles, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, name, avatar_url")
      .in("id", [...allProfileIds]);

    if (profErr) throw profErr;

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    // 6. Build final standings array
    type StandingEntry = {
      profile_id: string;
      name: string | null;
      avatar_url: string | null;
      gross_score: number | null;
      net_score: number | null;
      thru: number;
      is_live: boolean;
      is_submitted: boolean;
    };

    const standings: StandingEntry[] = [];

    // Submitted entries first (they have final scores)
    for (const [profileId, entry] of finishedEntriesMap) {
      const prof = profileMap.get(profileId);
      standings.push({
        profile_id: profileId,
        name: prof?.name ?? null,
        avatar_url: prof?.avatar_url ?? null,
        gross_score: entry.grossScore,
        net_score: entry.netScore,
        thru: 18,
        is_live: false,
        is_submitted: true,
      });
    }

    // Live entries (players currently on course)
    for (const [profileId, entry] of liveEntriesMap) {
      if (finishedEntriesMap.has(profileId)) continue; // already in submitted
      const prof = profileMap.get(profileId);
      const gross = entry.gross > 0 ? entry.gross : null;
      const net = gross != null ? gross - entry.courseHcp : null;
      standings.push({
        profile_id: profileId,
        name: prof?.name ?? null,
        avatar_url: prof?.avatar_url ?? null,
        gross_score: gross,
        net_score: net,
        thru: entry.thru,
        is_live: true,
        is_submitted: false,
      });
    }

    // Sort: submitted by net score asc, then live by net score asc (nulls last)
    standings.sort((a, b) => {
      // Submitted before live (they have final scores)
      if (a.is_submitted !== b.is_submitted) return a.is_submitted ? -1 : 1;
      if (a.net_score == null && b.net_score == null) return 0;
      if (a.net_score == null) return 1;
      if (b.net_score == null) return -1;
      return a.net_score - b.net_score;
    });

    return NextResponse.json({ standings }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
