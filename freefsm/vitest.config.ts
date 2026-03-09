import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.fc-worktrees/**"],
    testTimeout: 30000,
  },
});
