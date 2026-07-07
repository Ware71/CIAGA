// scripts/invitational-backfill/repair-points.mjs
//
// One-off repair after the playoff fieldSize fix (2026-06-10):
// the playoff complete handler stored points computed against a field of 2
// (the playoff participants) instead of the event field of 6.
//   Ware (P1): stored 48 → correct 55
//   Jack Wilson (P2): stored 18 → correct 45
// Then recompute both standings rollups so the group page reflects it.
//
// Usage: node scripts/invitational-backfill/repair-points.mjs
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

// CIAGA formula (defaults, field 6, 1 round) — same as lib/events/constants.ts
function formulaPoints(position, F) {
  const base = 18, scale = 32, compression = 0.7, fieldSensitivity = 0.2, winBonus = 5;
  const fieldScale = Math.pow(F / 6, fieldSensitivity);
  const posFrac = F > 1 ? Math.max(F - position, 0) / (F - 1) : 0;
  return Math.round(base + scale * Math.pow(posFrac, compression) * fieldScale + (position === 1 ? winBonus * fieldScale : 0));
}

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) { console.error(`ABORT ${label}: ${error.message}`); process.exit(1); }
  return data;
}

const main = async () => {
  const warePts = formulaPoints(1, 6);
  const jackPts = formulaPoints(2, 6);
  console.log(`computed correct points: P1=${warePts} P2=${jackPts} (expected 55 / 45)`);
  if (warePts !== 55 || jackPts !== 45) { console.error("ABORT: unexpected formula output"); process.exit(1); }

  const before = await must("read lb", db.from("event_leaderboard_entries")
    .select("profile_id, position, playoff_final_position, playoff_result, points_earned")
    .eq("event_id", EVENT_ID).in("profile_id", [WARE, JACK]));
  console.log("before:", JSON.stringify(before));

  await must("update Ware", db.from("event_leaderboard_entries")
    .update({ points_earned: warePts }).eq("event_id", EVENT_ID).eq("profile_id", WARE));
  await must("update Jack", db.from("event_leaderboard_entries")
    .update({ points_earned: jackPts }).eq("event_id", EVENT_ID).eq("profile_id", JACK));
  console.log("✓ points_earned updated");

  // Event must be 'completed' for the season rollup to include it
  const evt = await must("event status", db.from("events").select("majors_status, leaderboard_freeze_state").eq("id", EVENT_ID).single());
  console.log(`event: majors_status=${evt.majors_status} freeze_state=${evt.leaderboard_freeze_state}`);
  if (evt.majors_status !== "completed") {
    await must("set completed", db.from("events").update({ majors_status: "completed" }).eq("id", EVENT_ID));
    console.log("✓ majors_status set back to completed");
  }

  await must("recompute season standings", db.rpc("ciaga_compute_group_season_standings", { p_group_season_id: GROUP_SEASON_ID }));
  await must("recompute group standings", db.rpc("ciaga_compute_group_standings", { p_group_id: GROUP_ID }));
  console.log("✓ standings recomputed");

  const names = { [WARE]: "Ware", [JACK]: "Jack Wilson", "00dc22e9-8020-4aed-ab97-8e4cf6d3fc53": "Linehan", "32013806-c774-413c-816b-5483124f4848": "Ciaran", "34cd70b1-9523-46d1-bb90-f553469a998b": "Harper", "c693a1a8-7827-4af0-b303-c33d99f97076": "Liaga" };

  const season = await must("verify season", db.from("group_season_standings_entries")
    .select("profile_id, position, season_points, wins, top_3s, best_finish")
    .eq("group_season_id", GROUP_SEASON_ID).order("position"));
  console.log("\nseason standings rollup (group page):");
  for (const r of season) console.log(`  #${r.position} ${(names[r.profile_id] ?? r.profile_id).padEnd(12)} pts=${r.season_points} W=${r.wins} top3=${r.top_3s} best=${r.best_finish}`);

  const group = await must("verify group", db.from("major_group_standings")
    .select("profile_id, position, season_points, wins").eq("group_id", GROUP_ID).order("position"));
  console.log("\nmajor_group_standings:");
  for (const r of group) console.log(`  #${r.position} ${(names[r.profile_id] ?? r.profile_id).padEnd(12)} pts=${r.season_points} W=${r.wins}`);

  console.log("\nDONE");
};

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
