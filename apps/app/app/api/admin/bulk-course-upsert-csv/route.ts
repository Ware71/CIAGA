import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

function requireAdmin(req: NextRequest) {
  const key = req.headers.get("x-admin-key");
  if (!process.env.ADMIN_API_KEY) throw new Error("ADMIN_API_KEY not set");
  if (key !== process.env.ADMIN_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

// Minimal RFC4180-ish CSV parser (handles commas, quotes, newlines)
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      continue;
    }

    if (c === ",") {
      row.push(field.trim());
      field = "";
      continue;
    }

    if (c === "\n") {
      row.push(field.trim());
      field = "";
      // ignore blank lines
      if (row.some((v) => v.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    if (c === "\r") continue;

    field += c;
  }

  row.push(field.trim());
  if (row.some((v) => v.length > 0)) rows.push(row);

  return rows;
}

function toNullNumber(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toNullInt(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

/**
 * osm_id can be:
 *  - "way/1138697614" (or node/relation)
 *  - "1138697614"
 *
 * This parses to the numeric id ONLY (so it works with bigint/int columns).
 * If your DB column is TEXT and you want to store the full "way/..." string instead,
 * change this function accordingly and store the raw string.
 */
function parseOsmId(v: string | undefined): number | null {
  if (!v) return null;
  const s = v.trim();
  const m = s.match(/^(?:(way|node|relation)\/)?(\d+)$/i);
  if (!m) return null;
  const n = Number(m[2]);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function normKey(...parts: Array<string | null | undefined>) {
  return parts
    .map((p) => (p ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

function sumInt(vals: Array<number | null | undefined>): number {
  return vals.reduce((s: number, v) => s + (Number(v) || 0), 0);
}
function sumYards(holes: HoleRow[]) {
  return sumInt(holes.map((h) => h.hole_yardage ?? 0));
}
function sumPar(holes: HoleRow[]) {
  return sumInt(holes.map((h) => h.hole_par ?? 0));
}
function yardsToMeters(y: number | null) {
  if (y == null) return null;
  return Math.round(y * 0.9144);
}

type HoleRow = {
  course_id?: string | null;
  course_name: string;
  city?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;

  // ✅ NEW
  osm_id?: number | null;

  tee_name: string;
  gender?: string | null;
  tee_par?: number | null;
  tee_yards?: number | null;
  rating?: number | null;
  slope?: number | null;
  sort_order?: number | null;

  // schema-aligned tee fields
  bogey_rating?: number | null;
  total_meters?: number | null;
  holes_count?: number | null;

  front_course_rating?: number | null;
  front_slope_rating?: number | null;
  front_bogey_rating?: number | null;

  back_course_rating?: number | null;
  back_slope_rating?: number | null;
  back_bogey_rating?: number | null;

  hole_number: number;
  hole_par?: number | null;
  hole_yardage?: number | null;
  hole_handicap?: number | null;
};

type TeeGroup = {
  tee_name: string;
  gender: string | null;
  tee_par: number | null;
  tee_yards: number | null;
  rating: number | null;
  slope: number | null;
  sort_order: number | null;

  bogey_rating: number | null;
  total_meters: number | null;
  holes_count: number | null;

  front_course_rating: number | null;
  front_slope_rating: number | null;
  front_bogey_rating: number | null;

  back_course_rating: number | null;
  back_slope_rating: number | null;
  back_bogey_rating: number | null;

  holes: HoleRow[];
};

function hasFrontBackSplit(t: TeeGroup) {
  return (
    t.front_course_rating != null ||
    t.front_slope_rating != null ||
    t.front_bogey_rating != null ||
    t.back_course_rating != null ||
    t.back_slope_rating != null ||
    t.back_bogey_rating != null
  );
}

function applyNonNullMeta(target: TeeGroup, hr: HoleRow) {
  // "last non-null wins" (useful if later CSV rows repeat tee-level values)
  const setIfNonNull = <K extends keyof TeeGroup>(k: K, v: TeeGroup[K] | null | undefined) => {
    if (v !== null && v !== undefined) (target[k] as any) = v;
  };

  setIfNonNull("tee_par", hr.tee_par ?? null);
  setIfNonNull("tee_yards", hr.tee_yards ?? null);
  setIfNonNull("rating", hr.rating ?? null);
  setIfNonNull("slope", hr.slope ?? null);
  setIfNonNull("sort_order", hr.sort_order ?? null);

  setIfNonNull("bogey_rating", hr.bogey_rating ?? null);
  setIfNonNull("total_meters", hr.total_meters ?? null);
  setIfNonNull("holes_count", hr.holes_count ?? null);

  setIfNonNull("front_course_rating", hr.front_course_rating ?? null);
  setIfNonNull("front_slope_rating", hr.front_slope_rating ?? null);
  setIfNonNull("front_bogey_rating", hr.front_bogey_rating ?? null);

  setIfNonNull("back_course_rating", hr.back_course_rating ?? null);
  setIfNonNull("back_slope_rating", hr.back_slope_rating ?? null);
  setIfNonNull("back_bogey_rating", hr.back_bogey_rating ?? null);
}

/**
 * Detect WIDE hole columns: hole{N}_{metric}
 * e.g. hole1_yards, hole01_par, hole18_si
 */
function getWideHoleSpec(header: string[]) {
  const re = /^hole(\d+)_([a-z]+)$/i;

  const byHole = new Map<number, Set<string>>();
  for (const h of header) {
    const m = h.trim().match(re);
    if (!m) continue;
    const holeNum = Number(m[1]);
    const metric = m[2].toLowerCase();
    if (!Number.isFinite(holeNum) || holeNum <= 0) continue;
    if (!byHole.has(holeNum)) byHole.set(holeNum, new Set());
    byHole.get(holeNum)!.add(metric);
  }

  const holes = [...byHole.keys()].sort((a, b) => a - b);
  return { holes, hasAny: holes.length > 0 };
}

function isLongFormat(header: string[]) {
  return header.some((h) => h.trim().toLowerCase() === "hole_number");
}

function idxOf(header: string[], name: string) {
  const n = name.toLowerCase();
  return header.findIndex((h) => h.trim().toLowerCase() === n);
}

function getCell(line: string[], header: string[], col: string) {
  const i = idxOf(header, col);
  return i >= 0 ? (line[i] ?? "").trim() : "";
}

/**
 * Convert a single WIDE row into many LONG HoleRows (one per hole with any data)
 * Supports metrics: yards/par/si (si -> hole_handicap)
 */
function explodeWideRow(line: string[], header: string[], holeNums: number[]): HoleRow[] {
  const course_name = getCell(line, header, "course_name");
  const tee_name = getCell(line, header, "tee_name");
  if (!course_name || !tee_name) return [];

  const base: Omit<HoleRow, "hole_number"> = {
    course_id: getCell(line, header, "course_id") || null,
    course_name,
    city: getCell(line, header, "city") || null,
    country: getCell(line, header, "country") || null,
    lat: toNullNumber(getCell(line, header, "lat")),
    lng: toNullNumber(getCell(line, header, "lng")),

    // ✅ NEW
    osm_id: parseOsmId(getCell(line, header, "osm_id")),

    tee_name,
    gender: getCell(line, header, "gender") || null,
    tee_par: toNullInt(getCell(line, header, "tee_par")),
    tee_yards: toNullInt(getCell(line, header, "tee_yards")),
    rating: toNullNumber(getCell(line, header, "rating")),
    slope: toNullInt(getCell(line, header, "slope")),
    sort_order: toNullInt(getCell(line, header, "sort_order")),

    bogey_rating: toNullNumber(getCell(line, header, "bogey_rating")),
    total_meters: toNullInt(getCell(line, header, "total_meters")),
    holes_count: toNullInt(getCell(line, header, "holes_count")),

    front_course_rating: toNullNumber(getCell(line, header, "front_course_rating")),
    front_slope_rating: toNullInt(getCell(line, header, "front_slope_rating")),
    front_bogey_rating: toNullNumber(getCell(line, header, "front_bogey_rating")),

    back_course_rating: toNullNumber(getCell(line, header, "back_course_rating")),
    back_slope_rating: toNullInt(getCell(line, header, "back_slope_rating")),
    back_bogey_rating: toNullNumber(getCell(line, header, "back_bogey_rating")),
  };

  const out: HoleRow[] = [];

  for (const n of holeNums) {
    const yards = toNullInt(getCell(line, header, `hole${n}_yards`));
    const par = toNullInt(getCell(line, header, `hole${n}_par`));
    const si = toNullInt(getCell(line, header, `hole${n}_si`));

    // also allow "handicap" naming if your wide file uses it
    const handicapAlt = toNullInt(getCell(line, header, `hole${n}_handicap`));
    const handicap = si ?? handicapAlt;

    // If there is literally no data for this hole, skip it.
    if (yards == null && par == null && handicap == null) continue;

    out.push({
      ...base,
      hole_number: n,
      hole_yardage: yards,
      hole_par: par,
      hole_handicap: handicap,
    });
  }

  return out;
}

export async function POST(req: NextRequest) {
  const authErr = requireAdmin(req);
  if (authErr) return authErr;

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("text/csv") && !contentType.includes("application/octet-stream")) {
    // still allow, but warn
  }

  const csvText = await req.text();
  const table = parseCsv(csvText);

  if (table.length < 2) {
    return NextResponse.json({ error: "CSV must have a header and at least 1 data row." }, { status: 400 });
  }

  const header = table[0].map((h) => h.trim());

  const requiredBase = ["course_name", "tee_name"];
  for (const r of requiredBase) {
    if (idxOf(header, r) === -1) {
      return NextResponse.json({ error: `Missing required column: ${r}` }, { status: 400 });
    }
  }

  const long = isLongFormat(header);
  const wideSpec = getWideHoleSpec(header);

  if (!long && !wideSpec.hasAny) {
    return NextResponse.json(
      {
        error:
          "CSV format not recognized. Provide either LONG format with 'hole_number' OR WIDE format with columns like 'hole1_yards', 'hole1_par', 'hole1_si'.",
      },
      { status: 400 }
    );
  }

  // Build rows (always LONG internally)
  const rows: HoleRow[] = [];

  for (let r = 1; r < table.length; r++) {
    const line = table[r];

    if (long) {
      const course_name = getCell(line, header, "course_name");
      const tee_name = getCell(line, header, "tee_name");
      const hole_number = toNullInt(getCell(line, header, "hole_number"));

      if (!course_name || !tee_name || !hole_number) continue; // skip incomplete lines

      rows.push({
        course_id: getCell(line, header, "course_id") || null,
        course_name,
        city: getCell(line, header, "city") || null,
        country: getCell(line, header, "country") || null,
        lat: toNullNumber(getCell(line, header, "lat")),
        lng: toNullNumber(getCell(line, header, "lng")),

        // ✅ NEW
        osm_id: parseOsmId(getCell(line, header, "osm_id")),

        tee_name,
        gender: getCell(line, header, "gender") || null,
        tee_par: toNullInt(getCell(line, header, "tee_par")),
        tee_yards: toNullInt(getCell(line, header, "tee_yards")),
        rating: toNullNumber(getCell(line, header, "rating")),
        slope: toNullInt(getCell(line, header, "slope")),
        sort_order: toNullInt(getCell(line, header, "sort_order")),

        bogey_rating: toNullNumber(getCell(line, header, "bogey_rating")),
        total_meters: toNullInt(getCell(line, header, "total_meters")),
        holes_count: toNullInt(getCell(line, header, "holes_count")),

        front_course_rating: toNullNumber(getCell(line, header, "front_course_rating")),
        front_slope_rating: toNullInt(getCell(line, header, "front_slope_rating")),
        front_bogey_rating: toNullNumber(getCell(line, header, "front_bogey_rating")),

        back_course_rating: toNullNumber(getCell(line, header, "back_course_rating")),
        back_slope_rating: toNullInt(getCell(line, header, "back_slope_rating")),
        back_bogey_rating: toNullNumber(getCell(line, header, "back_bogey_rating")),

        hole_number,
        hole_par: toNullInt(getCell(line, header, "hole_par")),
        hole_yardage: toNullInt(getCell(line, header, "hole_yardage")),
        hole_handicap: toNullInt(getCell(line, header, "hole_handicap")),
      });
    } else {
      // WIDE -> explode into LONG rows
      rows.push(...explodeWideRow(line, header, wideSpec.holes));
    }
  }

  if (!rows.length) {
    return NextResponse.json({ error: "No usable data rows found." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Group: courseKey -> teeKey -> holes
  const courses = new Map<
    string,
    {
      course_id: string | null;
      course_name: string;
      city: string | null;
      country: string | null;
      lat: number | null;
      lng: number | null;
      osm_id: number | null;
      tees: Map<string, TeeGroup>;
    }
  >();

  for (const hr of rows) {
    const courseKey =
      hr.course_id?.trim() ? `id:${hr.course_id.trim()}` : `name:${normKey(hr.course_name, hr.city, hr.country)}`;

    if (!courses.has(courseKey)) {
      courses.set(courseKey, {
        course_id: hr.course_id?.trim() || null,
        course_name: hr.course_name,
        city: hr.city ?? null,
        country: hr.country ?? null,
        lat: hr.lat ?? null,
        lng: hr.lng ?? null,
        osm_id: hr.osm_id ?? null,
        tees: new Map(),
      });
    } else {
      // last non-null wins for course-level osm_id too
      const c0 = courses.get(courseKey)!;
      if (c0.osm_id == null && hr.osm_id != null) c0.osm_id = hr.osm_id;
    }

    const c = courses.get(courseKey)!;
    const teeKey = normKey(hr.tee_name, hr.gender || "");
    if (!c.tees.has(teeKey)) {
      c.tees.set(teeKey, {
        tee_name: hr.tee_name,
        gender: hr.gender ?? null,

        tee_par: hr.tee_par ?? null,
        tee_yards: hr.tee_yards ?? null,
        rating: hr.rating ?? null,
        slope: hr.slope ?? null,
        sort_order: hr.sort_order ?? null,

        bogey_rating: hr.bogey_rating ?? null,
        total_meters: hr.total_meters ?? null,
        holes_count: hr.holes_count ?? null,

        front_course_rating: hr.front_course_rating ?? null,
        front_slope_rating: hr.front_slope_rating ?? null,
        front_bogey_rating: hr.front_bogey_rating ?? null,

        back_course_rating: hr.back_course_rating ?? null,
        back_slope_rating: hr.back_slope_rating ?? null,
        back_bogey_rating: hr.back_bogey_rating ?? null,

        holes: [],
      });
    } else {
      // allow later rows to fill missing tee-level metadata
      applyNonNullMeta(c.tees.get(teeKey)!, hr);
    }

    c.tees.get(teeKey)!.holes.push(hr);
  }

  // Expand tees: if an 18-hole tee has front/back fields, auto-create 9-hole tees
  for (const [, c] of courses) {
    const toAdd: Array<[string, TeeGroup]> = [];

    for (const [, t] of c.tees) {
      // Dedup holes for splitting (last wins), then sort
      const byHole = new Map<number, HoleRow>();
      for (const h of t.holes) byHole.set(h.hole_number, h);
      const holes18 = [...byHole.values()].sort((a, b) => a.hole_number - b.hole_number);

      if (holes18.length !== 18) continue;
      if (!hasFrontBackSplit(t)) continue;

      // Only split "parent" tees (avoid re-splitting already-split tees)
      const nameLower = (t.tee_name || "").toLowerCase();
      if (nameLower.includes("front 9") || nameLower.includes("back 9")) continue;

      const front = holes18.slice(0, 9);
      const back = holes18.slice(9, 18);

      // Ensure parent has good defaults if not supplied
      if (t.holes_count == null) t.holes_count = 18;
      if (t.tee_yards == null) t.tee_yards = sumYards(holes18);
      if (t.tee_par == null) t.tee_par = sumPar(holes18);
      if (t.total_meters == null) t.total_meters = yardsToMeters(t.tee_yards);

      const baseName = t.tee_name;
      const genderKey = t.gender ?? "";
      const baseSort = t.sort_order ?? 0;

      const frontYards = sumYards(front);
      const backYards = sumYards(back);
      const frontPar = sumPar(front);
      const backPar = sumPar(back);

      // Front 9 tee
      {
        const tee_name = `${baseName} (Front 9)`;
        const key = normKey(tee_name, genderKey);

        const g: TeeGroup = {
          tee_name,
          gender: t.gender ?? null,
          tee_par: frontPar ?? null,
          tee_yards: frontYards ?? null,
          rating: t.front_course_rating ?? null,
          slope: t.front_slope_rating ?? null,
          sort_order: baseSort + 1,

          bogey_rating: t.front_bogey_rating ?? null,
          total_meters: yardsToMeters(frontYards ?? null),
          holes_count: 9,

          // do not carry split fields on derived tees
          front_course_rating: null,
          front_slope_rating: null,
          front_bogey_rating: null,
          back_course_rating: null,
          back_slope_rating: null,
          back_bogey_rating: null,

          holes: front.map((h, i) => ({ ...h, hole_number: i + 1 })),
        };

        if (!c.tees.has(key)) toAdd.push([key, g]);
      }

      // Back 9 tee
      {
        const tee_name = `${baseName} (Back 9)`;
        const key = normKey(tee_name, genderKey);

        const g: TeeGroup = {
          tee_name,
          gender: t.gender ?? null,
          tee_par: backPar ?? null,
          tee_yards: backYards ?? null,
          rating: t.back_course_rating ?? null,
          slope: t.back_slope_rating ?? null,
          sort_order: baseSort + 2,

          bogey_rating: t.back_bogey_rating ?? null,
          total_meters: yardsToMeters(backYards ?? null),
          holes_count: 9,

          // do not carry split fields on derived tees
          front_course_rating: null,
          front_slope_rating: null,
          front_bogey_rating: null,
          back_course_rating: null,
          back_slope_rating: null,
          back_bogey_rating: null,

          holes: back.map((h, i) => ({ ...h, hole_number: i + 1 })),
        };

        if (!c.tees.has(key)) toAdd.push([key, g]);
      }
    }

    for (const [k, v] of toAdd) c.tees.set(k, v);
  }

  let courseUpserts = 0;
  let teeBoxUpserts = 0;
  let holesDeleted = 0;
  let holesInserted = 0;

  const results: any[] = [];

  for (const [, c] of courses) {
    try {
      // ✅ If courses.osm_id is NOT NULL, fail early with a clear error
      if (c.osm_id == null) throw new Error(`Missing/invalid osm_id for course: ${c.course_name}`);

      // Upsert course
      let courseId = c.course_id;

      if (courseId) {
        const { error } = await supabase
          .from("courses")
          .upsert(
            {
              id: courseId,
              name: c.course_name,
              city: c.city,
              country: c.country,
              lat: c.lat,
              lng: c.lng,
              osm_id: c.osm_id, // ✅ NEW
            },
            { onConflict: "id" }
          );

        if (error) throw error;
        courseUpserts++;
      } else {
        // Admin-friendly matching: (name, city, country)
        const { data: existing, error: findErr } = await supabase
          .from("courses")
          .select("id")
          .eq("name", c.course_name)
          .eq("city", c.city)
          .eq("country", c.country)
          .limit(1);

        if (findErr) throw findErr;

        if (existing && existing.length) {
          courseId = existing[0].id;
          const { error: updErr } = await supabase
            .from("courses")
            .update({ lat: c.lat, lng: c.lng, osm_id: c.osm_id }) // ✅ NEW
            .eq("id", courseId);
          if (updErr) throw updErr;
        } else {
          const { data: inserted, error: insErr } = await supabase
            .from("courses")
            .insert({
              name: c.course_name,
              city: c.city,
              country: c.country,
              lat: c.lat,
              lng: c.lng,
              osm_id: c.osm_id, // ✅ NEW
            })
            .select("id")
            .single();
          if (insErr) throw insErr;
          courseId = inserted.id;
        }

        courseUpserts++;
      }

      // Upsert tee boxes + replace holes
      for (const [, t] of c.tees) {
        const { data: teeBox, error: teeErr } = await supabase
          .from("course_tee_boxes")
          .upsert(
            {
              course_id: courseId,
              name: t.tee_name,
              gender: t.gender,
              par: t.tee_par,
              yards: t.tee_yards,
              rating: t.rating,
              slope: t.slope,
              sort_order: t.sort_order,

              bogey_rating: t.bogey_rating,
              total_meters: t.total_meters,
              holes_count: t.holes_count,

              front_course_rating: t.front_course_rating,
              front_slope_rating: t.front_slope_rating,
              front_bogey_rating: t.front_bogey_rating,

              back_course_rating: t.back_course_rating,
              back_slope_rating: t.back_slope_rating,
              back_bogey_rating: t.back_bogey_rating,
            },
            { onConflict: "course_id,name,gender" }
          )
          .select("id")
          .single();

        if (teeErr) throw teeErr;
        teeBoxUpserts++;

        const teeBoxId = teeBox.id;

        const { error: delErr, count } = await supabase
          .from("course_tee_holes")
          .delete({ count: "exact" })
          .eq("tee_box_id", teeBoxId);

        if (delErr) throw delErr;
        holesDeleted += count ?? 0;

        // Dedup by hole_number (last row wins)
        const byHole = new Map<number, HoleRow>();
        for (const h of t.holes) byHole.set(h.hole_number, h);

        const holesToInsert = [...byHole.values()]
          .sort((a, b) => a.hole_number - b.hole_number)
          .map((h) => ({
            tee_box_id: teeBoxId,
            hole_number: h.hole_number,
            par: h.hole_par ?? null,
            yardage: h.hole_yardage ?? null,
            handicap: h.hole_handicap ?? null,
          }));

        if (holesToInsert.length) {
          const { error: insErr } = await supabase.from("course_tee_holes").insert(holesToInsert);
          if (insErr) throw insErr;
          holesInserted += holesToInsert.length;
        }
      }

      results.push({ course: c.course_name, course_id: courseId, ok: true });
    } catch (e: any) {
      results.push({ course: c.course_name, ok: false, error: e?.message ?? String(e) });
    }
  }

  return NextResponse.json({
    ok: true,
    summary: { courses: courses.size, courseUpserts, teeBoxUpserts, holesDeleted, holesInserted },
    results,
  });
}
