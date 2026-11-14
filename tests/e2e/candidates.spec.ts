import { test, expect } from '@playwright/test';
import { createServer } from '../../apps/server/src/server.ts';

const ffufOutput = JSON.stringify({
  config: { method: 'GET' },
  results: [
    { input: { FUZZ: '1041' }, status: 200, url: 'https://api.example.test/v1/users/1041' },
    { input: { FUZZ: '1042' }, status: 200, url: 'https://api.example.test/v1/users/1042' },
    { input: { FUZZ: 'about' }, status: 200, url: 'https://api.example.test/about' },
  ],
});

test('ffuf output becomes ranked IDOR candidates and a reviewable draft without target traffic', async ({ page }) => {
  process.env.REPROCASE_HEADLESS = '1';
  const server = await createServer({ memory: true, port: 0 });
  const exceptions: string[] = [];
  const outbound: string[] = [];
  page.on('pageerror', error => exceptions.push(error.message));
  page.on('request', request => { if (request.url().includes('example.test')) outbound.push(request.url()); });
  try {
    await page.goto(server.url);
    await page.getByRole('button', { name: 'Import your evidence' }).click();
    const dialog = page.locator('.modal');
    await dialog.locator('.segmented').getByRole('button', { name: 'ffuf', exact: true }).click();
    await expect(dialog.getByText('ranks likely IDOR leads offline')).toBeVisible();
    await dialog.locator('textarea').fill(ffufOutput);
    await dialog.getByRole('button', { name: 'Find IDOR candidates' }).click();
    const entries = dialog.locator('.candidate-entry');
    await expect(entries).toHaveCount(2);
    await expect(entries.first().locator('code')).toHaveText('https://api.example.test/v1/users/1041');
    await expect(entries.first()).toContainText('Fuzzed identifier returned a 2xx response');
    await entries.first().getByRole('button', { name: 'Create draft' }).click();
    await expect(page.locator('.modal')).toHaveCount(0);
    await expect(page.getByText('/v1/users/{id1}').first()).toBeVisible();
    expect(outbound).toEqual([]);
    expect(exceptions).toEqual([]);
  } finally {
    await server.close();
  }
});
