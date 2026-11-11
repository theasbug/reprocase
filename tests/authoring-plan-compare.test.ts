import { afterEach, describe, expect, it, vi } from 'vitest';
import { authoringSchema, buildCase, compareRuns, createExampleCase, newRunResult, planRun, validateCase, type AuthoringInput, type RunResult } from '@reprocase/core';
import { createServer } from '../apps/server/src/server.ts';

const settings: AuthoringInput = {
  title: 'Guided private document', policy: 'Only the owner may read or change this private document.',
  tenantPointer: '/tenant', tenantResponsePointer: '/tenant', rolePointer: '/role', expectedRole: 'member',
  createPath: '/documents', createBody: { title: 'Controlled baseline', marker: 'Controlled baseline' }, readPath: '/documents/{resource}',
  csrf: { path: '/csrf', pointer: '/csrf', header: 'x-csrf-token' },
};
let server: Awaited<ReturnType<typeof createServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; });
async function setup() { server = await createServer({ memory: true, port: 0 }); await server.service.startDemo(); return server; }
const config = (revision: number, origin: string) => ({ targets: { api: origin }, approvedRevision: revision, intervalMs: 0 });

describe('guided authoring and read-only run planning', () => {
  it('creates an unapproved declarative read case with fresh references and no source credentials or IDs', () => {
    const input = structuredClone(settings), built = buildCase(input);
    expect(input).toEqual(settings);
    expect(built.issues).toEqual([{ path: 'policy.acknowledged', message: 'Review and acknowledge the expected access policy', level: 'error' }]);
    expect(built.case.policy.acknowledged).toBe(false);
    expect(built.case.steps.find(s => s.id === 'create-resource')!.request.body).toMatchObject({ marker: { $ref: 'run.marker' } });
    expect(JSON.stringify(built.case)).not.toContain('http://');
    built.case.policy.acknowledged = true; expect(validateCase(built.case)).toEqual([]);
  });
  it.each(['read', 'write'] as const)('rebuilds a guided %s proof with fresh accounts, then observes secure denial', async kind => {
    const s = await setup(), built = s.service.build({ ...settings, kind, ownershipSource: 'owner_read' });
    const spec = s.service.saveCase({ ...built.case, policy: { ...built.case.policy, acknowledged: true } }, 1);
    await s.service.bindDemo(spec.id, true);
    const options = config(spec.revision, s.service.demo!.origin);
    const initial = s.service.startRun(spec.id, options), first = await s.service.waitRun(initial.id);
    expect(first.verdict).toBe('reproduced'); expect(s.service.demo!.stats().documentCount).toBe(0);
    await s.service.bindDemo(spec.id, true, 'bearer');
    const second = await s.service.waitRun(s.service.startRun(spec.id, options).id);
    expect(second.verdict).toBe('reproduced');
    expect(s.service.getCase(spec.id)).toEqual(spec);
    s.service.setDemoMode('secure');
    const denied = await s.service.waitRun(s.service.startRun(spec.id, options).id);
    expect(denied.verdict).toBe('not_reproduced'); expect(s.service.demo!.stats().documentCount).toBe(0);
    const comparison = s.service.compare(first.id, denied.id);
    expect(comparison.sameRevision).toBe(true); expect(comparison.verdictChanged).toBe(true);
    expect(comparison.steps.find(step => step.id === 'probe')).toMatchObject({ beforeHTTP: 200, afterHTTP: 403, changed: true });
    const serialized = JSON.stringify(comparison);
    for (const secret of s.service.browsers.knownSecrets()) expect(serialized).not.toContain(secret);
    for (const account of s.service.demo!.accounts) expect(serialized).not.toContain(account.id);
  });
  it.each([
    { tenantPointer: undefined }, { expectedRole: 'admin', rolePointer: undefined },
    { readPath: '//unapproved.test/{resource}' }, { readPath: '/documents/fixed-id' },
    { markerRequestPointer: '/__proto__/polluted' }, { ownerResponsePointer: '/owner~2id' },
    { createPath: '/documents/{resource}' }, { csrf: { path: '/csrf/{resource}', pointer: '/csrf', header: 'cookie' } },
  ])('rejects unsupported or unsafe authoring mappings %# before any execution', patch => {
    expect(() => buildCase({ ...settings, ...patch })).toThrow();
    expect(({} as any).polluted).toBeUndefined();
  });
  it('rejects marker pointers crossing primitives and builds nested JSON marker objects safely', () => {
    expect(() => buildCase({ ...settings, createBody: { metadata: 'text' }, markerRequestPointer: '/metadata/marker' })).toThrow(/non-object/);
    const result = buildCase({ ...settings, markerRequestPointer: '/metadata/marker', markerResponsePointer: '/metadata/marker' });
    expect(result.case.steps.find(s => s.id === 'create-resource')!.request.body).toMatchObject({ metadata: { marker: { $ref: 'run.marker' } } });
  });
  it('finds missing bindings, wrong origins, stale revisions and a budget too small for the complete flow', () => {
    const spec = createExampleCase(), origin = 'https://test.example';
    const plan = planRun(spec, { targets: { api: origin }, approvedRevision: 2, maxRequests: 2 });
    expect(plan.ready).toBe(false);
    expect(plan.issues.map(i => i.path)).toEqual(expect.arrayContaining(['actors.owner', 'actors.researcher', 'approvedRevision', 'maxRequests']));
    const bindings = spec.actors.map(a => ({ actorId: a.id, connected: false, origin, mode: 'direct' as const }));
    const ready = planRun(spec, { targets: { api: origin }, approvedRevision: 1 }, bindings);
    expect(ready.ready).toBe(true); expect(ready.totals.writes).toBe(2);
    expect(ready.totals.identityChecks).toBe(4);
    expect(ready.steps.find(s => s.phase === 'probe')!.dependencies).toContain('create-document');
    bindings[0].origin = 'https://other.example';
    expect(planRun(spec, { targets: { api: origin }, approvedRevision: 1 }, bindings).ready).toBe(false);
  });
  it('builds and inspects via authenticated API without target traffic; the same plan gates starting a run', async () => {
    const s = await setup(), headers = { authorization: `Bearer ${s.token}` }, spy = vi.spyOn(s.service.browsers, 'request');
    expect((await s.app.inject({ method: 'POST', url: '/api/cases/build', payload: { settings } })).statusCode).toBe(401);
    const built = await s.app.inject({ method: 'POST', url: '/api/cases/build', headers, payload: { settings, targetOrigin: s.service.demo!.origin } });
    expect(built.statusCode).toBe(200); const spec = built.json().case;
    const payload = config(1, s.service.demo!.origin);
    const plan = await s.app.inject({ method: 'POST', url: `/api/cases/${spec.id}/preflight`, headers, payload });
    expect(plan.json().ready).toBe(false); expect(spy).not.toHaveBeenCalled();
    const start = await s.app.inject({ method: 'POST', url: `/api/cases/${spec.id}/run`, headers, payload });
    expect(start.statusCode).toBe(422); expect(spy).not.toHaveBeenCalled();
    const acknowledged = s.service.saveCase({ ...spec, policy: { ...spec.policy, acknowledged: true } }, 1);
    await s.service.bindDemo(spec.id); spy.mockClear();
    const ready = await s.app.inject({ method: 'POST', url: `/api/cases/${spec.id}/preflight`, headers, payload: config(acknowledged.revision, s.service.demo!.origin) });
    expect(ready.json().ready).toBe(true); expect(spy).not.toHaveBeenCalled();
    const stale = await s.app.inject({ method: 'POST', url: `/api/cases/${spec.id}/run`, headers, payload });
    expect(stale.statusCode).toBe(409); expect(spy).not.toHaveBeenCalled();
  });
});

