import { chromium, expect, type Locator } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createServer } from '../apps/server/src/server.ts';

// Records the real local product. No provider is configured and no verdict is mocked.
// Run npm run build first, then: node --import tsx scripts/record-launch-demo.ts
const output = resolve(process.env.REPROCASE_RECORD_OUT ?? '.cache/launch-demo');
await mkdir(output, { recursive: true });
process.env.REPROCASE_HEADLESS = '1';
const server = await createServer({ memory: true, port: 0 });
const browser = await chromium.launch({ headless: true,
  ...(process.env.REPROCASE_CHROMIUM_EXECUTABLE ? { executablePath: process.env.REPROCASE_CHROMIUM_EXECUTABLE } : {}),
});
const context = await browser.newContext({ viewport: { width: 1600, height: 900 },
  recordVideo: { dir: join(output, 'raw'), size: { width: 1600, height: 900 } },
  locale: 'en-US', colorScheme: 'dark', deviceScaleFactor: 1,
});
const captureStart = performance.now();
const page = await context.newPage();
const video = page.video()!;
const errors: string[] = [];
page.on('pageerror', error => errors.push(error.message));
const captions: { start: number; end: number; text: string }[] = [];
let start = 0;
let trimSeconds = 0;
const elapsed = () => (performance.now() - start) / 1000;
const holdUntil = async (second: number) => { const delay = second * 1000 - (performance.now() - start); if (delay > 0) await new Promise(r => setTimeout(r, delay)); };
const click = async (locator: Locator) => {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 14 });
  await locator.click();
};
const overview = () => page.locator('.case-tabs').getByRole('button', { name: 'Investigation', exact: true });
const approve = () => page.getByLabel('I approve this case version and the target origins above for this run.', { exact: true });
const run = async (expected: 'Reproduced' | 'Not reproduced') => {
  await approve().check();
  await click(page.getByTestId('run'));
  await expect(page.getByRole('dialog', { name: 'Run preflight', exact: true })).toBeVisible();
  await new Promise(r => setTimeout(r, 900));
  await click(page.getByTestId('confirm-run'));
  await expect(page.locator('.verdict-banner h2')).toHaveText(expected, { timeout: 20000 });
  await page.locator('.verdict-banner').scrollIntoViewIfNeeded();
};
try {
  await page.goto(server.url);
  await click(page.getByTestId('load-demo'));
  await expect(page.locator('.connection-pill.connected')).toHaveCount(2);
  await expect(page.locator('.save-status')).toContainText('r1');
  await page.locator('.target-strip').scrollIntoViewIfNeeded();
  await new Promise(r => setTimeout(r, 300));
  start = performance.now();
  trimSeconds = (start - captureStart) / 1000;
  const identities = await page.locator('.actor-card .actor-identity strong').allTextContents();
  const revision = await page.locator('.save-status').innerText();
  captions.push({ start: 0, end: 5, text: 'Fresh accounts. Reproducible proofs.\nActual local demo — no API key required.' });
  await holdUntil(4);
  captions.push({ start: 5, end: 14, text: 'Verify two separate accounts, then run the IDOR case.\nA fresh resource and marker establish the access witness.' });
  await run('Reproduced');
  if (elapsed() > 13) throw new Error('First run exceeded the recording budget; record again without speeding up evidence.');
  await holdUntil(14);
  await page.screenshot({ path: join(output, 'first-proof.png') });
  await click(overview());
  captions.push({ start: 14, end: 23, text: 'Replace both accounts with fresh identities.\nThe case specification stays at the same revision.' });
  await holdUntil(16);
  await click(page.getByTestId('fresh-identities'));
  await expect.poll(() => page.locator('.actor-card .actor-identity strong').allTextContents()).not.toEqual(identities);
  await expect(page.locator('.save-status')).toHaveText(revision);
  await page.locator('.actor-card').first().scrollIntoViewIfNeeded();
  await holdUntil(22);
  captions.push({ start: 23, end: 32, text: 'Run the unchanged case with new accounts and a new resource.\nThe authorization failure is reproduced again.' });
  await run('Reproduced');
  await expect(page.locator('.history-item')).toHaveCount(2);
  if (elapsed() > 31) throw new Error('Second run exceeded the recording budget.');
  await holdUntil(32);
  await click(overview());
  captions.push({ start: 32, end: 42, text: 'Switch the local application to its secure implementation.\nThe same case now reports: Not reproduced.' });
  await click(page.getByTestId('secure-toggle'));
  await expect(page.getByTestId('secure-toggle')).toContainText('Secure target');
  await holdUntil(34);
  await run('Not reproduced');
  await expect(page.locator('.history-item')).toHaveCount(3);
  await holdUntil(42);
  await page.screenshot({ path: join(output, 'secure-proof.png') });
  captions.push({ start: 42, end: 50, text: 'Review and export a sanitized case package.\nRecipients connect their own local sessions.' });
  await click(page.getByRole('button', { name: 'Export case', exact: true }));
  const dialog = page.getByRole('dialog', { name: 'Review before sharing', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Download package', exact: true })).toBeDisabled();
  await holdUntil(45);
  await dialog.getByLabel('I have reviewed the contents for sensitive information.', { exact: true }).check();
  const downloaded = page.waitForEvent('download');
  await click(dialog.getByRole('button', { name: 'Download package', exact: true }));
  const download = await downloaded;
  await download.saveAs(join(output, 'demo.reprocase.json'));
  const contents = await readFile(join(output, 'demo.reprocase.json'), 'utf8');
  expect(contents).not.toContain('Bearer ');
  expect(contents).not.toContain('rc_session=');
  expect(contents).not.toContain(server.token);
  const runs = server.service.state().runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  expect(runs.map(r => r.verdict)).toEqual(['reproduced', 'reproduced', 'not_reproduced']);
  expect(new Set(runs.map(r => r.caseRevision)).size).toBe(1);
  expect(errors).toEqual([]);
  await holdUntil(50);
  await page.keyboard.press('Escape');
  captions.push({ start: 50, end: 56, text: 'Try the local demo. No API key required.\ngithub.com/theasbug/reprocase' });
  await holdUntil(56);
  const receipt = {
    product: 'ReproCase', version: server.service.state().version,
    recordedAt: new Date().toISOString(), source: 'real local HTTP fixture and workbench',
    sourceCommit: process.env.REPROCASE_SOURCE_COMMIT ?? 'recorded working tree',
    sameCaseRevision: true, freshIdentitiesChanged: true, providerConfigured: false,
    outcomes: runs.map(r => ({ verdict: r.verdict, code: r.code, caseRevision: r.caseRevision, requests: r.requests })),
    sanitizedExportVerified: true, pageErrors: errors, editedVerdicts: false,
  };
  await writeFile(join(output, 'verification.json'), JSON.stringify(receipt, null, 2) + '\n');
  await writeFile(join(output, 'captions.json'), JSON.stringify(captions, null, 2) + '\n');
  await writeFile(join(output, 'recording.json'), JSON.stringify({ trimSeconds, contentSeconds: 56, viewport: { width: 1600, height: 900 } }, null, 2));
} finally {
  await context.close();
  await video.saveAs(join(output, 'recording.webm'));
  await browser.close();
  await server.close();
}
console.log(JSON.stringify({ output, recorded: true, duration: 56, outcomes: ['reproduced', 'reproduced', 'not_reproduced'] }));
