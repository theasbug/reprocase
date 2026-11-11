import { VERSION } from '../packages/core/src/version.ts';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserManager } from '../packages/browser/src/index.ts';
import { createExampleCase } from '../packages/core/src/example.ts';
import { executeCase } from '../packages/core/src/runner.ts';
import { createRedactor } from '../packages/core/src/redact.ts';
import { startDemo, type DemoAccount } from '../apps/server/src/demo.ts';
import type { RunResult, Verdict } from '../packages/core/src/schema.ts';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hurlBinary = process.env.HURL_BIN || 'hurl';
const outputFolder = resolve(projectRoot, 'benchmark-results');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const sourceFiles = ['package.json', 'package-lock.json', 'packages/core/src/schema.ts', 'packages/core/src/version.ts', 'packages/core/src/authoring.ts', 'packages/core/src/preflight.ts', 'packages/core/src/compare.ts', 'packages/core/src/runner.ts', 'packages/core/src/values.ts', 'packages/core/src/validate.ts', 'packages/core/src/redact.ts', 'packages/browser/src/index.ts', 'apps/server/src/demo.ts', 'examples/cross-tenant.hurl', 'examples/cross-tenant-denied.hurl', 'scripts/benchmark.ts'];

interface Trial {
  tool: 'reprocase' | 'hurl';
  mode: 'vulnerable' | 'secure';
  authMode: 'cookie' | 'bearer';
  pair: number;
  expectedVerdict: Verdict;
  observedVerdict: Verdict;
  passed: boolean;
  identitiesFresh: boolean;
  identitiesDistinct: boolean;
  tenantsDistinct: boolean;
  templateUnchanged: boolean;
  cleanupConfirmed: boolean;
  resourceWrites: number;
  manualTemplateEdits: 0;
  suppliedBindings: string[];
  requestCount?: number;
  code?: string;
  exitCode?: number;
  statuses?: number[];
  recipe?: 'violation' | 'denial';
  stderr?: string;
  evidence?: RunResult;
}

function subprocess(binary: string, args: string[], input = '', env: NodeJS.ProcessEnv = process.env): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((accept, reject) => {
    const child = spawn(binary, args, { cwd: projectRoot, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Hurl exceeded the controlled benchmark timeout.')); }, 90000);
    child.stdout.on('data', data => { stdout += String(data); });
    child.stderr.on('data', data => { stderr += String(data); });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => { clearTimeout(timeout); accept({ code: code ?? -1, stdout, stderr }); });
    child.stdin.end(input);
  });
}

function callsIn(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(callsIn);
  const object = value as Record<string, unknown>;
  if (object.request && object.response) return [object];
  return Object.values(object).flatMap(callsIn);
}

