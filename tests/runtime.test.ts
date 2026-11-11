import { afterEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer, projectRoot } from '../apps/server/src/server.ts';

const execFileAsync = promisify(execFile);
const cleanups: (() => Promise<void>)[] = [];
const workRoot = resolve(projectRoot, '../../work');
mkdirSync(workRoot, { recursive: true });
function newWorkspace(): string { return mkdtempSync(join(workRoot, 'runtime-test-')); }
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function persistentServer(demo = false) {
  const workspace = newWorkspace();
  const server = await createServer({ workspace, port: 0, demo });
  cleanups.push(() => server.close());
  return server;
}
async function cli(workspace: string, ...args: string[]) {
  return execFileAsync(process.execPath, ['--import', 'tsx', 'apps/server/src/cli.ts', ...args, '--workspace', workspace], {
    cwd: projectRoot, windowsHide: true, timeout: 15000, maxBuffer: 5 * 1024 * 1024,
    env: { ...process.env, TEMP: workspace, TMP: workspace },
  });
}
function toolValue(result: Awaited<ReturnType<Client['callTool']>>): any {
  const content = result.content as { type: string; text?: string }[];
  const text = content.find(item => item.type === 'text')?.text;
  if (!text) throw new Error('MCP returned no JSON text content');
  return JSON.parse(text);
}