function finished(body: any, revision = 1): RunResult {
  const run = newRunResult(createExampleCase());
  return { ...run, state: 'completed', caseRevision: revision, code: 'test', steps: [{ id: 'probe', label: 'Probe', phase: 'probe', actor: 'researcher', status: 'passed', startedAt: run.startedAt, checks: [], response: { status: 200, headers: {}, body } }] };
}
describe('bounded recorded evidence comparison', () => {
  it('compares nested JSON pointers and check outcomes, excluding transient identity row IDs', () => {
    const before = finished({ 'a/b': { '~key': 'old' }, keep: 1, remove: true }), after = finished({ 'a/b': { '~key': 'new' }, keep: 1, add: true });
    before.checks = [{ id: 'witness', label: 'Fresh marker', passed: true }]; after.checks = [{ id: 'witness', label: 'Fresh marker', passed: false }];
    const result = compareRuns(before, after);
    expect(result.changedSteps).toBe(1); expect(result.checksChanged).toEqual(['witness']);
    expect(result.steps[0].fields).toEqual(expect.arrayContaining([{ pointer: '/a~1b/~0key', kind: 'changed', before: 'old', after: 'new' }, { pointer: '/add', kind: 'added', after: true }, { pointer: '/remove', kind: 'removed', before: true }]));
  });
  it('labels changed case versions and rejects unrelated or running evidence', () => {
    const before = finished({ ok: true }), after = finished({ ok: true }, 2);
    const result = compareRuns(before, after); expect(result.sameRevision).toBe(false); expect(result.notes[0]).toContain('revision changed');
    expect(() => compareRuns(before, { ...after, caseId: 'another' })).toThrow(/same case/);
    expect(() => compareRuns(before, { ...after, state: 'running' })).toThrow(/finish/);
  });
  it('bounds large comparisons and still marks later steps changed after the display limit', () => {
    const before = finished(Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`field${i}`, 1]))), after = finished(Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`field${i}`, 2])));
    before.steps.push({ ...before.steps[0], id: 'second', response: { status: 200, headers: {}, body: { value: 'a' } } });
    after.steps.push({ ...after.steps[0], id: 'second', response: { status: 200, headers: {}, body: { value: 'b' } } });
    const result = compareRuns(before, after);
    expect(result.truncated).toBe(true); expect(result.steps.flatMap(s => s.fields)).toHaveLength(200);
    expect(result.changedSteps).toBe(2); expect(result.steps[1].changed).toBe(true);
  });
  it('marks a deeply nested comparison as limited rather than declaring complete equality', () => {
    let a: any = 'a', b: any = 'b';
    for (let i = 0; i < 30; i++) { a = { nested: a }; b = { nested: b }; }
    const result = compareRuns(finished(a), finished(b));
    expect(result.truncated).toBe(true); expect(result.steps[0].limited).toBe(true);
  });
});
