// Browser tests for the V2 dashboard. They run against the real docs/v2
// sources plus a snapshot built by the real pipeline from fixtures, served
// exactly the way GitHub Pages serves it.

const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.E2E_PORT || 4173);

function launchOptions() {
  return process.env.E2E_CHROMIUM ? { executablePath: process.env.E2E_CHROMIUM } : {};
}

module.exports = defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.js',
  timeout: 30000,
  expect: { timeout: 7000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  // E2E_CHROMIUM lets a sandbox with a pre-installed browser skip the download
  // (`npx playwright install chromium` is the normal path, and what CI uses).
  projects: [
    {
      name: 'desktop',
      testIgnore: /mobile\.spec\.js/,
      use: { ...devices['Desktop Chrome'], launchOptions: launchOptions() },
    },
    {
      name: 'mobile',
      testMatch: /mobile\.spec\.js/,
      use: { ...devices['Pixel 5'], launchOptions: launchOptions() },
    },
  ],
  webServer: {
    command: 'node tests/e2e/serve.js',
    url: `http://127.0.0.1:${PORT}/v2/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
