// scripts/verify-compare-lowest.mjs
//
// READ-ONLY diagnostic for the compare_against_lowest regression.
// Lists every round using default_playing_handicap_mode = 'compare_against_lowest'
// with its participants' locked course/playing handicaps, so we can see whether
// playing_handicap_used is wrongly stuck at 0.
//
// Usage:  node scripts/verify-compare-lowest.mjs
// Env:    apps/app/.env.local  (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const env = loadEnv(join(here, "..", "apps", "app", ".env.local"));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
console.log("Target:", url);
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: rounds, error } = await db
  .from("rounds")
  .select("id, name, status, format_type, default_playing_handicap_mode, default_playing_handicap_value, started_at, created_at")
  .eq("default_playing_handicap_mode", "compare_against_lowest")
  .order("created_at", { ascending: false });

if (error) { console.error(error); process.exit(1); }

if (!rounds?.length) {
  console.log("No compare_against_lowest rounds found on this DB.");
  process.exit(0);
}

for (const r of rounds) {
  console.log("\n" + "=".repeat(72));
  console.log(`${r.name ?? "(unnamed)"}  [${r.format_type}]  status=${r.status}  value=${r.default_playing_handicap_value}%`);
  console.log(`id=${r.id}  started_at=${r.started_at ?? "—"}  created_at=${r.created_at}`);
  const { data: parts } = await db
    .from("round_participants")
    .select("display_name, profile_id, is_guest, handicap_index, course_handicap_used, playing_handicap_used, assigned_playing_handicap, assigned_handicap_index, tee_snapshot_id")
    .eq("round_id", r.id);
  for (const p of parts ?? []) {
    console.log(
      `  ${(p.display_name ?? p.profile_id ?? "?").padEnd(22)}` +
      ` HI=${String(p.handicap_index ?? "—").padStart(5)}` +
      ` CHused=${String(p.course_handicap_used ?? "—").padStart(4)}` +
      ` PHused=${String(p.playing_handicap_used ?? "—").padStart(4)}` +
      ` assignedPH=${p.assigned_playing_handicap ?? "—"}` +
      ` snap=${p.tee_snapshot_id ? "y" : "n"}`,
    );
  }
}
