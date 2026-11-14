import { test, expect, _electron } from '@playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startProofApi } from '../fixtures/proof-api.ts';

test('packaged app learns and executes a v2 write proof with its bundled browser transport', async () => {
  const root = resolve('.'), work = resolve('../../work'); mkdirSync(work, { recursive: true });
  const executablePath = process.env.REPROCASE_DESKTOP_EXE;
  if (!executablePath) throw new Error('Set REPROCASE_DESKTOP_EXE to the packaged app');
  const lab = await startProofApi();
  const app = await _electron.launch({ executablePath, args: [], cwd: root, env: { ...Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined)) as Record<string, string>, REPROCASE_HEADLESS: '1', REPROCASE_DESKTOP_WORKSPACE: mkdtempSync(join(work, 'desktop-expanded-')) }, timeout: 60000 });
  try {
    const page = await app.firstWindow(); await expect(page.getByTestId('quick-proof')).toBeVisible();
    const result = await page.evaluate(async origin => {
      const api = async (path: string, body?: unknown) => {
        const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${sessionStorage.getItem('reprocase.token') ?? ''}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
        const value = await response.json(); if (!response.ok) throw new Error(JSON.stringify(value)); return value;
      };
      const session = await api('/api/quickproof', { origin });
      for (const [actor, token] of [['owner', 'alice'], ['researcher', 'bob']]) await api(`/api/quickproof/${session.id}/connect`, { actor, token });
      await api(`/api/quickproof/${session.id}/identity`, {});
      const learned = await api(`/api/quickproof/${session.id}/observe`, { create: 'POST /documents\n\n{"text":"before"}', vulnerable: 'PATCH /documents/42\n\n{"text":"after"}' });
      if (learned.status !== 'ready') throw new Error(JSON.stringify(learned));
      const response = await fetch(`/api/cases/${learned.case.id}`, { method: 'PUT', headers: { Authorization: `Bearer ${sessionStorage.getItem('reprocase.token')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ case: { ...learned.case, policy: { ...learned.case.policy, acknowledged: true } }, expectedRevision: learned.case.revision }) });
      const spec = await response.json(); if (!response.ok) throw new Error(JSON.stringify(spec));
      const started = await api(`/api/cases/${spec.id}/run`, { targets: { api: origin }, approvedRevision: spec.revision, intervalMs: 0 });
      for (let i = 0; i < 300; i++) { const run = await api(`/api/runs/${started.id}`); if (run.state !== 'running') return run; await new Promise(resolve => setTimeout(resolve, 100)); }
      throw new Error('Packaged write proof timed out');
    }, lab.origin);
    expect(result.schemaVersion).toBe(2); expect(result.verdict, result.reason).toBe('reproduced');
    expect(lab.docs.size).toBe(0); expect(result.cleanupErrors).toEqual([]);
  } finally { await app.close(); await lab.close(); }
});
