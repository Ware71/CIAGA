import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type TeeHole = {
  hole_number: number;
  par: number | null;
  yardage: number | null;
  handicap: number | null;
};

function must<T>(v: T | null | undefined, msg: string): T {
  if (v === null || v === undefined) throw new Error(msg);
  if (typeof v === "string" && v.trim() === "") throw new Error(msg);
  return v;
}

export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdmin();

    // Auth via Bearer token
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing Authorization token" }, { status: 401 });

    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    // Admin check
    const { data: myProfile, error: pErr } = await admin
      .from("profiles")
      .select("id,is_admin")
      .eq("owner_user_id", userRes.user.id)
      .single();

    if (pErr) throw new Error(pErr.message);
    if (!myProfile?.is_admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    const body = await req.json();
    const {
      played_at,
      round_name,
      course_id,
      tee_box_id,
      players,
      scores,
    }: {
      played_at: string;
      round_name?: string;
      course_id: string;
      tee_box_id: string;
      players: Array<{ profile_id: string; handicap_index: number | null }>;
      scores: Array<{ profile_id: string; hole_number: number; strokes: number }>;
    } = body;

    if (!played_at) return NextResponse.json({ error: "played_at is required" }, { status: 400 });
    if (!course_id) return NextResponse.json({ error: "course_id is required" }, { status: 400 });
    if (!tee_box_id) return NextResponse.json({ error: "tee_box_id is required" }, { status: 400 });
    if (!players?.length) return NextResponse.json({ error: "At least one player is required" }, { status: 400 });
    if (!scores?.length) return NextResponse.json({ error: "Scores are required" }, { status: 400 });

    // 1) Course lookup
    const { data: course, error: cErr } = await admin
      .from("courses")
      .select("id,name,city,country,lat,lng")
      .eq("id", course_id)
      .single();

    if (cErr || !course) throw new Error(`Course lookup failed: ${cErr?.message}`);

    // 2) Create round with status='live' so the UPDATE to 'finished' fires DB triggers
    const playedAtIso = new Date(played_at).toISOString();
    const { data: round, error: rErr } = await admin
      .from("rounds")
      .insert({
        created_by: myProfile.id,
        status: "live",
        visibility: "private",
        course_id: course.id,
        name: round_name || course.name,
        started_at: playedAtIso,
        finished_at: playedAtIso,
      })
      .select("id")
      .single();

    if (rErr || !round) throw new Error(`Create round failed: ${rErr?.message}`);

    // 3) Course snapshot
    const { data: courseSnap, error: csErr } = await admin
      .from("round_course_snapshots")
      .insert({
        round_id: round.id,
        source_course_id: course.id,
        course_name: course.name,
        city: course.city,
        country: course.country,
        lat: course.lat,
        lng: course.lng,
      })
      .select("id")
      .single();

    if (csErr || !courseSnap) throw new Error(`Create course snapshot failed: ${csErr?.message}`);

    // 4) Tee box snapshot + hole snapshots
    const { data: teeBox, error: tbErr } = await admin
      .from("course_tee_boxes")
      .select("id,name,gender,yards,par,rating,slope,holes_count")
      .eq("id", tee_box_id)
      .single();

    if (tbErr || !teeBox) throw new Error(`Tee box lookup failed: ${tbErr?.message}`);

    const { data: holes, error: hErr } = await admin
      .from("course_tee_holes")
      .select("hole_number,par,yardage,handicap")
      .eq("tee_box_id", tee_box_id)
      .order("hole_number", { ascending: true });

    if (hErr) throw new Error(`Tee holes lookup failed: ${hErr.message}`);

    const teeHoles: TeeHole[] = (holes ?? []) as TeeHole[];
    if (!teeHoles.length) throw new Error(`Tee box has no holes`);

    const yardsTotal = teeHoles.reduce((a, h) => a + (h.yardage ?? 0), 0);
    const parTotal = teeHoles.reduce((a, h) => a + (h.par ?? 0), 0);

    const { data: teeSnap, error: tsErr } = await admin
      .from("round_tee_snapshots")
      .insert({
        round_course_snapshot_id: courseSnap.id,
        source_tee_box_id: teeBox.id,
        name: teeBox.name,
        gender: teeBox.gender,
        holes_count: teeBox.holes_count ?? teeHoles.length,
        yards_total: teeBox.yards ?? yardsTotal,
        par_total: teeBox.par ?? parTotal,
        rating: teeBox.rating,
        slope: teeBox.slope,
      })
      .select("id")
      .single();

    if (tsErr || !teeSnap) throw new Error(`Create tee snapshot failed: ${tsErr?.message}`);

    const holeSnapshotRows = teeHoles.map((h) => ({
      round_tee_snapshot_id: teeSnap.id,
      hole_number: h.hole_number,
      par: h.par,
      yardage: h.yardage,
      stroke_index: h.handicap,
    }));

    const { error: hsErr } = await admin.from("round_hole_snapshots").insert(holeSnapshotRows);
    if (hsErr) throw new Error(`Create hole snapshots failed: ${hsErr.message}`);

    // 5) Participants
    const participantIdByProfileId = new Map<string, string>();

    for (const player of players) {
      const { data: part, error: rpErr } = await admin
        .from("round_participants")
        .insert({
          round_id: round.id,
          profile_id: player.profile_id,
          is_guest: false,
          role: "player",
          handicap_index: player.handicap_index,
          tee_snapshot_id: teeSnap.id,
        })
        .select("id")
        .single();

      if (rpErr || !part) throw new Error(`Create participant failed for profile ${player.profile_id}: ${rpErr?.message}`);
      participantIdByProfileId.set(player.profile_id, part.id);
    }

    // 6) Score events
    const scoreEvents = scores.map((s) => {
      const participantId = must(
        participantIdByProfileId.get(s.profile_id),
        `No participant found for profile_id=${s.profile_id}`
      );
      return {
        round_id: round.id,
        participant_id: participantId,
        hole_number: s.hole_number,
        strokes: s.strokes,
        entered_by: myProfile.id,
      };
    });

    const { error: seErr } = await admin.from("round_score_events").insert(scoreEvents);
    if (seErr) throw new Error(`Create score events failed: ${seErr.message}`);

    // 7) UPDATE status to 'finished' — this fires the DB triggers for handicap computation
    const { error: finErr } = await admin
      .from("rounds")
      .update({ status: "finished" })
      .eq("id", round.id);

    if (finErr) throw new Error(`Finish round failed: ${finErr.message}`);

    return NextResponse.json({ ok: true, round_id: round.id });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
