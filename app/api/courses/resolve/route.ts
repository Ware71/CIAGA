import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const GOLF_BASE = process.env.GOLFCOURSE_API_BASE ?? "https://api.golfcourseapi.com";
const GOLF_KEY = process.env.GOLFCOURSE_API_KEY;

// Nominatim (OSM reverse geocode)
const NOMINATIM_BASE = process.env.NOMINATIM_BASE ?? "https://nominatim.openstreetmap.org";
const NOMINATIM_USER_AGENT =
  process.env.OSM_NOMINATIM_USER_AGENT ??
  process.env.OVERPASS_USER_AGENT ??
  "CIAGA/1.0 (contact: dev@ciaga.app)";

// geo gates (km)
const MAX_KM_NAMED = Number(process.env.GOLFCOURSE_MAX_KM_NAMED ?? 60);
const MAX_KM_UNNAMED = Number(process.env.GOLFCOURSE_MAX_KM_UNNAMED ?? 40);

// thresholds
const MIN_NAME_SIM = Number(process.env.GOLFCOURSE_MIN_NAME_SIMILARITY ?? 0.30);
const MIN_FINAL = Number(process.env.GOLFCOURSE_MIN_FINAL_SCORE ?? 0.55);
const MIN_FINAL_UNNAMED = Number(process.env.GOLFCOURSE_MIN_FINAL_SCORE_UNNAMED ?? 0.65);

type ResolveBody = {
  osm_id: string;
  name: string;
  lat: number;
  lng: number;

  // Optional: callers (search/nearby) may pass these in if they already have them.
  city?: string | null;
  country?: string | null;
};

const GENERIC_GOLF_WORDS = new Set([
  "golf",
  "course",
  "club",
  "gc",
  "g.c",
  "links",
  "resort",
  "centre",
  "center",
  "country",
  "cc",
]);

const NOISE_WORDS = new Set(["the", "at", "and", "of", "de", "la", "le"]);
const EXTRA_NOISE = new Set(["ltd", "limited"]);

