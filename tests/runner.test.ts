import { afterEach, describe, expect, it } from 'vitest';
import { createExampleCase, createWriteExampleCase, executeCase, validateCase, type SessionTransport } from '@reprocase/core';
import { BrowserManager } from '@reprocase/browser';
import { startDemo, type DemoMode, type DemoServer } from '../apps/server/src/demo.ts';

let demo: DemoServer | undefined;
let browser: BrowserManager | undefined;
afterEach(async () => { await browser?.close(); await demo?.close(); demo = undefined; browser = undefined; });
async function setup(mode: DemoMode = 'vulnerable', auth: 'cookie' | 'bearer' = 'cookie') {
  demo = await startDemo(mode); browser = new BrowserManager();
  await bindPair(auth);
  return { spec: createExampleCase(), config: { targets: { api: demo.origin }, approvedRevision: 1, intervalMs: 0 } };
}
async function bindPair(auth: 'cookie' | 'bearer') {
  for (const [i, actor] of ['owner', 'researcher'].entries()) {
    const user = demo!.accounts[i];
    if (auth === 'cookie') await browser!.connectDirect(actor, { origin: demo!.origin, login: { path: '/auth/login', method: 'POST', body: { email: user.email, password: user.password } } });
    else {
      const response = await fetch(`${demo!.origin}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password: user.password }) });
      const login = await response.json() as { token: string };
      await browser!.connectDirect(actor, { origin: demo!.origin, token: login.token });
    }
  }
}
const transport = (): SessionTransport => ({ request: (actor, request, signal) => browser!.request(actor, request, signal), knownSecrets: () => browser!.knownSecrets() });

describe('fresh-account relational reproduction', () => {
  it('validates the example and reproduces with live cookie sessions, ownership proof and cleanup', async () => {
    const { spec, config } = await setup();
    expect(validateCase(spec)).toEqual([]);
    const result = await executeCase(spec, config, transport());
    expect(result.verdict).toBe('reproduced');
    expect(result.code).toBe('witness_observed');
    expect(result.checks.filter(c => c.id.startsWith('resource-')).every(c => c.passed)).toBe(true);
    expect(demo!.stats().documentCount).toBe(0);
    const serialized = JSON.stringify(result);
    for (const secret of browser!.knownSecrets()) expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(demo!.accounts[0].id);
    expect(serialized).not.toContain(demo!.accounts[1].id);
  });
  it('reuses an unchanged case with new actors, tokens, CSRF and newly allocated resources', async () => {
    const { spec, config } = await setup('vulnerable', 'bearer');
    const original = JSON.stringify(spec), firstAccounts = demo!.accounts.map(a => a.id);
    const first = await executeCase(spec, config, transport());
    demo!.freshPair(); await bindPair('bearer');
    const second = await executeCase(spec, config, transport());
    expect(first.verdict).toBe('reproduced'); expect(second.verdict).toBe('reproduced');
    expect(first.id).not.toBe(second.id);
    expect(demo!.accounts.map(a => a.id)).not.toEqual(firstAccounts);
    expect(JSON.stringify(spec)).toBe(original);
    expect(demo!.stats().documentCount).toBe(0);
    expect(JSON.stringify(second)).not.toMatch(/rc_[0-9a-f]{8}-[0-9a-f-]+/);
  });
  it('classifies an explicitly denied secure endpoint as not reproduced', async () => {
    const { spec, config } = await setup('secure');
    const result = await executeCase(spec, config, transport());
    expect(result.verdict).toBe('not_reproduced'); expect(result.code).toBe('rejection_observed');
    expect(result.steps.find(s => s.id === 'cross-tenant-read')?.response?.status).toBe(403);
    expect(demo!.stats().documentCount).toBe(0);
  });
  it('does not treat a generic 200 response as a violation or a confirmed fix', async () => {
    const { spec, config } = await setup('ambiguous');
    const result = await executeCase(spec, config, transport());
    expect(result.verdict).toBe('inconclusive'); expect(result.code).toBe('ambiguous_response');
  });
  it('rejects the same account in both roles before creating any resource', async () => {
    const { spec, config } = await setup();
    const user = demo!.accounts[0];
    await browser!.connectDirect('researcher', { origin: demo!.origin, login: { path: '/auth/login', body: { email: user.email, password: user.password } } });
    const result = await executeCase(spec, config, transport());
    expect(result.code).toBe('precondition_failed'); expect(result.verdict).toBe('inconclusive'); expect(demo!.stats().writeCount).toBe(0);
  });
  it('classifies expired sessions separately from a secure endpoint', async () => {
    const { spec, config } = await setup(); demo!.expireSessions();
    const result = await executeCase(spec, config, transport());
    expect(result.code).toBe('authentication_failed'); expect(result.verdict).toBe('inconclusive'); expect(demo!.stats().writeCount).toBe(0);
  });
  it('rechecks identity and role after preparation, before probing', async () => {
    const { spec, config } = await setup();
    const base = transport();
    const result = await executeCase(spec, config, { ...base, async request(actor, request, signal) {
      const response = await base.request(actor, request, signal);
      if (request.method === 'POST' && new URL(request.url).pathname === '/documents') demo!.setRole(demo!.accounts[1].email, 'admin');
      return response;
    } });
    expect(result.code).toBe('identity_changed'); expect(result.verdict).toBe('inconclusive');
    expect(result.steps.some(s => s.phase === 'probe')).toBe(false);
    expect(demo!.stats().documentCount).toBe(0);
  });
  it('rejects a stale approval before sending any requests', async () => {
    const { spec, config } = await setup();
    const result = await executeCase(spec, { ...config, approvedRevision: 999 }, transport());
    expect(result.code).toBe('stale_revision'); expect(result.requests).toBe(0);
  });
  it('cancels an uncertain create without retrying it or issuing an unproven cleanup', async () => {
    const { spec, config } = await setup(); const controller = new AbortController(); const base = transport(); let creates = 0;
    const result = await executeCase(spec, config, { ...base, async request(actor, request, signal) {
      const response = await base.request(actor, request, signal);
      if (request.method === 'POST' && new URL(request.url).pathname === '/documents') { creates++; controller.abort(); }
      return response;
    } }, { signal: controller.signal });
    expect(result.state).toBe('cancelled'); expect(result.verdict).toBe('inconclusive'); expect(creates).toBe(1);
    expect(result.reason).toContain('unknown'); expect(demo!.stats().documentCount).toBe(1);
  });
  it('proves a write using an independent owner before/after observation', async () => {
    const { config } = await setup(); const spec = createWriteExampleCase();
    expect(validateCase(spec)).toEqual([]);
    const result = await executeCase(spec, config, transport());
    expect(result.verdict).toBe('reproduced');
    expect(result.checks.find(c => c.id === 'witness-write-transition')?.passed).toBe(true);
    expect(demo!.stats().documentCount).toBe(0);
  });
  it('does not reproduce a write when the independent owner observation is unchanged', async () => {
    const { config } = await setup('secure');
    const result = await executeCase(createWriteExampleCase(), config, transport());
    expect(result.verdict).toBe('not_reproduced');
    expect(result.checks.find(c => c.id === 'witness-write-transition')?.passed).toBe(false);
  });
  it('rejects a write marker that already existed before the non-owner mutation', async () => {
    const { config } = await setup(); const spec = createWriteExampleCase();
    (spec.steps.find(s => s.id === 'create-document')!.request.body as any).title = { $ref: 'run.marker' };
    const result = await executeCase(spec, config, transport());
    expect(result.verdict).toBe('inconclusive'); expect(result.code).toBe('write_precondition_failed');
    expect(result.steps.some(s => s.phase === 'probe')).toBe(false);
  });
  it('rejects malformed run budgets before dispatch', async () => {
    const { spec, config } = await setup();
    const result = await executeCase(spec, { ...config, maxRequests: Number.NaN }, transport());
    expect(result.code).toBe('invalid_run_config'); expect(result.requests).toBe(0);
  });
});
