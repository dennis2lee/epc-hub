import { defineConfig } from "vitest/config";
import path from "node:path";

// Unit tests: `npm test`. Integration tests against the local Supabase stack:
// `npm run test:int` (requires `npm run db:start` and .env.local).
const integration = process.env.VITEST_INTEGRATION === "1";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "src/tests/empty.ts"),
    },
  },
  test: {
    include: integration ? ["src/**/*.int.test.ts"] : ["src/**/*.test.ts"],
    exclude: integration ? [] : ["src/**/*.int.test.ts", "node_modules/**"],
    coverage: { reportsDirectory: "build/coverage" },
  },
});
