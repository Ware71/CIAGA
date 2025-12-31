import { NextRequest, NextResponse } from "next/server";

type NominatimResult = {
  place_id: number;
  osm_type: "node" | "way" | "relation";
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  name?: string;

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
};

function pickCity(a?: NominatimResult["address"]) {
  return a?.city || a?.town || a?.village || a?.county || a?.state || null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const qRaw = (searchParams.get("q") ?? "").trim();
  const limitRaw = (searchParams.get("limit") ?? "").trim();

  const limit = Math.min(50, Math.max(1, Number(limitRaw) || 12));

  if (!qRaw) {
    return NextResponse.json({ items: [] });
  }

  // Bias toward golf courses while still allowing "Augusta National" etc.
  const q = qRaw.toLowerCase().includes("golf") ? qRaw : `${qRaw} golf course`;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("addressdetails", "1"); // ✅ lets us extract city/country

  // Identify your app. In production this should be a real contact.
  const ua = process.env.NOMINATIM_USER_AGENT ?? "CIAGA/1.0 (contact: dev@ciaga.app)";

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": ua,
      "Accept-Language": "en",
    },
    // Nominatim prefers caching; but for dev keep it fresh
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

  const items = data.map((r) => {
    const id = `${r.osm_type}/${r.osm_id}`;
    const lat = Number(r.lat);
    const lng = Number(r.lon);

    // Short name: prefer explicit name, otherwise first part of display_name
    const name = r.name || (r.display_name ? r.display_name.split(",")[0].trim() : "Unknown course");

    const city = pickCity(r.address);
    const country = r.address?.country ?? null;
    const subtitle = [city, country].filter(Boolean).join(" · ") || r.display_name;

    return {
      id,
      name,
      lat,
      lng,

      // Keep client types consistent
      distance_m: 0,
      website: null,
      phone: null,

      // extra info for UI (optional)
      subtitle,
    };
  });

  return NextResponse.json({ items });
}
