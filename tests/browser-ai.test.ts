import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { BrowserManager } from '../packages/browser/src/index.ts';
import { AIManager } from '../packages/ai/src/index.ts';
import { createExampleCase } from '../packages/core/src/example.ts';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function fixture() {
  const identities: Record<string, { id: string; tenant: string; role: string }> = {
    'session-alpha-private': { id: 'alice', tenant: 'tenant-a', role: 'member' },
    'session-bravo-private': { id: 'bob', tenant: 'tenant-b', role: 'member' },
  };
  let mutations = 0;
  const server = createServer(async (request, response) => {
    const token = request.headers.authorization?.replace(/^Bearer /, '') || request.headers.cookie?.split('rc_session=')[1]?.split(';')[0];
    const identity = token ? identities[token] : undefined;
    response.setHeader('content-type', 'application/json');
    if (request.url === '/') {
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><html><body><h1>Sign in</h1><form id="login"><label>Email <input name="email" type="email"></label><label>Password <input name="password" type="password"></label><button type="submit">Continue</button></form><script>document.querySelector("form").onsubmit=async(e)=>{e.preventDefault();await fetch("/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});location.href="/account"}</script></body></html>'); return;
    }
    if (request.url === '/login') {
      let raw = ''; for await (const chunk of request) raw += chunk;
      const parsed = raw ? JSON.parse(raw) as { email?: string } : {};
      const loginToken = parsed.email === 'bob@example.test' ? 'session-bravo-private' : 'session-alpha-private';
      response.setHeader('set-cookie', `rc_session=${loginToken}; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600`);
      response.end(JSON.stringify({ ok: true })); return;
    }
    if (request.url === '/redirect') { response.statusCode = 302; response.setHeader('location', '/mutate'); response.end('{}'); return; }
    if (!identity) { response.statusCode = 401; response.end(JSON.stringify({ error: 'unauthenticated' })); return; }
    if (request.url === '/account') { response.setHeader('content-type', 'text/html'); response.end(`<html><body><h1>Welcome ${identity.id}</h1></body></html>`); return; }
    if (request.url === '/me') { response.end(JSON.stringify(identity)); return; }
    if (request.url === '/echo') { response.end(JSON.stringify({ seenAuth: request.headers.authorization, sensitive: token })); return; }
    if (request.url === '/mutate') { mutations += 1; setTimeout(() => response.end(JSON.stringify({ changed: true })), 200); return; }
    response.statusCode = 404; response.end('{}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing listener');
  const origin = `http://127.0.0.1:${address.port}`;
  const manager = new BrowserManager();
  cleanups.push(async () => { await manager.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { manager, origin, identities, mutations: () => mutations };
}
const identityProbe = { origin: 'api', path: '/me', idPointer: '/id', tenantPointer: '/tenant', rolePointer: '/role' };

describe('isolated account transport', () => {
  it('keeps bearer identities separate and rejects an origin change before dispatch', async () => {
    const { manager, origin } = await fixture();
    await manager.connectDirect('case:owner', { origin, token: 'session-alpha-private' });
    await manager.connectDirect('case:reader', { origin, token: 'session-bravo-private' });
    expect(manager.status('case:owner')?.connected).toBe(false);
    expect(await manager.verify('case:owner', identityProbe)).toMatchObject({ id: 'alice', tenant: 'tenant-a' });
    expect(await manager.verify('case:reader', identityProbe)).toMatchObject({ id: 'bob', tenant: 'tenant-b' });
    await expect(manager.request('case:owner', { url: 'http://127.0.0.1:1/me', method: 'GET', headers: {} })).rejects.toThrow('not bound');
    await expect(manager.request('case:owner', { url: `${origin}/me`, method: 'GET', headers: { Authorization: 'Bearer session-bravo-private' } })).rejects.toThrow('selected account');
  });

  it('refreshes a direct cookie jar through a declarative login recipe', async () => {
    const { manager, origin } = await fixture();
    await manager.connectDirect('owner', { origin, login: { path: '/login', body: { email: 'test-user', password: 'do-not-export-this' } } });
    expect(await manager.verify('owner', identityProbe)).toMatchObject({ id: 'alice' });
    expect(manager.knownSecrets()).toContain('do-not-export-this');
    expect(manager.knownSecrets()).toContain('session-alpha-private');
    expect(manager.knownSecrets()).not.toContain('/');
    expect(manager.knownSecrets()).not.toContain('3600');
    expect(manager.knownSecrets()).not.toContain('Lax');
    expect(manager.status('owner')?.origin).toBe(origin);
  });

  it('binds manually supplied cookie state and never follows redirects', async () => {
    const { manager, origin, mutations } = await fixture();
    await manager.connectDirect('owner', { origin, cookie: 'rc_session=session-alpha-private' });
    expect(await manager.verify('owner', identityProbe)).toMatchObject({ id: 'alice' });
    expect(await manager.request('owner', { url: `${origin}/redirect`, method: 'GET', headers: {} })).toMatchObject({ status: 302 });
    expect(mutations()).toBe(0);
  });

  it('rejects changed live identity and treats expiry as disconnected', async () => {
    const { manager, origin, identities } = await fixture();
    await manager.connectDirect('owner', { origin, token: 'session-alpha-private' });
    await manager.verify('owner', identityProbe);
    identities['session-alpha-private']!.role = 'admin';
    await expect(manager.verify('owner', identityProbe)).rejects.toThrow('changed');
    expect(manager.status('owner')?.connected).toBe(false);
    delete identities['session-alpha-private'];
    await expect(manager.verify('owner', identityProbe)).rejects.toThrow('401');
    expect(manager.status('owner')?.connected).toBe(false);
  });

  it('exports recorded HTTP evidence without live credential values', async () => {
    const { manager, origin } = await fixture();
    await manager.connectDirect('owner', { origin, token: 'session-alpha-private' });
    manager.recording('owner', true);
    await manager.request('owner', { url: `${origin}/echo`, method: 'GET', headers: {} });
    const har = JSON.stringify(manager.traffic('owner'));
    expect(har).not.toContain('session-alpha-private');
    expect(har).toContain('[REDACTED]');
    expect(manager.traffic('owner').log.entries).toHaveLength(1);
  });

  it('does not retry a mutation when cancellation leaves its result uncertain', async () => {
    const { manager, origin, mutations } = await fixture();
    await manager.connectDirect('owner', { origin, token: 'session-alpha-private' });
    const controller = new AbortController();
    const pending = manager.request('owner', { url: `${origin}/mutate`, method: 'POST', headers: {}, body: {} }, controller.signal);
    for (let i = 0; i < 30 && mutations() === 0; i += 1) await new Promise(resolve => setTimeout(resolve, 5));
    controller.abort();
    await expect(pending).rejects.toThrow('in-flight');
    expect(mutations()).toBe(1);
  });

  it('shares browser cookies with API verification while keeping separate Chromium accounts isolated', async () => {
    const previousHeadless = process.env.REPROCASE_HEADLESS;
    process.env.REPROCASE_HEADLESS = '1';
    const { manager, origin } = await fixture();
    try {
      for (const [key, username] of [['owner', 'alice@example.test'], ['reader', 'bob@example.test']]) {
        await manager.open(key!, origin);
        const snapshot = await manager.snapshot(key!);
        const email = snapshot.fields.find(field => field.type === 'email')!;
        const password = snapshot.fields.find(field => field.type === 'password')!;
        const submit = snapshot.fields.find(field => field.tag === 'button')!;
        const refs = manager.setSecrets(key!, { username, password: 'private-browser-password' });
        await manager.action(key!, { type: 'fillSecret', ref: email.ref, secretRef: refs.username });
        await manager.action(key!, { type: 'fillSecret', ref: password.ref, secretRef: refs.password });
        expect(JSON.stringify(await manager.snapshot(key!))).not.toContain('private-browser-password');
        const current = await manager.snapshot(key!);
        await manager.action(key!, { type: 'click', ref: current.fields.find(field => field.tag === 'button')!.ref });
        for (let i = 0; i < 100 && !manager.status(key!)?.url?.endsWith('/account'); i += 1) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(await manager.verify('owner', identityProbe)).toMatchObject({ id: 'alice' });
      expect(await manager.verify('reader', identityProbe)).toMatchObject({ id: 'bob' });
      expect(manager.status('owner')?.connected).toBe(true);
      expect(manager.status('reader')?.connected).toBe(true);
    } finally {
      if (previousHeadless === undefined) delete process.env.REPROCASE_HEADLESS;
      else process.env.REPROCASE_HEADLESS = previousHeadless;
    }
  });
});

function compatibleReply(name: string, args: unknown): Response {
  return new Response(JSON.stringify({ id: 'mock-completion', object: 'chat.completion', created: 1, model: 'test-model', choices: [{ index: 0, finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: `call-${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('optional AI adapters', () => {
  it('sends an application user agent and a stable OpenCode session for all turns of one login conversation', async () => {
    const headers: Headers[] = [];
    const ai = new AIManager({ fetch: async (_url, init) => {
      headers.push(new Headers(init?.headers));
      return headers.length === 1 ? compatibleReply('snapshot', {}) : compatibleReply('finish', { message: 'Done' });
    } });
    ai.configure({ provider: 'compatible', model: 'longcat-2.5-free', baseURL: 'https://opencode.ai/inference/go/openai/v1', apiKey: 'test-only-key' });
    const browser = { setSecrets: () => ({}), knownSecrets: () => [], snapshot: async () => ({ url: 'https://example.test', text: 'Signed in', fields: [] }) } as unknown as BrowserManager;
    expect((await ai.assistLogin(browser, 'owner', {})).state).toBe('completed');
    expect(headers).toHaveLength(2);
    expect(headers[0].get('x-opencode-session')).toMatch(/^[0-9a-f-]{36}$/);
    expect(headers[1].get('x-opencode-session')).toBe(headers[0].get('x-opencode-session'));
    expect(headers.every(h => h.get('user-agent') === 'reprocase/1.1.0-beta.3')).toBe(true);
    expect(ai.publicSettings()).not.toHaveProperty('apiKey');
  });
  it('tests required tool support, creates a new conversation per test, and keeps the existing key only for the same endpoint', async () => {
    const headers: Headers[] = [];
    const ai = new AIManager({ fetch: async (_url, init) => { headers.push(new Headers(init?.headers)); return compatibleReply('connection_test', { ok: true }); } });
    ai.configure({ provider: 'compatible', model: 'longcat-2.5-free', baseURL: 'https://opencode.ai/inference/go/openai/v1', apiKey: 'private-model-key' });
    expect(await ai.testConnection()).toMatchObject({ ok: true, model: 'longcat-2.5-free', routing: 'opencode-session' });
    ai.configure({ provider: 'compatible', model: 'longcat-2.5-free', baseURL: 'https://opencode.ai/inference/go/openai/v1' });
    await ai.testConnection();
    expect(headers[1].get('authorization')).toBe('Bearer private-model-key');
    expect(headers[1].get('x-opencode-session')).not.toBe(headers[0].get('x-opencode-session'));
    ai.configure({ provider: 'compatible', model: 'local-model', baseURL: 'http://127.0.0.1:11434/v1' });
    await ai.testConnection();
    expect(headers[2].get('authorization')).not.toContain('private-model-key');
    expect(headers[2].get('x-opencode-session')).toBeNull();
  });
  it('reports a responding model without function calling and redacts provider error echoes', async () => {
    const ai = new AIManager({ fetch: async () => compatibleReply('wrong_tool', { ok: true }) });
    ai.configure({ provider: 'compatible', model: 'no-tools' });
    await expect(ai.testConnection()).rejects.toThrow(/tool call/);
    const failing = new AIManager({ fetch: async () => new Response(JSON.stringify({ error: { message: 'failed private-key-echo' } }), { status: 400, headers: { 'content-type': 'application/json' } }) });
    failing.configure({ provider: 'compatible', model: 'test', apiKey: 'private-key-echo' });
    await expect(failing.testConnection()).rejects.toThrow('[REDACTED]');
  });
  it('does not change or execute cases and rejects a stale model revision', async () => {
    const example = createExampleCase();
    const ai = new AIManager({ fetch: async () => compatibleReply('propose_case', { caseJson: JSON.stringify({ ...example, revision: 99 }), explanation: 'Changed draft', warnings: [] }) });
    ai.configure({ provider: 'compatible', model: 'test-model' });
    await expect(ai.propose(example, 'Improve the descriptions')).rejects.toThrow('revision');
    expect(example.revision).toBe(1);
  });

  it('removes known secrets from model payloads and returns a reviewable proposal', async () => {
    const bodies: string[] = [];
    const example = createExampleCase();
    const ai = new AIManager({ fetch: async (_url, init) => {
      bodies.push(String(init?.body));
      return compatibleReply('propose_case', { caseJson: JSON.stringify(example), explanation: 'Ready for review', warnings: ['Confirm API expectations'] });
    } });
    ai.configure({ provider: 'compatible', model: 'test-model', apiKey: 'model-provider-key' });
    const proposal = await ai.propose(example, 'The old session is an-old-session-secret', ['an-old-session-secret']);
    expect(bodies.join('')).not.toContain('an-old-session-secret');
    expect(bodies.join('')).not.toContain('model-provider-key');
    expect(proposal).toMatchObject({ baseRevision: 1, case: { id: example.id } });
    expect(ai.publicSettings()).not.toHaveProperty('apiKey');
  });

  it('uses opaque password references during assisted login', async () => {
    const bodies: string[] = []; const browserActions: unknown[] = [];
    const passwordRef = 'credential_11111111-1111-1111-1111-111111111111';
    const fakeBrowser = {
      setSecrets: () => ({ password: passwordRef }), knownSecrets: () => ['super-private-password'],
      snapshot: async () => ({ url: 'https://example.test', text: 'Sign in', fields: [{ ref: 'g1e0', tag: 'input', type: 'password', label: 'Password' }] }),
      action: async (_key: string, action: unknown) => { browserActions.push(action); return { state: 'done' }; },
    } as unknown as BrowserManager;
    const ai = new AIManager({ fetch: async (_url, init) => {
      bodies.push(String(init?.body));
      return bodies.length === 1 ? compatibleReply('fill_secret', { ref: 'g1e0', secretRef: passwordRef }) : compatibleReply('finish', { message: 'Done' });
    } });
    ai.configure({ provider: 'compatible', model: 'test-model' });
    const result = await ai.assistLogin(fakeBrowser, 'owner', { password: 'super-private-password' });
    expect(result.state).toBe('completed');
    expect(bodies.join('')).not.toContain('super-private-password');
    expect(bodies[0]).toContain(passwordRef);
    expect(browserActions).toEqual([{ type: 'fillSecret', ref: 'g1e0', secretRef: passwordRef }]);
  });

  it('hands MFA to the user without sending a model request', async () => {
    let calls = 0;
    const ai = new AIManager({ fetch: async () => { calls += 1; throw new Error('unexpected'); } });
    ai.configure({ provider: 'compatible', model: 'test-model' });
    const browser = { setSecrets: () => ({}), knownSecrets: () => [], snapshot: async () => ({ url: 'https://example.test', text: 'Enter verification code from authenticator', fields: [] }) } as unknown as BrowserManager;
    expect((await ai.assistLogin(browser, 'owner', {})).state).toBe('needs_user');
    expect(calls).toBe(0);
  });

  it('rejects insecure remote model endpoints', () => {
    const ai = new AIManager();
    expect(() => ai.configure({ provider: 'compatible', model: 'test', baseURL: 'http://remote.example/v1' })).toThrow('HTTPS');
  });
});
