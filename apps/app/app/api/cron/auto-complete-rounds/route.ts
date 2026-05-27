import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { finishRound } from "@/lib/rounds/finishRound";
import { reconcileCompetitionStatus } from "@/lib/majors/reconcileStatus";

export const runtime = "nodejs";

/**
 * GET /api/cron/auto-complete-rounds
 *
 * Called by Vercel Cron every 15 minutes. Finds all live rounds whose
 * auto-complete threshold has elapsed and marks them finished.
 *
 * Threshold = 1h when all holes are done, scaling to 24h when no holes
 * have been scored. See ciaga_get_rounds_for_auto_complete() for the SQL.
 *
 * Secured with CRON_SECRET — Vercel automatically sends
 * "Authorization: Bearer <CRON_SECRET>" for cron invocations.
 * Set CRON_SECRET in Vercel dashboard → Settings → Environment Variables.
 */
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[auto-complete-rounds] CRON_SECRET env var is not set");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  if (req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: rounds, error } = await supabaseAdmin.rpc(
    "ciaga_get_rounds_for_auto_complete"
  );

  if (error) {
    console.error("[auto-complete-rounds] RPC error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results: { round_id: string; status: "ok" | "error"; error?: string }[] = [];

  if (rounds?.length) {
    // Process sequentially — parallel writes risk saturating the Supabase
    // connection pool when many rounds complete in the same window.
    for (const row of rounds as {
      round_id: string;
      owner_profile_id: string;
    }[]) {
      try {
        await finishRound({
          roundId: row.round_id,
          actorProfileId: row.owner_profile_id,
        });
        results.push({ round_id: row.round_id, status: "ok" });
      } catch (e: any) {
        console.error(
          `[auto-complete-rounds] failed to finish round ${row.round_id}:`,
          e?.message
        );
        results.push({ round_id: row.round_id, status: "error", error: e?.message });
      }
    }

    const completed = results.filter((r) => r.status === "ok").length;
    console.log(
      `[auto-complete-rounds] processed ${rounds.length} candidate(s), completed ${completed}`
    );
  }

  // Sweep stale live competitions whose date has passed.
  // This always runs (even when no rounds needed finishing) to handle the
  // day-after scenario: a competition that finished on its competition_date
  // will have been set to 'live' (daysDiff = 0 during the day). Now that it's
  // the next morning, reconcile pushes them to 'completed'.
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const { data: staleComps } = await supabaseAdmin
    .from("competitions")
    .select("id")
    .eq("majors_status", "live")
    .lt("competition_date", today);

  if (staleComps?.length) {
    for (const comp of staleComps) {
      await reconcileCompetitionStatus(comp.id).catch(() => {});
    }
    console.log(
      `[auto-complete-rounds] reconciled ${staleComps.length} stale live competition(s)`
    );
  }

  const completed = results.filter((r) => r.status === "ok").length;
  return NextResponse.json({ ok: true, completed, results });
}
