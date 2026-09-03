// app/api/admin/reports/[id]/route.ts
//
// Move one report through its lifecycle without touching the content —
// "reviewing" while an admin looks into it, "dismissed" when there's nothing to
// answer for. Taking the content down goes through /api/admin/moderation, which
// closes the reports itself.

import { NextResponse } from "next/server";
import { adminErrorStatus, requireAdminProfile } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["open", "reviewing", "actioned", "dismissed"] as const;
type Status = (typeof STATUSES)[number];

/** Statuses that end a report's life, and so get stamped with who and when. */
const TERMINAL: Status[] = ["actioned", "dismissed"];

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { adminProfileId } = await requireAdminProfile(req);
    const { id } = await ctx.params;

    const body = (await req.json()) as { status?: string; resolution_note?: string };
    const status = body.status as Status | undefined;

    if (!status || !STATUSES.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const isTerminal = TERMINAL.includes(status);

    const { error } = await supabaseAdmin
      .from("feed_reports")
      .update({
        status,
        resolution_note: body.resolution_note?.slice(0, 500) ?? null,
        resolved_by: isTerminal ? adminProfileId : null,
        resolved_at: isTerminal ? new Date().toISOString() : null,
      })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    return NextResponse.json({ error: msg }, { status: adminErrorStatus(msg) });
  }
}
