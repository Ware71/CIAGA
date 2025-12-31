import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const GOLF_BASE = process.env.GOLFCOURSE_API_BASE ?? "https://api.golfcourseapi.com";
const GOLF_KEY = process.env.GOLFCOURSE_API_KEY;

type ResolveBody = {
  osm_id: string;
  name: string;
  lat: number;
  lng: number;
};

function norm(s: string) {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreMatch(a: string, b: string) {
  const A = new Set(norm(a).split(" ").filter(Boolean));
  const B = new Set(norm(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.max(A.size, B.size);
}

function normalizeGender(k: string) {
  const s = (k ?? "").toLowerCase().trim();
  if (["f", "female", "women", "womens", "ladies", "lady"].includes(s)) return "female";
  if (["m", "male", "men", "mens"].includes(s)) return "male";
  return "unisex";
}

function nnum(v: any): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ResolveBody;

  if (!body?.osm_id || !body?.name || !Number.isFinite(body.lat) || !Number.isFinite(body.lng)) {
    return NextResponse.json({ error: "Missing osm_id/name/lat/lng" }, { status: 400 });
  }

  // 1) Find existing course (if any)
  const existing = await supabaseAdmin
    .from("courses")
    .select("id, golfcourseapi_id")
    .eq("osm_id", body.osm_id)
    .maybeSingle();

  let courseId: string | null = existing.data?.id ?? null;

  // 2) If already enriched AND tee boxes exist → cache hit
  if (existing.data?.id && existing.data.golfcourseapi_id) {
    const tees = await supabaseAdmin
      .from("course_tee_boxes")
      .select("id", { count: "exact", head: true })
      .eq("course_id", existing.data.id);

    if ((tees.count ?? 0) > 0) {
      return NextResponse.json({
        course_id: existing.data.id,
        from_cache: true,
        enriched: true,
        tee_count: tees.count,
      });
    }
    // else: fall through and retry enrichment
  }

  // 3) Insert course if it does not exist
  if (!courseId) {
    const inserted = await supabaseAdmin
      .from("courses")
      .insert({
        osm_id: body.osm_id,
        name: body.name,
        name_original: body.name,
        lat: body.lat,
        lng: body.lng,
        source: "osm",
      })
      .select("id")
      .single();

    if (inserted.error) {
      return NextResponse.json({ error: inserted.error.message }, { status: 500 });
    }

    courseId = inserted.data.id;
  }

  // 4) Enrich using:
  //    GET /v1/search?search_query=...
  //    Header: Authorization: Key <API_KEY>
  if (!GOLF_KEY?.trim()) {
    return NextResponse.json({
      course_id: courseId,
      enriched: false,
      reason: "Missing GOLFCOURSE_API_KEY",
    });
  }

  try {
    const searchUrl = `${GOLF_BASE}/v1/search?search_query=${encodeURIComponent(body.name)}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        Authorization: `Key ${GOLF_KEY}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const searchText = await searchRes.text();
    if (!searchRes.ok) {
      return NextResponse.json({
        course_id: courseId!,
        enriched: false,
        reason: "Search failed",
        status: searchRes.status,
        body: searchText.slice(0, 400),
      });
    }

    const searchJson = JSON.parse(searchText);
    const candidates: any[] = Array.isArray(searchJson?.courses) ? searchJson.courses : [];

    if (!candidates.length) {
      return NextResponse.json({
        course_id: courseId!,
        enriched: false,
        reason: "No candidates returned",
      });
    }

    // Best match by name similarity (optionally distance bonus)
    let best = candidates[0];
    let bestScore = -1;

    for (const c of candidates) {
      const candName =
        `${c.club_name ?? ""} ${c.course_name ?? ""}`.trim() ||
        c.course_name ||
        c.club_name ||
        "";

      const s = scoreMatch(body.name, candName);

      const clat = Number(c.latitude ?? c.lat);
      const clng = Number(c.longitude ?? c.lng);

      let distBonus = 0;
      if (Number.isFinite(clat) && Number.isFinite(clng)) {
        const d = Math.hypot(body.lat - clat, body.lng - clng);
        distBonus = Math.max(0, 1 - d * 10);
      }

      const total = s * 0.8 + distBonus * 0.2;
      if (total > bestScore) {
        bestScore = total;
        best = c;
      }
    }

    const golfId = String(best?.id ?? "");
    if (!golfId) {
      return NextResponse.json({
        course_id: courseId!,
        enriched: false,
        reason: "Matched candidate missing id",
      });
    }

    const teesObj = best?.tees ?? {};

    // Save raw payload + chosen id (so we can skip re-enriching later)
    await supabaseAdmin
      .from("courses")
      .update({
        golfcourseapi_id: golfId,
        golfcourseapi_raw: best,
        source: "osm+golfcourseapi",
      })
      .eq("id", courseId);

    // --- Build tee rows (and keep holes in memory) ---
    type TeeRow = {
      course_id: string;
      name: string;
      gender: string | null;
      yards: number | null;
      par: number | null;
      rating: number | null;
      slope: number | null;
      bogey_rating: number | null;
      total_meters: number | null;
      holes_count: number | null;

      front_course_rating: number | null;
      front_slope_rating: number | null;
      front_bogey_rating: number | null;
      back_course_rating: number | null;
      back_slope_rating: number | null;
      back_bogey_rating: number | null;

      // we will set this after sorting
      sort_order: number;
      // internal key for mapping holes after insert
      _tmp_key: string;
      _holes: any[];
    };

    const teeRows: TeeRow[] = [];
    let tmp = 0;

    for (const [genderKey, arr] of Object.entries(teesObj)) {
      const gender = normalizeGender(genderKey);
      const teesArr = Array.isArray(arr) ? arr : [];

      for (const t of teesArr) {
        const holes = Array.isArray(t?.holes) ? t.holes : [];

        teeRows.push({
          course_id: courseId!,
          name: String(t.tee_name ?? t.name ?? `Tee ${tmp + 1}`),
          gender,
          yards: nnum(t.total_yards ?? t.yards ?? t.yardage),
          par: nnum(t.par_total ?? t.par),
          rating: nnum(t.course_rating ?? t.rating),
          slope: nnum(t.slope_rating ?? t.slope),
          bogey_rating: nnum(t.bogey_rating),
          total_meters: nnum(t.total_meters),
          holes_count: nnum(t.number_of_holes ?? holes.length),

          front_course_rating: nnum(t.front_course_rating),
          front_slope_rating: nnum(t.front_slope_rating),
          front_bogey_rating: nnum(t.front_bogey_rating),
          back_course_rating: nnum(t.back_course_rating),
          back_slope_rating: nnum(t.back_slope_rating),
          back_bogey_rating: nnum(t.back_bogey_rating),

          sort_order: 0,
          _tmp_key: `tmp_${tmp++}`,
          _holes: holes,
        });
      }
    }

    if (!teeRows.length) {
      return NextResponse.json({
        course_id: courseId!,
        enriched: true,
        tee_count: 0,
        hole_count: 0,
        matched_name: `${best.club_name ?? ""} ${best.course_name ?? ""}`.trim(),
        match_score: bestScore,
        note: "No tee data returned by API for this match",
      });
    }

    // Sort tee boxes by highest rating first, then slope, then yards (desc)
    teeRows.sort((a, b) => {
      const ar = a.rating ?? -1;
      const br = b.rating ?? -1;
      if (br !== ar) return br - ar;

      const as = a.slope ?? -1;
      const bs = b.slope ?? -1;
      if (bs !== as) return bs - as;

      const ay = a.yards ?? -1;
      const by = b.yards ?? -1;
      return by - ay;
    });

    // Assign sort_order after sorting
    teeRows.forEach((t, idx) => (t.sort_order = idx));

    // Clear old tee boxes (holes cascade via FK)
    await supabaseAdmin.from("course_tee_boxes").delete().eq("course_id", courseId);

    // Insert tee boxes and select id + tmp key mapping
    const teeInsertPayload = teeRows.map((t) => {
      const { _tmp_key, _holes, ...db } = t;
      return db;
    });

    const teeIns = await supabaseAdmin
      .from("course_tee_boxes")
      .insert(teeInsertPayload)
      .select("id, sort_order");

    if (teeIns.error) {
      return NextResponse.json({
        course_id: courseId,
        enriched: false,
        reason: "DB insert tee boxes failed",
        db_error: teeIns.error.message,
      });
    }

    const insertedTees = teeIns.data ?? [];
    const teeCount = insertedTees.length;

    // Build holes rows by matching sort_order
    // (because we preserved teeRows sorting and inserted with same sort_order)
    const holesRows: any[] = [];

    for (const insRow of insertedTees) {
      const teeLocal = teeRows.find((t) => t.sort_order === insRow.sort_order);
      const holes = teeLocal?._holes ?? [];

      holes.forEach((h: any, idx: number) => {
        holesRows.push({
          tee_box_id: insRow.id,
          hole_number: Number(h.hole_number ?? h.hole ?? (idx + 1)),
          par: nnum(h.par),
          yardage: nnum(h.yardage ?? h.yards),
          handicap: nnum(h.handicap),
        });
      });
    }

    let holeCount = 0;
    if (holesRows.length) {
      const holeIns = await supabaseAdmin.from("course_tee_holes").insert(holesRows);

      if (holeIns.error) {
        return NextResponse.json({
          course_id: courseId,
          enriched: false,
          reason: "DB insert holes failed",
          db_error: holeIns.error.message,
        });
      }

      holeCount = holesRows.length;
    }

    return NextResponse.json({
      course_id: courseId!,
      enriched: true,
      tee_count: teeCount,
      hole_count: holeCount,
      matched_name: `${best.club_name ?? ""} ${best.course_name ?? ""}`.trim(),
      match_score: bestScore,
    });
  } catch (e: any) {
    return NextResponse.json({
      course_id: courseId,
      enriched: false,
      reason: "Exception",
      message: e?.message ?? "Unknown error",
    });
  }
}
