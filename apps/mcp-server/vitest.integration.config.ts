import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 120_000,
    environment: "node",
    // Integration tests need a real Postgres + Anthropic key. Skip if missing.
  },
});
