// scripts/fix-course-record-subjects.mjs
//
// One-time cleanup for the "course record credited to the wrong player" bug.
//
// Course-record feed items are shared per course+tee and updated in place when
// the record is broken. The emitter used to UPSERT the new holder into
// feed_item_subjects without removing the previous holder, so items accumulated
// every past holder as a subject. The feed renderer shows subjects[0] sorted
// alphabetically, so a broken record could credit the wrong person (e.g. a host
// player instead of the guest who actually shot the record).
//
// The code fix (achievements.ts replaceSubjects) prevents recurrence. This
// script repairs items that are already polluted by keeping only the current
// holder (feed_items.actor_profile_id, which equals payload->>profile_id).
//
// Equivalent SQL:
//   DELETE FROM public.feed_item_subjects s
//   USING public.feed_items f
//   WHERE s.feed_item_id = f.id
//     AND f.type = 'course_record'
//     AND s.subject_profile_id <> f.actor_profile_id;
//
// Usage:
//   node scripts/fix-course-record-subjects.mjs                    # dry-run vs apps/app/.env.local (staging)
//   node scripts/fix-course-record-subjects.mjs --apply            # apply vs apps/app/.env.local
//   node scripts/fix-course-record-subjects.mjs --env-file <path>          # dry-run vs a specific env file (e.g. prod)
//   node scripts/fix-course-record-subjects.mjs --env-file <path> --apply  # apply vs that env
//
// Env file must define a URL + service-role key under either the app names
// (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) or the prod names
// (PROD_SUPABASE_URL / PROD_SUPABASE_SERVICE_ROLE_KEY).

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// ── Args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const envFileArg = (() => {
  const i = args.indexOf("--env-file");
  return i >= 0 ? args[i + 1] : null;
})();

// ── Env / client ────────────────────────────────────────────────────────────
function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const envPath = envFileArg
  ? (isAbsolute(envFileArg) ? envFileArg : resolve(process.cwd(), envFileArg))
  : join(here, "..", "apps", "app", ".env.local");

let env;
try {
  env = loadEnv(envPath);
} catch (e) {
  console.error(`Could not read env file: ${envPath}\n${e.message}`);
  process.exit(1);
}

const url = env.NEXT_PUBLIC_SUPABASE_URL || env.PROD_SUPABASE_URL || env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.PROD_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    `Missing Supabase URL / service-role key in ${envPath}\n` +
      "Expected NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or PROD_ equivalents).",
  );
  process.exit(1);
}

// Identify the environment for a clear log line + a production warning.
let envName = url;
try {
  const cfg = JSON.parse(readFileSync(join(here, "..", ".claude", "db-environments.json"), "utf8"));
  for (const [name, d] of Object.entries(cfg.supabase ?? {})) {
    if (url.includes(d.project_ref)) envName = name.toUpperCase();
  }
} catch {
  /* best-effort labelling only */
}

console.log("━".repeat(64));
console.log(`Target : ${envName}`);
console.log(`URL    : ${url}`);
console.log(`Mode   : ${APPLY ? "APPLY (will delete stale subjects)" : "DRY-RUN (no writes)"}`);
if (envName === "PRODUCTION") console.log("⚠️  This is PRODUCTION.");
console.log("━".repeat(64) + "\n");

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function fail(label, error) {
  console.error(`ABORT ${label}: ${error.message} (code=${error.code ?? "?"})`);
  process.exit(1);
}

// ── 1. Load all course_record feed items ──────────────────────────────────
const crItems = [];
{
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("feed_items")
      .select("id, actor_profile_id, payload")
      .eq("type", "course_record")
      .range(from, from + PAGE - 1);
    if (error) fail("load feed_items", error);
    crItems.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
}

if (!crItems.length) {
  console.log("No course_record feed items on this DB. Nothing to do.");
  process.exit(0);
}

