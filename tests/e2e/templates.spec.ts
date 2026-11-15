import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from '../../apps/server/src/server.ts';

const screenshots = resolve('docs/screenshots'); mkdirSync(screenshots, { recursive: true });

test('save a proven case as a template and reuse it on a target the user types', async ({ page }) => {
  process.env.REPROCASE_HEADLESS = '1';
  const server = await createServer({ memory: true, port: 0 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(server.url);
    await page.getByTestId('load-demo').click();
    await expect(page.locator('.connection-pill.connected')).toHaveCount(2);
    const demoOrigin = (await page.getByLabel('Origin api', { exact: true }).inputValue()).trim();

    await page.getByTestId('save-template').click();
    await page.getByLabel('Template name', { exact: true }).fill('Cross-tenant document read');
    await page.getByLabel('Works on', { exact: true }).fill('Document APIs shaped like the demo');
    await page.getByLabel('Tags', { exact: true }).fill('idor, read');
    await page.getByTestId('save-template-confirm').click();
    await expect(page.locator('.alert, [role="status"]').filter({ hasText: 'Saved the template' }).first()).toBeVisible();

    await page.getByTestId('open-templates').click();
    const card = page.getByTestId('template-card').filter({ hasText: 'Cross-tenant document read' });
    await expect(card).toBeVisible();
    await expect(page.getByTestId('template-card').filter({ hasText: 'Built-in' }).first()).toBeVisible();
    await page.screenshot({ path: resolve(screenshots, 'templates-library.png'), fullPage: true, animations: 'disabled' });

    await card.getByTestId('use-template').click();
    // No target is filled in for the user.
    await expect(page.getByLabel('Target address api', { exact: true })).toHaveValue('');
    await expect(page.getByTestId('use-template-confirm')).toBeDisabled();
    await page.getByLabel('Target address api', { exact: true }).fill(demoOrigin);
    await page.getByLabel('Case title', { exact: true }).fill('Reused on site B');
    await page.screenshot({ path: resolve(screenshots, 'templates-use.png'), fullPage: true, animations: 'disabled' });
    await page.getByTestId('use-template-confirm').click();

    await expect(page.locator('.case-heading h1')).toHaveText('Reused on site B');
    await expect(page.getByLabel('Origin api', { exact: true })).toHaveValue(demoOrigin);
    // A template case starts unapproved, with no accounts connected.
    await expect(page.getByLabel('I have reviewed this case’s expected access policy.', { exact: true })).not.toBeChecked();
    await expect(page.locator('.connection-pill.connected')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});
