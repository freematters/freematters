import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.fc-worktrees/**",
      "**/install.test.ts",
      "**/*.real.test.ts",
    ],
    testTimeout: 30000,
  },
});
