import { defineConfig, devices } from "@playwright/test";

// Locally this drives the Edge that ships with Windows, so nothing needs
// downloading; CI installs Playwright's Chromium instead.
const channel = process.env.CI ? undefined : "msedge";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://localhost:4173/", trace: "retain-on-failure" },
  webServer: {
    command: "npm run build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/",
    // Always serve a fresh build: reusing a leftover server tests stale code.
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop", use: { channel, viewport: { width: 1440, height: 900 } }, grepInvert: /@docs/ },
    {
      name: "phone",
      use: { ...devices["Pixel 7"], channel, defaultBrowserType: "chromium" },
      grep: /@phone/,
    },
    // Regenerates the README images: npm run docs:screenshots
    { name: "docs", use: { channel, viewport: { width: 1440, height: 900 } }, grep: /@docs/ },
  ],
});
