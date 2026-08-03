import { defineConfig } from "vitest/config";

export default defineConfig({
  // Resolves the "@/*" aliases from tsconfig.json natively (no plugin needed).
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The parser suite shells out to Python across 12 fixture workbooks.
    testTimeout: 120_000,
    env: {
      // src/db connects lazily but throws at import time without a URL, so
      // modules that merely re-export pure helpers still need one present.
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgres://test:test@127.0.0.1:5432/test",
    },
  },
});
