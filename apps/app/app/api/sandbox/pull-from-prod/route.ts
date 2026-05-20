import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getProductionReaderClient } from "@/lib/supabaseProductionReader";
import type { SupabaseClient } from "@supabase/supabase-js";

async function readAllRows(client: SupabaseClient, table: string): Promise<any[]> {
  const rows: any[] = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed reading ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function insertRows(
  client: SupabaseClient,
  table: string,
  rows: any[],
  transform?: (row: any) => any
): Promise<number> {
  if (rows.length === 0) return 0;
  const prepared = transform ? rows.map(transform) : rows;
  const chunkSize = 500;
  for (let i = 0; i < prepared.length; i += chunkSize) {
    const chunk = prepared.slice(i, i + chunkSize);
    const { error } = await client.from(table).insert(chunk);
    if (error) throw new Error(`Failed inserting into ${table}: ${error.message}`);
  }
  return prepared.length;
}

// Tables in FK-safe insertion order (dependencies before dependents)
const TABLE_PLAN: Array<{ table: string; transform?: (row: any) => any }> = [
  { table: "courses" },
  { table: "course_tee_boxes" },
  { table: "course_tee_holes" },
  // Null out owner_user_id — auth.users from prod don't exist in staging.
  // The impersonation feature creates sandbox auth users on demand.
  { table: "profiles", transform: (row) => ({ ...row, owner_user_id: null }) },
  { table: "rounds" },
  { table: "round_participants" },
  { table: "round_hole_states" },
  { table: "round_score_events" },
  { table: "round_course_snapshots" },
  { table: "round_tee_snapshots" },
  { table: "round_hole_snapshots" },
  { table: "round_teams" },
  { table: "round_format_results" },
  { table: "round_sidegame_results" },
  { table: "follows" },
  { table: "feed_items" },
  { table: "feed_comments" },
  { table: "feed_reactions" },
  { table: "feed_reports" },
  { table: "feed_item_subjects" },
  { table: "feed_item_targets" },
  { table: "feed_comment_votes" },
  { table: "invites" },
  { table: "handicap_index_history" },
  { table: "handicap_round_results" },
  { table: "competitions" },
  { table: "competition_entries" },
  { table: "competition_tee_times" },
  { table: "competition_rounds" },
  { table: "competition_round_submissions" },
  { table: "competition_leaderboard_entries" },
  { table: "competition_audit_log" },
  { table: "competition_extras" },
  { table: "competition_waitlist" },
  { table: "major_groups" },
  { table: "major_group_memberships" },
  { table: "major_group_standings" },
  { table: "competition_series" },
  { table: "series_event_templates" },
  { table: "series_seasons" },
  { table: "season_standings_entries" },
  { table: "matchplay_stages" },
  { table: "matchplay_fixtures" },
  { table: "matchplay_bracket_slots" },
  { table: "matchplay_league_table_entries" },
  { table: "event_history_summaries" },
  { table: "profile_competition_stats" },
  { table: "user_notifications" },
];

export async function POST(req: Request) {
  if (process.env.NEXT_PUBLIC_APP_ENV !== "sandbox") {
    return NextResponse.json({ error: "Not available" }, { status: 403 });
  }

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let prodClient: SupabaseClient;
  try {
    prodClient = getProductionReaderClient();
  } catch (e: any) {
    return NextResponse.json(
      { error: `Production credentials not configured: ${e.message}` },
      { status: 500 }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) => {
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };

      try {
        // Phase 1: read all tables from production
        const snapshot: Record<string, any[]> = {};
        for (const { table } of TABLE_PLAN) {
          const rows = await readAllRows(prodClient, table);
          snapshot[table] = rows;
          send({ type: "read", table, rows: rows.length });
        }

        // Phase 2: wipe staging
        const { error: resetError } = await supabaseAdmin.rpc("sandbox_full_reset_database");
        if (resetError) throw new Error(`Reset failed: ${resetError.message}`);
        send({ type: "wipe" });

        // Phase 3: write production data into staging
        let totalRows = 0;
        let tablesCopied = 0;
        for (const { table, transform } of TABLE_PLAN) {
          const count = await insertRows(supabaseAdmin as any, table, snapshot[table], transform);
          totalRows += count;
          if (count > 0) tablesCopied++;
          send({ type: "write", table, rows: count });
        }

        send({ type: "done", tablesCopied, rowsCopied: totalRows });
      } catch (e: any) {
        send({ type: "error", message: e?.message ?? "Server error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
