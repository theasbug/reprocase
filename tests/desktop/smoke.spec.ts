import { test, expect, _electron } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Cross-platform smoke test for the packaged desktop app (Windows, macOS, Linux):
 * it starts, uses the bundled Chromium, runs the local demo to a verdict, and only offers
 * native desktop-control tools on Windows.
 */
test('packaged desktop app starts, runs the demo and exposes only supported tools', async () => {
  const project = resolve('.'), work = resolve('../../work'); mkdirSync(work, { recursive: true });
  const workspace = mkdtempSync(join(work, 'desktop-smoke-'));
  const electron = process.platform === 'win32' ? 'electron.exe' : process.platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
  const executablePath = process.env.REPROCASE_DESKTOP_EXE ?? join(project, 'node_modules/electron/dist', electron);
  const app = await _electron.launch({
    executablePath,
    args: process.env.REPROCASE_DESKTOP_EXE ? [] : [project],
    cwd: project,
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([name, value]) => name !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>, REPROCASE_HEADLESS: '1', REPROCASE_DESKTOP_WORKSPACE: workspace },
    timeout: 60000,
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId('load-demo')).toBeVisible();
    const info = await page.evaluate(() => (window as any).reprocase?.appInfo?.() ?? null);
    if (info) expect(info.desktop).toBe(true);

    // Desktop-control tools exist only where they are implemented.
    const tools: string[] = await page.evaluate(async () => {
      const response = await fetch('/api/agent/state', { headers: { Authorization: `Bearer ${sessionStorage.getItem('reprocase.token') ?? ''}` } });
      return (await response.json()).tools.map((tool: { name: string }) => tool.name);
    });
    const desktopTools = tools.filter(name => name.startsWith('desktop_'));
    if (process.platform === 'win32') expect(desktopTools.length).toBeGreaterThan(0);
    else expect(desktopTools).toEqual([]);

    // The bundled Chromium and the shared runner work on this platform.
    await page.getByTestId('load-demo').click();
    await expect(page.locator('.connection-pill.connected')).toHaveCount(2, { timeout: 60000 });
    await page.getByLabel('I approve this case version and the target origins above for this run.', { exact: true }).check();
    await page.getByTestId('run').click();
    await page.getByTestId('confirm-run').click();
    await expect(page.locator('.verdict-banner h2')).toHaveText('Reproduced', { timeout: 60000 });
  } finally {
    await app.close();
  }
});
