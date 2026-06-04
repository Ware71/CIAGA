import { NextResponse } from "next/server";
import { getAuthedProfileOrThrow } from "@/lib/auth/getAuthedProfile";
import { getMajorSchedule } from "@/lib/majors/queries";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { profileId } = await getAuthedProfileOrThrow(req);
    const url = new URL(req.url);

    const statusParam = url.searchParams.get("status");
    const status = statusParam ? statusParam.split(",") : undefined;

    const groupIdsParam = url.searchParams.get("group_ids");
    const groupIds = groupIdsParam ? groupIdsParam.split(",") : undefined;

    const data = await getMajorSchedule(profileId, { status, groupIds });
    return NextResponse.json({ items: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    const status = String(msg).toLowerCase().includes("auth") ? 401 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
