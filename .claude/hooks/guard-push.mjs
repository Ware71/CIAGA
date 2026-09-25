#!/usr/bin/env node
/**
 * PreToolUse(Bash): refuse to push anything directly onto main.
 *
 * Deploying CIAGA means merging develop into main on a real local checkout.
 * `git push origin develop:main` skips the merge commit, so main's history stops
 * matching what was reviewed, and origin/develop is left behind — staging then
 * serves a build from before the work existed while main looks perfectly healthy.
 *
 * This is written down in CLAUDE.md and again in the deploy skill. Both are
 * context, not enforcement, so it lives here as well.
 *
 * Blocks any push refspec whose destination is main (develop:main, HEAD:main,
 * +develop:main). A plain `git push` while checked out on main — what the deploy
 * flow actually does — is untouched.
 *
 * Override for a genuine exception: CIAGA_ALLOW_DIRECT_PUSH=1
 */

import { readFileSync } from "node:fs";

function main() {
  if (process.env.CIAGA_ALLOW_DIRECT_PUSH === "1") return 0;

  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return 0; // never break the session over an unreadable payload
  }

  if (payload.tool_name !== "Bash") return 0;
  const raw = String(payload.tool_input?.command ?? "");

  // Only inspect what the shell will actually execute. Everything from the
  // first heredoc marker onward is data — a commit message describing this very
  // rule contains "develop:main" and must not trip it. (It did, on first run.)
  const command = raw.split("<<")[0];

  // Look at each command segment separately and require it to *be* a git push,
  // not merely mention one. `echo "never git push origin develop:main"` is talk;
  // `git push origin develop:main` is the thing being prevented.
  const segments = command.split(/(?:\|\||&&|[;&|\n])/);
  const pushes = segments
    .map((s) => s.trim())
    .filter((s) => /^(?:sudo\s+)?git\s+(?:-[^\s]+\s+|--[^\s]+(?:=[^\s]+)?\s+)*push\b/.test(s));
  if (pushes.length === 0) return 0;

  // A refspec landing on main: "<something>:main" or "<something>:refs/heads/main"
  const refspec = /(?:^|\s)\+?[^\s:]+:(?:refs\/heads\/)?main(?:\s|$)/;
  const offending = pushes.find((s) => refspec.test(s));
  if (!offending) return 0;

  process.stderr.write(
    [
      "Blocked: this pushes straight onto main.",
      "",
      `  ${offending}`,
      "",
      "Deploy is a real merge, not a refspec push. Use the /deploy skill, or:",
      "",
      "  git push origin develop   # staging deploys from develop — first",
      "  git checkout main && git pull && git merge develop",
      "  git push",
      "  git checkout develop",
      "",
      "Pushing develop:main leaves origin/develop behind, so staging keeps",
      "serving old code while main looks fine. That cost a long debugging",
      "session on 2026-07-31.",
      "",
      "If this really is the exception, re-run with CIAGA_ALLOW_DIRECT_PUSH=1.",
    ].join("\n")
  );
  return 2;
}

process.exit(main());
