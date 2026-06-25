// /app/api/rounds/start/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getOwnedProfileIdOrThrow } from "@/lib/serverOwnedProfile";
import { notifyFollowersOfRoundActivity } from "@/lib/notifications/roundActivity";

type Body = { round_id: string };

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = userData.user;
    const myProfileId = await getOwnedProfileIdOrThrow(user.id);

    const body = (await req.json()) as Body;
    if (!body?.round_id) return NextResponse.json({ error: "Missing round_id" }, { status: 400 });

    // Load round and participant in parallel — need setup_locked before enforcing role check
    const [roundResult, meResult] = await Promise.all([
      supabaseAdmin
        .from("rounds")
        .select("id, course_id, pending_tee_box_id, status, started_at, setup_locked")
        .eq("id", body.round_id)
        .single(),
      supabaseAdmin
        .from("round_participants")
        .select("id, role")
        .eq("round_id", body.round_id)
        .eq("profile_id", myProfileId)
        .maybeSingle(),
    ]);

    if (roundResult.error) return NextResponse.json({ error: roundResult.error.message }, { status: 500 });
    if (meResult.error) return NextResponse.json({ error: meResult.error.message }, { status: 500 });

    const round = roundResult.data;
    const me = meResult.data;

    if (!me) return NextResponse.json({ error: "Not a participant in this round" }, { status: 403 });
    // When setup is locked any participant can start; otherwise only the owner can.
    if (!round.setup_locked && me.role !== "owner") {
      return NextResponse.json({ error: "Only the round owner can start an unlocked round" }, { status: 403 });
    }

    // Already live -> idempotent OK
    if (round.status === "live") {
      return NextResponse.json({ ok: true, round_id: round.id });
    }

    if (!round.course_id) return NextResponse.json({ error: "Round has no course_id" }, { status: 400 });
    if (!round.pending_tee_box_id) return NextResponse.json({ error: "No tee selected for this round" }, { status: 400 });

    // -------------------------------
    // Atomic claim: only one starter wins
    // Requires you allow "starting" as a valid status.
    // -------------------------------
    const claimTs = new Date().toISOString();

    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("rounds")
      .update({ status: "starting", started_at: claimTs })
      .eq("id", round.id)
      .neq("status", "live")
      .neq("status", "starting")
      .select("id, status, started_at")
      .maybeSingle();

    if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 });

    // If we didn't claim, someone else is starting/live already -> idempotent OK
    if (!claimed) {
      // We can return ok; client will refresh via realtime anyway
      return NextResponse.json({ ok: true, round_id: round.id });
    }

    const defaultTeeBoxId = round.pending_tee_box_id as string;

    // Ensure a course snapshot exists for this round
    const { data: existingCourseSnap, error: ecsErr } = await supabaseAdmin
      .from("round_course_snapshots")
      .select("id")
      .eq("round_id", round.id)
      .order("created_at", { ascending: false })
      .maybeSingle();

    if (ecsErr) return NextResponse.json({ error: ecsErr.message }, { status: 500 });

    let courseSnapId: string;

    if (existingCourseSnap?.id) {
      courseSnapId = existingCourseSnap.id;
    } else {
      const { data: course, error: courseErr } = await supabaseAdmin
        .from("courses")
        .select("id, name, city, country, lat, lng")
        .eq("id", round.course_id)
        .single();

      if (courseErr) return NextResponse.json({ error: courseErr.message }, { status: 500 });

      const { data: rcs, error: rcsErr } = await supabaseAdmin
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

      if (rcsErr) return NextResponse.json({ error: rcsErr.message }, { status: 500 });
      courseSnapId = rcs.id;
    }

    // Fetch all participants and their per-player tee overrides
    const { data: participants, error: partErr } = await supabaseAdmin
      .from("round_participants")
      .select("id, pending_tee_box_id")
      .eq("round_id", round.id);

    if (partErr) return NextResponse.json({ error: partErr.message }, { status: 500 });

    // Collect unique tee box IDs needed (player overrides + round default)
    const teeBoxIds = new Set<string>([defaultTeeBoxId]);
    for (const p of participants ?? []) {
      if (p.pending_tee_box_id) teeBoxIds.add(p.pending_tee_box_id);
    }

    // Build a map teeBoxId -> teeSnapId, creating snapshots as needed
    const teeSnapMap = new Map<string, string>();

    for (const teeBoxId of teeBoxIds) {
      // Reuse existing snapshot if already created (idempotent)
      const { data: existingRts, error: exRtsErr } = await supabaseAdmin
        .from("round_tee_snapshots")
        .select("id")
        .eq("round_course_snapshot_id", courseSnapId)
        .eq("source_tee_box_id", teeBoxId)
        .maybeSingle();

      if (exRtsErr) return NextResponse.json({ error: exRtsErr.message }, { status: 500 });

      if (existingRts?.id) {
        teeSnapMap.set(teeBoxId, existingRts.id);
        continue;
      }

      const { data: tee, error: teeErr } = await supabaseAdmin
        .from("course_tee_boxes")
        .select("id, name, gender, yards, par, rating, slope, holes_count")
        .eq("id", teeBoxId)
        .single();

      if (teeErr) return NextResponse.json({ error: teeErr.message }, { status: 500 });

      const holesCount = tee.holes_count ?? 18;

      const { data: holes, error: holesErr } = await supabaseAdmin
        .from("course_tee_holes")
        .select("hole_number, par, yardage, handicap")
        .eq("tee_box_id", tee.id)
        .order("hole_number", { ascending: true });

      if (holesErr) return NextResponse.json({ error: holesErr.message }, { status: 500 });

      const { data: rts, error: rtsErr } = await supabaseAdmin
        .from("round_tee_snapshots")
        .insert({
          round_course_snapshot_id: courseSnapId,
          source_tee_box_id: tee.id,
          name: tee.name,
          gender: tee.gender,
          holes_count: holesCount,
          yards_total: tee.yards,
          par_total: tee.par,
          rating: tee.rating,
          slope: tee.slope,
        })
        .select("id")
        .single();

      if (rtsErr) return NextResponse.json({ error: rtsErr.message }, { status: 500 });
      teeSnapMap.set(teeBoxId, rts.id);

      // Insert hole snapshots only if none exist for this teeSnap
      const snapId = rts.id;
      const { data: existingHoles, error: exHolesErr } = await supabaseAdmin
        .from("round_hole_snapshots")
        .select("hole_number")
        .eq("round_tee_snapshot_id", snapId)
        .limit(1);

      if (exHolesErr) return NextResponse.json({ error: exHolesErr.message }, { status: 500 });

      if ((existingHoles?.length ?? 0) === 0 && holes?.length) {
        const payload = holes
          .filter((h) => typeof h.hole_number === "number")
          .map((h) => ({
            round_tee_snapshot_id: snapId,
            hole_number: h.hole_number,
            par: h.par,
            yardage: h.yardage,
            stroke_index: h.handicap,
          }));

        const { error: holeInsErr } = await supabaseAdmin.from("round_hole_snapshots").insert(payload);
        if (holeInsErr) return NextResponse.json({ error: holeInsErr.message }, { status: 500 });
      }
    }

    // Assign each participant their tee snapshot (per-player override, else round default)
    const defaultSnapId = teeSnapMap.get(defaultTeeBoxId)!;
    for (const participant of participants ?? []) {
      const snapId = participant.pending_tee_box_id
        ? (teeSnapMap.get(participant.pending_tee_box_id) ?? defaultSnapId)
        : defaultSnapId;

      const { error: assignErr } = await supabaseAdmin
        .from("round_participants")
        .update({ tee_snapshot_id: snapId })
        .eq("id", participant.id);

      if (assignErr) return NextResponse.json({ error: assignErr.message }, { status: 500 });
    }

    const teeSnapId = defaultSnapId;

    // Persist resolved handicaps (snapshot at start to prevent mid-round drift)
    const { error: handicapErr } = await supabaseAdmin.rpc("ciaga_persist_playing_handicaps", {
      p_round_id: round.id,
    });

    if (handicapErr) return NextResponse.json({ error: handicapErr.message }, { status: 500 });

    // Compute and store team handicaps for single-ball formats
    const SINGLE_BALL_FORMATS = ["scramble", "greensomes", "foursomes"];
    const { data: roundForFormat } = await supabaseAdmin
      .from("rounds")
      .select("format_type")
      .eq("id", round.id)
      .single();

    if (roundForFormat && SINGLE_BALL_FORMATS.includes((roundForFormat as any).format_type)) {
      const formatType = (roundForFormat as any).format_type as string;

      // Fetch participants with team assignment and resolved course handicap
      const { data: teamsData } = await supabaseAdmin
        .from("round_teams")
        .select("id")
        .eq("round_id", round.id);

      const { data: partsData } = await supabaseAdmin
        .from("round_participants")
        .select("id, team_id, course_handicap_used")
        .eq("round_id", round.id)
        .not("team_id", "is", null);

      if (teamsData && partsData) {
        for (const team of teamsData as any[]) {
          const members = (partsData as any[]).filter((p) => p.team_id === team.id);
          const handicaps = members
            .map((p) => typeof p.course_handicap_used === "number" ? p.course_handicap_used : null)
            .filter((h): h is number => h !== null);

          if (handicaps.length === 0) continue;

          const sorted = [...handicaps].sort((a, b) => a - b);
          let teamHcp = 0;

          if (formatType === "scramble") {
            if (sorted.length === 1) teamHcp = Math.round(sorted[0] * 0.35);
            else if (sorted.length === 2) teamHcp = Math.round(sorted[0] * 0.35 + sorted[1] * 0.15);
            else if (sorted.length === 3) teamHcp = Math.round(sorted[0] * 0.30 + sorted[1] * 0.20 + sorted[2] * 0.10);
            else teamHcp = Math.round(sorted[0] * 0.25 + sorted[1] * 0.20 + sorted[2] * 0.15 + sorted[3] * 0.10);
          } else if (formatType === "greensomes") {
            teamHcp = Math.round(sorted[0] * 0.6 + (sorted[1] ?? sorted[0]) * 0.4);
          } else if (formatType === "foursomes") {
            teamHcp = Math.round((sorted[0] + (sorted[1] ?? sorted[0])) * 0.5);
          }

          await supabaseAdmin
            .from("round_teams")
            .update({ playing_handicap_used: teamHcp })
            .eq("id", team.id);
        }
      }
    }

    // Finalize: mark live (idempotent)
    const { error: updErr } = await supabaseAdmin
      .from("rounds")
      .update({ status: "live" })
      .eq("id", round.id);

    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

    // Notify followers of the players that this round has started (grouped,
    // best-effort — runs only on the request that won the start claim).
    await notifyFollowersOfRoundActivity({ roundId: round.id, kind: "started" }).catch(() => {});

    return NextResponse.json({ ok: true, round_id: round.id, tee_snapshot_id: teeSnapId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
