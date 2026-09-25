# Supabase Environments

| Env | Project ref |
|---|---|
| staging | `balcwdqjzouufxigszup` |
| production | `jcmkyxlfyrhkgeszefjb` |

**The CLI must always be left linked to staging.** If a task requires linking to
production, re-link staging immediately afterwards.

```bash
node scripts/check-db-env.js          # which project am I linked to?
node scripts/migration-status.mjs     # what has not reached production yet?
```

## Where the real procedure lives

This file used to carry its own copy of the migration workflow. It had drifted: it
told you to link production and push, and never mentioned re-linking staging — the
single rule that matters most. Four copies of this policy existed and this was the
oldest, so it is now a pointer rather than a fourth source of truth.

- **Deploy procedure** — `.claude/skills/deploy/SKILL.md` (`/deploy`)
- **Writing a migration** — `.claude/rules/supabase-migrations.md`
- **Project refs, machine-readable** — `.claude/db-environments.json`, read by
  `scripts/check-db-env.js`
- **Summary** — the "Database environments" section of the root `CLAUDE.md`

A `Stop` hook now refuses to end a turn with the CLI linked to production, so the
re-link step is enforced rather than remembered.
