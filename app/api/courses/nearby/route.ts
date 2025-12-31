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
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const lat = Number(searchParams.get("lat"));
  const lng = Number(searchParams.get("lng"));
  const radius = Number(searchParams.get("radius") ?? "15000");

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Missing/invalid lat,lng" }, { status: 400 });
  }

  const r = Math.min(Math.max(radius, 500), 50000);

  const query = `
    [out:json][timeout:15];
    (
      node(around:${r},${lat},${lng})["leisure"="golf_course"];
      way(around:${r},${lat},${lng})["leisure"="golf_course"];
      relation(around:${r},${lat},${lng})["leisure"="golf_course"];
    );
    out center tags;
  `;

  const overpassUrl = "https://overpass-api.de/api/interpreter";
  const res = await fetch(overpassUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ data: query }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: "Overpass error", status: res.status, body: text.slice(0, 400) },
      { status: 502 }
    );
  }

  const json = (await res.json()) as { elements: OverpassElement[] };

  const items = (json.elements ?? [])
    .map((el) => {
      const p =
        el.type === "node"
          ? { lat: el.lat!, lon: el.lon! }
          : { lat: el.center?.lat, lon: el.center?.lon };

      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;

      const name = el.tags?.name ?? "Unnamed course";
      const distance_m = haversineMeters(lat, lng, p.lat!, p.lon!);

      return {
        id: `${el.type}/${el.id}`, // OSM ID
        name,
        lat: p.lat!,
        lng: p.lon!,
        distance_m,
        website: el.tags?.website ?? el.tags?.["contact:website"] ?? null,
        phone: el.tags?.phone ?? el.tags?.["contact:phone"] ?? null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a!.distance_m - b!.distance_m))
    .slice(0, 50);

  return NextResponse.json({ count: items.length, items });
}
