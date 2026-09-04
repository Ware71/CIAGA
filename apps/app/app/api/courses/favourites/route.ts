import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";

export const runtime = "nodejs";

/**
 * The viewer's starred courses.
 *
 * RLS on course_favourites already restricts every row to its owner, so these
 * could be direct client writes. They go through a route because a favourite is
 * keyed on a `courses.id` the client may not have yet — a worldwide search
 * result is an OSM id and nothing more — and this is where that gap is closed
 * consistently rather than at each call site.
 */

type FavouriteRow = {
  course_id: string;
  created_at: string;
  courses: {
    id: string;
    osm_id: string | null;
    name: string | null;
    city: string | null;
    country: string | null;
    lat: number | null;
    lng: number | null;
  } | null;
};

/** GET — the viewer's favourites, with enough course detail to render a row. */
export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);

    const { data, error } = await supabaseAdmin
      .from("course_favourites")
      .select(
        "course_id, created_at, courses:courses!course_id(id, osm_id, name, city, country, lat, lng)"
      )
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const items = ((data ?? []) as unknown as FavouriteRow[])
      .filter((row) => !!row.courses)
      .map((row) => ({
        course_id: row.course_id,
        osm_id: row.courses!.osm_id,
        name: row.courses!.name,
        city: row.courses!.city,
        country: row.courses!.country,
        lat: row.courses!.lat,
        lng: row.courses!.lng,
        created_at: row.created_at,
      }));

    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unauthorised" }, { status: 401 });
  }
}

/**
 * POST — star a course. Body: { course_id }
 *
 * Idempotent: starring twice is a no-op rather than a duplicate-key error, so a
 * double-tap doesn't surface as a failure.
 */
export async function POST(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const body = await req.json().catch(() => ({}));
    const courseId = body?.course_id as string | undefined;

    if (!courseId) {
      return NextResponse.json({ error: "course_id required" }, { status: 400 });
    }

    // Fail loudly on an unknown course rather than letting the FK error
    // surface as an opaque 500 — a worldwide hit that was never resolved is
    // the likely cause and the caller can act on that.
    const { data: course } = await supabaseAdmin
      .from("courses")
      .select("id")
      .eq("id", courseId)
      .maybeSingle();

    if (!course) {
      return NextResponse.json({ error: "Unknown course" }, { status: 404 });
    }

    const { error } = await supabaseAdmin
      .from("course_favourites")
      .upsert({ profile_id: profileId, course_id: courseId }, { onConflict: "profile_id,course_id" });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unauthorised" }, { status: 401 });
  }
}

/** DELETE /api/courses/favourites?course_id=… — unstar. Also idempotent. */
export async function DELETE(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const courseId = new URL(req.url).searchParams.get("course_id");

    if (!courseId) {
      return NextResponse.json({ error: "course_id required" }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from("course_favourites")
      .delete()
      .eq("profile_id", profileId)
      .eq("course_id", courseId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unauthorised" }, { status: 401 });
  }
}
