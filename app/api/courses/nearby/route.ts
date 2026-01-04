import { NextRequest, NextResponse } from "next/server";

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isProbablyNotAGolfCourse(tags: Record<string, string>) {
  // Optional: filter out obvious non-courses that sometimes appear
  const tourism = (tags.tourism ?? "").toLowerCase();
  const amenity = (tags.amenity ?? "").toLowerCase();
  if (tourism === "hotel") return true;
  if (amenity === "hotel") return true;
  return false;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const radius = Number(searchParams.get("radius") ?? "15000");

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Invalid lat/lng" }, { status: 400 });
  }

  const query = `
    [out:json][timeout:25];
    (
      node(around:${radius},${lat},${lng})["leisure"="golf_course"];
      way(around:${radius},${lat},${lng})["leisure"="golf_course"];
      relation(around:${radius},${lat},${lng})["leisure"="golf_course"];
    );
    out center tags qt;
  `;

  const overpassUrls = [
    "https://overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
  ];

  async function postOverpass(url: string) {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "Accept": "application/json",
        "User-Agent": process.env.OVERPASS_USER_AGENT ?? "CIAGA/1.0 (contact: dev@ciaga.app)",
      },
      body: new URLSearchParams({ data: query }).toString(),
      cache: "no-store",
    });
  }

  let response: Response | null = null;
  let lastError = "";

  for (const url of overpassUrls) {
    try {
      const res = await postOverpass(url);
      if (res.ok) {
        response = res;
        break;
      }
      const text = await res.text();
      lastError = `${url} → ${res.status}: ${text.slice(0, 250)}`;
      if ([429, 502, 503, 504].includes(res.status)) continue;
    } catch (e: any) {
      lastError = `${url} failed: ${e?.message ?? "unknown error"}`;
    }
  }

  if (!response) {
    return NextResponse.json({ error: "Overpass error", detail: lastError }, { status: 502 });
  }

  const json = (await response.json()) as { elements?: OverpassElement[] };
  const elements = Array.isArray(json.elements) ? json.elements : [];

  const items = elements
    .map((el) => {
      const lat0 = el.lat ?? el.center?.lat;
      const lng0 = el.lon ?? el.center?.lon;
      if (!Number.isFinite(lat0) || !Number.isFinite(lng0)) return null;

      const tags = el.tags ?? {};
      if (isProbablyNotAGolfCourse(tags)) return null;

      const distance_m = haversineMeters(lat, lng, lat0!, lng0!);

      return {
        id: `${el.type}/${el.id}`,
        name: tags.name ?? "Unnamed Golf Course",
        lat: lat0!,
        lng: lng0!,
        distance_m,
        website: tags.website ?? tags["contact:website"] ?? null,
        phone: tags.phone ?? tags["contact:phone"] ?? null,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => a.distance_m - b.distance_m);

  return NextResponse.json({ items });
}
