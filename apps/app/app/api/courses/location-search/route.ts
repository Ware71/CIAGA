// /app/api/courses/location-search/route.ts
// General-purpose Nominatim location search (not filtered to golf courses).
// Used by the worldwide tab to find a location, then search for nearby courses.

import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const q = (searchParams.get("q") ?? "").trim();
  const limit = Math.min(20, Math.max(1, Number(searchParams.get("limit")) || 8));

  if (!q) return NextResponse.json({ items: [] });

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("addressdetails", "1");

  const ua =
    process.env.NOMINATIM_USER_AGENT ?? "CIAGA/1.0 (contact: dev@ciaga.app)";

  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": ua, "Accept-Language": "en" },
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Nominatim ${res.status}: ${text.slice(0, 200)}`);
    }

    const raw = (await res.json()) as Array<{
      place_id: number;
      display_name: string;
      lat: string;
      lon: string;
      type?: string;
      class?: string;
      address?: {
        city?: string;
        town?: string;
        village?: string;
        county?: string;
        state?: string;
        country?: string;
      };
    }>;

    const items = raw.map((r) => ({
      place_id: r.place_id,
      display_name: r.display_name,
      lat: Number(r.lat),
      lng: Number(r.lon),
      type: r.type ?? null,
      class: r.class ?? null,
      city:
        r.address?.city ||
        r.address?.town ||
        r.address?.village ||
        r.address?.county ||
        r.address?.state ||
        null,
      country: r.address?.country ?? null,
    }));

    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Location search failed" },
      { status: 502 }
    );
  }
}
