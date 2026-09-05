// scripts/recompress-storage-images.mjs
//
// Re-encodes the avatars and group images already sitting in Storage, and
// refreshes their Cache-Control.
//
// Background (2026-09 egress audit): until now components/profile/ProfileScreen
// and majors/groups/[id]/GroupDetailClient uploaded the file straight off the
// picker — a 3-5 MB camera original — with `cacheControl: "3600"`. Those images
// render at 16-96px across ~45 sites and the service worker declined to cache
// them, so production burned 6.5 GB of cached egress in a month against an
// 18 MB bucket and a userbase of ten. The upload paths are fixed; this fixes the
// images that were uploaded before they were.
//
// It rewrites each object AT THE SAME PATH. That matters: `profiles.avatar_url`
// stores a public URL frozen at upload time, the same URL is copied into
// `auth.user_metadata.avatar_url`, and it can be embedded in stored feed
// payloads (lib/feed/schemas.ts). Re-pathing would mean chasing all three and
// would still strand copies. Overwriting the bytes leaves every URL valid — the
// Smart CDN invalidates on update within ~60s, and browsers holding the old copy
// self-heal within the hour that the old Cache-Control bought.
//
// Two consequences worth knowing before you run it:
//
//   Extensions go stale. A `.jpg` path will serve `image/webp`. That is
//   harmless — Storage serves the contentType it was given, and nothing in the
//   app parses the extension — but it looks odd in the dashboard.
//
//   HEIC is skipped. sharp has no libheif here, so anything it cannot decode is
//   reported and left alone rather than crashing the run.
//
// Usage:
//   node scripts/recompress-storage-images.mjs                       # dry run vs staging
//   node scripts/recompress-storage-images.mjs --apply               # rewrite staging
//   node scripts/recompress-storage-images.mjs --bucket avatars
//
//   # production, without writing a service-role key to disk:
//   PROD_SUPABASE_URL=… PROD_SUPABASE_SERVICE_ROLE_KEY=… \
//     node scripts/recompress-storage-images.mjs --apply
//
//   node scripts/recompress-storage-images.mjs --env-file <path> --apply
//
// This talks to whatever the env file points at. It never touches the Supabase
// CLI link, so the stay-linked-to-staging rule in CLAUDE.md is unaffected.
// Run staging first, eyeball the avatars in the app, then production.

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { dirname, join, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const envFileArg = argValue("--env-file");
const bucketArg = argValue("--bucket");

// Mirrors VARIANTS.avatar / VARIANTS.group in apps/app/lib/media/compressImage.ts.
// Keep the two in step, or a backfilled image and a freshly uploaded one will
// disagree about what an avatar is.
const TARGETS = {
  avatars: { maxEdge: 320, targetBytes: 40 * 1024 },
  "group-images": { maxEdge: 512, targetBytes: 80 * 1024 },
};

const WANT_CACHE_CONTROL = "max-age=31536000";
const CACHE_CONTROL_SECONDS = "31536000";

// Only rewrite when the re-encode is a real win. Re-encoding a file that is
// already small buys a few bytes and costs a generation of quality.
const WORTH_REWRITING_RATIO = 0.9;

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Credentials, in precedence order:
 *
 *   1. --env-file <path>   an explicit flag means what it says
 *   2. the environment     PROD_SUPABASE_URL + PROD_SUPABASE_SERVICE_ROLE_KEY
 *   3. apps/app/.env.local the staging default
 *
 * Step 2 exists so a production run never has to write a service-role key to
 * disk. Each source is taken whole — a URL from one and a key from another
 * would eventually point a production key at staging, or worse.
 */
function pick(source) {
  return {
    url: source.PROD_SUPABASE_URL || source.NEXT_PUBLIC_SUPABASE_URL || source.SUPABASE_URL,
    key: source.PROD_SUPABASE_SERVICE_ROLE_KEY || source.SUPABASE_SERVICE_ROLE_KEY,
  };
}

const fromEnvVars = pick(process.env);
const hasEnvVars = Boolean(fromEnvVars.url && fromEnvVars.key);

// A half-set pair is a typo, not a choice. Say so rather than silently falling
// back to the staging file and reporting a confusingly empty production bucket.
if (!envFileArg && !hasEnvVars && (fromEnvVars.url || fromEnvVars.key)) {
  console.error(
    "Only one of the Supabase environment variables is set. Set both, or neither.\n" +
      `  URL: ${fromEnvVars.url ? "set" : "MISSING"}\n` +
      `  key: ${fromEnvVars.key ? "set" : "MISSING"}`,
  );
  process.exit(1);
}

let url;
let key;
let credsFrom;

if (!envFileArg && hasEnvVars) {
  ({ url, key } = fromEnvVars);
  credsFrom = "environment";
} else {
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

  ({ url, key } = pick(env));
  credsFrom = envPath;

  if (!url || !key) {
    console.error(
      `Missing Supabase URL / service-role key in ${envPath}\n` +
        "Expected NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY " +
        "(or PROD_SUPABASE_URL + PROD_SUPABASE_SERVICE_ROLE_KEY).\n" +
        "Alternatively set PROD_SUPABASE_URL and PROD_SUPABASE_SERVICE_ROLE_KEY " +
        "in the environment and pass no --env-file.",
    );
    process.exit(1);
  }
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

const buckets = bucketArg ? [bucketArg] : Object.keys(TARGETS);
for (const b of buckets) {
  if (!TARGETS[b]) {
    console.error(`Unknown bucket "${b}". Known: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(1);
  }
}

console.log("━".repeat(72));
console.log(`Target : ${envName}`);
console.log(`URL    : ${url}`);
console.log(`Creds  : ${credsFrom}`);
console.log(`Buckets: ${buckets.join(", ")}`);
console.log(`Mode   : ${APPLY ? "APPLY — objects will be overwritten" : "dry run"}`);
console.log("━".repeat(72));

/**
 * Storage has no recursive list. Folders come back as entries with a null id,
 * so walk them. Avatars are `<uid>/<file>`; group images are
 * `groups/<groupId>/<file>`, hence a depth of more than one.
 */
async function listAll(supabase, bucket, prefix = "", depth = 0) {
  if (depth > 4) return [];

  const out = [];
  const pageSize = 100;

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: pageSize, offset });

    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        out.push(...(await listAll(supabase, bucket, path, depth + 1)));
      } else {
        out.push({ path, metadata: entry.metadata ?? {} });
      }
    }

    if (data.length < pageSize) break;
  }

  return out;
}

async function processBucket(supabase, bucket) {
  const { maxEdge, targetBytes } = TARGETS[bucket];
  console.log(`\n## ${bucket}  (max edge ${maxEdge}px, target ${formatBytes(targetBytes)})\n`);

  let objects;
  try {
    objects = await listAll(supabase, bucket);
  } catch (e) {
    console.error(`  ! ${e.message}`);
    return { before: 0, after: 0, rewritten: 0, skipped: 0, failed: 1 };
  }

  if (objects.length === 0) {
    console.log("  (empty)");
    return { before: 0, after: 0, rewritten: 0, skipped: 0, failed: 0 };
  }

  const totals = { before: 0, after: 0, rewritten: 0, skipped: 0, failed: 0 };

  for (const obj of objects) {
    const originalBytes = Number(obj.metadata.size ?? 0);
    const cacheControl = String(obj.metadata.cacheControl ?? "");
    const cacheStale = cacheControl !== WANT_CACHE_CONTROL;

    const { data: blob, error: dlErr } = await supabase.storage.from(bucket).download(obj.path);
    if (dlErr) {
      console.log(`  ! ${obj.path} — download failed: ${dlErr.message}`);
      totals.failed += 1;
      continue;
    }

    const input = Buffer.from(await blob.arrayBuffer());
    totals.before += input.byteLength;

    let output;
    try {
      output = await sharp(input)
        // Honour the EXIF orientation before dropping the EXIF, or every iPhone
        // portrait comes out sideways with nothing left to correct it.
        .rotate()
        .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } catch (e) {
      // Almost always HEIC: sharp here has no libheif.
      console.log(`  ! ${obj.path} — could not decode (${formatBytes(input.byteLength)}): ${e.message}`);
      totals.after += input.byteLength;
      totals.failed += 1;
      continue;
    }

    const smaller = output.byteLength < input.byteLength * WORTH_REWRITING_RATIO;
    if (!smaller && !cacheStale) {
      console.log(`    ${obj.path} — already fine (${formatBytes(input.byteLength)})`);
      totals.after += input.byteLength;
      totals.skipped += 1;
      continue;
    }

    // Already small, but still carrying a 1-hour TTL: keep the original bytes
    // and re-upload purely to refresh the metadata.
    const body = smaller ? output : input;
    const contentType = smaller ? "image/webp" : String(obj.metadata.mimetype || "image/jpeg");
    const reason = smaller ? `${formatBytes(input.byteLength)} → ${formatBytes(body.byteLength)}` : `cache-control ${cacheControl || "unset"} → ${WANT_CACHE_CONTROL}`;

    totals.after += body.byteLength;

    if (!APPLY) {
      console.log(`  · ${obj.path} — would rewrite (${reason})`);
      totals.rewritten += 1;
      continue;
    }

    const { error: upErr } = await supabase.storage.from(bucket).upload(obj.path, body, {
      upsert: true,
      cacheControl: CACHE_CONTROL_SECONDS,
      contentType,
    });

    if (upErr) {
      console.log(`  ! ${obj.path} — upload failed: ${upErr.message}`);
      totals.failed += 1;
      continue;
    }

    console.log(`  ✓ ${obj.path} — ${reason}`);
    totals.rewritten += 1;
  }

  return totals;
}

// process.exitCode rather than process.exit(): the Supabase client leaves fetch
// handles open, and tearing them down mid-flight trips a libuv assertion on
// Windows. Same reason as enable-sandbox-reset.mjs.
async function main() {
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // `list()` on a bucket that does not exist returns an empty array, not an
  // error, so check up front — otherwise a typo'd or unprovisioned bucket reads
  // as "nothing to do" and the run looks like a success.
  const { data: existing, error: bucketErr } = await supabase.storage.listBuckets();
  if (bucketErr) {
    console.error(`Could not list buckets: ${bucketErr.message}`);
    return 1;
  }
  const names = new Set((existing ?? []).map((b) => b.name));
  const missing = buckets.filter((b) => !names.has(b));
  if (missing.length > 0) {
    console.error(`Bucket(s) not found on this project: ${missing.join(", ")}`);
    return 1;
  }

  const grand = { before: 0, after: 0, rewritten: 0, skipped: 0, failed: 0 };
  for (const bucket of buckets) {
    const t = await processBucket(supabase, bucket);
    for (const k of Object.keys(grand)) grand[k] += t[k];
  }

  console.log("\n" + "━".repeat(72));
  console.log(
    `${APPLY ? "Rewrote" : "Would rewrite"} ${grand.rewritten}, skipped ${grand.skipped}, failed ${grand.failed}`,
  );
  console.log(
    `Total ${formatBytes(grand.before)} → ${formatBytes(grand.after)}` +
      (grand.before > 0
        ? `  (${Math.round((1 - grand.after / grand.before) * 100)}% smaller, ${(grand.before / Math.max(grand.after, 1)).toFixed(1)}× on egress per view)`
        : ""),
  );
  if (!APPLY) console.log("\nDry run. Pass --apply to rewrite.");
  console.log("━".repeat(72));

  return grand.failed > 0 ? 1 : 0;
}

process.exitCode = await main();
