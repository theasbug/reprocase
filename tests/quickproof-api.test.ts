import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../apps/server/src/server.ts';
import { startAltApi } from './fixtures/alt-api.ts';

type Lab = Awaited<ReturnType<typeof startAltApi>>;
let server: Awaited<ReturnType<typeof createServer>> | undefined;
let lab: Lab | undefined;
afterEach(async () => { await server?.close(); await lab?.close(); server = undefined; lab = undefined; });

async function api(path: string, body?: unknown) {
  const host = new URL(server!.origin).host;
  const res = await server!.app.inject({ method: body === undefined ? 'GET' : 'POST', url: path, headers: { host, authorization: `Bearer ${server!.token}` }, ...(body === undefined ? {} : { payload: body as any }) });
  return { status: res.statusCode, json: res.json() };
}

/** The full wizard: 1 origin + 2 tokens + 2 pasted requests. No JSON Pointers typed by the user. */
async function quickProof(owner: string, other: string) {
  const start = await api('/api/quickproof', { origin: lab!.origin });
  expect(start.status).toBe(200);
  const id = start.json.id as string;
  expect((await api(`/api/quickproof/${id}/connect`, { actor: 'owner', header: { name: 'X-Auth-Token', value: owner } })).status).toBe(200);
  expect((await api(`/api/quickproof/${id}/connect`, { actor: 'researcher', header: { name: 'X-Auth-Token', value: other } })).status).toBe(200);
  const identity = await api(`/api/quickproof/${id}/identity`, {});
  expect(identity.json.found, JSON.stringify(identity.json)).toBe(true);
  const observe = await api(`/api/quickproof/${id}/observe`, {
    // Pasted straight from DevTools/Burp, including headers that must be ignored.
    create: 'POST /api/v1/notes HTTP/1.1\nHost: x\nX-Auth-Token: should-be-ignored\nContent-Type: application/json\n\n{"text":"draft","color":"green"}',
    vulnerable: `GET ${lab!.origin}/api/v1/notes/00000000-0000-4000-8000-000000000001`,
  });
  expect(observe.status, JSON.stringify(observe.json)).toBe(200);
  return { id, identity: identity.json, observe: observe.json };
}

async function run(id: string) {
  const spec = server!.service.getCase(id);
  const acknowledged = server!.service.saveCase({ ...spec, policy: { ...spec.policy, acknowledged: true } }, spec.revision);
  const started = server!.service.startRun(id, { targets: { api: lab!.origin }, approvedRevision: acknowledged.revision, intervalMs: 0 });
  return server!.service.waitRun(started.id);
}

describe('Quick Proof API on a differently shaped app', () => {
  it('learns the mechanism (identity, CSRF, ID, owner, marker) and the run reproduces', async () => {
    lab = await startAltApi('vulnerable');
    server = await createServer({ memory: true, port: 0 });
    const { id, identity, observe } = await quickProof(lab.users.alice.token, lab.users.bob.token);
    expect(identity.identity).toMatchObject({ path: '/api/v1/profile', idPointer: '/account_id', tenantPointer: '/org/slug', sameTenant: false });
    expect(observe.learned).toMatchObject({ objectPath: '/api/v1/notes/{resource}', idField: '/note/uid', ownerField: '/note/created_by', markerField: '/text', boundary: 'cross_tenant', csrf: { path: '/api/v1/csrf', pointer: '/xsrf', header: 'x-xsrf-token' } });
    expect(observe.preview).toEqual({ owner: 200, other: 200, otherSawObject: true });
    expect(observe.case.policy.acknowledged).toBe(false);
    expect(lab.noteCount()).toBe(0); // the observation object was cleaned up
    const result = await run(id);
    expect(result.verdict, result.reason).toBe('reproduced');
    expect(lab.noteCount()).toBe(0);
  });

  it('not reproduced when the app enforces ownership', async () => {
    lab = await startAltApi('secure');
    server = await createServer({ memory: true, port: 0 });
    const { id, observe } = await quickProof(lab.users.alice.token, lab.users.bob.token);
    expect(observe.preview.other).toBe(401);
    expect((await run(id)).verdict).toBe('not_reproduced');
  });

  it('explains what to do when no identity endpoint is found, and never runs without accounts', async () => {
    lab = await startAltApi('vulnerable');
    server = await createServer({ memory: true, port: 0 });
    const id = (await api('/api/quickproof', { origin: lab.origin })).json.id;
    expect((await api(`/api/quickproof/${id}/identity`, {})).status).toBe(422);
    await api(`/api/quickproof/${id}/connect`, { actor: 'owner', header: { name: 'X-Auth-Token', value: lab.users.alice.token } });
    await api(`/api/quickproof/${id}/connect`, { actor: 'researcher', header: { name: 'X-Auth-Token', value: lab.users.bob.token } });
    const miss = await api(`/api/quickproof/${id}/identity`, { path: '/api/v1/nope' });
    expect(miss.json.found).toBe(false);
    expect(miss.json.message).toMatch(/did not return two different account IDs/);
  });

  it('rejects more than one credential at once and non-loopback-safe origins are validated', async () => {
    lab = await startAltApi('vulnerable');
    server = await createServer({ memory: true, port: 0 });
    expect((await api('/api/quickproof', { origin: 'ftp://x' })).status).toBe(400);
    const id = (await api('/api/quickproof', { origin: lab.origin })).json.id;
    expect((await api(`/api/quickproof/${id}/connect`, { actor: 'owner', token: 'a', cookie: 'b=c' })).status).toBe(400);
  });
});

describe('Triager: verify an imported package on my own site', () => {
  it('remaps a different identity endpoint automatically, resets the policy acknowledgement, and reproduces', async () => {
    lab = await startAltApi('vulnerable');
    server = await createServer({ memory: true, port: 0 });
    // A reporter's case whose identity probe matches *their* site, not ours.
    const { id } = await quickProof(lab.users.alice.token, lab.users.bob.token);
    const reported = server.service.getCase(id);
    const foreign = { ...reported, id: 'reported-case', revision: 1, policy: { ...reported.policy, acknowledged: true }, actors: reported.actors.map(a => ({ ...a, identity: { ...a.identity, path: '/me', idPointer: '/id', tenantPointer: '/tenant' } })) };
    const pack = { format: 'reprocase', schemaVersion: 1, exportedAt: new Date().toISOString(), case: foreign, redactions: [] };

    const imported = await api('/api/import', { kind: 'package', data: JSON.stringify(pack) });
    expect(imported.status).toBe(200);
    expect(imported.json.case.policy.acknowledged).toBe(false);
    expect(imported.json.warnings.join(' ')).toMatch(/acknowledge it yourself/);
    const caseId = imported.json.case.id;

    const verified = await api(`/api/cases/${caseId}/verify-on-site`, { origin: lab.origin, accounts: { owner: { header: { name: 'X-Auth-Token', value: lab.users.alice.token } }, researcher: { header: { name: 'X-Auth-Token', value: lab.users.bob.token } } } });
    expect(verified.status, JSON.stringify(verified.json)).toBe(200);
    expect(verified.json.remapped).toEqual({ path: '/api/v1/profile', idPointer: '/account_id', tenantPointer: '/org/slug' });
    expect(verified.json.case.revision).toBe(2);
    const result = await run(caseId);
    expect(result.verdict, result.reason).toBe('reproduced');
  });
});
