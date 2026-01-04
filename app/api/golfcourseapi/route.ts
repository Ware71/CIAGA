import { NextRequest, NextResponse } from "next/server";

const BASE_URL =
  process.env.GOLFCOURSE_API_BASE ?? "https://api.golfcourseapi.com";

const API_KEY = process.env.GOLFCOURSE_API_KEY;

if (!API_KEY) {
  console.warn("⚠️ GOLFCOURSE_API_KEY is not set");
}

function isSafePath(path: string) {
  return path.startsWith("/") && !path.includes("..") && !path.includes("//");
}

async function handler(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const path = url.searchParams.get("path");

    if (!path || !isSafePath(path)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    // Build upstream URL and forward ALL params except `path`
    const upstreamUrl = new URL(`${BASE_URL}${path}`);
    for (const [key, value] of url.searchParams.entries()) {
      if (key === "path") continue;
      upstreamUrl.searchParams.append(key, value);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      // Try common auth header styles; upstream will use what it expects
      Authorization: `Key ${API_KEY}`,
      "x-api-key": API_KEY ?? "",
    };

    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
    };

    if (req.method !== "GET" && req.method !== "HEAD") {
      fetchOptions.body = await req.text();
    }

    const upstream = await fetch(upstreamUrl.toString(), fetchOptions);
    const text = await upstream.text();

    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Proxy error" },
      { status: 500 }
    );
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
