#!/usr/bin/env node
/**
 * Stop: refuse to end a turn with the Supabase CLI left linked to production.
 *
 * Rule #1 in CLAUDE.md is that the CLI must ALWAYS be left linked to staging.
 * A deploy legitimately links production to push migrations, and the re-link is
 * the step that gets forgotten — after which the next `db push` in an unrelated
 * session, in any worktree, targets production.
 *
 * Self-healing: the message tells Claude to re-link, and the next Stop passes.
 *
 * Override when you deliberately need to stay on production:
 *   CIAGA_ALLOW_PROD_LINK=1
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function main() {
  if (process.env.CIAGA_ALLOW_PROD_LINK === "1") return 0;

  let payload = {};
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    /* fall through — an unreadable payload must not wedge the turn */
  }

  // Set once this hook has already blocked; without it a Claude that cannot
  // re-link (no CLI, no network) would be held in the turn indefinitely.
  if (payload.stop_hook_active) return 0;

  let linkedRef;
  let envs;
  try {
    linkedRef = readFileSync(
      path.join(REPO_ROOT, "supabase", ".temp", "project-ref"),
      "utf8"
    ).trim();
    envs = JSON.parse(
      readFileSync(path.join(REPO_ROOT, ".claude", "db-environments.json"), "utf8")
    ).supabase;
  } catch {
    return 0; // not linked, or config missing — nothing to enforce
  }

  const prod = envs?.production?.project_ref;
  const staging = envs?.staging?.project_ref;
  if (!prod || linkedRef !== prod) return 0;

  process.stderr.write(
    [
      `The Supabase CLI is still linked to PRODUCTION (${prod}).`,
      "",
      "It must always be left linked to staging. Re-link before finishing:",
      "",
      `  npx supabase link --project-ref ${staging}`,
      "  node scripts/check-db-env.js",
      "",
      "If staying on production is deliberate, set CIAGA_ALLOW_PROD_LINK=1.",
    ].join("\n")
  );
  return 2;
}

process.exit(main());
