import { test, expect } from '@playwright/test';
import { createServer } from '../../apps/server/src/server.ts';
import { startAltApi } from '../fixtures/alt-api.ts';

test('Quick Proof: two accounts and two pasted requests become a reproduced verdict on an unfamiliar API', async ({ page }) => {
  process.env.REPROCASE_HEADLESS = '1';
  const lab = await startAltApi('vulnerable');
  const server = await createServer({ memory: true, port: 0 });
  const exceptions: string[] = [];
  page.on('pageerror', error => exceptions.push(error.message));
  let typedFields = 0;
  const fill = async (locator: ReturnType<typeof page.getByLabel>, value: string) => { await locator.fill(value); typedFields++; };
  try {
    await page.goto(server.url);
    await page.getByTestId('quick-proof').click();
    const dialog = page.locator('.modal');

    // 1 · Accounts: target + two credentials sent in the app's custom header.
    await fill(dialog.getByLabel('Target API'), lab.origin);
    for (const [label, token] of [['Account A · owns the object', lab.users.alice.token], ['Account B · tries to access it', lab.users.bob.token]] as const) {
      await dialog.getByLabel(`${label} header name`).fill('X-Auth-Token');
      await fill(dialog.getByLabel(`${label} credential`), token);
    }
    await dialog.getByTestId('qp-connect').click();

    // 2 · Identity was found without typing a path or JSON Pointer.
    await expect(dialog.getByText('GET /api/v1/profile')).toBeVisible();
    await expect(dialog.getByText('Different organizations (cross-tenant)')).toBeVisible();
    await dialog.getByTestId('qp-identity-ok').click();

    // 3 · Two pasted requests.
    await fill(dialog.getByLabel('Create request'), 'POST /api/v1/notes HTTP/1.1\nContent-Type: application/json\n\n{"text":"hello","color":"blue"}');
    await fill(dialog.getByLabel('Vulnerable request'), `GET ${lab.origin}/api/v1/notes/7a1f3c2e-1b2c-4d5e-8f90-112233445566`);
    await dialog.getByTestId('qp-observe').click();

    // 4 · Preview and what was learned.
    await expect(dialog.getByText('Account B could read account A’s new object.')).toBeVisible();
    await expect(dialog.getByText('/api/v1/notes/{resource}')).toBeVisible();
    await expect(dialog.getByText('/api/v1/csrf → x-xsrf-token')).toBeVisible();
    await dialog.getByTestId('qp-open').click();

    // Review the policy, approve, run.
    await page.getByLabel('I have reviewed this case’s expected access policy.').check();
    await page.getByLabel('I approve this case version and the target origins above for this run.').check();
    await page.getByTestId('run').click();
    await page.getByTestId('confirm-run').click();
    await expect(page.locator('.verdict-banner h2')).toHaveText('Reproduced', { timeout: 20000 });
    expect(typedFields).toBeLessThanOrEqual(5);
    expect(exceptions).toEqual([]);
  } finally {
    await server.close();
    await lab.close();
  }
});
