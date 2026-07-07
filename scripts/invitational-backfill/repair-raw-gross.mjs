// scripts/invitational-backfill/repair-raw-gross.mjs
//
// One-off repair after migration 20260610000007 (event results use actual
// gross, not WHS adjusted gross): recompute the Invitational leaderboard,
// re-apply the playoff outcome (the RPC drops playoff columns), and
// recompute both standings rollups.
//
// Expected outcome:
//   1 Ware 95/73 (won playoff, 55) · 2 Jack Wilson 80/73 (lost playoff, 45)
//   3 Linehan 109/78 (40) · 4 Ciaran 128/82 (35)
//   5 Liaga 148/93 (28) · 6 Harper 142/94 (18)   ← 5/6 swap vs the capped result
//
// Usage: node scripts/invitational-backfill/repair-raw-gross.mjs
// Env:   scripts/invitational-backfill/.env.prod

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const env = {};
for (const line of readFileSync(join(here, ".env.prod"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const db = createClient(env.PROD_SUPABASE_URL, env.PROD_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EVENT_ID = "f9aaa51e-24f0-4b0c-83c4-467993b9ac33";
const GROUP_ID = "401b231b-df50-4c5f-86e3-2dd2e03e16a4";
const GROUP_SEASON_ID = "f93e2d7e-5e20-4fb7-9eb8-9bd3b3d9c99b";
const WARE = "c6cf1d65-516c-46ca-8800-4914a0c0531b";
const JACK = "195e5884-79b7-4fec-8823-20ada9f6c946";

const NAMES = {
  [WARE]: "Ware", [JACK]: "Jack Wilson",
  "00dc22e9-8020-4aed-ab97-8e4cf6d3fc53": "Linehan",
  "32013806-c774-413c-816b-5483124f4848": "Ciaran",
  "34cd70b1-9523-46d1-bb90-f553469a998b": "Harper",
  "c693a1a8-7827-4af0-b303-c33d99f97076": "Liaga",
};

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) { console.error(`ABORT ${label}: ${error.message}`); process.exit(1); }
  return data;
}

const main = async () => {
  // 1. Recompute leaderboard with the raw-gross function.
  //    NOTE: this DELETE+INSERTs entries, dropping the playoff columns.
  await must("recompute leaderboard", db.rpc("ciaga_compute_event_leaderboard", { p_event_id: EVENT_ID }));
  console.log("✓ leaderboard recomputed (raw gross)");

  // 2. Re-apply the playoff outcome — same writes the playoff complete handler
  //    performs after its own RPC recompute.
  await must("re-apply Ware playoff", db.from("event_leaderboard_entries")
    .update({ playoff_result: "won_playoff", playoff_final_position: 1, points_earned: 55 })
    .eq("event_id", EVENT_ID).eq("profile_id", WARE));
  await must("re-apply Jack playoff", db.from("event_leaderboard_entries")
    .update({ playoff_result: "lost_playoff", playoff_final_position: 2, points_earned: 45 })
    .eq("event_id", EVENT_ID).eq("profile_id", JACK));
  console.log("✓ playoff outcome re-applied (Ware won 55, Jack lost 45)");

  // 3. Recompute standings now the playoff fields are back.
  await must("recompute season standings", db.rpc("ciaga_compute_group_season_standings", { p_group_season_id: GROUP_SEASON_ID }));
  await must("recompute group standings", db.rpc("ciaga_compute_group_standings", { p_group_id: GROUP_ID }));
  console.log("✓ standings recomputed");

  // 4. Verify.
  const lb = await must("verify leaderboard", db.from("event_leaderboard_entries")
    .select("profile_id, position, playoff_final_position, playoff_result, gross_score, net_score, to_par, points_earned")
    .eq("event_id", EVENT_ID).order("position"));
  console.log("\nfinal leaderboard:");
  for (const e of lb) {
    console.log(`  #${e.position}${e.playoff_final_position ? ` (pfp ${e.playoff_final_position}, ${e.playoff_result})` : ""} ` +
      `${(NAMES[e.profile_id] ?? "?").padEnd(12)} gross=${e.gross_score} net=${e.net_score} to_par=${e.to_par} pts=${e.points_earned}`);
  }

  const season = await must("verify season standings", db.from("group_season_standings_entries")
    .select("profile_id, position, season_points, wins, top_3s, best_finish")
    .eq("group_season_id", GROUP_SEASON_ID).order("position"));
  console.log("\nseason standings rollup:");
  for (const r of season) {
    console.log(`  #${r.position} ${(NAMES[r.profile_id] ?? "?").padEnd(12)} pts=${r.season_points} W=${r.wins} top3=${r.top_3s} best=${r.best_finish}`);
  }

  const group = await must("verify group standings", db.from("major_group_standings")
    .select("profile_id, position, season_points, wins").eq("group_id", GROUP_ID).order("position"));
  console.log("\nmajor_group_standings:");
  for (const r of group) {
    console.log(`  #${r.position} ${(NAMES[r.profile_id] ?? "?").padEnd(12)} pts=${r.season_points} W=${r.wins}`);
  }

  const evt = await must("event status", db.from("events").select("majors_status, leaderboard_freeze_state").eq("id", EVENT_ID).single());
  console.log(`\nevent: majors_status=${evt.majors_status} freeze_state=${evt.leaderboard_freeze_state}`);
  console.log("DONE");
};

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
