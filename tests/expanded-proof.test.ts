import { afterEach, expect, it } from 'vitest';
import { createServer } from '../apps/server/src/server.ts';
import { startProofApi } from './fixtures/proof-api.ts';
import { exportPackage, importTraffic, validateCase, renderHurl, bindResource, parseRequest, type CaseSpec } from '../packages/core/src/index.ts';

process.env.REPROCASE_HEADLESS = '1';
let server: Awaited<ReturnType<typeof createServer>> | undefined, lab: Awaited<ReturnType<typeof startProofApi>> | undefined;
afterEach(async () => { await server?.close(); await lab?.close(); server = undefined; lab = undefined; });
async function setup(kind: 'authorization' | 'role' | 'cors_read' = 'authorization', options: Parameters<typeof startProofApi>[0] = {}) {
  lab = await startProofApi(options); server = await createServer({ memory: true, port: 0 });
  const qp = server.service.quickproof, { id } = qp.start(lab.origin, kind);
  if (kind === 'cors_read') {
    await server.service.browsers.open(id + ':owner', lab.origin);
    await server.service.browsers.action(id + ':owner', { type: 'navigate', url: '/login/alice' });
    // Only the local lab needs a browser permission to reach loopback from a virtual public origin.
    const context = (server.service.browsers as any).sessions.get(id + ':owner').context;
    await context.grantPermissions(['local-network-access'], { origin: 'https://reprocase-probe.invalid' });
  } else for (const [actor, token] of [['owner', 'alice'], ['researcher', 'bob']] as const) await qp.connect(id, { actor, token });
  const identity = await qp.detectIdentity(id); expect(identity.found).toBe(true);
  return { qp, id };
}
async function run(spec: CaseSpec) {
  const saved = server!.service.saveCase({ ...spec, policy: { ...spec.policy, acknowledged: true } }, spec.revision);
  const started = server!.service.startRun(saved.id, { targets: { api: lab!.origin }, approvedRevision: saved.revision, intervalMs: 0 });
  return server!.service.waitRun(started.id);
}
it.each(['path', 'query', 'body'] as const)('learns write IDOR with a %s ID and independently proves the mutation', async location => {
  const { qp, id } = await setup();
  const path = location === 'path' ? '/documents/42' : location === 'query' ? '/update?id=42' : '/update';
  const observed = await qp.observe(id, { create: 'POST /documents\n\n{"text":"before"}', vulnerable: `PATCH ${path}\n\n${JSON.stringify({ ...(location === 'body' ? { id: '42' } : {}), text: 'after' })}` });
  expect(observed.status, JSON.stringify(observed)).toBe('ready'); if (observed.status !== 'ready') return;
  expect(lab!.docs.size).toBe(0);
  const result = await run(observed.case); expect(result.verdict, result.reason).toBe('reproduced'); expect(lab!.docs.size).toBe(0);
  expect(result.steps.some(s => s.id === 'control-after')).toBe(true);
  const pack = exportPackage(observed.case, result, ['alice', 'bob']); expect(pack.schemaVersion).toBe(2); expect(importTraffic('package', JSON.stringify(pack)).case.schemaVersion).toBe(2);
});
it.each([{ secure: true, expected: 'not_reproduced' }, { noEffect: true, expected: 'inconclusive' }, { errorAfterWrite: true, expected: 'reproduced' }, { dropAfterWrite: true, expected: 'reproduced' }])('does not trust mutation HTTP status: %j', async ({ expected, ...options }) => {
  const { qp, id } = await setup('authorization', options);
  const observed = await qp.observe(id, { create: 'POST /documents\n\n{"text":"before"}', vulnerable: 'PATCH /documents/42\n\n{"text":"after"}' });
  expect(observed.status, JSON.stringify(observed)).toBe('ready'); if (observed.status !== 'ready') return;
  const result = await run(observed.case); expect(result.verdict, result.reason).toBe(expected); expect(lab!.docs.size).toBe(0);
});
it.each([{ count: 8 }, { enabled: true }, { state: 'rc_published' }])('proves a typed transition %j', async body => {
  const { qp, id } = await setup(); const observed = await qp.observe(id, { create: 'POST /documents\n\n{"text":"before"}', vulnerable: `PATCH /documents/42\n\n${JSON.stringify(body)}` });
  expect(observed.status, JSON.stringify(observed)).toBe('ready'); if (observed.status !== 'ready') return;
  const result = await run(observed.case); expect(result.verdict, result.reason).toBe('reproduced');
});
it('preserves form encoding for both creation and writes', async () => {
  const { qp, id } = await setup('authorization', { form: true });
  const observed = await qp.observe(id, { create: 'POST /documents\n\ntext=before', vulnerable: 'PUT /documents/42\n\ntext=after' });
  expect(observed.status, JSON.stringify(observed)).toBe('ready'); if (observed.status !== 'ready') return;
  const result = await run(observed.case); expect(result.verdict, result.reason).toBe('reproduced');
});
it('asks for one field choice before sending a creation request', async () => {
  const { qp, id } = await setup(); const before = lab!.seen.length;
  const result = await qp.observe(id, { create: 'POST /documents\n\n{"text":"before"}', vulnerable: 'PATCH /documents/42\n\n{"count":5,"enabled":true}' });
  expect(result.status).toBe('needs_input'); expect(lab!.seen.length).toBe(before);
});
it.each([false, true])('proves function reads with real roles (secure=%s)', async secure => {
  const { qp, id } = await setup('role', { secure }); const observed = await qp.observe(id, { vulnerable: 'GET /admin/report' });
  expect(observed.status, JSON.stringify(observed)).toBe('ready'); if (observed.status !== 'ready') return;
  expect(observed.case.kind).toBe('function_read');
  const result = await run(observed.case); expect(result.verdict, result.reason).toBe(secure ? 'not_reproduced' : 'reproduced'); expect(result.setup).toBe('verified_session');
});
it('builds a role write with role-specific expectations', async () => {
  const { qp, id } = await setup('role'); const observed = await qp.observe(id, { create: 'POST /documents\n\n{"text":"before"}', vulnerable: 'POST /documents/42\n\n{"text":"after"}' });
  expect(observed.status, JSON.stringify(observed)).toBe('ready'); if (observed.status !== 'ready') return;
  expect(observed.case.boundary).toBe('role'); expect((await run(observed.case)).verdict).toBe('reproduced');
});
it.each(['reflect', 'safe', 'wildcard', 'null'] as const)('uses real browser JS and cookie semantics for CORS (%s)', async cors => {
  const { qp, id } = await setup('cors_read', { cors }); const observed = await qp.observe(id, { vulnerable: 'GET /private' });
  expect(observed.status, JSON.stringify(observed)).toBe('ready'); if (observed.status !== 'ready') return;
  expect(() => renderHurl(observed.case)).toThrow(/browser/i);
  const result = await run(observed.case);
  expect(result.verdict, JSON.stringify(result)).toBe(cors === 'safe' || cors === 'wildcard' ? 'not_reproduced' : 'reproduced');
  expect(lab!.seen.some(r => r.origin === 'null')).toBe(true);
  expect(validateCase({ ...observed.case, policy: { ...observed.case.policy, acknowledged: true } }).filter(i => i.level === 'error')).toEqual([]);
}, 40000);

