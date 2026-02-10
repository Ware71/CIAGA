// /app/api/courses/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type NominatimResult = {
  place_id: number;
  osm_type: "node" | "way" | "relation";
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;

  namedetails?: { name?: string };
  extratags?: Record<string, string>;

  address?: {
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    country?: string;
    postcode?: string;
  };

  type?: string;
  class?: string;
  importance?: number;
};

type DbCourseRow = {
  id: string; // uuid
  osm_id: string; // way/123 etc
  name: string | null;
  name_original: string | null;
  lat: number | null;
  lng: number | null;
  city: string | null;
  country: string | null;
  address: string | null;
  source: string | null;
};

function pickCity(a?: NominatimResult["address"]) {
  return a?.city || a?.town || a?.village || a?.county || a?.state || null;
}

function toRad(x: number) {
  return (x * Math.PI) / 180;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function normalize(s: string) {
  return (s ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nameFromResult(r: NominatimResult) {
  return (
    r.namedetails?.name ||
    r.extratags?.name ||
    (r.display_name ? r.display_name.split(",")[0].trim() : "Unknown course")
  );
}

function isStrictGolfCourse(r: NominatimResult) {
  return r.class === "leisure" && r.type === "golf_course";
}

function isSportGolf(r: NominatimResult) {
  const sport = (r.extratags?.sport ?? "").toLowerCase();
  return sport === "golf";
}

function looksLikeGolfCourseByName(name: string) {
  const n = normalize(name);
  return (
    n.includes("golf") ||
    n.includes("links") ||
    n.endsWith(" gc") ||
    n.includes(" golf club") ||
    n.includes(" golf course")
  );
}

function golfSignalScore(r: NominatimResult) {
  const strict = isStrictGolfCourse(r);
  const sportGolf = isSportGolf(r);
  const nameHasGolf = (r.display_name ?? "").toLowerCase().includes("golf");
  return (strict ? 3 : 0) + (sportGolf ? 2 : 0) + (nameHasGolf ? 1 : 0);
}

async function nominatimSearch(args: {
  q: string;
  limit: number;
  hasNear: boolean;
  nearLat: number;
  nearLng: number;
}) {
  const { q, limit, hasNear, nearLat, nearLng } = args;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("namedetails", "1");
  url.searchParams.set("extratags", "1");

  if (hasNear) {
    const delta = 2.0;
    url.searchParams.set(
      "viewbox",
      `${nearLng - delta},${nearLat + delta},${nearLng + delta},${nearLat - delta}`
    );
    url.searchParams.set("bounded", "0");
  }

  const ua = process.env.NOMINATIM_USER_AGENT ?? "CIAGA/1.0 (contact: dev@ciaga.app)";

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": ua,
      "Accept-Language": "en",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Nominatim error ${res.status}: ${text.slice(0, 200)}`);
  }

  return (await res.json()) as NominatimResult[];
}

// ✅ NON-FATAL DB SEARCH (never throws)
async function dbSearchCourses(qRaw: string, limit: number) {
  const q = qRaw.trim();
  if (!q) return [] as DbCourseRow[];

  try {
    // Your schema shows `public.courses` (lowercase).
    const { data, error } = await supabaseAdmin
      .from("courses")
      .select("id,osm_id,name,name_original,lat,lng,city,country,address,source")
      .or(`name.ilike.%${q}%,name_original.ilike.%${q}%`)
      .limit(limit);

    if (error) {
      console.warn("[courses/search] dbSearchCourses non-fatal:", error.message);
      return [] as DbCourseRow[];
    }

    return (data ?? []) as DbCourseRow[];
  } catch (e: any) {
    console.warn("[courses/search] dbSearchCourses crashed non-fatal:", e?.message ?? e);
    return [] as DbCourseRow[];
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const qRaw = (searchParams.get("q") ?? "").trim();
  const limitRaw = (searchParams.get("limit") ?? "").trim();

  const nearLatRaw = (searchParams.get("nearLat") ?? "").trim();
  const nearLngRaw = (searchParams.get("nearLng") ?? "").trim();
  const nearLat = Number(nearLatRaw);
  const nearLng = Number(nearLngRaw);
  const hasNear = Number.isFinite(nearLat) && Number.isFinite(nearLng);

  const limit = Math.min(50, Math.max(1, Number(limitRaw) || 25));
  if (!qRaw) return NextResponse.json({ items: [] });

  const qNorm = normalize(qRaw);
  const qLen = qNorm.length;
  const qGolf = qRaw.toLowerCase().includes("golf") ? qRaw : `${qRaw} golf course`;

  try {
    // ✅ Nominatim is primary. DB is best-effort in parallel.
    const [a, b, dbRows] = await Promise.all([
      nominatimSearch({ q: qRaw, limit, hasNear, nearLat, nearLng }),
      qGolf !== qRaw
        ? nominatimSearch({ q: qGolf, limit, hasNear, nearLat, nearLng })
        : Promise.resolve([] as NominatimResult[]),
      dbSearchCourses(qRaw, limit), // never throws
    ]);

    // --- Nominatim merge + de-dupe ---
    const byId = new Map<string, NominatimResult>();

    function prefer(left: NominatimResult, right: NominatimResult) {
      const gsL = golfSignalScore(left);
      const gsR = golfSignalScore(right);
      if (gsR !== gsL) return gsR > gsL ? right : left;

      const impL = left.importance ?? 0;
      const impR = right.importance ?? 0;
      if (impR !== impL) return impR > impL ? right : left;

      return left;
    }

    for (const r of [...a, ...b]) {
      const id = `${r.osm_type}/${r.osm_id}`;
      const existing = byId.get(id);
      byId.set(id, existing ? prefer(existing, r) : r);
    }

    const merged = Array.from(byId.values());

    // --- Tighten to golf-only (your existing logic) ---
    const tightened = merged.filter((r) => {
      if (isStrictGolfCourse(r)) return true;

      const name = nameFromResult(r);
      const nameNorm = normalize(name);

      const exact = qLen > 0 && nameNorm === qNorm;
      const starts = qLen > 0 && nameNorm.startsWith(qNorm);
      const contains = qLen > 0 && nameNorm.includes(qNorm);

      const sportGolf = isSportGolf(r);
      const nameGolfy = looksLikeGolfCourseByName(name);

      if (sportGolf) {
        if (exact || starts) return true;
        if (qLen >= 6 && contains && nameGolfy) return true;
        return false;
      }

      if (qLen >= 6 && (exact || starts) && nameGolfy) return true;
      return false;
    });

    // --- Convert Nominatim results to output items ---
    const nomItems = tightened.map((r) => {
      const id = `${r.osm_type}/${r.osm_id}`;
      const lat = Number(r.lat);
      const lng = Number(r.lon);

      const name = nameFromResult(r);

      const city = pickCity(r.address);
      const country = r.address?.country ?? null;
      const postcode = r.address?.postcode ?? null;

      const subtitle = [city, country].filter(Boolean).join(" · ") || r.display_name || "";

      const distance_m =
        hasNear && Number.isFinite(lat) && Number.isFinite(lng)
          ? haversineMeters(nearLat, nearLng, lat, lng)
          : 0;

      const nameNorm = normalize(name);
      const isExact = qNorm.length > 0 && nameNorm === qNorm;
      const isStarts = qNorm.length > 0 && nameNorm.startsWith(qNorm);

      return {
        id,
        name,
        lat,
        lng,
        distance_m,
        website: r.extratags?.website ?? null,
        phone: r.extratags?.phone ?? null,
        subtitle,
        city,
        county: r.address?.county ?? null,
        country,
        postcode,
        importance: r.importance ?? 0,
        _golfScore: golfSignalScore(r),
        _exact: isExact ? 1 : 0,
        _starts: isStarts ? 1 : 0,
      };
    });

    // --- Convert DB rows to items + append (de-dupe by osm_id) ---
    const dbItems = dbRows
      .filter((r) => !!r.osm_id && Number.isFinite(r.lat ?? NaN) && Number.isFinite(r.lng ?? NaN))
      .map((r) => {
        const name = (r.name ?? r.name_original ?? "Unknown course").trim();
        const lat = r.lat as number;
        const lng = r.lng as number;

        const subtitle =
          [r.city, r.country].filter(Boolean).join(" · ") || r.address || "";

        const distance_m = hasNear ? haversineMeters(nearLat, nearLng, lat, lng) : 0;

        const nameNorm = normalize(name);
        const isExact = qNorm.length > 0 && nameNorm === qNorm;
        const isStarts = qNorm.length > 0 && nameNorm.startsWith(qNorm);

        return {
          id: r.osm_id, // IMPORTANT: de-dupe compatible with Nominatim ids (way/123)
          name,
          lat,
          lng,
          distance_m,
          website: null,
          phone: null,
          subtitle,
          city: r.city ?? null,
          county: null,
          country: r.country ?? null,
          postcode: null,
          importance: 0,
          _golfScore: 999, // small boost so DB wins ties; tweak/remove if you want
          _exact: isExact ? 1 : 0,
          _starts: isStarts ? 1 : 0,
        };
      });

    // Append + de-dupe by `id` (osm id). Prefer DB when collision.
    const byOutId = new Map<string, any>();
    for (const it of nomItems) byOutId.set(it.id, it);
    for (const it of dbItems) byOutId.set(it.id, it); // DB overwrites OSM

    const items = Array.from(byOutId.values());

    // Rank (your same ordering; DB will naturally bubble up if exact/starts matches)
    items.sort((x, y) => {
      if (y._exact !== x._exact) return y._exact - x._exact;
      if (y._starts !== x._starts) return y._starts - x._starts;

      if ((y._golfScore ?? 0) !== (x._golfScore ?? 0))
        return (y._golfScore ?? 0) - (x._golfScore ?? 0);

      if (hasNear) {
        const dx = x.distance_m ?? 0;
        const dy = y.distance_m ?? 0;
        if (dx !== dy) return dx - dy;
      }

      const ix = x.importance ?? 0;
      const iy = y.importance ?? 0;
      if (iy !== ix) return iy - ix;

      return String(x.name).localeCompare(String(y.name));
    });

    // strip private ranking fields
    const out = items.slice(0, limit).map((x) => {
      const { _golfScore, _exact, _starts, importance, ...rest } = x as any;
      return rest;
    });

    return NextResponse.json({ items: out });
  } catch (e: any) {
    // Only Nominatim failures (or unexpected errors) land here now.
    return NextResponse.json({ error: e?.message ?? "Search failed" }, { status: 502 });
  }
}
