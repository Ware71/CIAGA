// app/api/admin/moderation/route.ts
//
// The take-down endpoint. feed_items.visibility and feed_comments.visibility
// have been read on every feed query since the beginning and written by
// nothing — this is what finally writes them.
//
//   hide     out of the feed, still reachable by direct link
//   remove   gone from both
//   restore  back to visible
//
// Every call also writes a feed_moderation_actions row, and hide/remove close
// the open reports on that target.

import { NextResponse } from "next/server";
import { adminErrorStatus, requireAdminProfile } from "@/lib/auth/requireAdmin";
import { setContentVisibility } from "@/lib/feed/commands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = ["hide", "remove", "restore"] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(req: Request) {
  try {
    const { adminProfileId } = await requireAdminProfile(req);

    const body = (await req.json()) as {
      target_type?: "feed_item" | "comment";
      target_id?: string;
      action?: string;
      reason?: string;
      report_id?: string;
    };

    const targetType = body.target_type;
    const targetId = (body.target_id ?? "").trim();
    const action = body.action as Action | undefined;

    if (targetType !== "feed_item" && targetType !== "comment") {
      return NextResponse.json({ error: "Invalid target_type" }, { status: 400 });
    }
    if (!targetId) {
      return NextResponse.json({ error: "target_id required" }, { status: 400 });
    }
    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    await setContentVisibility({
      actorProfileId: adminProfileId,
      targetType,
      targetId,
      action,
      reason: body.reason?.slice(0, 500) ?? null,
      reportId: body.report_id ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    return NextResponse.json({ error: msg }, { status: adminErrorStatus(msg) });
  }
}