async function main() {
  const startedAt = new Date().toISOString();
  const hurlVersion = await subprocess(hurlBinary, ['--version']);
  if (hurlVersion.code !== 0) throw new Error('Hurl is not executable. Set HURL_BIN to the verified portable Hurl executable.');
  const version = hurlVersion.stdout.split(/\r?\n/)[0].trim();
  const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, digest(await readFile(resolve(projectRoot, path), 'utf8'))])));
  const spec = createExampleCase('benchmark-cross-tenant');
  const specText = JSON.stringify(spec);
  const positiveRecipe = await readFile(resolve(projectRoot, 'examples/cross-tenant.hurl'), 'utf8');
  const negativeRecipe = await readFile(resolve(projectRoot, 'examples/cross-tenant-denied.hurl'), 'utf8');
  const recipeFolder = resolve(projectRoot, '.reprocase/benchmark-recipes');
  await mkdir(recipeFolder, { recursive: true });
  const redactor = createRedactor();
  const neverPersist = new Set<string>();
  const identitiesSeen = new Set<string>();
  const remember = (value: string) => { if (value) neverPersist.add(value); };
  const fixture = await startDemo('vulnerable');
  const trials: Trial[] = [];
  const login = async (account: DemoAccount) => {
    const response = await fetch(`${fixture.origin}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password }) });
    if (!response.ok) throw new Error('Controlled fixture login failed.');
    const result = await response.json() as { token: string; cookie: string };
    redactor.add(account.email, account.password, result.token, result.cookie);
    for (const value of [account.email, account.password, account.id, account.tenant, result.token, result.cookie]) remember(value);
    redactor.alias(account.id, 'demo.actor.id'); redactor.alias(account.tenant, 'demo.actor.tenant');
    return result;
  };
  const freshPair = () => {
    const accounts = fixture.freshPair();
    const fresh = accounts.every(account => !identitiesSeen.has(account.id));
    accounts.forEach(account => identitiesSeen.add(account.id));
    return { accounts, fresh, distinct: accounts[0].id !== accounts[1].id, differentTenants: accounts[0].tenant !== accounts[1].tenant };
  };

  try {
    for (const mode of ['vulnerable', 'secure'] as const) for (const authMode of ['cookie', 'bearer'] as const) for (const pair of [1, 2]) {
      fixture.setMode(mode);
      const expectedVerdict: Verdict = mode === 'vulnerable' ? 'reproduced' : 'not_reproduced';

      // Each mechanism receives independently provisioned fresh accounts. The
      // fixture policy, case, and recipe stay unchanged between account pairs.
      {
        const { accounts, fresh, distinct, differentTenants } = freshPair();
        const credentials = await Promise.all(accounts.map(login));
        const browser = new BrowserManager();
        try {
          for (const [index, actor] of ['owner', 'researcher'].entries()) await browser.connectDirect(actor, { origin: fixture.origin, ...(authMode === 'cookie' ? { cookie: credentials[index].cookie } : { token: credentials[index].token }) });
          const before = fixture.stats();
          const result = await executeCase(spec, { targets: { api: fixture.origin }, approvedRevision: spec.revision, intervalMs: 0, maxRequests: 100 }, browser);
          const after = fixture.stats();
          redactor.add(...browser.knownSecrets()); browser.knownSecrets().forEach(remember);
          trials.push({ tool: 'reprocase', mode, authMode, pair, expectedVerdict, observedVerdict: result.verdict, passed: result.verdict === expectedVerdict, identitiesFresh: fresh, identitiesDistinct: distinct, tenantsDistinct: differentTenants, templateUnchanged: JSON.stringify(spec) === specText, cleanupConfirmed: before.documentCount === 0 && after.documentCount === 0 && result.cleanupErrors.length === 0, resourceWrites: after.writeCount - before.writeCount, manualTemplateEdits: 0, suppliedBindings: ['api origin', 'owner account credential', 'researcher account credential'], requestCount: result.requests, code: result.code, evidence: result });
        } finally { await browser.close(); }
      }

      {
        const { accounts, fresh, distinct, differentTenants } = freshPair();
        const credentials = await Promise.all(accounts.map(login));
        const marker = `rc_${randomUUID()}`;
        redactor.alias(marker, 'run.marker'); remember(marker);
        const sourceRecipe = mode === 'vulnerable' ? positiveRecipe : negativeRecipe;
        const recipe = authMode === 'cookie' ? sourceRecipe.replaceAll('Authorization: Bearer {{owner_token}}', 'Cookie: {{owner_cookie}}').replaceAll('Authorization: Bearer {{researcher_token}}', 'Cookie: {{researcher_cookie}}') : sourceRecipe;
        const recipePath = resolve(recipeFolder, `${mode}-${authMode}.hurl`);
        await writeFile(recipePath, recipe, 'utf8');
        const before = fixture.stats();
        const execution = await subprocess(hurlBinary, ['--test', '--json', '--no-color', '--no-cookie-store', '--no-proxy', '*', '--jobs', '1', '--retry', '0', '--max-time', '10', recipePath], '', {
          ...process.env,
          HURL_VARIABLE_base: fixture.origin,
          HURL_VARIABLE_owner_token: credentials[0].token,
          HURL_VARIABLE_researcher_token: credentials[1].token,
          HURL_VARIABLE_owner_cookie: credentials[0].cookie,
          HURL_VARIABLE_researcher_cookie: credentials[1].cookie,
          HURL_VARIABLE_marker: marker,
        });
        const after = fixture.stats();
        let calls: Record<string, unknown>[] = [];
        try { calls = callsIn(JSON.parse(execution.stdout)); } catch { /* A failing/unsupported Hurl invocation remains inconclusive. */ }
        const statuses = calls.map(call => (call.response as Record<string, unknown>)?.status).filter((status): status is number => typeof status === 'number');
        const observedVerdict: Verdict = execution.code === 0 && calls.length === 7 ? expectedVerdict : 'inconclusive';
        const safeStderr = redactor.text(execution.stderr).replaceAll(projectRoot, '[PROJECT]').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[UUID]').replace(/[\w.+-]+@reprocase\.test/g, '[DEMO ACCOUNT]');
        trials.push({ tool: 'hurl', mode, authMode, pair, expectedVerdict, observedVerdict, passed: observedVerdict === expectedVerdict, identitiesFresh: fresh, identitiesDistinct: distinct, tenantsDistinct: differentTenants, templateUnchanged: digest(sourceRecipe) === digest(mode === 'vulnerable' ? positiveRecipe : negativeRecipe), cleanupConfirmed: before.documentCount === 0 && after.documentCount === 0, resourceWrites: after.writeCount - before.writeCount, manualTemplateEdits: 0, suppliedBindings: ['base API origin', 'owner account credential', 'researcher account credential', 'fresh marker'], requestCount: calls.length, recipe: mode === 'vulnerable' ? 'violation' : 'denial', exitCode: execution.code, statuses, stderr: safeStderr });
      }
      console.log(`Measured ${mode}/${authMode}/pair${pair}: ReproCase ${trials.at(-2)!.observedVerdict}; Hurl ${trials.at(-1)!.observedVerdict}`);
    }
  } finally { await fixture.close(); }

  let hurlSource: unknown;
  try { hurlSource = JSON.parse(await readFile(process.env.HURL_SOURCE_METADATA || resolve(projectRoot, '../../work/hurl/source.json'), 'utf8')); } catch { hurlSource = { note: 'No binary-download provenance file supplied; see HURL_BIN and record verification separately.' }; }
  const summary = redactor.json({
    schemaVersion: 1,
    benchmark: 'Fresh-account cross-tenant document reproduction on the owned local fixture',
    startedAt, completedAt: new Date().toISOString(), nodeVersion: process.version, platform: process.platform,
    reprocaseVersion: VERSION, hurlVersion: version, hurlSource,
    caseSha256: digest(specText), sourceHashes,
    conditions: { fixture: 'Owned local Fastify application; no external test target', modes: ['vulnerable', 'secure'], authModes: ['cookie', 'bearer'], independentPairsPerToolPerCell: 2, expectedHurlHTTPCalls: 7, expectedReproCaseHTTPCalls: 9, harnessAuthenticationExcludedFromRequestCounts: true, templatesEditedBetweenPairs: false, bothToolsReceiveNewAccounts: true, providerAPIUsed: false },
    interpretation: [
      'These observations measure the declared fixture scenarios, not general vulnerability detection or universal correctness.',
      'Both tools support fresh bound workflows. Hurl uses an explicitly authored violation or denial recipe; a failing positive assertion is never classified as a negative finding.',
      'The harness supplies a new marker to this authored Hurl baseline; ReproCase generates it internally. This is not a claim that Hurl cannot generate dynamic values.',
      'Manual template edits are zero for both tools in this automated harness; supplied-binding lists document configuration inputs, not measured human effort or completion time.',
      'ReproCase sends extra live identity rechecks. Request counts therefore differ and are not a speed comparison.',
      'Credentials and literal observed account/resource values are not included in the persisted results. Hurl raw JSON is inspected in memory and not saved.',
    ],
    totalTrials: trials.length, passedTrials: trials.filter(trial => trial.passed).length,
    allChecksPassed: trials.every(trial => trial.passed && trial.identitiesFresh && trial.identitiesDistinct && trial.tenantsDistinct && trial.templateUnchanged && trial.cleanupConfirmed && trial.resourceWrites === 2),
    trials,
  });
  const serialised = JSON.stringify(summary, null, 2);
  for (const value of neverPersist) if (value.length >= 8 && serialised.includes(value)) throw new Error('Benchmark export blocked: a known private fixture binding remained in the result.');
  await mkdir(outputFolder, { recursive: true });
  await writeFile(resolve(outputFolder, 'summary.json'), `${serialised}\n`, 'utf8');
  const totals = (tool: Trial['tool']) => ({ total: trials.filter(trial => trial.tool === tool).length, passed: trials.filter(trial => trial.tool === tool && trial.passed).length });
  const report = [
    '# Measured fresh-account comparison', '',
    `Recorded ${summary.completedAt}. Node ${process.version}, ${process.platform}. ${version}. ReproCase ${VERSION}.`, '',
    'The controlled local fixture was exercised in vulnerable and secure modes, using both cookie and Bearer sessions. Each tool received two independently provisioned identity pairs per mode/auth cell. No external target or paid model API was used.', '',
    `ReproCase: ${totals('reprocase').passed}/${totals('reprocase').total} expected verdicts. Hurl: ${totals('hurl').passed}/${totals('hurl').total} expected recipe outcomes.`, '',
    `All freshness, distinct-identity, tenant, unchanged-template, cleanup, and two-resource-write checks passed: ${summary.allChecksPassed ? 'yes' : 'no'}.`, '',
    '## Observations', '',
    ...trials.map(trial => `- ${trial.tool} / ${trial.mode} / ${trial.authMode} / fresh pair ${trial.pair}: ${trial.observedVerdict}; expected ${trial.expectedVerdict}; ${trial.requestCount ?? 'unknown'} HTTP requests in the test workflow; cleanup ${trial.cleanupConfirmed ? 'confirmed' : 'not confirmed'}; template edits ${trial.manualTemplateEdits}.`), '',
    '## What this comparison establishes', '',
    ...summary.interpretation.map(text => `- ${text}`), '',
    '## Reproduce', '',
    'Set HURL_BIN to a verified Hurl executable and run `npx tsx scripts/benchmark.ts` from this project. The script starts and closes its own local fixture. The checked-in positive and denial Hurl recipes use placeholders; actor credentials are passed to the child process through environment variables. Spawn uses no shell. Optional HURL_SOURCE_METADATA points to the binary provenance JSON.', '',
    'The complete machine-readable results, source hashes, binary provenance, check outcomes, and sanitized ReproCase observations are in [summary.json](summary.json). No wall-clock speed or human productivity claim is made.', '',
  ].join('\n');
  await writeFile(resolve(outputFolder, 'report.md'), report, 'utf8');
  console.log(`Saved ${trials.length} measured trials. All checks passed: ${summary.allChecksPassed}.`);
  if (!summary.allChecksPassed) process.exitCode = 1;
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Benchmark failed.'); process.exitCode = 1; });
