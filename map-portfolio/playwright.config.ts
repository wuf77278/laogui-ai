import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4178",
    viewport: { width: 1440, height: 900 },
    screenshot: "only-on-failure"
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:4178/api/health",
    reuseExistingServer: true,
    timeout: 120000
  }
});
