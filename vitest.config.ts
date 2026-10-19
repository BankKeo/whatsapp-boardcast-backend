import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
    },
    hookTimeout: 120_000,
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
