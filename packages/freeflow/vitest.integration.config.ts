import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/init.test.ts", "**/install-workflow.test.ts"],
    exclude: ["**/.claude/worktrees/**", "**/.fc-worktrees/**"],
    testTimeout: 30000,
  },
});
