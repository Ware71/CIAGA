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
    if (error) {
      // Preserve the original Supabase error code so callers can distinguish
      // "table not found" (42P01) from real network/permission errors.
      throw Object.assign(new Error(error.message), { code: error.code });
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function isFKViolation(error: any): boolean {
  return (
    error?.code === "23503" ||
    (error?.message ?? "").toLowerCase().includes("violates foreign key constraint")
  );
}

async function insertRows(
  client: SupabaseClient,
  table: string,
  rows: any[],
  transform?: (row: any) => any,
  onConflict: string = "id"
): Promise<{ inserted: number; skipped: number }> {
  if (rows.length === 0) return { inserted: 0, skipped: 0 };
  const prepared = transform ? rows.map(transform) : rows;
  const chunkSize = 500;
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < prepared.length; i += chunkSize) {
    const chunk = prepared.slice(i, i + chunkSize);
    // Upsert so trigger-created rows (e.g. round_hole_states created when rounds
    // are inserted) get overwritten with production data rather than causing
    // duplicate key violations.
    const { error } = await client.from(table).upsert(chunk, { onConflict });
    if (!error) {
      inserted += chunk.length;
    } else if (isFKViolation(error)) {
      // Chunk contains orphaned rows — fall back to row-by-row and skip bad rows
      for (const row of chunk) {
        const { error: rowErr } = await client.from(table).upsert(row, { onConflict });
        if (!rowErr) {
          inserted++;
        } else if (isFKViolation(rowErr)) {
          skipped++;
        } else {
          throw Object.assign(new Error(rowErr.message), { code: rowErr.code });
        }
      }
    } else {
      throw Object.assign(new Error(error.message), { code: error.code });
    }
  }

  return { inserted, skipped };
}

function isTableNotFound(e: any): boolean {
  const msg = (e?.message ?? "").toLowerCase();
  return (
    e?.code === "42P01" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

// Tables in FK-safe insertion order (dependencies before dependents)
const TABLE_PLAN: Array<{ table: string; transform?: (row: any) => any; onConflict?: string }> = [
  { table: "courses" },
  { table: "course_tee_boxes" },
  { table: "course_tee_holes" },
  // Null out owner_user_id — auth.users from prod don't exist in staging.
  // The impersonation feature creates sandbox auth users on demand.
  { table: "profiles", transform: (row) => ({ ...row, owner_user_id: null }) },
  { table: "rounds" },
  // Snapshots reference rounds and must precede round_participants (which FK to tee_snapshots)
  { table: "round_course_snapshots", transform: (row) => ({ ...row, source_course_id: null }) },
  { table: "round_tee_snapshots", transform: (row) => ({ ...row, source_tee_box_id: null }) },
  // round_teams must precede round_participants: participants have a nullable FK to teams
  { table: "round_teams" },
  { table: "round_participants" },
  { table: "round_hole_states", onConflict: "participant_id,hole_number" },
  { table: "round_score_events" },
  { table: "round_hole_snapshots" },
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
  { table: "handicap_round_results", transform: (row) => ({ ...row, tee_snapshot_id: null }) },
  // event_rules_versions is not in TABLE_PLAN — null out FKs that reference it
  { table: "events", transform: (row) => ({ ...row, published_rules_version_id: null }) },
  { table: "event_entries" },
  { table: "event_tee_times" },
  { table: "event_rounds" },
  { table: "event_charges" },
  { table: "event_player_charges" },
  { table: "event_round_submissions" },
  { table: "event_leaderboard_entries" },
  { table: "event_audit_log" },
  { table: "event_extras" },
  { table: "event_waitlist" },
  { table: "major_groups" },
  { table: "major_group_memberships" },
  { table: "major_group_standings" },
  { table: "group_seasons" },
  { table: "group_charges", transform: (row) => ({ ...row, created_by: null }) },
  { table: "group_balance_transactions" },
  { table: "group_season_standings_entries", onConflict: "group_season_id,profile_id" },
  { table: "competitions" },
  { table: "competition_event_templates" },
  { table: "competition_winnings" },
  { table: "competition_player_freeze_snapshots", onConflict: "competition_id,profile_id" },
  { table: "prize_pots" },
  { table: "prize_pot_entries" },
  { table: "prize_pot_payouts" },
  { table: "matchplay_stages" },
  { table: "matchplay_fixtures" },
  { table: "matchplay_bracket_slots" },
  { table: "matchplay_league_table_entries" },
  { table: "event_history_summaries" },
  { table: "profile_event_stats" },
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
        // Phase 1: read all tables from production.
        // Tables that don't exist in production yet (new in develop) are skipped.
        const snapshot: Record<string, any[]> = {};
        for (const { table } of TABLE_PLAN) {
          try {
            const rows = await readAllRows(prodClient, table);
            snapshot[table] = rows;
            send({ type: "read", table, rows: rows.length });
          } catch (e: any) {
            if (isTableNotFound(e)) {
              snapshot[table] = [];
              send({ type: "skip", table });
            } else {
              // Real error (network, permissions) — abort before touching staging
              throw e;
            }
          }
        }

        // Phase 2: wipe staging
        const { error: resetError } = await supabaseAdmin.rpc("sandbox_full_reset_database");
        if (resetError) throw new Error(`Reset failed: ${resetError.message}`);
        send({ type: "wipe" });

        // Phase 3: write production data into staging.
        // Per-table errors (schema mismatch, column drift) are reported but don't
        // abort the rest — staging will simply be missing that table's data.
        let totalRows = 0;
        let tablesCopied = 0;
        for (const { table, transform, onConflict } of TABLE_PLAN) {
          try {
            const { inserted, skipped } = await insertRows(
              supabaseAdmin as any,
              table,
              snapshot[table],
              transform,
              onConflict
            );
            totalRows += inserted;
            if (inserted > 0) tablesCopied++;
            send({ type: "write", table, rows: inserted, skipped });
          } catch (e: any) {
            send({ type: "write_error", table, message: e?.message ?? "Insert failed" });
          }
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
