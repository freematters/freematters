import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.real.test.ts"],
    exclude: ["**/.claude/worktrees/**", "**/.fc-worktrees/**"],
    testTimeout: 120000,
  },
});