function stripDiacritics(input: string) {
  return (input ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function norm(s: string) {
  return stripDiacritics(s ?? "")
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bst\b/g, "saint");
}

function isUnnamedOsmName(name: string) {
  const n = norm(name);
  return !n || n === "unnamed golf course" || n.startsWith("unnamed");
}

function cleanGolfApiName(raw: string) {
  let s = (raw ?? "").replace(/\(\s*\d+\s*\)/g, " "); // remove "(1012346)"
  s = s.replace(/\b(ltd|limited)\b/gi, " "); // remove company suffixes
  return s.replace(/\s+/g, " ").trim();
}

function chooseBestDisplayName(osmName: string, golfApiName: string) {
  const osm = (osmName ?? "").trim();
  const golf = cleanGolfApiName(golfApiName ?? "").trim();

  if (isUnnamedOsmName(osm)) return golf || golfApiName || osm;
  if (!golf) return osm || golfApiName;

  const aDigits = (osm.match(/\d/g) ?? []).length;
  const bDigits = (golf.match(/\d/g) ?? []).length;
  if (aDigits !== bDigits) return aDigits < bDigits ? osm : golf;

  const aTokens = norm(osm).split(" ").filter(Boolean);
  const bTokens = norm(golf).split(" ").filter(Boolean);
  if (aTokens.length !== bTokens.length) return aTokens.length < bTokens.length ? osm : golf;

  return osm;
}

function jaccard(A: Set<string>, B: Set<string>) {
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

function tokensForSimilarity(s: string) {
  return norm(s)
    .split(" ")
    .filter(Boolean)
    .filter((t) => !NOISE_WORDS.has(t))
    .filter((t) => !GENERIC_GOLF_WORDS.has(t))
    .filter((t) => !EXTRA_NOISE.has(t))
    .filter((t) => !/^\d+$/.test(t));
}

function nameSimilarity(a: string, b: string) {
  const A = new Set(tokensForSimilarity(a));
  const B = new Set(tokensForSimilarity(b));
  const strict = jaccard(A, B);
  if (strict > 0) return strict;

  const A2 = new Set(norm(a).split(" ").filter(Boolean).filter((t) => !NOISE_WORDS.has(t)));
  const B2 = new Set(norm(b).split(" ").filter(Boolean).filter((t) => !NOISE_WORDS.has(t)));
  return jaccard(A2, B2);
}

function tokensForQueryRewrite(s: string) {
  return norm(s)
    .split(" ")
    .filter(Boolean)
    .filter((t) => !NOISE_WORDS.has(t))
    .filter((t) => !GENERIC_GOLF_WORDS.has(t));
}

function buildAttemptQueries(osmName: string) {
  const original = (osmName ?? "").trim();
  const cleaned = tokensForQueryRewrite(original).join(" ").trim();

  const q: string[] = [];
  if (original) q.push(original);
  if (cleaned && cleaned !== original) q.push(cleaned);

  // broad fallback (lets geo do the work)
  q.push("golf");

  return [...new Set(q.map((s) => s.trim()).filter(Boolean))];
}

function toNum(v: any): number | null {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

// GolfCourseAPI coords are usually in location.latitude/longitude
function pickLat(c: any): number | null {
  return (
    toNum(c?.location?.latitude) ??
    toNum(c?.location?.lat) ??
    toNum(c?.latitude) ??
    toNum(c?.lat) ??
    null
  );
}

function pickLng(c: any): number | null {
  return (
    toNum(c?.location?.longitude) ??
    toNum(c?.location?.lng) ??
    toNum(c?.location?.lon) ??
    toNum(c?.longitude) ??
    toNum(c?.lng) ??
    toNum(c?.lon) ??
    null
  );
}

function pickCandidateName(c: any) {
  return (
    `${c.club_name ?? ""} ${c.course_name ?? ""}`.trim() ||
    c.course_name ||
    c.club_name ||
    c.name ||
    ""
  );
}

// Haversine km
function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
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

/** -----------------------------
 *  Split + SI Helpers
 *  -----------------------------
 */

function sumYards(holes: any[]) {
  return holes.reduce((s, h) => s + (Number(h?.yardage ?? h?.yards) || 0), 0);
}

function sumPar(holes: any[]) {
  return holes.reduce((s, h) => s + (Number(h?.par) || 0), 0);
}

function yardsToMeters(y: number | null) {
  return y == null ? null : Math.round(y * 0.9144);
}

function hasFrontBackSplit(t: any, holes: any[]) {
  return (
    holes.length === 18 &&
    (t?.front_course_rating != null ||
      t?.front_slope_rating != null ||
      t?.front_bogey_rating != null ||
      t?.back_course_rating != null ||
      t?.back_slope_rating != null ||
      t?.back_bogey_rating != null)
  );
}

/**
 * Derive Stroke Index using blended difficulty:
 *  - 70% yardage
 *  - 30% par
 * Harder holes => lower SI (1 = hardest)
 */
function deriveSIRanksParYardage(holes: any[]): number[] {
  if (!holes.length) return [];

  const scored = holes.map((h, i) => {
    const yards = Number(h?.yardage ?? h?.yards) || 0;
    const par = Number(h?.par) || 0;

    // par contributes, but yardage dominates (par scaled up)
    const score = yards * 0.7 + par * 50 * 0.3;

    return { i, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const si: number[] = Array(holes.length);
  scored.forEach((s, rank) => {
    si[s.i] = rank + 1;
  });

  return si;
}

/** -----------------------------
 *  Location helpers (City/Country)
 *  -----------------------------
 */

function pickCityFromAddress(addr: Record<string, any> | undefined | null): string | null {
  if (!addr) return null;
  const v =
    addr.city ??
    addr.town ??
    addr.village ??
    addr.hamlet ??
    addr.municipality ??
    addr.county ??
    null;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function pickCountryFromAddress(addr: Record<string, any> | undefined | null): string | null {
  if (!addr) return null;
  const v = addr.country ?? null;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

async function reverseGeocodeCityCountry(lat: number, lng: number): Promise<{
  city: string | null;
  country: string | null;
}> {
  // Be tolerant: if Nominatim is slow/limited, we just return nulls.
  try {
    const url =
      `${NOMINATIM_BASE}/reverse?format=jsonv2` +
      `&lat=${encodeURIComponent(String(lat))}` +
      `&lon=${encodeURIComponent(String(lng))}` +
      `&zoom=10&addressdetails=1`;

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": NOMINATIM_USER_AGENT,
      },
      cache: "no-store",
    });

    if (!res.ok) return { city: null, country: null };

    const json: any = await res.json();
    const addr = json?.address ?? null;

    return {
      city: pickCityFromAddress(addr),
      country: pickCountryFromAddress(addr),
    };
  } catch {
    return { city: null, country: null };
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ResolveBody;

  if (!body?.osm_id || !body?.name || !Number.isFinite(body.lat) || !Number.isFinite(body.lng)) {
    return NextResponse.json({ error: "Missing osm_id/name/lat/lng" }, { status: 400 });
  }

  // 0) Determine city/country (prefer caller-provided; otherwise reverse geocode)
  let city: string | null = typeof body.city === "string" ? body.city.trim() : (body.city ?? null);
  let country: string | null =
    typeof body.country === "string" ? body.country.trim() : (body.country ?? null);

  if (!city || !country) {
    const geo = await reverseGeocodeCityCountry(body.lat, body.lng);
    city = city ?? geo.city;
    country = country ?? geo.country;
  }

  // 1) Get or create course row
  const existing = await supabaseAdmin
    .from("courses")
    .select("id, golfcourseapi_id, city, country")
    .eq("osm_id", body.osm_id)
    .order("id", { ascending: false })
    .limit(1);

  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 });

  let courseId: string | null = existing.data?.[0]?.id ?? null;
  const existingGolfId: string | null = existing.data?.[0]?.golfcourseapi_id ?? null;

  // Backfill location on existing course if missing (never overwrite good values)
  if (courseId) {
    const existingCity = existing.data?.[0]?.city ?? null;
    const existingCountry = existing.data?.[0]?.country ?? null;

    const patch: any = {};
    if (!existingCity && city) patch.city = city;
    if (!existingCountry && country) patch.country = country;

    if (Object.keys(patch).length) {
      await supabaseAdmin.from("courses").update(patch).eq("id", courseId);
    }
  }

  if (courseId && existingGolfId) {
    const tees = await supabaseAdmin
      .from("course_tee_boxes")
      .select("id", { count: "exact", head: true })
      .eq("course_id", courseId);

    if ((tees.count ?? 0) > 0) {
      return NextResponse.json({
        course_id: courseId,
        from_cache: true,
        enriched: true,
        tee_count: tees.count,
        city,
        country,
      });
    }
  }

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
        city: city ?? null,
        country: country ?? null,
      })
      .select("id");

    if (inserted.error) return NextResponse.json({ error: inserted.error.message }, { status: 500 });

    courseId = inserted.data?.[0]?.id ?? null;
    if (!courseId) return NextResponse.json({ error: "Insert succeeded but no id returned" }, { status: 500 });
  }

  if (!GOLF_KEY?.trim()) {
    return NextResponse.json({
      course_id: courseId,
      enriched: false,
      reason: "Missing GOLFCOURSE_API_KEY",
      city,
      country,
    });
  }

  const unnamed = isUnnamedOsmName(body.name);
  const maxKm = unnamed ? MAX_KM_UNNAMED : MAX_KM_NAMED;

  const queries = buildAttemptQueries(body.name);
  const debug: any[] = [];

  type Scored = {
    c: any;
    candName: string;
    km: number;
    nameScore: number;
    finalScore: number;
    query: string;
  };

  let best: Scored | null = null;

  for (const q of queries) {
    const searchUrl = `${GOLF_BASE}/v1/search?search_query=${encodeURIComponent(q)}`;
    const res = await fetch(searchUrl, {
      headers: { Authorization: `Key ${GOLF_KEY}`, Accept: "application/json" },
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) {
      debug.push({ query: q, status: res.status, error: text.slice(0, 200) });
      continue;
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      debug.push({ query: q, error: "Invalid JSON from GolfCourseAPI" });
      continue;
    }

    const candidates: any[] = Array.isArray(json?.courses) ? json.courses : [];
    if (!candidates.length) {
      debug.push({ query: q, resultsCount: 0, top: [] });
      continue;
    }

    const scored: Scored[] = [];

    for (const c of candidates) {
      const clat = pickLat(c);
      const clng = pickLng(c);
      if (clat == null || clng == null) continue;

      const km = distanceKm(body.lat, body.lng, clat, clng);
      if (km > maxKm) continue;

      const candName = pickCandidateName(c);
      const ns = unnamed ? 0 : nameSimilarity(body.name, candName);
      if (!unnamed && ns < MIN_NAME_SIM) continue;

      // distance dominates; name is tie-breaker
      const loc = clamp01(1 - km / maxKm);
      const final = unnamed ? loc : 0.85 * loc + 0.15 * ns;

      scored.push({ c, candName, km, nameScore: ns, finalScore: final, query: q });
    }

    scored.sort((a, b) => b.finalScore - a.finalScore || a.km - a.km);

    debug.push({
      query: q,
      resultsCount: candidates.length,
      top: scored.slice(0, 5).map((s) => ({
        id: s.c?.id,
        name: s.candName,
        km: Number(s.km.toFixed(2)),
        nameScore: Number(s.nameScore.toFixed(3)),
        finalScore: Number(s.finalScore.toFixed(3)),
      })),
    });

    if (scored.length && (!best || scored[0].finalScore > best.finalScore)) best = scored[0];

    const accept = unnamed ? MIN_FINAL_UNNAMED : MIN_FINAL;
    if (best && best.finalScore >= accept) break;
  }

  if (!best) {
    return NextResponse.json({
      course_id: courseId,
      enriched: false,
      reason: "No match found",
      received: { name: body.name, lat: body.lat, lng: body.lng, unnamed, queries },
      debug,
      policy: { maxKm, minNameSim: MIN_NAME_SIM, minFinal: MIN_FINAL },
      city,
      country,
    });
  }

  const golfId = String(best.c?.id ?? "");
  if (!golfId) {
    return NextResponse.json({ course_id: courseId, enriched: false, reason: "Matched candidate missing id", debug });
  }

  const golfApiDisplay =
    `${best.c?.club_name ?? ""} ${best.c?.course_name ?? ""}`.trim() ||
    best.c?.course_name ||
    best.c?.club_name ||
    best.candName ||
    "";

  const matchedDisplayName = chooseBestDisplayName(body.name, golfApiDisplay);

  await supabaseAdmin
    .from("courses")
    .update({
      golfcourseapi_id: golfId,
      golfcourseapi_raw: best.c,
      source: "osm+golfcourseapi",
      name: matchedDisplayName,
      ...(city ? { city } : {}),
      ...(country ? { country } : {}),
    })
    .eq("id", courseId);

  // ---------- TEE INGESTION (FULL 18 + FRONT 9 + BACK 9 when available) ----------
  const teesObj = best.c?.tees ?? {};

  type TeePart = "full" | "front" | "back";

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

    sort_order: number;
    _holes: any[];
    _part: TeePart;
  };

  const teeRows: TeeRow[] = [];

  for (const [genderKey, arr] of Object.entries(teesObj)) {
    const gender = normalizeGender(genderKey);
    const teesArr = Array.isArray(arr) ? arr : [];

    for (const t of teesArr) {
      const holesAll = Array.isArray(t?.holes) ? t.holes : [];
      const baseName = String(t.tee_name ?? t.name ?? "Tee").trim() || "Tee";

      if (hasFrontBackSplit(t, holesAll)) {
        const frontHoles = holesAll.slice(0, 9);
        const backHoles = holesAll.slice(9, 18);

        // FULL 18 (retain front/back fields on this record)
        const fullY = sumYards(holesAll);
        teeRows.push({
          course_id: courseId!,
          name: baseName,
          gender,
          yards: nnum(t.total_yards ?? t.yards ?? t.yardage) ?? fullY,
          par: nnum(t.par_total ?? t.par) ?? sumPar(holesAll),
          rating: nnum(t.course_rating ?? t.rating),
          slope: nnum(t.slope_rating ?? t.slope),
          bogey_rating: nnum(t.bogey_rating),
          total_meters: nnum(t.total_meters) ?? yardsToMeters(fullY),
          holes_count: nnum(t.number_of_holes ?? holesAll.length) ?? 18,

          front_course_rating: nnum(t.front_course_rating),
          front_slope_rating: nnum(t.front_slope_rating),
          front_bogey_rating: nnum(t.front_bogey_rating),
          back_course_rating: nnum(t.back_course_rating),
          back_slope_rating: nnum(t.back_slope_rating),
          back_bogey_rating: nnum(t.back_bogey_rating),

          sort_order: 0,
          _holes: holesAll,
          _part: "full",
        });

        // FRONT 9 (use front ratings as the tee rating/slope/bogey)
        const frontY = sumYards(frontHoles);
        teeRows.push({
          course_id: courseId!,
          name: `${baseName} (Front 9)`,
          gender,
          yards: frontY,
          par: sumPar(frontHoles),
          rating: nnum(t.front_course_rating),
          slope: nnum(t.front_slope_rating),
          bogey_rating: nnum(t.front_bogey_rating),
          total_meters: yardsToMeters(frontY),
          holes_count: 9,

          front_course_rating: null,
          front_slope_rating: null,
          front_bogey_rating: null,
          back_course_rating: null,
          back_slope_rating: null,
          back_bogey_rating: null,

          sort_order: 0,
          _holes: frontHoles,
          _part: "front",
        });

        // BACK 9 (use back ratings as the tee rating/slope/bogey)
        const backY = sumYards(backHoles);
        teeRows.push({
          course_id: courseId!,
          name: `${baseName} (Back 9)`,
          gender,
          yards: backY,
          par: sumPar(backHoles),
          rating: nnum(t.back_course_rating),
          slope: nnum(t.back_slope_rating),
          bogey_rating: nnum(t.back_bogey_rating),
          total_meters: yardsToMeters(backY),
          holes_count: 9,

          front_course_rating: null,
          front_slope_rating: null,
          front_bogey_rating: null,
          back_course_rating: null,
          back_slope_rating: null,
          back_bogey_rating: null,

          sort_order: 0,
          _holes: backHoles,
          _part: "back",
        });

        continue;
      }

      // default: keep as single tee
      const fullY = sumYards(holesAll);
      teeRows.push({
        course_id: courseId!,
        name: baseName,
        gender,
        yards: nnum(t.total_yards ?? t.yards ?? t.yardage) ?? (holesAll.length ? fullY : null),
        par: nnum(t.par_total ?? t.par) ?? (holesAll.length ? sumPar(holesAll) : null),
        rating: nnum(t.course_rating ?? t.rating),
        slope: nnum(t.slope_rating ?? t.slope),
        bogey_rating: nnum(t.bogey_rating),
        total_meters: nnum(t.total_meters) ?? (holesAll.length ? yardsToMeters(fullY) : null),
        holes_count: nnum(t.number_of_holes ?? holesAll.length),

        front_course_rating: nnum(t.front_course_rating),
        front_slope_rating: nnum(t.front_slope_rating),
        front_bogey_rating: nnum(t.front_bogey_rating),
        back_course_rating: nnum(t.back_course_rating),
        back_slope_rating: nnum(t.back_slope_rating),
        back_bogey_rating: nnum(t.back_bogey_rating),

        sort_order: 0,
        _holes: holesAll,
        _part: "full",
      });
    }
  }

  if (!teeRows.length) {
    return NextResponse.json({
      course_id: courseId,
      enriched: true,
      tee_count: 0,
      hole_count: 0,
      matched_name: matchedDisplayName,
      match_km: best.km,
      match_score: best.finalScore,
      match_query: best.query,
      debug,
      note: "Matched course has no tee data",
      city,
      country,
    });
  }

  // Sort tee boxes by rating desc, slope desc, yards desc (keeps your old behavior)
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

  teeRows.forEach((t, idx) => (t.sort_order = idx));

  // Replace old tee boxes (holes cascade)
  await supabaseAdmin.from("course_tee_boxes").delete().eq("course_id", courseId);

  // Insert tee boxes
  const teeInsertPayload = teeRows.map((t) => {
    const { _holes, _part, ...db } = t;
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
      city,
      country,
    });
  }

  const insertedTees = teeIns.data ?? [];
  const teeCount = insertedTees.length;

  // Insert holes
  const holesRows: any[] = [];

  for (const insRow of insertedTees) {
    const teeLocal = teeRows.find((t) => t.sort_order === insRow.sort_order);
    const holes = teeLocal?._holes ?? [];
    const part = teeLocal?._part ?? "full";

    const derivedSI = deriveSIRanksParYardage(holes);

    holes.forEach((h: any, idx: number) => {
      const apiSI = nnum(h.handicap);

      // Full: prefer API numbering; Split: force 1..9
      const holeNum =
        part === "full"
          ? Number(h.hole_number ?? h.hole ?? idx + 1) || idx + 1
          : idx + 1;

      holesRows.push({
        tee_box_id: insRow.id,
        hole_number: holeNum,
        par: nnum(h.par),
        yardage: nnum(h.yardage ?? h.yards),
        handicap: apiSI ?? derivedSI[idx] ?? null,
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
        city,
        country,
      });
    }
    holeCount = holesRows.length;
  }

  return NextResponse.json({
    course_id: courseId,
    enriched: true,
    tee_count: teeCount,
    hole_count: holeCount,
    matched_name: matchedDisplayName,
    match_km: best.km,
    match_score: best.finalScore,
    match_query: best.query,
    debug,
    city,
    country,
  });
}
