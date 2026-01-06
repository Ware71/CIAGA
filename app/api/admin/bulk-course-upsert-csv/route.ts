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

function normKey(...parts: Array<string | null | undefined>) {
  return parts
    .map((p) => (p ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join("|");
}

type HoleRow = {
  course_id?: string | null;
  course_name: string;
  city?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;

  tee_name: string;
  gender?: string | null;
  tee_par?: number | null;
  tee_yards?: number | null;
  rating?: number | null;
  slope?: number | null;
  sort_order?: number | null;

  hole_number: number;
  hole_par?: number | null;
  hole_yardage?: number | null;
  hole_handicap?: number | null;
};

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
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const required = ["course_name", "tee_name", "hole_number"];
  for (const r of required) {
    if (idx(r) === -1) {
      return NextResponse.json({ error: `Missing required column: ${r}` }, { status: 400 });
    }
  }

  const rows: HoleRow[] = [];
  for (let r = 1; r < table.length; r++) {
    const line = table[r];
    const get = (col: string) => {
      const i = idx(col);
      return i >= 0 ? (line[i] ?? "").trim() : "";
    };

    const course_name = get("course_name");
    const tee_name = get("tee_name");
    const hole_number = toNullInt(get("hole_number"));

    if (!course_name || !tee_name || !hole_number) continue; // skip incomplete lines

    rows.push({
      course_id: get("course_id") || null,
      course_name,
      city: get("city") || null,
      country: get("country") || null,
      lat: toNullNumber(get("lat")),
      lng: toNullNumber(get("lng")),

      tee_name,
      gender: get("gender") || null,
      tee_par: toNullInt(get("tee_par")),
      tee_yards: toNullInt(get("tee_yards")),
      rating: toNullNumber(get("rating")),
      slope: toNullInt(get("slope")),
      sort_order: toNullInt(get("sort_order")),

      hole_number,
      hole_par: toNullInt(get("hole_par")),
      hole_yardage: toNullInt(get("hole_yardage")),
      hole_handicap: toNullInt(get("hole_handicap")),
    });
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
      tees: Map<
        string,
        {
          tee_name: string;
          gender: string | null;
          tee_par: number | null;
          tee_yards: number | null;
          rating: number | null;
          slope: number | null;
          sort_order: number | null;
          holes: HoleRow[];
        }
      >;
    }
  >();

  for (const hr of rows) {
    const courseKey =
      hr.course_id?.trim()
        ? `id:${hr.course_id.trim()}`
        : `name:${normKey(hr.course_name, hr.city, hr.country)}`;

    if (!courses.has(courseKey)) {
      courses.set(courseKey, {
        course_id: hr.course_id?.trim() || null,
        course_name: hr.course_name,
        city: hr.city ?? null,
        country: hr.country ?? null,
        lat: hr.lat ?? null,
        lng: hr.lng ?? null,
        tees: new Map(),
      });
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
        holes: [],
      });
    }

    c.tees.get(teeKey)!.holes.push(hr);
  }

  let courseUpserts = 0;
  let teeBoxUpserts = 0;
  let holesDeleted = 0;
  let holesInserted = 0;

  const results: any[] = [];

  for (const [, c] of courses) {
    try {
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
            },
            { onConflict: "id" }
          );

        if (error) throw error;
        courseUpserts++;
      } else {
        // Admin-friendly matching: (name, city, country)
        // Stronger: create a unique index and use onConflict. For now we do: find-or-insert.
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
          // also update lat/lng if provided
          const { error: updErr } = await supabase
            .from("courses")
            .update({ lat: c.lat, lng: c.lng })
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
            },
            { onConflict: "course_id,name,gender" }
          )
          .select("id")
          .single();

        if (teeErr) throw teeErr;
        teeBoxUpserts++;

        const teeBoxId = teeBox.id;

        const { error: delErr, count } = await supabase
          .from("course_tee_box_holes")
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
          const { error: insErr } = await supabase.from("course_tee_box_holes").insert(holesToInsert);
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
