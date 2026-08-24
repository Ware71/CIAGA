// scripts/measure-improvement.mjs
//
// READ-ONLY. Measures how player scoring ability actually evolves with rounds
// played, to calibrate the projection model's improvement term.
//
// The projection currently damps any fitted trend to nothing within ~12 rounds,
// so it cannot answer "when will I go scratch". Before loosening that, we need
// numbers for three things:
//
//   1. PERSISTENCE — if a player improved over their last 20 rounds, how much do
//      they improve over the NEXT 20? Regress next-slope on prior-slope. The
//      coefficient is what the damping constant should be derived from. Near
//      zero means trends are noise and the current damping is right; near one
//      means they persist and it is far too aggressive.
//
//   2. HEADROOM — how much do players at a given level improve, as a function of
//      where they started and how many rounds they have played? A 28-handicap
//      has room a 5-handicap does not, and pooling them washes that out.
//
//   3. FLOOR — where do long-history players actually level off?
//
// Usage:  node scripts/measure-improvement.mjs
// Env:    apps/app/.env.local  (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setDefaultResultOrder } from "node:dns";

setDefaultResultOrder("ipv4first");

const here = dirname(fileURLToPath(import.meta.url));
const PAGE = 1000;
/** Rounds per observation window on each side of the persistence regression. */
const W = 20;

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
console.log("Target:", url, "\n");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function fetchAll(table, columns, apply) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await apply(db.from(table).select(columns).range(from, from + PAGE - 1));
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// ---------------------------------------------------------------------------

const rows = await fetchAll(
  "ciaga_scoring_record_stream",
  "profile_id, played_at, differential",
  (q) => q.not("differential", "is", null).order("played_at", { ascending: true })
);

const byProfile = new Map();
for (const r of rows) {
  if (!byProfile.has(r.profile_id)) byProfile.set(r.profile_id, []);
  byProfile.get(r.profile_id).push({ d: String(r.played_at).slice(0, 10), v: Number(r.differential) });
}

console.log(`${rows.length} differentials across ${byProfile.size} profiles`);
const lengths = [...byProfile.values()].map((v) => v.length).sort((a, b) => b - a);
console.log(`rounds per player: ${lengths.join(", ")}\n`);

// --- helpers ---------------------------------------------------------------

/** OLS slope of v against index, per round. Negative = improving. */
function slope(vals) {
  const n = vals.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i; sy += vals[i]; sxx += i * i; sxy += i * vals[i];
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return null;
  return (n * sxy - sx * sy) / denom;
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function regress(pairs) {
  if (pairs.length < 3) return null;
  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx < 1e-12) return null;
  const b = sxy / sxx;
  const r = sxy / Math.sqrt(sxx * syy || 1);
  const resid = xs.map((x, i) => ys[i] - (my + b * (x - mx)));
  const se = Math.sqrt(resid.reduce((s, e) => s + e * e, 0) / Math.max(1, xs.length - 2) / sxx);
  return { slope: b, r, n: pairs.length, se };
}

// --- 1. Persistence --------------------------------------------------------

const persistence = [];
const levelPairs = []; // [level now, change in level over next W rounds]
const startVsTotal = []; // [starting level, total improvement over whole history]

for (const [, v] of byProfile) {
  const vals = v.map((x) => x.v);

  for (let i = W; i + W <= vals.length; i++) {
    const prior = slope(vals.slice(i - W, i));
    const next = slope(vals.slice(i, i + W));
    if (prior === null || next === null) continue;
    persistence.push([prior, next]);

    const lvlNow = mean(vals.slice(i - W, i));
    const lvlNext = mean(vals.slice(i, i + W));
    levelPairs.push([lvlNow, lvlNext - lvlNow, i]);
  }

  if (vals.length >= 2 * W) {
    const first = mean(vals.slice(0, W));
    const last = mean(vals.slice(-W));
    startVsTotal.push([first, last - first, vals.length]);
  }
}

console.log("=== 1. TREND PERSISTENCE ===");
console.log(`Does improvement over ${W} rounds predict improvement over the next ${W}?`);
const p = regress(persistence.map(([a, b]) => [a, b]));
if (p) {
  console.log(`  observations: ${p.n}`);
  console.log(`  coefficient:  ${p.slope.toFixed(3)}  (± ${p.se.toFixed(3)} s.e.)`);
  console.log(`  correlation:  ${p.r.toFixed(3)}`);
  console.log(`  reading: 0 = trends are pure noise; 1 = they persist fully.`);
  const t = p.slope / (p.se || 1);
  console.log(`  significance: t = ${t.toFixed(2)} ${Math.abs(t) > 2 ? "(significant)" : "(NOT significant)"}`);
} else {
  console.log("  not enough overlapping windows in this database");
}

console.log("\n=== 2. HEADROOM: level now -> change over next 20 rounds ===");
if (levelPairs.length) {
  const bins = [[0, 5], [5, 10], [10, 15], [15, 20], [20, 25], [25, 40], [40, 100]];
  console.log("  level band   n     mean change   (negative = improving)");
  for (const [lo, hi] of bins) {
    const inBin = levelPairs.filter(([l]) => l >= lo && l < hi).map(([, d]) => d);
    if (inBin.length < 3) continue;
    console.log(
      `  ${String(lo).padStart(3)}-${String(hi).padEnd(3)}    ${String(inBin.length).padStart(4)}   ${mean(inBin).toFixed(3)}`
    );
  }
  const byExp = regress(levelPairs.map(([, d, i]) => [i, d]));
  if (byExp) {
    console.log(`\n  change vs rounds-played-so-far: ${byExp.slope.toFixed(5)}/round (r=${byExp.r.toFixed(3)})`);
    console.log("  (positive = improvement slows with experience)");
  }
} else {
  console.log("  no player has 40+ rounds; cannot measure");
}

console.log("\n=== 3. WHOLE-CAREER IMPROVEMENT ===");
if (startVsTotal.length) {
  console.log("  start level   rounds   total change in level");
  for (const [s, d, n] of startVsTotal.sort((a, b) => b[2] - a[2])) {
    console.log(`  ${s.toFixed(1).padStart(11)}   ${String(n).padStart(6)}   ${d >= 0 ? "+" : ""}${d.toFixed(2)}`);
  }
  const r = regress(startVsTotal.map(([s, d]) => [s, d]));
  if (r) {
    console.log(`\n  total change vs starting level: ${r.slope.toFixed(3)} (r=${r.r.toFixed(3)}, n=${r.n})`);
    console.log("  (negative = worse players improve more, i.e. real headroom)");
  }
} else {
  console.log(`  no player has ${2 * W}+ rounds`);
}
