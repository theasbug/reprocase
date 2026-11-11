import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './tests/desktop', outputDir: 'test-results-desktop', workers: 1, timeout: 120000, expect: { timeout: 20000 }, reporter: [['list']], use: { actionTimeout: 15000 } });
