import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browserPath = resolve(projectRoot, '.browsers');
const cli = resolve(dirname(require.resolve('playwright/package.json')), 'cli.js');
console.log(`Installing the managed Chromium into ${browserPath}`);
const child = spawn(process.execPath, [cli, 'install', 'chromium'], {
  cwd: projectRoot,
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserPath },
  stdio: 'inherit',
  windowsHide: true,
});
child.on('error', error => { console.error(`Chromium installation failed: ${error.message}`); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
