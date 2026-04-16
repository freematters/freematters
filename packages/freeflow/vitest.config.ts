import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.fc-worktrees/**",
      "**/.claude/worktrees/**",
    ],
    testTimeout: 30000,
  },
});