it('refuses ambiguous identifier bindings and credential/ownership mutation fields', async () => {
  expect(bindResource(parseRequest('PATCH /update?user_id=7&document_id=42\n\n{"text":"after"}'))).toBeUndefined();
  const { qp, id } = await setup(); const before = lab!.seen.length;
  const observed = await qp.observe(id, { create: 'POST /documents\n\n{"text":"before"}', vulnerable: 'PATCH /documents/42\n\n{"ownerId":"different-user"}' });
  expect(observed.status).toBe('needs_input'); expect(lab!.seen.length).toBe(before);
});

it('does not weaken v1 validation or accept a forged positive control', async () => {
  const { qp, id } = await setup(); const observed = await qp.observe(id, { create: 'POST /documents\n\n{"text":"before"}', vulnerable: 'PATCH /documents/42\n\n{"text":"after"}' });
  if (observed.status !== 'ready') throw new Error('Missing draft');
  const forged = structuredClone(observed.case); forged.policy.acknowledged = true;
  forged.witness.writeProof!.control!.mutation = 'create-resource';
  expect(validateCase(forged).some(i => i.path === 'witness.writeProof.control')).toBe(true);
  expect(validateCase({ ...forged, schemaVersion: 1 }).some(i => i.level === 'error')).toBe(true);
});

it('never sends an excluded CORS target request', async () => {
  const { qp, id } = await setup('cors_read', { cors: 'reflect' }); const observed = await qp.observe(id, { vulnerable: 'GET /private' });
  if (observed.status !== 'ready') throw new Error('Missing draft');
  server!.service.saveProgram({ name: 'Restricted lab', inScope: [lab!.origin + '/*'], outOfScope: [lab!.origin + '/private'], maxRps: 100 });
  const before = lab!.seen.filter(r => r.url === '/private').length;
  const result = await run(observed.case); expect(result.verdict).toBe('inconclusive');
  expect(lab!.seen.filter(r => r.url === '/private').length).toBe(before);
});

