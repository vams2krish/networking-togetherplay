import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 45000,
  expect: { timeout: 12000 },
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    browserName: "chromium",
    viewport: { width: 1440, height: 1100 },
    trace: "retain-on-failure",
  },
});
