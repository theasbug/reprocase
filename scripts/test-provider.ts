/** Explicit opt-in live test. The key stays in this process's environment/memory. */
import { AIManager } from '../packages/ai/src/index.ts';
import { createExampleCase } from '../packages/core/src/example.ts';
import { validateCase } from '../packages/core/src/validate.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const key = process.env.REPROCASE_TEST_API_KEY;
if (!key) throw new Error('Set REPROCASE_TEST_API_KEY in this process environment before running this optional live test.');
const baseURL = process.env.REPROCASE_TEST_BASE_URL ?? 'https://opencode.ai/inference/go/openai/v1';
const model = process.env.REPROCASE_TEST_MODEL ?? 'longcat-2.5-free';
const requests: { path: string; sessionHeader: boolean; userAgent: string; status?: number }[] = [];
const ai = new AIManager({ fetch: async (url, init) => {
  const headers = new Headers(init?.headers), item = { path: new URL(String(url)).pathname, sessionHeader: !!headers.get('x-opencode-session'), userAgent: headers.get('user-agent') ?? '', status: undefined as number | undefined };
  requests.push(item); const response = await fetch(url, init); item.status = response.status; return response;
} });
ai.configure({ provider: 'compatible', baseURL, model, apiKey: key });
const started = Date.now();
const report: Record<string, unknown> = { testedAt: new Date().toISOString(), endpoint: baseURL, model, requests };
try {
  report.connection = await ai.testConnection();
  console.log(JSON.stringify({ stage: 'tool_connection', ok: true, elapsedMs: Date.now() - started }));
  const spec = createExampleCase(), original = JSON.stringify(spec);
  const proposal = await ai.propose(spec, 'Improve only the title of this TypeScript API authorization test case to be clear and concise. Preserve every other field, the case ID and revision. Return the complete case through propose_case.');
  report.proposal = { schemaValid: true, revisionPreserved: proposal.baseRevision === spec.revision && proposal.case.revision === spec.revision, caseIdPreserved: proposal.case.id === spec.id, validationErrors: validateCase(proposal.case).filter(i => i.level === 'error'), sourceUnchanged: original === JSON.stringify(spec), appliedAutomatically: false, warningCount: proposal.warnings.length };
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.error = (error instanceof Error ? error.message : String(error)).split(key).join('[REDACTED]');
  process.exitCode = 1;
}
report.elapsedMs = Date.now() - started;
const serialized = JSON.stringify(report, null, 2);
if (serialized.includes(key)) throw new Error('Refusing to persist a report containing the provider key');
mkdirSync(resolve('docs'), { recursive: true });
writeFileSync(resolve('docs/provider-live-test.json'), serialized + '\n');
console.log(serialized);
