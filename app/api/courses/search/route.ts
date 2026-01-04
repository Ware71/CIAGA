import { NextRequest, NextResponse } from "next/server";

type NominatimResult = {
  place_id: number;
  osm_type: "node" | "way" | "relation";
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;

  // when namedetails=1
  namedetails?: { name?: string };

  // when extratags=1
  extratags?: Record<string, string>;

  // only when addressdetails=1
  address?: {
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    country?: string;
  };

  type?: string;
  class?: string;
  importance?: number;
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

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const qRaw = (searchParams.get("q") ?? "").trim();
  const limitRaw = (searchParams.get("limit") ?? "").trim();

  // Optional bias point (user location) to sort/bias worldwide results
  const nearLatRaw = (searchParams.get("nearLat") ?? "").trim();
  const nearLngRaw = (searchParams.get("nearLng") ?? "").trim();
  const nearLat = Number(nearLatRaw);
  const nearLng = Number(nearLngRaw);
  const hasNear = Number.isFinite(nearLat) && Number.isFinite(nearLng);

  const limit = Math.min(50, Math.max(1, Number(limitRaw) || 25));

  if (!qRaw) return NextResponse.json({ items: [] });

  // Bias toward golf courses while still allowing "Augusta National" etc.
  const q = qRaw.toLowerCase().includes("golf") ? qRaw : `${qRaw} golf course`;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("namedetails", "1"); // better name extraction
  url.searchParams.set("extratags", "1");   // website/phone/sport tags etc.

  // If we have a nearby point, bias results to a viewbox (NOT a hard filter)
  if (hasNear) {
    const delta = 2.0; // degrees-ish bias window
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
    const text = await res.text();
    return NextResponse.json(
      { error: "Nominatim error", status: res.status, body: text.slice(0, 300) },
      { status: 502 }
    );
  }

  const data = (await res.json()) as NominatimResult[];

  // Keep golf-ish results but don’t be overly strict (worldwide is messy)
  const filtered = data.filter((r) => {
    const isStrict = r.class === "leisure" && r.type === "golf_course";
    const sport = (r.extratags?.sport ?? "").toLowerCase();
    const isTaggedGolf = sport === "golf";
    const nameHasGolf = (r.display_name ?? "").toLowerCase().includes("golf");
    return isStrict || isTaggedGolf || nameHasGolf;
  });

  const items = filtered.map((r) => {
    const id = `${r.osm_type}/${r.osm_id}`;
    const lat = Number(r.lat);
    const lng = Number(r.lon);

    // Prefer namedetails/extratags name, else first part of display_name
    const name =
      r.namedetails?.name ||
      r.extratags?.name ||
      (r.display_name ? r.display_name.split(",")[0].trim() : "Unknown course");

    const city = pickCity(r.address);
    const country = r.address?.country ?? null;
    const subtitle = [city, country].filter(Boolean).join(" · ") || r.display_name;

    const distance_m =
      hasNear && Number.isFinite(lat) && Number.isFinite(lng)
        ? haversineMeters(nearLat, nearLng, lat, lng)
        : 0;

    return {
      id,
      name,
      lat,
      lng,
      distance_m,
      website: r.extratags?.website ?? null,
      phone: r.extratags?.phone ?? null,
      subtitle,
      importance: r.importance ?? 0,
    };
  });

  // Sort: distance first if we have near point, else importance
  items.sort((a, b) => {
    if (hasNear) return (a.distance_m ?? 0) - (b.distance_m ?? 0);
    return (b.importance ?? 0) - (a.importance ?? 0);
  });

  return NextResponse.json({ items });
}
