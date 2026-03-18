import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.real.test.ts"],
    testTimeout: 120000,
  },
});
