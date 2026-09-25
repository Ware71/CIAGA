import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { baseline } from "./eslint.baseline.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // next-pwa build output. Minified bundles written into public/ at build
    // time; linting them produced ~2,000 meaningless errors and buried the real
    // ones. worker/index.js is the hand-written source and is still linted.
    "public/sw.js",
    "public/workbox-*.js",
    "public/worker-*.js",
    "public/*.js.map",
  ]),
  {
    rules: {
      // 1,974 of 2,031 lint errors were this one rule, which made `npm run lint`
      // unusable as a gate and hid 57 real errors — including react-hooks
      // set-state-in-effect and exhaustive-deps violations. Recorded as a warning
      // rather than suppressed: the count is still visible, it just no longer
      // outvotes everything else. Tightening it back is a deliberate project.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // Pre-existing violations, recorded per file so the rules stay at "error" for
  // everything else. See eslint.baseline.mjs.
  ...baseline,
]);

export default eslintConfig;
