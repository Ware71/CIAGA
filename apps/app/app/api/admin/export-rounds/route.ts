import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdmin();

    // ── Auth ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing Authorization token" }, { status: 401 });

    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const { data: myProfile, error: pErr } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("owner_user_id", userRes.user.id)
      .single();

    if (pErr) throw new Error(pErr.message);
    if (!myProfile?.is_admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    // ── Parse body ────────────────────────────────────────────────────────────
    const body = await req.json();
    const profileIds: string[] = body?.profile_ids ?? [];
    if (!profileIds.length) {
      return NextResponse.json({ error: "profile_ids must be a non-empty array" }, { status: 400 });
    }

    // ── 1. Fetch round_participants for the selected players ──────────────────
    const { data: participants, error: partErr } = await admin
      .from("round_participants")
      .select("id, round_id, profile_id, profiles(name)")
      .in("profile_id", profileIds);

    if (partErr) throw new Error(partErr.message);
    if (!participants?.length) {
      return new Response(
        "Player Name,Date Played,Course,Tee,Total Strokes,Course Rating,Slope,Score Differential\n",
        { headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="rounds-export.csv"' } }
      );
    }

    const participantIds = participants.map((p) => p.id);

    // Build lookups
    const participantById = Object.fromEntries(participants.map((p) => [p.id, p]));

    // ── 2. Fetch handicap_round_results ───────────────────────────────────────
    const { data: hrrRows, error: hrrErr } = await admin
      .from("handicap_round_results")
      .select("round_id, participant_id, played_at, score_differential, tee_snapshot_id, adjusted_gross_score")
      .in("participant_id", participantIds);

    if (hrrErr) throw new Error(hrrErr.message);

    const hrrRoundIds = [...new Set((hrrRows ?? []).map((r) => r.round_id as string))];
    const teeSnapshotIds = [...new Set((hrrRows ?? []).map((r) => r.tee_snapshot_id as string).filter(Boolean))];

    // ── 3. Fetch round_course_snapshots ───────────────────────────────────────
    const courseByRoundId: Record<string, string> = {};
    if (hrrRoundIds.length) {
      const { data: courseSnapshots, error: csErr } = await admin
        .from("round_course_snapshots")
        .select("round_id, course_name")
        .in("round_id", hrrRoundIds);

      if (csErr) throw new Error(csErr.message);
      for (const s of courseSnapshots ?? []) {
        courseByRoundId[s.round_id] = s.course_name;
      }
    }

    // ── 4. Fetch round_tee_snapshots ──────────────────────────────────────────
    const teeBySnapshotId: Record<string, { name: string; rating: number | null; slope: number | null }> = {};
    if (teeSnapshotIds.length) {
      const { data: teeSnapshots, error: tsErr } = await admin
        .from("round_tee_snapshots")
        .select("id, name, rating, slope")
        .in("id", teeSnapshotIds);

      if (tsErr) throw new Error(tsErr.message);
      for (const t of teeSnapshots ?? []) {
        teeBySnapshotId[t.id] = { name: t.name, rating: t.rating, slope: t.slope };
      }
    }

    // ── 5. Fetch raw scores and sum per participant_id ────────────────────────
    // Each round_participants.id is unique per player per round, so keying by
    // participant_id alone (matching the history page pattern) avoids any
    // round_id discrepancy between round_score_events and handicap_round_results.
    // Explicit high limit prevents silent PostgREST row-cap truncation.
    const { data: scoreRows, error: scoreErr } = await admin
      .from("round_current_scores")
      .select("participant_id, strokes")
      .in("participant_id", participantIds)
      .not("strokes", "is", null)
      .limit(100000);

    if (scoreErr) throw new Error(scoreErr.message);

    // participant_id → total raw strokes
    const totalStrokesMap: Record<string, number> = {};
    for (const s of scoreRows ?? []) {
      if (s.strokes == null) continue;
      totalStrokesMap[s.participant_id] = (totalStrokesMap[s.participant_id] ?? 0) + s.strokes;
    }

    // ── 6. Build CSV rows ─────────────────────────────────────────────────────
    type Row = {
      playerName: string;
      playedAt: string;
      course: string;
      tee: string;
      totalStrokes: string;
      rating: string;
      slope: string;
      scoreDiff: string;
      ags: string;
    };

    const rows: Row[] = [];

    for (const hrr of hrrRows ?? []) {
      const participant = participantById[hrr.participant_id];
      if (!participant) continue;

      const tee = hrr.tee_snapshot_id ? teeBySnapshotId[hrr.tee_snapshot_id] : null;
      // Raw strokes first; fall back to adjusted_gross_score (already stored in HRR)
      // for accepted rounds where score events aren't available — mirrors history page.
      const totalStrokes = totalStrokesMap[hrr.participant_id] ?? hrr.adjusted_gross_score ?? null;

      // profiles is a joined object; handle Supabase nested return shape
      const profileData = participant.profiles as { name: string | null } | null;
      const playerName = profileData?.name ?? "";

      rows.push({
        playerName,
        playedAt: hrr.played_at ?? "",
        course: courseByRoundId[hrr.round_id] ?? "",
        tee: tee?.name ?? "",
        totalStrokes: totalStrokes != null ? String(totalStrokes) : "",
        rating: tee?.rating != null ? String(tee.rating) : "",
        slope: tee?.slope != null ? String(tee.slope) : "",
        scoreDiff: hrr.score_differential != null ? String(hrr.score_differential) : "",
        ags: hrr.adjusted_gross_score != null ? String(hrr.adjusted_gross_score) : "",
      });
    }

    rows.sort((a, b) => {
      const nameCmp = a.playerName.localeCompare(b.playerName);
      return nameCmp !== 0 ? nameCmp : a.playedAt.localeCompare(b.playedAt);
    });

    // ── 7. Serialize CSV ──────────────────────────────────────────────────────
    function csvCell(v: string): string {
      if (v.includes(",") || v.includes('"') || v.includes("\n")) {
        return `"${v.replace(/"/g, '""')}"`;
      }
      return v;
    }

    const header = "Player Name,Date Played,Course,Tee,Total Strokes,Course Rating,Slope,Score Differential,Adjusted Gross Score";
    const lines = rows.map((r) =>
      [r.playerName, r.playedAt, r.course, r.tee, r.totalStrokes, r.rating, r.slope, r.scoreDiff, r.ags]
        .map(csvCell)
        .join(",")
    );

    const csv = [header, ...lines].join("\n") + "\n";

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="rounds-export.csv"',
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unexpected error" }, { status: 500 });
  }
}
