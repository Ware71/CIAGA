// scripts/enable-sandbox-reset.mjs
//
// Arms the destructive sandbox reset on a NON-PRODUCTION database.
//
// sandbox_full_reset_database() (migration 20260729000000) truncates every
// public table except a small preserved list. It is built dynamically from
// pg_tables so it can never fall behind the schema — which also means it is
// materially more dangerous than the literal table list it replaced. The
// migration itself applies everywhere (staging and prod must stay in step), so
// the function is inert unless the database opts in via this flag.
//
// This script sets that flag. It REFUSES to run against production.
//
// Usage:
//   node scripts/enable-sandbox-reset.mjs                  # status vs apps/app/.env.local
//   node scripts/enable-sandbox-reset.mjs --apply          # arm it
//   node scripts/enable-sandbox-reset.mjs --disable        # disarm it
//   node scripts/enable-sandbox-reset.mjs --env-file <path> [--apply|--disable]

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const DISABLE = args.includes("--disable");
const envFileArg = (() => {
  const i = args.indexOf("--env-file");
  return i >= 0 ? args[i + 1] : null;
})();

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const envPath = envFileArg
  ? isAbsolute(envFileArg)
    ? envFileArg
    : resolve(process.cwd(), envFileArg)
  : join(here, "..", "apps", "app", ".env.local");

let env;
try {
  env = loadEnv(envPath);
} catch (e) {
  console.error(`Could not read env file: ${envPath}\n${e.message}`);
  process.exit(1);
}

const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    `Missing Supabase URL / service-role key in ${envPath}\n` +
      "Expected NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

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

if (envName === "PRODUCTION") {
  console.error("\n⛔ Refusing to arm the sandbox reset on PRODUCTION.");
  process.exit(1);
}

// Exit via process.exitCode rather than process.exit(): the Supabase client
// leaves fetch handles open, and tearing them down mid-flight trips a libuv
// assertion on Windows.
async function main() {
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: current, error: readErr } = await supabase
    .from("ciaga_system_settings")
    .select("key, value, updated_at")
    .eq("key", "sandbox_reset_enabled")
    .maybeSingle();

  if (readErr) {
    console.error(`Could not read ciaga_system_settings: ${readErr.message}`);
    return 1;
  }

  console.log(`Current: ${current?.value === "true" ? "ARMED" : "disarmed"}`);

  if (!APPLY && !DISABLE) {
    console.log("\nPass --apply to arm, --disable to disarm.");
    return 0;
  }

  const value = DISABLE ? "false" : "true";
  const { error: writeErr } = await supabase
    .from("ciaga_system_settings")
    .upsert(
      { key: "sandbox_reset_enabled", value, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );

  if (writeErr) {
    console.error(`Write failed: ${writeErr.message}`);
    return 1;
  }

  console.log(`Now    : ${value === "true" ? "ARMED" : "disarmed"}`);
  console.log("━".repeat(64));
  return 0;
}

process.exitCode = await main();
