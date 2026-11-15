import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const CI = Boolean(process.env.CI);

/**
 * E2E smoke runs against the production build (`vite preview`).
 * Locally it uses the installed Chrome (channel "chrome"); CI uses Playwright's Chromium.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: CI ? 60_000 : 30_000,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(CI ? {} : { channel: 'chrome' }) },
    },
  ],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 60_000,
  },
});