it('rejects a Bearer-only CORS proof and does not mislabel public data', async () => {
  lab = await startProofApi(); server = await createServer({ memory: true, port: 0 });
  const qp = server.service.quickproof, { id } = qp.start(lab.origin, 'cors_read');
  await qp.connect(id, { actor: 'owner', token: 'alice' }); await qp.detectIdentity(id);
  await expect(qp.observe(id, { vulnerable: 'GET /private' })).rejects.toThrow(/browser/i);
  expect(lab.seen.some(r => r.origin)).toBe(false);
});

it('does not create a CORS finding for an anonymous public response', async () => {
  const { qp, id } = await setup('cors_read', { publicData: true, cors: 'reflect' });
  expect((await qp.observe(id, { vulnerable: 'GET /private' })).status).toBe('needs_input');
});

it('preserves SameSite cookie restrictions and reports a real network failure as inconclusive', async () => {
  const { qp, id } = await setup('cors_read', { cors: 'reflect' });
  const context = (server!.service.browsers as any).sessions.get(id + ':owner').context;
  const cookies = await context.cookies(); await context.clearCookies(); await context.addCookies(cookies.map((c: any) => ({ ...c, sameSite: 'Strict' })));
  const observed = await qp.observe(id, { vulnerable: 'GET /private' }); if (observed.status !== 'ready') throw new Error('Missing draft');
  expect((await run(observed.case)).verdict).toBe('not_reproduced');
});

it('does not treat a network failure as a CORS fix', async () => {
  const { qp, id } = await setup('cors_read', { cors: 'reflect', dropCors: true });
  const observed = await qp.observe(id, { vulnerable: 'GET /private' }); if (observed.status !== 'ready') throw new Error('Missing draft');
  expect((await run(observed.case)).verdict).toBe('inconclusive');
});

it('blocks a role proof when the live role changes after learning', async () => {
  const { qp, id } = await setup('role'); const observed = await qp.observe(id, { vulnerable: 'GET /admin/report' }); if (observed.status !== 'ready') throw new Error('Missing draft');
  lab!.users.bob.role = 'admin'; expect((await run(observed.case)).verdict).toBe('inconclusive');
});

it('cancels learning without retrying a mutation or sending cleanup after stop', async () => {
  const { qp, id } = await setup('authorization', { slowMutation: true });
  const task = qp.observe(id, { create: 'POST /documents\n\n{"text":"before"}', vulnerable: 'PATCH /documents/42\n\n{"text":"after"}' });
  const rejected = expect(task).rejects.toThrow(/cancel/i);
  await expect.poll(() => lab!.seen.some(r => r.method === 'PATCH')).toBe(true);
  qp.cancel(id); const count = lab!.seen.length; await rejected;
  await new Promise(resolve => setTimeout(resolve, 250)); expect(lab!.seen.length).toBe(count);
  expect(lab!.seen.filter(r => r.method === 'PATCH')).toHaveLength(1);
});

it('proves a nested JSON field and keeps failed-cleanup addresses local', async () => {
  const { qp, id } = await setup('authorization', { failDelete: true });
  const observed = await qp.observe(id, { create: 'POST /documents\n\n{"details":{"memo":"before"}}', vulnerable: 'PATCH /documents/42\n\n{"details":{"memo":"after"}}' });
  if (observed.status !== 'ready') throw new Error('Missing draft');
  expect(observed.notes.join(' ')).toContain('Remove the observation object manually');
  const result = await run(observed.case); expect(result.verdict, result.reason).toBe('reproduced');
  expect(result.localCleanupTargets).toHaveLength(2);
  const exported = JSON.stringify(exportPackage(observed.case, result));
  expect(exported).not.toContain('localCleanupTargets');
  for (const url of result.localCleanupTargets!) expect(exported).not.toContain(new URL(url).pathname.split('/').at(-1));
});

it.each(['role', 'cors_read'] as const)('private data is still disclosed with an HTTP 403 (%s)', async kind => {
  const { qp, id } = await setup(kind, { errorRead: true, cors: 'reflect' });
  const observed = await qp.observe(id, { vulnerable: kind === 'role' ? 'GET /admin/report' : 'GET /private' });
  if (observed.status !== 'ready') throw new Error('Missing draft');
  const result = await run(observed.case); expect(result.verdict, result.reason).toBe('reproduced');
  expect(result.steps.some(step => step.response?.status === 403)).toBe(true);
});
