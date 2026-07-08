import { defineConfig } from "vitest/config";

// Unit tests for pure logic only (fantasy simulation engine, market registry,
// validation) — no DOM, no Supabase. Run with `npm run test` in apps/app.
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: ["lib/**/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
