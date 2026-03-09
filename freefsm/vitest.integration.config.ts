import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/install.test.ts"],
    testTimeout: 30000,
  },
});
