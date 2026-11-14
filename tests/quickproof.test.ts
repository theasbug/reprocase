import { afterEach, describe, expect, it } from 'vitest';
import { buildQuickProof, executeCase, findOwnerPointer, inferCreate, inferIdentity, templatePath, validateCase, type SessionTransport } from '../packages/core/src/index.ts';
import { startAltApi } from './fixtures/alt-api.ts';

type Lab = Awaited<ReturnType<typeof startAltApi>>;
let lab: Lab | undefined;
afterEach(async () => { await lab?.close(); lab = undefined; });

const call = async (lab: Lab, token: string, method: string, path: string, body?: unknown, xsrf?: string) => {
  const res = await fetch(lab.origin + path, { method, headers: { 'x-auth-token': token, ...(body ? { 'content-type': 'application/json' } : {}), ...(xsrf ? { 'x-xsrf-token': xsrf } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};

/** A transport that authenticates each actor with the lab's custom header, like a bound session. */
const transport = (lab: Lab, tokens: Record<string, string>): SessionTransport => ({
  async request(actor, req) {
    const res = await fetch(req.url, { method: req.method, headers: { ...req.headers, 'x-auth-token': tokens[actor]!, ...(req.body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}) });
    const text = await res.text();
    let body: any = null; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    return { status: res.status, headers: Object.fromEntries(res.headers), body };
  },
  knownSecrets: () => Object.values(tokens),
});

/** What the server does in Quick Proof: observe identity and one creation, then infer a case. */
async function observeAndBuild(lab: Lab, owner: string, other: string) {
  const a = await call(lab, owner, 'GET', '/api/v1/profile');
  const b = await call(lab, other, 'GET', '/api/v1/profile');
  const identity = inferIdentity('/api/v1/profile', a.body, b.body)!;
  const ownerIdentity = { id: a.body.account_id, tenant: identity.tenantPointer ? a.body.org.slug : undefined };
  const xsrf = (await call(lab, owner, 'GET', '/api/v1/csrf')).body.xsrf;
  const createBody = { text: 'hello', color: 'green' };
  const created = await call(lab, owner, 'POST', '/api/v1/notes', createBody, xsrf);
  const vulnerablePath = `/api/v1/notes/${created.body.note.uid}`;
  const create = inferCreate({ requestBody: createBody, responseBody: created.body, sampleId: templatePath(vulnerablePath)!.sampleId, owner: ownerIdentity });
  return buildQuickProof({ identity, createPath: '/api/v1/notes', createBody, create, readPath: vulnerablePath, csrf: { path: '/api/v1/csrf', pointer: '/xsrf', header: 'x-xsrf-token' } });
}

describe('Quick Proof inference', () => {
  it('finds the identity fields by comparing two accounts', () => {
    const a = { account_id: 'a1b2c3d4-0000-4000-8000-000000000001', email: 'a@x.test', org: { slug: 'org-alpha', plan: 'team' }, prefs: { theme: 'dark' } };
    const b = { account_id: 'a1b2c3d4-0000-4000-8000-000000000002', email: 'b@x.test', org: { slug: 'org-bravo', plan: 'team' }, prefs: { theme: 'dark' } };
    const guess = inferIdentity('/api/v1/profile', a, b)!;
    expect(guess.idPointer).toBe('/account_id');
    expect(guess.tenantPointer).toBe('/org/slug');
    expect(guess.sameTenant).toBe(false);
    expect(inferIdentity('/x', a, a)).toBeUndefined();
    expect(inferIdentity('/x', 'html', b)).toBeUndefined();
  });

  it('templates the object ID in a path and finds ID, owner and marker fields in a wrapped response', () => {
    expect(templatePath('/api/v1/notes/0b0e2a8c-3d5e-4f6a-9b1c-2d3e4f5a6b7c')).toEqual({ readPath: '/api/v1/notes/{resource}', sampleId: '0b0e2a8c-3d5e-4f6a-9b1c-2d3e4f5a6b7c' });
    expect(templatePath('/users/1042/orders')).toEqual({ readPath: '/users/{resource}/orders', sampleId: '1042' });
    expect(templatePath('/settings')).toBeUndefined();
    const owner = { id: 'owner-uuid-11111111-2222', tenant: 'org-alpha' };
    const guess = inferCreate({ requestBody: { color: 'green', text: 'x' }, responseBody: { ok: true, note: { uid: '0b0e2a8c-3d5e-4f6a-9b1c-2d3e4f5a6b7c', created_by: owner.id, org_slug: 'org-alpha', text: 'x' } }, sampleId: '0b0e2a8c-3d5e-4f6a-9b1c-2d3e4f5a6b7c', owner });
    expect(guess).toMatchObject({ idResponsePointer: '/note/uid', ownerResponsePointer: '/note/created_by', ownerSource: 'creation', tenantResponsePointer: '/note/org_slug', markerRequestPointer: '/text' });
    expect(findOwnerPointer({ data: { author_id: 7, id: 9 } }, 7)).toBe('/data/author_id');
  });

  it('skips secret-looking fields and explains missing pieces', () => {
    expect(() => inferCreate({ requestBody: { text: 'x' }, responseBody: { ok: true }, owner: { id: 'u' } })).toThrow(/identifier/);
    const g = inferCreate({ requestBody: { amount: 3 }, responseBody: { id: 42, token: 'zzzzzzzzzzzzzzzzzzzzzzzzzz1' }, owner: { id: 'u' } });
    expect(g.idResponsePointer).toBe('/id');
    expect(g.ownerResponsePointer).toBeUndefined();
    expect(g.notes.join(' ')).toMatch(/owner/);
    expect(g.markerRequestPointer).toBe('/title');
  });

  it('produces a valid, unacknowledged case without hand-written JSON', async () => {
    lab = await startAltApi('vulnerable');
    const built = await observeAndBuild(lab, lab.users.alice.token, lab.users.bob.token);
    expect(built.issues.filter(i => i.level === 'error').filter(i => !i.path.startsWith('policy'))).toEqual([]);
    expect(built.case.policy.acknowledged).toBe(false);
    expect(built.authoring.boundary).toBe('cross_tenant');
    expect(validateCase(built.case).some(i => i.path === 'witness.success')).toBe(false);
  });
});

describe('Quick Proof on a differently shaped API (end to end through the real runner)', () => {
  const runIt = async (lab: Lab, owner: string, other: string) => {
    const built = await observeAndBuild(lab, owner, other);
    const spec = { ...built.case, policy: { ...built.case.policy, acknowledged: true } };
    return executeCase(spec, { targets: { api: lab.origin }, approvedRevision: spec.revision, intervalMs: 0 }, transport(lab, { owner, researcher: other }));
  };

  it('reproduced on the vulnerable lab, and cleans up the created note', async () => {
    lab = await startAltApi('vulnerable');
    const run = await runIt(lab, lab.users.alice.token, lab.users.bob.token);
    expect(run.verdict, run.reason).toBe('reproduced');
    expect(lab.noteCount()).toBe(1); // the observation note remains; the run's own note was cleaned up
  });

  it('not reproduced when the lab enforces ownership (401)', async () => {
    lab = await startAltApi('secure');
    const run = await runIt(lab, lab.users.alice.token, lab.users.bob.token);
    expect(run.verdict, run.reason).toBe('not_reproduced');
  });

  it('cross-user (same tenant) is inferred and reproduced', async () => {
    lab = await startAltApi('vulnerable');
    const built = await observeAndBuild(lab, lab.users.alice.token, lab.users.carol.token);
    expect(built.authoring.boundary).toBe('cross_user');
    const run = await runIt(lab, lab.users.alice.token, lab.users.carol.token);
    expect(run.verdict, run.reason).toBe('reproduced');
  });

  it('inconclusive when both "accounts" are the same person', async () => {
    lab = await startAltApi('vulnerable');
    const built = await observeAndBuild(lab, lab.users.alice.token, lab.users.bob.token);
    const spec = { ...built.case, policy: { ...built.case.policy, acknowledged: true } };
    const run = await executeCase(spec, { targets: { api: lab.origin }, approvedRevision: spec.revision, intervalMs: 0 }, transport(lab, { owner: lab.users.alice.token, researcher: lab.users.alice.token }));
    expect(run.verdict).toBe('inconclusive');
    expect(run.code).toBe('precondition_failed');
  });
});
