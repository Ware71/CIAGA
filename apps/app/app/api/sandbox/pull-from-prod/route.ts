import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getProductionReaderClient } from "@/lib/supabaseProductionReader";
import {
  applyStepTransform,
  planCopy,
  type CopyPlan,
  type CopyStep,
  type SchemaGraph,
} from "@/lib/sandbox/tableGraph";
import type { SupabaseClient } from "@supabase/supabase-js";

type ProductionReaderClient = ReturnType<typeof getProductionReaderClient>;

async function readAllRows(client: ProductionReaderClient, table: string): Promise<any[]> {
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

function isTableNotFound(e: any): boolean {
  const msg = (e?.message ?? "").toLowerCase();
  return (
    e?.code === "42P01" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

/** Best-effort constraint name out of a PostgREST error, for the orphan report. */
function constraintOf(error: any): string {
  const direct = error?.details ?? error?.message ?? "";
  const m = /constraint "([^"]+)"/.exec(direct);
  return m?.[1] ?? "unknown constraint";
}

type SkippedRow = { row: any; constraint: string };

type InsertResult = {
  inserted: number;
  skipped: SkippedRow[];
};

async function insertRows(
  client: SupabaseClient,
  table: string,
  rows: any[],
  onConflict: string | null
): Promise<InsertResult> {
  if (rows.length === 0) return { inserted: 0, skipped: [] };
  const chunkSize = 500;
  let inserted = 0;
  const skipped: SkippedRow[] = [];

  // Tables without a primary key can't be upserted on a conflict target; they
  // are only ever written into a freshly truncated database, so a plain insert
  // is correct there.
  const write = (payload: any) =>
    onConflict
      ? client.from(table).upsert(payload, { onConflict })
      : client.from(table).insert(payload);

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    // Upsert so trigger-created rows (e.g. round_hole_states created when rounds
    // are inserted) get overwritten with production data rather than causing
    // duplicate key violations.
    const { error } = await write(chunk);
    if (!error) {
      inserted += chunk.length;
    } else if (isFKViolation(error)) {
      // Chunk contains rows whose parent isn't in place yet — fall back to
      // row-by-row and hold the failures for the re-drive pass.
      for (const row of chunk) {
        const { error: rowErr } = await write(row);
        if (!rowErr) {
          inserted++;
        } else if (isFKViolation(rowErr)) {
          skipped.push({ row, constraint: constraintOf(rowErr) });
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

/** Identify a row in the orphan report without dumping the whole thing. */
function rowKey(row: any, onConflict: string | null): string {
  const cols = onConflict ? onConflict.split(",") : ["id"];
  return cols.map((c) => `${c}=${row?.[c] ?? "?"}`).join(" ");
}

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
  // A real staging auth.users id — the substitute for NOT NULL references into
  // auth that production values can never satisfy here.
  const operatorAuthUid = userData.user.id;

  let prodClient: ProductionReaderClient;
  try {
    prodClient = getProductionReaderClient();
  } catch (e: any) {
    return NextResponse.json(
      { error: `Production credentials not configured: ${e.message}` },
      { status: 500 }
    );
  }

  // Phase 0: derive the copy plan from staging's live schema. Done before the
  // stream opens so a planning failure is a plain error response.
  let plan: CopyPlan;
  try {
    const { data, error } = await supabaseAdmin.rpc("sandbox_schema_graph");
    if (error) throw new Error(error.message);
    plan = planCopy(data as SchemaGraph);
  } catch (e: any) {
    return NextResponse.json(
      { error: `Could not read the staging schema graph: ${e?.message ?? "unknown error"}` },
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
        send({
          type: "plan",
          discovered: plan.discovered,
          copying: plan.steps.length,
          denied: plan.denied,
          blocked: plan.blocked,
          preserved: plan.preserved,
          uncovered: plan.uncovered,
          cycleBreaks: plan.fixups,
        });

        // Phase 1: read every planned table from production.
        // Tables that don't exist in production yet (new on develop) are skipped.
        const snapshot: Record<string, any[]> = {};
        for (const { table } of plan.steps) {
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
        const stepByTable = new Map<string, CopyStep>(plan.steps.map((s) => [s.table, s]));
        const pending = new Map<string, SkippedRow[]>();
        let totalRows = 0;
        let tablesCopied = 0;

        for (const step of plan.steps) {
          try {
            const prepared = (snapshot[step.table] ?? []).map((row) =>
              applyStepTransform(step, row, operatorAuthUid)
            );
            const { inserted, skipped } = await insertRows(
              supabaseAdmin as any,
              step.table,
              prepared,
              step.onConflict
            );
            totalRows += inserted;
            if (inserted > 0) tablesCopied++;
            if (skipped.length > 0) pending.set(step.table, skipped);
            send({ type: "write", table: step.table, rows: inserted, skipped: skipped.length });
          } catch (e: any) {
            send({ type: "write_error", table: step.table, message: e?.message ?? "Insert failed" });
          }
        }

        // Phase 4: restore the columns that were nulled to break FK cycles
        // (rounds ↔ event_tee_times, events ↔ event_rules_versions). A full-row
        // upsert overwrites every column, so the original values come back.
        for (const fixup of plan.fixups) {
          const step = stepByTable.get(fixup.table);
          if (!step) continue;
          const rows = (snapshot[fixup.table] ?? []).filter((r) =>
            fixup.columns.some((c) => r?.[c] != null)
          );
          if (rows.length === 0) continue;
          // A full-row rewrite needs a conflict target; without a PK it would
          // duplicate every row instead of updating it.
          if (!step.onConflict) {
            send({
              type: "write_error",
              table: fixup.table,
              message: `cannot restore ${fixup.columns.join(", ")} — table has no primary key`,
            });
            continue;
          }
          try {
            const { inserted, skipped } = await insertRows(
              supabaseAdmin as any,
              fixup.table,
              // Restore the cycle columns; permanent nulls and operator
              // remaps stay as they were on the first pass.
              rows.map((row) => applyStepTransform(step, row, operatorAuthUid, "fixup")),
              step.onConflict
            );
            if (skipped.length > 0) {
              pending.set(fixup.table, [...(pending.get(fixup.table) ?? []), ...skipped]);
            }
            send({
              type: "write",
              table: `${fixup.table} ← ${fixup.columns.join(", ")}`,
              rows: inserted,
              skipped: skipped.length,
            });
          } catch (e: any) {
            send({
              type: "write_error",
              table: `${fixup.table} ← ${fixup.columns.join(", ")}`,
              message: e?.message ?? "Restore failed",
            });
          }
        }

        // Phase 5: re-drive every row that was skipped on the way through. Most
        // skips are ordering artefacts — a self-referencing FK (profiles.created_by,
        // feed_comments.parent_comment_id) whose parent came later in the same
        // table, or a row that landed before a cycle fixup. Now that everything is
        // in place, retry once. Only rows that fail twice are genuine orphans.
        let orphanTotal = 0;
        for (const step of plan.steps) {
          const skipped = pending.get(step.table);
          if (!skipped || skipped.length === 0) continue;

          let recovered = 0;
          const stillFailing: SkippedRow[] = [];
          for (const entry of skipped) {
            const { error } = step.onConflict
              ? await (supabaseAdmin as any)
                  .from(step.table)
                  .upsert(entry.row, { onConflict: step.onConflict })
              : await (supabaseAdmin as any).from(step.table).insert(entry.row);
            if (!error) recovered++;
            else stillFailing.push({ row: entry.row, constraint: constraintOf(error) });
          }

          totalRows += recovered;
          if (recovered > 0) {
            send({ type: "recovered", table: step.table, rows: recovered });
          }
          if (stillFailing.length > 0) {
            orphanTotal += stillFailing.length;
            const byConstraint = new Map<string, string[]>();
            for (const f of stillFailing) {
              const keys = byConstraint.get(f.constraint) ?? [];
              if (keys.length < 5) keys.push(rowKey(f.row, step.onConflict));
              byConstraint.set(f.constraint, keys);
            }
            send({
              type: "orphan",
              table: step.table,
              rows: stillFailing.length,
              constraints: [...byConstraint.entries()].map(([constraint, samples]) => ({
                constraint,
                samples,
              })),
            });
          }
        }

        send({ type: "done", tablesCopied, rowsCopied: totalRows, orphans: orphanTotal });
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
