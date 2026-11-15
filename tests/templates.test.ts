import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer } from '../apps/server/src/server.ts';
import { applyTemplate, createExampleCase, makeTemplate, parseTemplateFile, templateSlots } from '../packages/core/src/index.ts';

let server: Awaited<ReturnType<typeof createServer>> | undefined;
afterEach(async () => { await server?.close(); server = undefined; });

async function call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
  const host = new URL(server!.origin).host;
  const res = await server!.app.inject({ method, url: path, headers: { host, authorization: `Bearer ${server!.token}` }, ...(body === undefined ? {} : { payload: body as any }) });
  return { status: res.statusCode, json: res.json() };
}

describe('case templates (core)', () => {
  const spec = createExampleCase();

  it('keeps the case logic, drops approval and lists every path to map', () => {
    const template = makeTemplate({ ...spec, policy: { ...spec.policy, acknowledged: true } }, { name: 'Doc read', tags: ['idor'] });
    expect(template.format).toBe('reprocase-template');
    expect(template.case.policy.acknowledged).toBe(false);
    expect(template.case.steps.length).toBe(spec.steps.length);
    const paths = templateSlots(template.case).map(slot => slot.path);
    expect(paths).toContain('/me');
    expect(paths.some(path => path.includes('{'))).toBe(true);
  });

  it('rewrites mapped paths and keeps everything else', () => {
    const template = makeTemplate(spec, { name: 'Doc read' });
    const objectPath = templateSlots(template.case).find(slot => slot.path.includes('{'))!.path;
    const placeholder = objectPath.match(/\{[^}]+\}/)![0];
    const next = applyTemplate(template, { title: 'On site B', paths: { '/me': '/api/v2/account', [objectPath]: `/api/v2/files/${placeholder}` } });
    expect(next.title).toBe('On site B');
    expect(next.id).not.toBe(template.case.id);
    expect(next.revision).toBe(1);
    expect(next.policy.acknowledged).toBe(false);
    expect(next.actors.every(actor => actor.identity.path === '/api/v2/account')).toBe(true);
    expect(next.steps.filter(step => step.request.path === objectPath)).toEqual([]);
    expect(next.steps.some(step => step.request.path === `/api/v2/files/${placeholder}`)).toBe(true);
  });

  it('refuses mappings that would change what the case does', () => {
    const template = makeTemplate(spec, { name: 'Doc read' });
    const objectPath = templateSlots(template.case).find(slot => slot.path.includes('{'))!.path;
    expect(() => applyTemplate(template, { paths: { [objectPath]: '/api/v2/files/1' } })).toThrow(/placeholders/);
    expect(() => applyTemplate(template, { paths: { '/me': 'https://other.example/me' } })).toThrow(/single \//);
    expect(() => applyTemplate(template, { paths: { '/me': '//other.example/me' } })).toThrow(/single \//);
    expect(() => applyTemplate(template, { paths: { '/me': '/me?x=1' } })).toThrow(/without a query/);
    expect(() => applyTemplate(template, { paths: { '/not-used': '/x' } })).toThrow(/does not use/);
  });

  it('imports a ReproCase package as a template without its evidence', () => {
    const text = readFileSync('examples/cross-tenant.reprocase.json', 'utf8');
    const template = parseTemplateFile(text);
    expect(template.case.title).toBe(JSON.parse(text).case.title);
    expect(JSON.stringify(template)).not.toContain('"evidence"');
    expect(() => parseTemplateFile('{"hello":1}')).toThrow(/neither/);
  });
});

describe('case templates (service)', () => {
  it('saves a proven case, reuses it on a target the user enters, and reproduces again', async () => {
    process.env.REPROCASE_HEADLESS = '1';
    server = await createServer({ memory: true, port: 0, demo: true });
    const demo = server.service.state().demo!;
    const source = server.service.state().cases[0]!;

    const saved = await call('POST', '/api/templates', { caseId: source.id, name: 'Cross-tenant read', appliesTo: 'Demo-shaped document APIs', tags: ['idor'] });
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    for (const secret of server.service.knownSecrets()) expect(JSON.stringify(saved.json)).not.toContain(secret);

    const list = await call('GET', '/api/templates');
    const ids = list.json.map((t: any) => t.id);
    expect(ids).toContain(saved.json.id);
    expect(ids).toContain('horizontal-idor-read');
    expect(list.json.find((t: any) => t.id === 'horizontal-idor-read').builtIn).toBe(true);

    // The target must be typed by the user; there is no default.
    expect((await call('POST', `/api/templates/${saved.json.id}/use`, { targets: {} })).status).toBe(422);

    const used = await call('POST', `/api/templates/${saved.json.id}/use`, { targets: { api: demo.origin }, title: 'Reused on the demo' });
    expect(used.status, JSON.stringify(used.json)).toBe(200);
    const caseId = used.json.case.id as string;
    expect(used.json.case.policy.acknowledged).toBe(false);
    expect(server.service.state().targets?.[caseId]).toEqual({ api: demo.origin });

    await server.service.bindDemo(caseId, false, 'cookie');
    const spec = server.service.getCase(caseId);
    const approved = server.service.saveCase({ ...spec, policy: { ...spec.policy, acknowledged: true } }, spec.revision);
    const run = await server.service.waitRun(server.service.startRun(caseId, { targets: { api: demo.origin }, approvedRevision: approved.revision, intervalMs: 0 }).id);
    expect(run.verdict, run.reason).toBe('reproduced');
  });

  it('refuses a target outside the saved program scope and protects built-in templates', async () => {
    server = await createServer({ memory: true, port: 0, demo: true });
    const demo = server.service.state().demo!;
    server.service.saveProgram({ id: 'p', name: 'Program', inScope: ['https://allowed.example/*'], maxRps: 5 });
    const before = server.service.state().cases.length;
    const used = await call('POST', '/api/templates/horizontal-idor-read/use', { targets: { api: demo.origin } });
    expect(used.status).toBe(422);
    expect(used.json.error).toMatch(/outside the saved program scope/);
    expect(server.service.state().cases.length).toBe(before);
    expect((await call('DELETE', '/api/templates/horizontal-idor-read')).status).toBe(400);
  });

  it('imports a template file and deletes saved templates', async () => {
    server = await createServer({ memory: true, port: 0 });
    const imported = await call('POST', '/api/templates/import', { data: readFileSync('templates/horizontal-idor-write.reprocase.json', 'utf8') });
    expect(imported.status, JSON.stringify(imported.json)).toBe(200);
    expect((await call('GET', `/api/templates/${imported.json.id}`)).json.case.title).toBe(imported.json.case.title);
    expect((await call('DELETE', `/api/templates/${imported.json.id}`)).status).toBe(200);
    expect((await call('GET', `/api/templates/${imported.json.id}`)).status).toBe(404);
  });
});