// ── 2. Load their subjects (batched) ───────────────────────────────────────
const subjectsByItem = new Map(); // feed_item_id -> [{ subject_profile_id }]
{
  const ids = crItems.map((i) => i.id);
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await db
      .from("feed_item_subjects")
      .select("feed_item_id, subject_profile_id")
      .in("feed_item_id", chunk);
    if (error) fail("load feed_item_subjects", error);
    for (const row of data ?? []) {
      const arr = subjectsByItem.get(row.feed_item_id) ?? [];
      arr.push(row);
      subjectsByItem.set(row.feed_item_id, arr);
    }
  }
}

// ── 3. Find items with stale subjects (subject != current holder) ──────────
const polluted = []; // { id, actor, staleIds[], holderName, courseName }
let itemsMultiSubject = 0;
let itemsNullActor = 0;

for (const it of crItems) {
  const subs = subjectsByItem.get(it.id) ?? [];
  if (subs.length > 1) itemsMultiSubject++;

  if (!it.actor_profile_id) {
    // Can't safely determine the holder — never wipe these.
    if (subs.length > 1) itemsNullActor++;
    continue;
  }

  const staleIds = subs
    .map((s) => s.subject_profile_id)
    .filter((pid) => pid && pid !== it.actor_profile_id);

  if (staleIds.length) {
    polluted.push({
      id: it.id,
      actor: it.actor_profile_id,
      staleIds: Array.from(new Set(staleIds)),
      holderName: it.payload?.name ?? "(unknown)",
      courseName: it.payload?.course_name ?? "(unknown course)",
    });
  }
}

const totalStaleRows = polluted.reduce((n, p) => n + p.staleIds.length, 0);

console.log(`course_record feed items      : ${crItems.length}`);
console.log(`items with >1 subject         : ${itemsMultiSubject}`);
console.log(`items with stale subjects     : ${polluted.length}`);
console.log(`stale subject rows to remove  : ${totalStaleRows}`);
if (itemsNullActor) console.log(`⚠️  items with >1 subject but NULL actor (skipped): ${itemsNullActor}`);
console.log("");

if (polluted.length) {
  console.log("Examples (up to 10):");
  for (const p of polluted.slice(0, 10)) {
    console.log(`  • ${p.courseName} — holder "${p.holderName}" — removing ${p.staleIds.length} stale subject(s)`);
  }
  console.log("");
}

if (!polluted.length) {
  console.log("✅ No polluted course_record items. Nothing to fix.");
  process.exit(0);
}

if (!APPLY) {
  console.log("Dry-run only. Re-run with --apply to delete the stale subject rows.");
  process.exit(0);
}

// ── 4. Apply: delete non-holder subjects per item ──────────────────────────
let deletedItems = 0;
for (const p of polluted) {
  const { error } = await db
    .from("feed_item_subjects")
    .delete()
    .eq("feed_item_id", p.id)
    .neq("subject_profile_id", p.actor);
  if (error) fail(`delete stale subjects for ${p.id}`, error);
  deletedItems++;
}
console.log(`\n✅ Cleaned ${deletedItems} item(s).`);

// ── 5. Verify ───────────────────────────────────────────────────────────────
let remainingMulti = 0;
{
  const ids = crItems.map((i) => i.id);
  const CHUNK = 200;
  const counts = new Map();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { data, error } = await db
      .from("feed_item_subjects")
      .select("feed_item_id")
      .in("feed_item_id", chunk);
    if (error) fail("verify", error);
    for (const row of data ?? []) counts.set(row.feed_item_id, (counts.get(row.feed_item_id) ?? 0) + 1);
  }
  for (const n of counts.values()) if (n > 1) remainingMulti++;
}
console.log(`Post-cleanup course_record items with >1 subject: ${remainingMulti}`);
console.log(remainingMulti === 0 ? "✅ Verified clean." : "⚠️  Some items still have >1 subject (check NULL-actor items).");
