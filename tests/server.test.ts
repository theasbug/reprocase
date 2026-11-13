import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../apps/server/src/server.ts';

let instance: Awaited<ReturnType<typeof createServer>> | undefined;
afterEach(async () => { await instance?.close(); instance = undefined; });
async function setup() { instance = await createServer({ memory: true, port: 0 }); return instance; }

describe('authenticated local application service', () => {
  it('protects state, mutations, host and origin, including encoded route prefixes', async () => {
    const server = await setup();
    for (const url of ['/api/state', '/%61pi/state', '/a%70i/state', '/%61%70%69/state']) {
      expect((await server.app.inject({ url })).statusCode).toBe(401);
    }
    expect((await server.app.inject({ url: '/%61pi/demo/start', method: 'POST', payload: {} })).statusCode).toBe(401);
    expect((await server.app.inject({ url: '/api/state', headers: { authorization: `Bearer ${server.token}`, origin: 'https://untrusted.test' } })).statusCode).toBe(403);
    expect((await server.app.inject({ url: '/api/state', headers: { authorization: `Bearer ${server.token}`, host: 'untrusted.test' } })).statusCode).toBe(403);
    expect((await server.app.inject({ url: '/api/state', headers: { authorization: `Bearer ${'ü'.repeat(64)}` } })).statusCode).toBe(401);
    expect((await server.app.inject({ url: '/api/state', headers: { authorization: `Bearer ${server.token}` } })).statusCode).toBe(200);
  });
  it('shares one engine across the API and service and exports the exact immutable run revision', async () => {
    const server = await setup(), headers = { authorization: `Bearer ${server.token}` };
    const response = await server.app.inject({ url: '/api/demo/start', method: 'POST', headers, payload: { mode: 'vulnerable' } });
    expect(response.statusCode).toBe(200);
    const demo = response.json();
    const spec = demo.case;
    const start = await server.app.inject({ url: `/api/cases/${spec.id}/run`, method: 'POST', headers, payload: { targets: { api: demo.origin }, approvedRevision: spec.revision, intervalMs: 0 } });
    expect(start.statusCode).toBe(200);
    const result = await server.service.waitRun(start.json().id);
    expect(result.verdict).toBe('reproduced');
    const updated = await server.app.inject({ url: `/api/cases/${spec.id}`, method: 'PUT', headers, payload: { case: { ...spec, title: 'A later edited title' }, expectedRevision: spec.revision } });
    expect(updated.json().revision).toBe(2);
    const exported = await server.app.inject({ url: `/api/cases/${spec.id}/export?runId=${result.id}`, headers });
    expect(exported.json().case.revision).toBe(1); expect(exported.json().case.title).toBe(spec.title);
    expect(exported.body).not.toContain(demo.accounts[0].password);
    const stale = await server.app.inject({ url: `/api/cases/${spec.id}`, method: 'PUT', headers, payload: { case: spec, expectedRevision: 1 } });
    expect(stale.statusCode).toBe(409);
  });
  it('cannot change the controlled lab or bindings during a run', async () => {
    const server = await setup(); const demo = await server.service.startDemo();
    const initial = server.service.startRun(demo.case.id, { targets: { api: demo.origin }, approvedRevision: 1, intervalMs: 30 });
    await expect(server.service.startDemo('secure')).rejects.toThrow('active');
    expect(server.service.demo!.mode).toBe('vulnerable');
    expect(() => server.service.setDemoMode('secure')).toThrow('active');
    await expect(server.service.bindDemo(demo.case.id, true)).rejects.toThrow('active');
    await server.service.waitRun(initial.id);
  });
});

describe('container listen mode', () => {
  afterEach(() => { delete process.env.REPROCASE_LISTEN_HOST; });
  it('rejects unexpected listen hosts', async () => {
    process.env.REPROCASE_LISTEN_HOST = '192.168.1.5';
    await expect(createServer({ memory: true, port: 0 })).rejects.toThrow(/REPROCASE_LISTEN_HOST/);
  });
  it('listens on all interfaces but keeps loopback Host, Origin and token checks', async () => {
    process.env.REPROCASE_LISTEN_HOST = '0.0.0.0';
    const server = await createServer({ memory: true, port: 0 });
    try {
      expect(server.origin).toMatch(/^http:\/\/localhost:\d+$/);
      const port = new URL(server.origin).port;
      const auth = { authorization: `Bearer ${server.token}` };
      expect((await fetch(`http://127.0.0.1:${port}/api/state`, { headers: { ...auth, origin: `http://127.0.0.1:${port}` } })).status).toBe(200);
      expect((await server.app.inject({ url: '/api/state', headers: { ...auth, host: `localhost:${port}`, origin: 'http://evil.test' } })).statusCode).toBe(403);
      expect((await server.app.inject({ url: '/api/state', headers: { ...auth, host: 'evil.test' } })).statusCode).toBe(403);
      expect((await server.app.inject({ url: '/api/state', headers: { host: `localhost:${port}` } })).statusCode).toBe(401);
    } finally { await server.close(); }
  });
});
