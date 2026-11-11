#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { VERSION, caseSchema, importTraffic, validateCase, type CaseSpec, type ImportKind, type Verdict } from '@reprocase/core';
import { createServer, projectRoot } from './server.ts';
import { ReproService } from './service.ts';
import { Store } from './store.ts';
import { startMcp } from './mcp.ts';
import { acquireWorkspace, connectRuntime } from './runtime.ts';

function argsOf(argv: string[]) {
  const positional: string[] = [], flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) { const [name, inline] = arg.slice(2).split(/=(.*)/s); flags[name] = inline ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true); }
    else positional.push(arg);
  }
  return { positional, flags };
}
const readJSON = (input: string) => JSON.parse(existsSync(input) ? readFileSync(input, 'utf8') : input);
function environmentValues(value: any): any {
  if (typeof value === 'string' && value.startsWith('env:')) { const name = value.slice(4); if (!process.env[name]) throw new Error(`Environment value is missing: ${name}`); return process.env[name]; }
  if (Array.isArray(value)) return value.map(environmentValues);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, environmentValues(v)]));
  return value;
}
function loadCase(service: ReproService, input: string): CaseSpec {
  if (!existsSync(input)) return service.getCase(input);
  const data = JSON.parse(readFileSync(input, 'utf8'));
  const spec = data.format === 'reprocase' ? importTraffic('package', JSON.stringify(data)).case : caseSchema.parse(data);
  const current = service.store.getCase(spec.id);
  return service.saveCase(spec, current?.revision);
}
function printJSON(value: unknown, flags: Record<string, string | boolean>) {
  const output = JSON.stringify(value, null, 2);
  if (typeof flags.output === 'string') { mkdirSync(dirname(resolve(flags.output)), { recursive: true }); writeFileSync(flags.output, output); }
  else console.log(output);
}
async function liveCommand(command: string, input: string, flags: Record<string, string | boolean>, call: NonNullable<Awaited<ReturnType<typeof connectRuntime>>>, second?: string) {
  if (command === 'create') { printJSON(await call('/api/cases/build', 'POST', { settings: readJSON(input), ...(typeof flags.target === 'string' ? { targetOrigin: flags.target } : {}) }), flags); return; }
  if (command === 'recon') { printJSON(existsSync(input) ? await call('/api/recon/extract', 'POST', { sourceText: readFileSync(input, 'utf8'), sourceLabel: input }) : await call('/api/recon/probe', 'POST', { origin: input }), flags); return; }
  if (command === 'plan') {
    if (typeof flags.targets !== 'string') throw new Error('plan requires --targets');
    const spec = await call(`/api/cases/${encodeURIComponent(input)}`);
    printJSON(await call(`/api/cases/${encodeURIComponent(input)}/preflight`, 'POST', { targets: readJSON(flags.targets), approvedRevision: spec.revision, maxRequests: Number(flags.budget ?? 100) }), flags); return;
  }
  if (command === 'compare') {
    if (!second) throw new Error('compare requires two run identifiers');
    printJSON(await call(`/api/runs/compare?before=${encodeURIComponent(input)}&after=${encodeURIComponent(second)}`), flags); return;
  }
  if (command === 'import') {
    const kind = flags.kind ?? (input.endsWith('.reprocase.json') ? 'package' : input.endsWith('.har') ? 'har' : input.endsWith('.xml') ? 'burp' : input.endsWith('.postman_collection.json') ? 'postman' : 'http');
    console.log(JSON.stringify(await call('/api/import', 'POST', { kind, data: readFileSync(input, 'utf8') }), null, 2)); return;
  }
  if (command === 'validate') {
    const issues = existsSync(input) ? validateCase((() => { const value = readJSON(input); return value.format === 'reprocase' ? importTraffic('package', JSON.stringify(value)).case : value; })()) : (await call(`/api/cases/${encodeURIComponent(input)}/validate`)).issues;
    console.log(JSON.stringify({ issues }, null, 2)); if (issues.some((i: any) => i.level === 'error')) process.exitCode = 1; return;
  }
  if (command === 'export') {
    const suffix = typeof flags.run === 'string' ? `runId=${encodeURIComponent(flags.run)}` : '';
    const format = String(flags.format ?? 'package');
    if (!['package', 'html', 'markdown', 'bounty', 'hurl', 'playwright'].includes(format)) throw new Error('Unknown export format');
    const value = await call(`/api/cases/${encodeURIComponent(input)}/${format === 'package' ? 'export' : 'report'}?${suffix}${format === 'package' ? '' : `&format=${format}`}`);
    const output = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    if (typeof flags.output === 'string') { mkdirSync(dirname(resolve(flags.output)), { recursive: true }); writeFileSync(flags.output, output); } else console.log(output); return;
  }
  if (command === 'matrix') {
    if (typeof flags.targets !== 'string' || typeof flags.bindings !== 'string') throw new Error('matrix requires --targets and --bindings');
    const spec: CaseSpec = await call(`/api/cases/${encodeURIComponent(input)}`);
    const targets = readJSON(flags.targets), profiles = environmentValues(readJSON(flags.bindings));
    for (const actor of spec.actors) {
      const binding = profiles.actors?.[actor.id]; if (!binding) throw new Error(`Missing binding for ${actor.label}`);
      await call(`/api/cases/${spec.id}/actors/${actor.id}/direct`, 'POST', { ...binding, origin: binding.origin ?? targets[actor.identity.origin] });
    }
    printJSON(await call(`/api/cases/${spec.id}/matrix`, 'POST', { targets, approvedRevision: spec.revision, intervalMs: Number(flags.interval ?? 250), maxRequests: Number(flags.budget ?? 100) }), flags);
    return;
  }
  if (command === 'run') {
    if (typeof flags.targets !== 'string' || typeof flags.bindings !== 'string') throw new Error('run requires --targets and --bindings');
    let spec: CaseSpec;
    if (existsSync(input)) {
      const data = readJSON(input); const source = data.format === 'reprocase' ? importTraffic('package', JSON.stringify(data)).case : caseSchema.parse(data);
      let current: CaseSpec | undefined;
      try { current = await call(`/api/cases/${encodeURIComponent(source.id)}`); } catch (error: any) { if (error.statusCode !== 404) throw error; }
      spec = current ? await call(`/api/cases/${source.id}`, 'PUT', { case: source, expectedRevision: current.revision }) : await call('/api/cases', 'POST', source);
    } else spec = await call(`/api/cases/${encodeURIComponent(input)}`);
    const targets = readJSON(flags.targets), profiles = environmentValues(readJSON(flags.bindings));
    for (const actor of spec.actors) {
      const binding = profiles.actors?.[actor.id]; if (!binding) throw new Error(`Missing binding for ${actor.label}`);
      await call(`/api/cases/${spec.id}/actors/${actor.id}/direct`, 'POST', { ...binding, origin: binding.origin ?? targets[actor.identity.origin] });
    }
    let run = await call(`/api/cases/${spec.id}/run`, 'POST', { targets, approvedRevision: spec.revision, intervalMs: Number(flags.interval ?? 250), maxRequests: Number(flags.budget ?? 100) });
    while (run.state === 'running') { await new Promise(resolve => setTimeout(resolve, 150)); run = await call(`/api/runs/${run.id}`); }
    console.log(JSON.stringify(run, null, 2));
    const expected = String(flags.expect ?? 'reproduced');
    if (!['reproduced', 'not_reproduced', 'inconclusive'].includes(expected)) throw new Error('Unknown expected verdict');
    process.exitCode = run.verdict === expected ? 0 : run.verdict === 'not_reproduced' ? 2 : 3; return;
  }
  throw new Error(`Unknown command: ${command}`);
}
export async function main(argv = process.argv.slice(2)) {
  const { positional, flags } = argsOf(argv);
  const command = positional[0] ?? 'serve';
  const workspace = resolve(String(flags.workspace ?? join(projectRoot, '.reprocase')));
  if (['help', '--help', '-h'].includes(command) || flags.help) {
    console.log(`ReproCase ${VERSION}\n\nserve | demo [--dev] [--workspace DIR] [--port 4317] [--mode secure|vulnerable]\nrecon ORIGIN_OR_FILE [--output FILE]\ncreate SETTINGS_FILE [--target ORIGIN]\nimport FILE [--kind har|http|package|burp|postman]\nvalidate CASE_ID_OR_FILE\nplan CASE_ID --targets FILE_OR_JSON [--budget 100]\nrun CASE_ID_OR_FILE --targets FILE_OR_JSON --bindings FILE [--expect reproduced|not_reproduced|inconclusive]\nmatrix CASE_ID_OR_FILE --targets FILE_OR_JSON --bindings FILE [--output FILE]\ncompare BEFORE_RUN_ID AFTER_RUN_ID [--output FILE]\nexport CASE_ID [--run RUN_ID] [--format package|html|markdown|bounty|hurl|playwright] [--output FILE]\nmcp [--workspace DIR]   (attach to a running local service)`);
    return;
  }
  if (command === 'mcp') { await startMcp(workspace); return; }
  if (command === 'serve' || command === 'demo') {
    const instance = await createServer({ workspace, port: Number(flags.port ?? 4317), dev: Boolean(flags.dev), demo: command === 'demo', mode: flags.mode === 'secure' ? 'secure' : 'vulnerable' });
    console.log(`\n  ReproCase ${VERSION}\n  Open ${instance.url}\n  Workspace ${workspace}\n  ${command === 'demo' ? `Controlled lab: ${instance.service.demo!.origin} (${instance.service.demo!.mode})` : 'Local-only workspace; imported packages never run automatically.'}\n`);
    const shutdown = () => { void instance.close().then(() => { process.exitCode = 0; }); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    return;
  }
  mkdirSync(workspace, { recursive: true });
  const live = await connectRuntime(workspace);
  const input = positional[1]; if (!input) throw new Error('Provide a case identifier or input file');
  if (live) { await liveCommand(command, input, flags, live, positional[2]); return; }
  const releaseWorkspace = acquireWorkspace(workspace);
  const service = new ReproService(new Store(join(workspace, 'state.sqlite')));
  await service.initialize();
  service.store.recoverInterruptedRuns();
  try {
    if (command === 'create') { printJSON(service.build(readJSON(input), typeof flags.target === 'string' ? flags.target : undefined), flags); return; }
    if (command === 'recon') { printJSON(existsSync(input) ? { endpoints: service.extractRecon(readFileSync(input, 'utf8'), input) } : await service.probeTarget(input), flags); return; }
    if (command === 'plan') {
      if (typeof flags.targets !== 'string') throw new Error('plan requires --targets');
      const spec = service.getCase(input);
      printJSON(service.plan(input, { targets: readJSON(flags.targets), approvedRevision: spec.revision, maxRequests: Number(flags.budget ?? 100) }), flags); return;
    }
    if (command === 'compare') { if (!positional[2]) throw new Error('compare requires two run identifiers'); printJSON(service.compare(input, positional[2]), flags); return; }
    if (command === 'import') {
      const kind = (flags.kind ?? (input.endsWith('.reprocase.json') ? 'package' : input.endsWith('.har') ? 'har' : input.endsWith('.xml') ? 'burp' : input.endsWith('.postman_collection.json') ? 'postman' : 'http')) as ImportKind;
      console.log(JSON.stringify(service.import(kind, readFileSync(input, 'utf8')), null, 2)); return;
    }
    if (command === 'validate') {
      const spec = existsSync(input) ? (() => { const content = readJSON(input); return content.format === 'reprocase' ? importTraffic('package', JSON.stringify(content)).case : caseSchema.parse(content); })() : service.getCase(input);
      const issues = validateCase(spec); console.log(JSON.stringify({ caseId: spec.id, revision: spec.revision, issues }, null, 2));
      if (issues.some(i => i.level === 'error')) process.exitCode = 1; return;
    }
    if (command === 'matrix') {
      if (typeof flags.targets !== 'string' || typeof flags.bindings !== 'string') throw new Error('matrix requires --targets and --bindings');
      const spec = loadCase(service, input), targets = readJSON(flags.targets);
      const profiles = environmentValues(readJSON(flags.bindings));
      for (const actor of spec.actors) {
        const binding = profiles.actors?.[actor.id]; if (!binding) throw new Error(`Missing binding for ${actor.label}`);
        await service.connectDirect(spec.id, actor.id, { ...binding, origin: binding.origin ?? targets[actor.identity.origin] });
      }
      printJSON(await service.runMatrix(spec.id, { targets, approvedRevision: spec.revision, intervalMs: Number(flags.interval ?? 250), maxRequests: Number(flags.budget ?? 100) }), flags);
      return;
    }
    if (command === 'run') {
      if (typeof flags.targets !== 'string' || typeof flags.bindings !== 'string') throw new Error('run requires --targets and --bindings');
      const spec = loadCase(service, input), targets = readJSON(flags.targets);
      const profiles = environmentValues(readJSON(flags.bindings));
      for (const actor of spec.actors) {
        const binding = profiles.actors?.[actor.id]; if (!binding) throw new Error(`Missing binding for ${actor.label}`);
        await service.connectDirect(spec.id, actor.id, { ...binding, origin: binding.origin ?? targets[actor.identity.origin] });
      }
      const initial = service.startRun(spec.id, { targets, approvedRevision: spec.revision, intervalMs: Number(flags.interval ?? 250), maxRequests: Number(flags.budget ?? 100) });
      const result = await service.waitRun(initial.id); console.log(JSON.stringify(result, null, 2));
      const expected = String(flags.expect ?? 'reproduced') as Verdict;
      if (!['reproduced', 'not_reproduced', 'inconclusive'].includes(expected)) throw new Error('Unknown expected verdict');
      process.exitCode = result.verdict === expected ? 0 : result.verdict === 'not_reproduced' ? 2 : 3; return;
    }
    if (command === 'export') {
      const runId = typeof flags.run === 'string' ? flags.run : undefined;
      const format = String(flags.format ?? 'package');
      if (!['package', 'html', 'markdown', 'bounty', 'hurl', 'playwright'].includes(format)) throw new Error('Format must be package, html, markdown, bounty, hurl or playwright');
      const output = format === 'package' ? JSON.stringify(service.package(input, runId), null, 2) : service.report(input, format as 'html' | 'markdown' | 'bounty' | 'hurl' | 'playwright', runId);
      if (typeof flags.output === 'string') { mkdirSync(dirname(resolve(flags.output)), { recursive: true }); writeFileSync(flags.output, output); }
      else console.log(output);
      return;
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (error) { throw new Error(service.safeError(error)); }
  finally { await service.close(); releaseWorkspace(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`ReproCase: ${error instanceof Error ? error.message : 'Operation failed'}`); process.exitCode = 1; });
}
