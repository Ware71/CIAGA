import { NextResponse } from "next/server";

const GOLF_BASE = process.env.GOLFCOURSE_API_BASE ?? "https://api.golfcourseapi.com";
const GOLF_KEY = process.env.GOLFCOURSE_API_KEY!;

export async function GET() {
  // Use a very generic query that should return something if auth works
  const url = `${GOLF_BASE}/v1/courses/search?name=${encodeURIComponent("golf")}`;

  // Try multiple header styles in one request by sending the most common ones
  const res = await fetch(url, {
    headers: {
      // common API key header variants
      "x-api-key": GOLF_KEY,
      "X-API-Key": GOLF_KEY,
      "apikey": GOLF_KEY,
      "api-key": GOLF_KEY,

      // some providers use Authorization instead
      Authorization: `Bearer ${GOLF_KEY}`,

      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await res.text();

  return NextResponse.json({
    url,
    status: res.status,
    ok: res.ok,
    body_preview: text.slice(0, 500),
  });
}
