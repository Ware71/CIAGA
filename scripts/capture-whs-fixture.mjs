// scripts/capture-whs-fixture.mjs
//
// READ-ONLY. Captures differential streams and their resulting handicap index
// history from the linked database, as fixtures for the TypeScript WHS engine
// (apps/app/lib/whs/handicapIndex.ts).
//
// The fixtures are the proof that the TS replay reproduces
// recalc_handicap_profile exactly. Nothing downstream of the projection engine
// is trustworthy without them, so they are checked in and asserted row-for-row
// by lib/whs/__tests__/replay.fixture.test.ts.
//
// Profiles are chosen to span the branches of the SQL rather than at random:
// below the 3-differential minimum, inside the small-n adjustment table, a long
// steady history, someone who regressed enough to trip the LHI cap, a plus
// handicapper (negative differentials exercise Postgres' round-half-away-from-
// zero), and anyone with same-day rounds or combined nines.
//
// Profile ids and names are NOT written to the fixtures — each becomes p1..pN.
//
// Usage:  node scripts/capture-whs-fixture.mjs
// Env:    apps/app/.env.local  (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setDefaultResultOrder } from "node:dns";

// Node >= 17 resolves DNS "verbatim", which on some setups hands undici an IPv6
// address with no route and surfaces as a bare ENOTFOUND. Force IPv4 first.
setDefaultResultOrder("ipv4first");

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "..", "apps", "app", "lib", "whs", "__tests__", "fixtures");
const PAGE = 1000;

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
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in apps/app/.env.local");
  process.exit(1);
}
console.log("Target:", url);
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

/** Page through a table/view so PostgREST's 1000-row ceiling can't silently truncate. */
async function fetchAll(table, columns, apply) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(columns).range(from, from + PAGE - 1);
    q = apply(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pull every profile that has any differential at all, then classify.
// ---------------------------------------------------------------------------

const streamRows = await fetchAll(
  "ciaga_scoring_record_stream",
  "profile_id, played_at, differential, combined_from_9",
  (q) => q.not("differential", "is", null).order("played_at", { ascending: true })
);
console.log(`Differential rows: ${streamRows.length}`);

const byProfile = new Map();
for (const r of streamRows) {
  if (!byProfile.has(r.profile_id)) byProfile.set(r.profile_id, []);
  byProfile.get(r.profile_id).push(r);
}
console.log(`Profiles with differentials: ${byProfile.size}`);

const historyRows = await fetchAll(
  "handicap_index_history",
  "profile_id, as_of_date, handicap_index, low_handicap_index",
  (q) => q.order("as_of_date", { ascending: true })
);

const historyByProfile = new Map();
for (const r of historyRows) {
  if (!historyByProfile.has(r.profile_id)) historyByProfile.set(r.profile_id, []);
  historyByProfile.get(r.profile_id).push(r);
}

// ---------------------------------------------------------------------------
// Classify each profile by which SQL branches its history exercises.
// ---------------------------------------------------------------------------

const num = (v) => (v === null || v === undefined ? null : Number(v));

const candidates = [];
for (const [profileId, rows] of byProfile) {
  const history = historyByProfile.get(profileId) ?? [];
  if (!history.length) continue;

  const diffs = rows.map((r) => num(r.differential));
  const indices = history.map((h) => num(h.handicap_index)).filter((v) => v !== null);
  if (!indices.length) continue;

  const dates = rows.map((r) => String(r.played_at).slice(0, 10));
  const distinctDates = new Set(dates);

  const capped = history.some((h) => {
    const hi = num(h.handicap_index);
    const lhi = num(h.low_handicap_index);
    return hi !== null && lhi !== null && hi - lhi > 3.0 + 1e-9;
  });

  candidates.push({
    profileId,
    n: rows.length,
    tags: {
      belowMinimum: rows.length < 3,
      smallN: rows.length >= 3 && rows.length <= 8,
      longSteady: rows.length >= 20,
      capped,
      plus: Math.min(...indices) < 0 || Math.min(...diffs) < 0,
      sameDay: distinctDates.size < dates.length,
      combinedNines: rows.some((r) => r.combined_from_9 === true),
    },
  });
}

// Greedy cover: keep taking the profile that adds the most uncovered branches.
const ALL_TAGS = [
  "belowMinimum", "smallN", "longSteady", "capped", "plus", "sameDay", "combinedNines",
];
const covered = new Set();
const chosen = [];
const pool = [...candidates];

while (pool.length && chosen.length < 10) {
  let bestIdx = -1;
  let bestGain = 0;
  let bestN = -1;
  for (let i = 0; i < pool.length; i++) {
    const gain = ALL_TAGS.filter((t) => pool[i].tags[t] && !covered.has(t)).length;
    if (gain > bestGain || (gain === bestGain && gain > 0 && pool[i].n > bestN)) {
      bestIdx = i; bestGain = gain; bestN = pool[i].n;
    }
  }
  if (bestIdx < 0 || bestGain === 0) break;
  const pick = pool.splice(bestIdx, 1)[0];
  for (const t of ALL_TAGS) if (pick.tags[t]) covered.add(t);
  chosen.push(pick);
}

// Always include the longest history, whether or not it added a new branch —
// it is the one most likely to expose window and LHI-expiry mistakes.
const longest = candidates.slice().sort((a, b) => b.n - a.n)[0];
if (longest && !chosen.some((c) => c.profileId === longest.profileId)) chosen.push(longest);

console.log(`\nBranches covered: ${[...covered].join(", ") || "(none)"}`);
const missing = ALL_TAGS.filter((t) => !covered.has(t));
if (missing.length) console.log(`Branches NOT present in this database: ${missing.join(", ")}`);

// ---------------------------------------------------------------------------
// Write fixtures.
// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

const manifest = [];
chosen.forEach((c, i) => {
  const slug = `p${i + 1}`;
  const stream = byProfile
    .get(c.profileId)
    .map((r) => ({ playedAt: String(r.played_at).slice(0, 10), differential: num(r.differential) }))
    .sort((a, b) => (a.playedAt < b.playedAt ? -1 : a.playedAt > b.playedAt ? 1 : 0));

  const expected = (historyByProfile.get(c.profileId) ?? []).map((h) => ({
    asOfDate: String(h.as_of_date).slice(0, 10),
    handicapIndex: num(h.handicap_index),
    lowHandicapIndex: num(h.low_handicap_index),
  }));

  const tags = ALL_TAGS.filter((t) => c.tags[t]);
  const file = join(OUT_DIR, `replay-${slug}.json`);
  writeFileSync(
    file,
    JSON.stringify({ slug, tags, differentials: stream.length, stream, expected }, null, 2) + "\n"
  );
  manifest.push({ slug, tags, differentials: stream.length, historyRows: expected.length });
  console.log(`  ${slug}: ${stream.length} differentials, ${expected.length} history rows [${tags.join(", ")}]`);
});

writeFileSync(join(OUT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`\nWrote ${chosen.length} fixtures to ${OUT_DIR}`);
