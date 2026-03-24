import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.spec.ts",
  timeout: 60000,
  retries: 0,
  workers: 1,
  use: {
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 15000,
  },
  reporter: "list",
});
