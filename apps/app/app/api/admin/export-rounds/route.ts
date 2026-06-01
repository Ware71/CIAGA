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
    const roundIds = [...new Set(participants.map((p) => p.round_id as string))];

    // Build lookups
    const participantById = Object.fromEntries(participants.map((p) => [p.id, p]));

    // ── 2. Fetch handicap_round_results ───────────────────────────────────────
    const { data: hrrRows, error: hrrErr } = await admin
      .from("handicap_round_results")
      .select("round_id, participant_id, played_at, score_differential, tee_snapshot_id")
      .in("participant_id", participantIds);

    if (hrrErr) throw new Error(hrrErr.message);

    const teeSnapshotIds = [...new Set((hrrRows ?? []).map((r) => r.tee_snapshot_id as string).filter(Boolean))];

    // ── 3. Fetch round_course_snapshots ───────────────────────────────────────
    const { data: courseSnapshots, error: csErr } = await admin
      .from("round_course_snapshots")
      .select("round_id, course_name")
      .in("round_id", roundIds);

    if (csErr) throw new Error(csErr.message);

    const courseByRoundId = Object.fromEntries((courseSnapshots ?? []).map((s) => [s.round_id, s.course_name]));

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

    // ── 5. Fetch raw scores and sum per (round_id, participant_id) ─────────────
    const { data: scoreRows, error: scoreErr } = await admin
      .from("round_current_scores")
      .select("round_id, participant_id, strokes")
      .in("round_id", roundIds);

    if (scoreErr) throw new Error(scoreErr.message);

    const totalStrokesMap: Record<string, Record<string, number>> = {};
    for (const s of scoreRows ?? []) {
      if (s.strokes == null) continue;
      if (!totalStrokesMap[s.round_id]) totalStrokesMap[s.round_id] = {};
      totalStrokesMap[s.round_id][s.participant_id] = (totalStrokesMap[s.round_id][s.participant_id] ?? 0) + s.strokes;
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
    };

    const rows: Row[] = [];

    for (const hrr of hrrRows ?? []) {
      const participant = participantById[hrr.participant_id];
      if (!participant) continue;

      const tee = hrr.tee_snapshot_id ? teeBySnapshotId[hrr.tee_snapshot_id] : null;
      const totalStrokes = totalStrokesMap[hrr.round_id]?.[hrr.participant_id];

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

    const header = "Player Name,Date Played,Course,Tee,Total Strokes,Course Rating,Slope,Score Differential";
    const lines = rows.map((r) =>
      [r.playerName, r.playedAt, r.course, r.tee, r.totalStrokes, r.rating, r.slope, r.scoreDiff]
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
