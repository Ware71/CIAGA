#!/usr/bin/env node
/**
 * PostToolUse(Write|Edit): lint a migration the moment it is written.
 *
 * The same check runs in `npm run check` and in CI, but by then the context that
 * produced the migration is gone. Firing on save turns a review comment into an
 * immediate correction.
 *
 * Only reacts to .sql files under supabase/migrations/; everything else is a
 * no-op, so it costs nothing on ordinary edits.
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return 0;
  }

  const filePath = payload.tool_input?.file_path;
  if (typeof filePath !== "string") return 0;

  const normalised = filePath.replace(/\\/g, "/");
  if (!/\/supabase\/migrations\/[^/]+\.sql$/.test(normalised)) return 0;

  try {
    execFileSync(
      "node",
      [path.join(REPO_ROOT, "scripts", "lint-migrations.mjs"), path.basename(normalised)],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    return 0;
  } catch (err) {
    process.stderr.write(
      `${err.stdout ?? ""}${err.stderr ?? ""}\nFix this migration before continuing.\n`
    );
    return 2;
  }
}

process.exit(main());
