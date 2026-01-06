import Papa from "papaparse";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type Row = Record<string, string>;

type TeeHole = {
  hole_number: number;
  par: number | null;
  yardage: number | null;
  handicap_index: number | null;
};

function must<T>(v: T | null | undefined, msg: string): T {
  if (v === null || v === undefined) throw new Error(msg);
  if (typeof v === "string" && v.trim() === "") throw new Error(msg);
  return v;
}

function toInt(v: string, label: string) {
  const n = Number(v);
  if (!Number.isInteger(n)) throw new Error(`Invalid ${label}: ${v}`);
  return n;
}

function toNumOrNull(v?: string) {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeBool(v?: string) {
  return (v || "").trim().toLowerCase() === "true";
}

export async function POST(req: Request) {
  try {
    const admin = getSupabaseAdmin();

    // ✅ Verify user via Bearer token (no auth-helpers)
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return NextResponse.json({ error: "Missing Authorization token" }, { status: 401 });

    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const authUserId = userRes.user.id;

    // ✅ Admin check
    const { data: myProfile, error: pErr } = await admin
      .from("profiles")
      .select("id,is_admin")
      .eq("owner_user_id", authUserId)
      .single();

    if (pErr) throw new Error(pErr.message);
    if (!myProfile?.is_admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

    // ✅ Parse multipart form
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Missing file" }, { status: 400 });

    const csvText = await file.text();
    const parsed = Papa.parse<Row>(csvText, { header: true, skipEmptyLines: true });

    if (parsed.errors?.length) {
      return NextResponse.json(
        { error: parsed.errors[0].message, errors: parsed.errors },
        { status: 400 }
      );
    }

    const rows = (parsed.data || []).filter(Boolean);
    if (!rows.length) return NextResponse.json({ error: "No rows found" }, { status: 400 });

    // ✅ Group by round_key
    const byRound = new Map<string, Row[]>();
    for (const r of rows) {
      const k = must(r.round_key, "Missing round_key");
      if (!byRound.has(k)) byRound.set(k, []);
      byRound.get(k)!.push(r);
    }

    const summary: {
      rounds_created: number;
      participants_created: number;
      score_events_created: number;
      round_keys: Array<{ round_key: string; round_id: string }>;
    } = {
      rounds_created: 0,
      participants_created: 0,
      score_events_created: 0,
      round_keys: [],
    };

    for (const [roundKey, rRows] of byRound.entries()) {
      const first = rRows[0];

      const courseId = must(first.course_id, `Round ${roundKey}: missing course_id`);
      const playedAt = must(first.played_at, `Round ${roundKey}: missing played_at`);

      const roundName = first.round_name || roundKey;
      const status = first.status || "in_progress";
      const visibility = first.visibility || "private";

      // 1) Course lookup (for snapshot)
      const { data: course, error: cErr } = await admin
        .from("courses")
        .select("id,name,city,country,lat,lng")
        .eq("id", courseId)
        .single();

      if (cErr || !course) throw new Error(`Round ${roundKey}: course lookup failed: ${cErr?.message}`);

      // 2) Create round
      const { data: round, error: rErr } = await admin
        .from("rounds")
        .insert({
          created_by: myProfile.id,
          status,
          visibility,
          course_id: course.id,
          name: roundName,
          started_at: playedAt,
          finished_at: status === "finished" ? playedAt : null,
        })
        .select("id")
        .single();

      if (rErr || !round) throw new Error(`Round ${roundKey}: create round failed: ${rErr?.message}`);
      summary.rounds_created += 1;

      // 3) Create course snapshot
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

      if (csErr || !courseSnap)
        throw new Error(`Round ${roundKey}: create course snapshot failed: ${csErr?.message}`);

      // 4) Tee snapshots + hole snapshots (supports multiple tee boxes)
      const teeBoxIds = Array.from(
        new Set(rRows.map((x) => must(x.tee_box_id, `Round ${roundKey}: missing tee_box_id`)))
      );

      const teeSnapshotIdByTeeBoxId = new Map<string, string>();

      for (const teeBoxId of teeBoxIds) {
        const { data: teeBox, error: tbErr } = await admin
          .from("course_tee_boxes")
          .select("id,name,gender,yards,par,rating,slope,holes_count")
          .eq("id", teeBoxId)
          .single();

        if (tbErr || !teeBox)
          throw new Error(`Round ${roundKey}: tee_box ${teeBoxId} lookup failed: ${tbErr?.message}`);

        const { data: holes, error: hErr } = await admin
          .from("course_tee_holes")
          .select("hole_number,par,yardage,handicap_index")
          .eq("tee_box_id", teeBoxId)
          .order("hole_number", { ascending: true });

        if (hErr) throw new Error(`Round ${roundKey}: tee holes lookup failed: ${hErr.message}`);

        const teeHoles: TeeHole[] = (holes ?? []) as TeeHole[];
        if (!teeHoles.length) throw new Error(`Round ${roundKey}: tee_box ${teeBoxId} has no holes`);

        const yardsTotal = teeHoles.reduce((a: number, h: TeeHole) => a + (h.yardage ?? 0), 0);
        const parTotal = teeHoles.reduce((a: number, h: TeeHole) => a + (h.par ?? 0), 0);

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

        if (tsErr || !teeSnap)
          throw new Error(`Round ${roundKey}: create tee snapshot failed: ${tsErr?.message}`);

        teeSnapshotIdByTeeBoxId.set(teeBoxId, teeSnap.id);

        const holeSnapshotRows = teeHoles.map((h: TeeHole) => ({
          round_tee_snapshot_id: teeSnap.id,
          hole_number: h.hole_number,
          par: h.par,
          yardage: h.yardage,
          stroke_index: h.handicap_index,
        }));

        const { error: hsErr } = await admin.from("round_hole_snapshots").insert(holeSnapshotRows);
        if (hsErr) throw new Error(`Round ${roundKey}: create hole snapshots failed: ${hsErr.message}`);
      }

      // 5) Participants
      function playerKey(r: Row) {
        if (r.profile_id) return `profile:${r.profile_id}`;
        if (r.player_email) return `email:${r.player_email.toLowerCase()}`;
        const dn = r.display_name || "Guest";
        return `guest:${dn}`;
      }

      const uniquePlayers = new Map<string, Row>();
      for (const rr of rRows) uniquePlayers.set(playerKey(rr), rr);

      const participantIdByPlayerKey = new Map<string, string>();

      for (const [pKey, pr] of uniquePlayers.entries()) {
        const teeBoxId = must(pr.tee_box_id, `Round ${roundKey}: participant missing tee_box_id`);
        const teeSnapId = must(
          teeSnapshotIdByTeeBoxId.get(teeBoxId),
          `Round ${roundKey}: tee snapshot missing for tee_box_id=${teeBoxId}`
        );

        let profileId: string | null = pr.profile_id || null;

        // Resolve by email if provided
        if (!profileId && pr.player_email) {
          const email = pr.player_email.toLowerCase();
          const { data: prof, error: pe } = await admin
            .from("profiles")
            .select("id,email")
            .eq("email", email)
            .maybeSingle();
          if (pe) throw pe;
          profileId = prof?.id ?? null;
        }

        const isGuest = normalizeBool(pr.is_guest) || (!profileId && !pr.player_email);

        if (!isGuest && !profileId) {
          throw new Error(
            `Round ${roundKey}: cannot resolve player (${pKey}) to profile_id; provide profile_id or set is_guest=true`
          );
        }

        const displayName = pr.display_name || pr.player_email || null;
        const role = (pr.role as "owner" | "scorer" | "player") || "player";

        const { data: part, error: rpErr } = await admin
          .from("round_participants")
          .insert({
            round_id: round.id,
            profile_id: isGuest ? null : profileId,
            is_guest: isGuest,
            display_name: displayName,
            role,
            handicap_index: toNumOrNull(pr.handicap_index),
            tee_snapshot_id: teeSnapId,
          })
          .select("id")
          .single();

        if (rpErr || !part) throw new Error(`Round ${roundKey}: create participant failed: ${rpErr?.message}`);

        summary.participants_created += 1;
        participantIdByPlayerKey.set(pKey, part.id);
      }

      // 6) Score events (1 row = 1 hole score)
      const scoreEvents = rRows.map((rr) => {
        const pId = must(
          participantIdByPlayerKey.get(playerKey(rr)),
          `Round ${roundKey}: missing participant for row`
        );

        return {
          round_id: round.id,
          participant_id: pId,
          hole_number: toInt(must(rr.hole_number, `Round ${roundKey}: missing hole_number`), "hole_number"),
          strokes: toInt(must(rr.strokes, `Round ${roundKey}: missing strokes`), "strokes"),
          entered_by: myProfile.id,
        };
      });

      const { error: seErr } = await admin.from("round_score_events").insert(scoreEvents);
      if (seErr) throw new Error(`Round ${roundKey}: create score events failed: ${seErr.message}`);

      summary.score_events_created += scoreEvents.length;
      summary.round_keys.push({ round_key: roundKey, round_id: round.id });
    }

    return NextResponse.json({ ok: true, summary });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 400 });
  }
}
