import { test, expect } from '@playwright/test';
import { createServer } from '../../apps/server/src/server.ts';
import { startProofApi } from '../fixtures/proof-api.ts';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const screenshots = resolve('docs/screenshots'); mkdirSync(screenshots, { recursive: true });

test('five-input write Quick proof creates fresh controls, reproduces, then verifies the fix', async ({ page }) => {
  process.env.REPROCASE_HEADLESS = '1';
  const lab = await startProofApi(); const server = await createServer({ memory: true, port: 0 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  let inputs = 0;
  try {
    await page.goto(server.url); await page.getByTestId('quick-proof').click();
    const dialog = page.locator('.modal');
    const fill = async (label: string, value: string) => { await dialog.getByLabel(label, { exact: true }).fill(value); inputs++; };
    await fill('Target API', lab.origin);
    await fill('Account A · owns the object credential', 'Bearer alice');
    await fill('Account B · tries to access it credential', 'Bearer bob');
    await dialog.getByTestId('qp-connect').click(); await dialog.getByTestId('qp-identity-ok').click();
    await fill('Create request', 'POST /documents\n\n{"text":"before"}');
    await fill('Vulnerable request', 'PATCH /documents/42\n\n{"text":"after"}');
    await page.screenshot({ path: resolve(screenshots, 'quick-write-v2.png'), fullPage: true, animations: 'disabled' });
    await dialog.getByTestId('qp-observe').click(); await expect(dialog.getByTestId('qp-open')).toBeVisible();
    expect(inputs).toBe(5); expect(lab.docs.size).toBe(0);
    await dialog.getByTestId('qp-open').click();
    await page.getByLabel('I have reviewed this case’s expected access policy.', { exact: true }).check();
    const run = async () => { await page.getByLabel('I approve this case version and the target origins above for this run.', { exact: true }).check(); await page.getByTestId('run').click(); await page.getByTestId('confirm-run').click(); };
    await run(); await expect(page.locator('.verdict-banner h2')).toHaveText('Reproduced'); expect(lab.docs.size).toBe(0);
    lab.setSecure(true); await run(); await expect(page.locator('.verdict-banner h2')).toHaveText('Not reproduced'); expect(lab.docs.size).toBe(0);
    expect(errors).toEqual([]);
  } finally { await server.close(); await lab.close(); }
});

test('role read Quick proof needs no creation request or manual pointers', async ({ page }) => {
  process.env.REPROCASE_HEADLESS = '1';
  const lab = await startProofApi(); const server = await createServer({ memory: true, port: 0 });
  try {
    await page.goto(server.url); await page.getByTestId('quick-proof').click(); const dialog = page.locator('.modal');
    await dialog.getByLabel('Proof type').selectOption('role'); await dialog.getByLabel('Target API').fill(lab.origin);
    await dialog.getByLabel('Account A · owns the object credential', { exact: true }).fill('Bearer alice');
    await dialog.getByLabel('Account B · tries to access it credential', { exact: true }).fill('Bearer bob');
    await dialog.getByTestId('qp-connect').click(); await expect(dialog).toContainText('admin → member'); await dialog.getByTestId('qp-identity-ok').click();
    await dialog.getByLabel('Vulnerable request', { exact: true }).fill('GET /admin/report'); await dialog.getByTestId('qp-observe').click(); await dialog.getByTestId('qp-open').click();
    await page.getByLabel('I have reviewed this case’s expected access policy.', { exact: true }).check();
    const run = async () => { await page.getByLabel('I approve this case version and the target origins above for this run.', { exact: true }).check(); await page.getByTestId('run').click(); await page.getByTestId('confirm-run').click(); };
    await run(); await expect(page.locator('.verdict-banner h2')).toHaveText('Reproduced');
    lab.setSecure(true); await run(); await expect(page.locator('.verdict-banner h2')).toHaveText('Not reproduced');
    await expect(page.getByTestId('role-matrix')).toBeDisabled();
  } finally { await server.close(); await lab.close(); }
});

test('CORS Quick proof uses one signed-in browser and a real cross-origin read', async ({ page }) => {
  process.env.REPROCASE_HEADLESS = '1';
  const lab = await startProofApi({ cors: 'reflect' }); const server = await createServer({ memory: true, port: 0 });
  try {
    await page.goto(server.url); await page.getByTestId('quick-proof').click(); const dialog = page.locator('.modal');
    await dialog.getByLabel('Proof type').selectOption('cors_read'); await dialog.getByLabel('Target API').fill(lab.origin);
    await page.screenshot({ path: resolve(screenshots, 'quick-cors-v2.png'), fullPage: true, animations: 'disabled' });
    const started = page.waitForResponse(r => r.url().endsWith('/api/quickproof') && r.request().method() === 'POST');
    await dialog.getByTestId('qp-connect').click(); const { id } = await (await started).json();
    await expect(dialog.getByRole('alert')).toContainText('Sign in there');
    await server.service.browsers.action(id + ':owner', { type: 'navigate', url: '/login/alice' });
    await (server.service.browsers as any).sessions.get(id + ':owner').context.grantPermissions(['local-network-access'], { origin: 'https://reprocase-probe.invalid' });
    await dialog.getByTestId('qp-connect').click(); await dialog.getByTestId('qp-identity-ok').click();
    await expect(dialog.getByLabel('Create request')).toHaveCount(0);
    await dialog.getByLabel('Vulnerable request', { exact: true }).fill('GET /private'); await dialog.getByTestId('qp-observe').click(); await dialog.getByTestId('qp-open').click();
    await expect(page.locator('.actor-card')).toHaveCount(1);
    await page.getByLabel('I have reviewed this case’s expected access policy.', { exact: true }).check();
    const run = async () => { await page.getByLabel('I approve this case version and the target origins above for this run.', { exact: true }).check(); await page.getByTestId('run').click(); await page.getByTestId('confirm-run').click(); };
    await run(); await expect(page.locator('.verdict-banner h2')).toHaveText('Reproduced');
    lab.setCors('safe'); await run(); await expect(page.locator('.verdict-banner h2')).toHaveText('Not reproduced');
  } finally { await server.close(); await lab.close(); }
});
