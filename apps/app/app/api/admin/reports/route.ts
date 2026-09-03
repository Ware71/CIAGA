// app/api/admin/reports/route.ts
//
// The moderation queue. feed_reports has been write-only since the schema was
// first pulled — reports went in and nothing ever read them back.
//
// Each row comes back hydrated with a preview of what was reported. Without it
// the queue is a list of uuids and nobody can act on anything.

import { NextResponse } from "next/server";
import { adminErrorStatus, requireAdminProfile } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["open", "reviewing", "actioned", "dismissed"] as const;
type Status = (typeof STATUSES)[number];

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(n, max));
}

/** A short, readable summary of a feed item for the queue. */
function describeFeedItem(row: any): string {
  const payload = row?.payload ?? {};
  if (row?.type === "user_post") {
    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    const photos = Array.isArray(payload.media)
      ? payload.media.length
      : Array.isArray(payload.image_urls)
        ? payload.image_urls.length
        : 0;
    if (text) return text.slice(0, 300);
    return photos > 0 ? `(${photos} photo${photos === 1 ? "" : "s"}, no caption)` : "(empty post)";
  }
  const course = payload?.course_name ? ` at ${payload.course_name}` : "";
  return `${String(row?.type ?? "activity").replace(/_/g, " ")}${course}`;
}

export async function GET(req: Request) {
  try {
    await requireAdminProfile(req);

    const url = new URL(req.url);
    const statusParam = url.searchParams.get("status");
    const status = STATUSES.includes(statusParam as Status) ? (statusParam as Status) : null;
    const limit = clampInt(url.searchParams.get("limit"), 50, 1, 100);

    let query = supabaseAdmin
      .from("feed_reports")
      .select(
        `id, reporter_profile_id, target_type, target_id, reason, reason_code,
         status, resolved_by, resolved_at, resolution_note, created_at,
         reporter:reporter_profile_id ( id, name, avatar_url )`,
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) throw error;

    const reports = (data ?? []) as any[];

    // Hydrate the targets in two batched reads rather than one per report.
    const feedItemIds = reports.filter((r) => r.target_type === "feed_item").map((r) => r.target_id);
    const commentIds = reports.filter((r) => r.target_type === "comment").map((r) => r.target_id);

    const [itemsRes, commentsRes] = await Promise.all([
      feedItemIds.length
        ? supabaseAdmin
            .from("feed_items")
            .select("id, type, payload, visibility, occurred_at, author:actor_profile_id ( id, name )")
            .in("id", feedItemIds)
        : Promise.resolve({ data: [], error: null }),
      commentIds.length
        ? supabaseAdmin
            .from("feed_comments")
            .select("id, body, visibility, created_at, feed_item_id, author:profile_id ( id, name )")
            .in("id", commentIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (itemsRes.error) throw itemsRes.error;
    if (commentsRes.error) throw commentsRes.error;

    const itemMap = new Map((itemsRes.data ?? []).map((r: any) => [r.id, r]));
    const commentMap = new Map((commentsRes.data ?? []).map((r: any) => [r.id, r]));

    // How many distinct people reported each target: the strongest triage
    // signal there is, and the reason we alert rather than auto-hide.
    const reportCounts = new Map<string, number>();
    for (const r of reports) {
      const key = `${r.target_type}:${r.target_id}`;
      reportCounts.set(key, (reportCounts.get(key) ?? 0) + 1);
    }

    const hydrated = reports.map((r) => {
      const target =
        r.target_type === "feed_item" ? itemMap.get(r.target_id) : commentMap.get(r.target_id);

      return {
        id: r.id,
        target_type: r.target_type,
        target_id: r.target_id,
        reason: r.reason,
        reason_code: r.reason_code,
        status: r.status,
        created_at: r.created_at,
        resolved_at: r.resolved_at,
        resolution_note: r.resolution_note,
        reporter: {
          profile_id: r.reporter?.id ?? r.reporter_profile_id,
          display_name: r.reporter?.name ?? "Someone",
        },
        report_count: reportCounts.get(`${r.target_type}:${r.target_id}`) ?? 1,
        target: target
          ? {
              exists: true,
              visibility: target.visibility,
              author: target.author?.name ?? "Unknown",
              author_profile_id: target.author?.id ?? null,
              preview:
                r.target_type === "feed_item"
                  ? describeFeedItem(target)
                  : String(target.body ?? "").slice(0, 300),
              /** Where an admin goes to see it in context. */
              href:
                r.target_type === "feed_item"
                  ? `/social/${r.target_id}`
                  : `/social/${target.feed_item_id}`,
            }
          : { exists: false },
      };
    });

    return NextResponse.json({ reports: hydrated }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    return NextResponse.json({ error: msg }, { status: adminErrorStatus(msg) });
  }
}
