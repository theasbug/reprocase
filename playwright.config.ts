import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    actionTimeout: 15_000,
    headless: true,
    viewport: { width: 1440, height: 1050 },
    launchOptions: process.env.REPROCASE_CHROMIUM_EXECUTABLE ? { executablePath: process.env.REPROCASE_CHROMIUM_EXECUTABLE } : {},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