describe('one runtime across web, CLI and MCP', () => {
  it('runs the actual stdio MCP adapter against the same authenticated local service', async () => {
    const server = await persistentServer(true);
    const transport = new StdioClientTransport({
      command: process.execPath, args: ['--import', 'tsx', 'apps/server/src/cli.ts', 'mcp', '--workspace', server.workspace],
      cwd: projectRoot, stderr: 'pipe', env: { TEMP: server.workspace, TMP: server.workspace },
    });
    const stderr: string[] = [];
    transport.stderr?.on('data', data => stderr.push(String(data)));
    const client = new Client({ name: 'reprocase-runtime-test', version: '1.0.0' }, { capabilities: {} });
    cleanups.push(async () => { await client.close(); });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map(tool => tool.name)).toEqual(expect.arrayContaining(['case_list', 'case_validate', 'case_build', 'run_plan', 'run_compare', 'run_start', 'run_get', 'case_export']));

    const listResponse = await client.callTool({ name: 'case_list', arguments: {} });
    expect(listResponse.isError).not.toBe(true);
    const state = toolValue(listResponse);
    expect(state.cases).toHaveLength(1);
    expect(state.demo).toEqual({ origin: server.service.demo!.origin, mode: 'vulnerable' });
    expect(state.demo).not.toHaveProperty('accounts');
    const caseSpec = state.cases[0];
    for (const account of server.service.demo!.accounts) expect(JSON.stringify(state)).not.toContain(account.password);
    const validation = toolValue(await client.callTool({ name: 'case_validate', arguments: { caseId: caseSpec.id } }));
    expect(validation.issues.filter((issue: any) => issue.level === 'error')).toEqual([]);
    const planned = toolValue(await client.callTool({ name: 'run_plan', arguments: { caseId: caseSpec.id, approvedRevision: caseSpec.revision, targets: { api: server.service.demo!.origin } } }));
    expect(planned.ready).toBe(true); expect(planned.totals.writes).toBe(2);
    expect(server.service.demo!.stats().writeCount).toBe(0);
    const built = toolValue(await client.callTool({ name: 'case_build', arguments: { settingsJson: readFileSync(join(projectRoot, 'examples/guided-document.json'), 'utf8'), targetOrigin: server.service.demo!.origin } }));
    expect(built.case.policy.acknowledged).toBe(false);
    expect(server.service.demo!.stats().writeCount).toBe(0);

    const stale = await client.callTool({ name: 'run_start', arguments: { caseId: caseSpec.id, approvedRevision: caseSpec.revision + 1, targets: { api: server.service.demo!.origin }, intervalMs: 0 } });
    expect(stale.isError).toBe(true);
    expect(toolValue(stale).error).toMatch(/revision/i);
    expect(server.service.store.runs()).toHaveLength(0);

    const initialResponse = await client.callTool({ name: 'run_start', arguments: { caseId: caseSpec.id, approvedRevision: caseSpec.revision, targets: { api: server.service.demo!.origin }, intervalMs: 0 } });
    expect(initialResponse.isError).not.toBe(true);
    const initial = toolValue(initialResponse);
    const completed = await server.service.waitRun(initial.id);
    expect(completed.verdict).toBe('reproduced');
    const received = toolValue(await client.callTool({ name: 'run_get', arguments: { runId: initial.id } }));
    expect(received).toMatchObject({ id: initial.id, verdict: 'reproduced', state: 'completed' });
    server.service.setDemoMode('secure');
    const denied = await server.service.waitRun(server.service.startRun(caseSpec.id, { approvedRevision: caseSpec.revision, targets: { api: server.service.demo!.origin }, intervalMs: 0 }).id);
    const compared = toolValue(await client.callTool({ name: 'run_compare', arguments: { before: completed.id, after: denied.id } }));
    expect(compared).toMatchObject({ sameRevision: true, verdictChanged: true, before: { verdict: 'reproduced' }, after: { verdict: 'not_reproduced' } });
    const pack = toolValue(await client.callTool({ name: 'case_export', arguments: { caseId: caseSpec.id, runId: initial.id } }));
    expect(pack).toMatchObject({ format: 'reprocase', schemaVersion: 1, case: { id: caseSpec.id, revision: caseSpec.revision } });
    const serialized = JSON.stringify(pack);
    for (const secret of server.service.browsers.knownSecrets()) expect(serialized).not.toContain(secret);
    for (const account of server.service.demo!.accounts) expect(stderr.join('')).not.toContain(account.password);
    expect(server.service.store.getRun(initial.id)?.verdict).toBe('reproduced');
  });

  it('attaches CLI validate/export to the live service without marking its pending run interrupted', async () => {
    const server = await persistentServer(true);
    const spec = server.service.store.cases()[0]!;
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let markEntered!: () => void;
    const entered = new Promise<void>(resolve => { markEntered = resolve; });
    const original = server.service.browsers.request.bind(server.service.browsers);
    server.service.browsers.request = async (actor, request, signal) => {
      if (request.method === 'POST' && new URL(request.url).pathname === '/documents') { markEntered(); await held; }
      return original(actor, request, signal);
    };
    const initial = server.service.startRun(spec.id, { targets: { api: server.service.demo!.origin }, approvedRevision: spec.revision, intervalMs: 100 });
    try {
      await entered;
      expect(server.service.store.getRun(initial.id)?.state).toBe('running');
      const validated = await cli(server.workspace, 'validate', spec.id);
      expect(JSON.parse(validated.stdout).issues.filter((issue: any) => issue.level === 'error')).toEqual([]);
      expect(server.service.store.getRun(initial.id)).toMatchObject({ state: 'running', code: 'running' });
      const exported = await cli(server.workspace, 'export', spec.id, '--run', initial.id);
      const pack = JSON.parse(exported.stdout);
      expect(pack.evidence).toMatchObject({ id: initial.id, state: 'running', code: 'running' });
      expect(server.service.store.getRun(initial.id)).toMatchObject({ state: 'running', code: 'running' });
    } finally {
      release();
      server.service.browsers.request = original;
      await server.service.waitRun(initial.id);
    }
    expect(server.service.store.getRun(initial.id)).toMatchObject({ state: 'completed', verdict: 'reproduced' });
  });

  it('refuses a second server for an owned workspace and releases its lock and launch record on close', async () => {
    const workspace = newWorkspace();
    const server = await createServer({ workspace, port: 0 });
    cleanups.push(() => server.close());
    expect(existsSync(join(workspace, 'owner.lock'))).toBe(true);
    const lockBefore = readFileSync(join(workspace, 'owner.lock'), 'utf8');
    await expect(createServer({ workspace, port: 0 })).rejects.toThrow('already in use');
    expect(readFileSync(join(workspace, 'owner.lock'), 'utf8')).toBe(lockBefore);
    await server.close();
    expect(existsSync(join(workspace, 'owner.lock'))).toBe(false);
    expect(existsSync(join(workspace, 'runtime.json'))).toBe(false);
    const reopened = await createServer({ workspace, port: 0 });
    cleanups.push(() => reopened.close());
    expect(existsSync(join(workspace, 'owner.lock'))).toBe(true);
  });
  it('uses actual CLI create/plan/compare commands against the daemon and can inspect recorded runs offline', async () => {
    const server = await persistentServer(true);
    const created = JSON.parse((await cli(server.workspace, 'create', join(projectRoot, 'examples/guided-document.json'), '--target', server.service.demo!.origin)).stdout);
    expect(created.case.policy.acknowledged).toBe(false);
    const id = created.case.id, targets = JSON.stringify({ api: server.service.demo!.origin });
    const draftPlan = JSON.parse((await cli(server.workspace, 'plan', id, '--targets', targets)).stdout);
    expect(draftPlan.ready).toBe(false); expect(server.service.demo!.stats().writeCount).toBe(0);
    const spec = server.service.saveCase({ ...created.case, policy: { ...created.case.policy, acknowledged: true } }, 1);
    await server.service.bindDemo(id);
    const ready = JSON.parse((await cli(server.workspace, 'plan', id, '--targets', targets)).stdout);
    expect(ready.ready).toBe(true);
    const options = { approvedRevision: spec.revision, targets: { api: server.service.demo!.origin }, intervalMs: 0 };
    const first = await server.service.waitRun(server.service.startRun(id, options).id);
    server.service.setDemoMode('secure');
    const second = await server.service.waitRun(server.service.startRun(id, options).id);
    const live = JSON.parse((await cli(server.workspace, 'compare', first.id, second.id)).stdout);
    expect(live.verdictChanged).toBe(true);
    await server.close();
    const offline = JSON.parse((await cli(server.workspace, 'compare', first.id, second.id)).stdout);
    expect(offline).toEqual(live);
    const offlinePlan = JSON.parse((await cli(server.workspace, 'plan', id, '--targets', targets)).stdout);
    expect(offlinePlan.ready).toBe(false); // Session credentials stay in memory, never in SQLite.
  });
});
