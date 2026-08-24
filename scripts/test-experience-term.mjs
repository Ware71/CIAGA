// scripts/test-experience-term.mjs
//
// READ-ONLY. Does the experience term in the improvement curve earn its place?
//
// The curve is  dL/dround = -a · max(0, L - F) · exp(-n / N0), and the exp(-n/N0)
// factor says a player with many rounds improves less. That is uncomfortable:
//
//   - `n` counts rounds RECORDED IN CIAGA, not rounds played in a lifetime. A
//     twenty-year golfer joining the society starts at n = 0, indistinguishable
//     from a genuine beginner.
//   - `n` and `L` are strongly correlated by construction — players with many
//     rounds have already improved, so they sit at a lower level and have less
//     headroom. The (L - F) factor may already capture everything exp(-n/N0) is
//     being credited with.
//
// This compares headroom-only against headroom-and-experience, tests whether n
// explains anything left over, and checks the effect WITHIN a single player
// (which removes all between-player confounding).
//
// Usage:  node scripts/test-experience-term.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setDefaultResultOrder } from "node:dns";

setDefaultResultOrder("ipv4first");
const here = dirname(fileURLToPath(import.meta.url));
const W = 20;

const env = {};
for (const line of readFileSync(join(here, "..", "apps", "app", ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from("ciaga_scoring_record_stream")
    .select("profile_id, played_at, differential")
    .not("differential", "is", null)
    .order("played_at", { ascending: true })
    .range(from, from + 999);
  if (error) throw error;
  rows.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}

const byProfile = new Map();
for (const r of rows) {
  if (!byProfile.has(r.profile_id)) byProfile.set(r.profile_id, []);
  byProfile.get(r.profile_id).push(Number(r.differential));
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => Math.sqrt(mean(a.map((x) => (x - mean(a)) ** 2)));
function corr(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy || 1);
}

const obs = [];
let pi = 0;
for (const [, vals] of byProfile) {
  pi++;
  for (let i = W; i + W <= vals.length; i++) {
    const L = mean(vals.slice(i - W, i));
    obs.push({ L, n: i, d: (mean(vals.slice(i, i + W)) - L) / W, profile: pi });
  }
}
console.log(`${obs.length} observations, ${new Set(obs.map((o) => o.profile)).size} profiles\n`);

console.log("=== COLLINEARITY ===");
console.log(`  corr(rounds played, level) = ${corr(obs.map((o) => o.n), obs.map((o) => o.L)).toFixed(3)}`);
console.log("  (strongly negative means the two terms are fighting over the same signal)\n");

// --- model fits ------------------------------------------------------------

function fitHeadroomOnly(sample) {
  let best = { a: 0, F: 0, sse: Infinity };
  for (let a = 0.0005; a <= 0.05; a += 0.0005) {
    for (let F = -4; F <= 16; F += 0.25) {
      let s = 0;
      for (const o of sample) {
        const e = o.d - -a * Math.max(0, o.L - F);
        s += e * e;
      }
      if (s < best.sse) best = { a, F, sse: s };
    }
  }
  return best;
}

function fitFull(sample) {
  let best = { a: 0, F: 0, N0: 100, sse: Infinity };
  for (let a = 0.001; a <= 0.06; a += 0.001) {
    for (let F = -4; F <= 16; F += 0.5) {
      for (let N0 = 20; N0 <= 800; N0 += 20) {
        let s = 0;
        for (const o of sample) {
          const e = o.d - -a * Math.max(0, o.L - F) * Math.exp(-o.n / N0);
          s += e * e;
        }
        if (s < best.sse) best = { a, F, N0, sse: s };
      }
    }
  }
  return best;
}

const rmse = (s) => Math.sqrt(s / obs.length);
const hOnly = fitHeadroomOnly(obs);
const full = fitFull(obs);

console.log("=== MODEL COMPARISON (all data) ===");
console.log(`  headroom only        : a=${hOnly.a.toFixed(4)} F=${hOnly.F.toFixed(2)}          RMSE=${rmse(hOnly.sse).toFixed(4)}`);
console.log(`  headroom + experience: a=${full.a.toFixed(4)} F=${full.F.toFixed(2)} N0=${full.N0}  RMSE=${rmse(full.sse).toFixed(4)}`);
const gain = 100 * (1 - (rmse(full.sse) / rmse(hOnly.sse)) ** 2);
console.log(`  extra variance explained by the experience term: ${gain.toFixed(1)}%`);
console.log(`  (it costs one parameter — under a few percent is not worth the semantics)\n`);

// --- does n explain the headroom-only residuals? ---------------------------

const res = obs.map((o) => o.d - -hOnly.a * Math.max(0, o.L - hOnly.F));
console.log("=== LEFTOVER SIGNAL ===");
console.log(`  corr(headroom-only residual, rounds played) = ${corr(res, obs.map((o) => o.n)).toFixed(3)}`);
console.log("  (near zero means headroom already explains it)\n");

// --- WITHIN a single player: the confound-free test ------------------------

console.log("=== WITHIN-PLAYER (no between-player confounding) ===");
for (const p of [...new Set(obs.map((o) => o.profile))]) {
  const mine = obs.filter((o) => o.profile === p);
  if (mine.length < 60) continue;
  const half = Math.floor(mine.length / 2);
  const early = mine.slice(0, half);
  const late = mine.slice(half);
  // Compare improvement per stroke of headroom, early vs late in their career.
  const rate = (g) => mean(g.map((o) => o.d / Math.max(0.5, o.L - hOnly.F)));
  console.log(
    `  profile ${p} (n=${mine.length}): early rate ${rate(early).toFixed(4)}  late rate ${rate(late).toFixed(4)}` +
      `   levels ${mean(early.map((o) => o.L)).toFixed(1)} -> ${mean(late.map((o) => o.L)).toFixed(1)}`
  );
}
console.log("\n  If early and late rates are similar once headroom is divided out,");
console.log("  the slowdown was headroom shrinking, not experience accumulating.");
