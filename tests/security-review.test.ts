import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createExampleCase, executeCase, validateCase, type SessionTransport } from '../packages/core/src/index.ts';
import { createServer } from '../apps/server/src/server.ts';

function inertTransport() {
  const request = vi.fn<SessionTransport['request']>(async () => ({ status: 500, headers: {}, body: null }));
  return { transport: { request, knownSecrets: () => [] } as SessionTransport, request };
}

describe('fresh-resource proof regressions', () => {
  it('rejects a circular owner assertion before sending any request', async () => {
    const spec = createExampleCase();
    spec.resources[0]!.ownerRef = 'actors.owner.id';
    const errors = validateCase(spec).filter(issue => issue.level === 'error');
    expect(errors.some(issue => issue.path.startsWith('resources.'))).toBe(true);
    const { transport, request } = inertTransport();
    const run = await executeCase(spec, { targets: { api: 'https://fixture.invalid' }, approvedRevision: 1, intervalMs: 0 }, transport);
    expect(run).toMatchObject({ verdict: 'inconclusive', code: 'invalid_case' });
    expect(request).not.toHaveBeenCalled();
  });

  it('does not allow an unused binding to authorize an unrelated cleanup', async () => {
    const spec = createExampleCase();
    const cleanup = spec.steps.find(step => step.phase === 'cleanup')!;
    cleanup.request.path = '/unrelated-resource/123';
    cleanup.request.pathParams = { unused: { $ref: 'captures.documentId' } };
    const errors = validateCase(spec).filter(issue => issue.level === 'error');
    expect(errors.some(issue => /Unused path binding|Cleanup must reference/.test(issue.message))).toBe(true);
    const { transport, request } = inertTransport();
    const run = await executeCase(spec, { targets: { api: 'https://fixture.invalid' }, approvedRevision: 1, intervalMs: 0 }, transport);
    expect(run.verdict).toBe('inconclusive');
    expect(request).not.toHaveBeenCalled();
  });

  it('does not call reading the researcher’s own identity a reproduced access violation', async () => {
    const spec = createExampleCase();
    const probe = spec.steps.find(step => step.phase === 'probe')!;
    probe.request.path = '/me';
    probe.request.pathParams = {};
    spec.witness.success = [{ id: 'own-identity', label: 'Reads its own identity', op: 'eq', left: { $ref: `steps.${probe.id}.body.id` }, right: { $ref: 'actors.researcher.id' } }];
    expect(validateCase(spec).some(issue => issue.level === 'error' && issue.path === 'witness.success')).toBe(true);
    const { transport, request } = inertTransport();
    const run = await executeCase(spec, { targets: { api: 'https://fixture.invalid' }, approvedRevision: 1, intervalMs: 0 }, transport);
    expect(run).toMatchObject({ verdict: 'inconclusive', code: 'invalid_case' });
    expect(request).not.toHaveBeenCalled();
  });

  it('does not use the owner reading its already-seeded marker as evidence that the researcher crossed the boundary', async () => {
    const spec = createExampleCase();
    const ownerRead = structuredClone(spec.steps.find(step => step.id === 'owner-read')!);
    ownerRead.id = 'owner-verification'; ownerRead.phase = 'verify'; ownerRead.checks = [];
    spec.steps.splice(spec.steps.length - 1, 0, ownerRead);
    spec.witness.success = [{ id: 'owner-sees-marker', label: 'Owner still sees its own initial marker', op: 'eq', left: { $ref: 'steps.owner-verification.body.marker' }, right: { $ref: 'run.marker' } }];
    expect(validateCase(spec).some(issue => issue.level === 'error' && issue.path === 'witness.success')).toBe(true);
    const { transport, request } = inertTransport();
    const run = await executeCase(spec, { targets: { api: 'https://fixture.invalid' }, approvedRevision: 1, intervalMs: 0 }, transport);
    expect(run).toMatchObject({ verdict: 'inconclusive', code: 'invalid_case' });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('local API route authentication regressions', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  let host: string;
  beforeAll(async () => { server = await createServer({ memory: true, port: 0, writeRuntime: false }); host = new URL(server.origin).host; });
  afterAll(async () => { await server.close(); });

  it.each(['/api/state', '/%61pi/state', '/a%70i/state', '/%61%70%69/state', '/%61pi/%73tate', '/%61pi/state?source=encoded'])('requires the launch token for %s', async url => {
    const response = await server.app.inject({ method: 'GET', url, headers: { host } });
    expect(response.statusCode).toBe(401);
    expect(response.json()).not.toHaveProperty('cases');
  });

  it('requires the token for encoded mutation routes before changing stored cases', async () => {
    const response = await server.app.inject({ method: 'POST', url: '/%61pi/cases', headers: { host }, payload: createExampleCase('must-not-be-saved') });
    expect(response.statusCode).toBe(401);
    expect(server.service.store.cases()).toHaveLength(0);
  });

  it('accepts the launch token only with the correct local host and origin', async () => {
    const authenticated = { host, authorization: `Bearer ${server.token}` };
    const allowed = await server.app.inject({ method: 'GET', url: '/%61pi/state', headers: { ...authenticated, origin: server.origin } });
    expect(allowed.statusCode).toBe(200);
    const badOrigin = await server.app.inject({ method: 'GET', url: '/api/state', headers: { ...authenticated, origin: 'https://untrusted.invalid' } });
    expect(badOrigin.statusCode).toBe(403);
    const badHost = await server.app.inject({ method: 'GET', url: '/api/state', headers: { ...authenticated, host: 'untrusted.invalid' } });
    expect(badHost.statusCode).toBe(403);
  });

  it('rejects malformed path escapes and non-ASCII false tokens without an internal error', async () => {
    const malformed = await server.app.inject({ method: 'GET', url: '/%GG/state', headers: { host } });
    expect(malformed.statusCode).toBe(400);
    const wrongToken = await server.app.inject({ method: 'GET', url: '/api/state', headers: { host, authorization: `Bearer ${'ğ'.repeat(64)}` } });
    expect(wrongToken.statusCode).toBe(401);
  });
});
