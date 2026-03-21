import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/install.test.ts"],
    exclude: ["**/.claude/worktrees/**", "**/.fc-worktrees/**"],
    testTimeout: 30000,
  },
});
