import { caseSchema, packageSchema, type CaseSpec, type Json, type ReproPackage, type RunResult } from './schema.ts';
import { createRedactor } from './redact.ts';

const reference = (value: unknown): value is { $ref: string } => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && typeof (value as Record<string, unknown>).$ref === 'string';
function pointer(value: unknown, path: string): unknown {
  if (path === '') return value;
  if (!path.startsWith('/')) return undefined;
  for (const encoded of path.slice(1).split('/')) {
    const part = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function exportPackage(spec: CaseSpec, run?: RunResult, secrets: string[] = []): ReproPackage {
  const parsed = caseSchema.parse(spec);
  const redactor = createRedactor(secrets);
  // Collect credentials from the whole evidence before rendering any earlier text.
  if (run) redactor.json(run);
  const aliasTemplate = (template: unknown, actual: unknown) => {
    if (reference(template)) {
      if (typeof actual === 'string' || typeof actual === 'number') redactor.alias(actual, template.$ref);
      return;
    }
    if (!template || !actual || typeof template !== 'object' || typeof actual !== 'object') return;
    for (const [key, item] of Object.entries(template)) aliasTemplate(item, (actual as Record<string, unknown>)[key]);
  };
  if (run) {
    for (const [actor, identity] of Object.entries(run.identities)) {
      redactor.alias(identity.id, `actors.${actor}.id`);
      if (identity.tenant !== undefined) redactor.alias(identity.tenant, `actors.${actor}.tenant`);
    }
    for (const result of run.steps) {
      const step = parsed.steps.find(item => item.id === result.id);
      if (!step) continue;
      aliasTemplate(step.request.body, result.request?.body);
      for (const capture of step.captures) {
        const source = capture.from === 'status' ? result.response?.status : capture.from === 'headers' ? result.response?.headers : result.response?.body;
        const value = pointer(source, capture.pointer);
        if (typeof value === 'string' || typeof value === 'number') redactor.alias(value, `captures.${capture.name}`);
      }
    }
  }
  const safeSpec = redactor.json(parsed);
  const evidence = run ? JSON.parse(JSON.stringify(redactor.json({
    observation: 'Historical local observation; importing this evidence does not perform a live verification.',
    ...run,
  }))) as Json : undefined;
  return packageSchema.parse({
    format: 'reprocase', schemaVersion: 1, exportedAt: new Date().toISOString(), case: safeSpec,
    ...(evidence === undefined ? {} : { evidence }),
    redactions: ['Account credentials are not included.', 'Observed actor, resource, and run-marker bindings are replaced by symbolic aliases where available.', 'Review the export for application-specific personal information before sharing.'],
  });
}

function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
const humanVerdict = (value: unknown) => value === 'reproduced' ? 'Reproduced' : value === 'not_reproduced' ? 'Not reproduced' : 'Inconclusive / no live run';
const html = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const mdText = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\r\n]+/g, ' ').replace(/([\\`*_[\]])/g, '\\$1');
const code = (value: unknown) => { const content = JSON.stringify(value, null, 2) ?? ''; const sequences = content.match(/`+/g) ?? []; const fence = '`'.repeat(Math.max(3, ...sequences.map(s => s.length + 1))); return `${fence}json\n${content}\n${fence}`; };

export function renderMarkdown(input: ReproPackage): string {
  const pack = packageSchema.parse(input);
  const evidence = asRecord(pack.evidence);
  const steps = Array.isArray(evidence.steps) ? evidence.steps : [];
  const checks = Array.isArray(evidence.checks) ? evidence.checks : [];
  return [
    `# ${mdText(pack.case.title)}`,
    '',
    mdText(pack.case.description),
    '',
    '**Historical observation:** This report describes a recorded local run. The recipient must connect their own accounts and execute the package to obtain a new result.',
    '',
    `- Case: ${mdText(pack.case.id)} · revision ${pack.case.revision}`,
    `- Exported: ${mdText(pack.exportedAt)}`,
    `- Verdict: **${humanVerdict(evidence.verdict)}**`,
    `- Reason: ${mdText(evidence.reason ?? 'No live run is attached.')}`,
    `- Setup provenance: ${mdText(evidence.setup ?? 'Not observed')}`,
    '',
    '## Declared policy and assumptions',
    '',
    mdText(pack.case.policy.statement),
    '',
    `Researcher acknowledged: ${pack.case.policy.acknowledged ? 'yes' : 'no'}. This is a declared policy expectation, not an independent certification of the application’s intended permissions.`,
    '',
    '## Observed checks',
    '',
    ...(checks.length ? checks.map(item => { const check = asRecord(item); return `- ${check.passed ? 'PASS' : 'FAIL'}: ${mdText(check.label)}${check.detail ? ` — ${mdText(check.detail)}` : ''}`; }) : ['No checks attached.']),
    '',
    '## Account and resource relationships',
    '',
    ...pack.case.actors.map(actor => `- ${mdText(actor.label)} (${mdText(actor.id)})${actor.expectedRole ? `: expected role ${mdText(actor.expectedRole)}` : ''}`),
    ...pack.case.resources.map(resource => `- ${mdText(resource.label)}: created by ${mdText(resource.createdBy)}, owned by ${mdText(resource.ownerActor)}; identity and ownership are checked from fresh response bindings.`),
    '',
    '## Recorded steps',
    '',
    ...(steps.length ? steps.flatMap(item => { const step = asRecord(item); return [`### ${mdText(step.label)} — ${mdText(step.status)}`, '', `Actor: ${mdText(step.actor)} · phase: ${mdText(step.phase)}`, '', code(step), '']; }) : ['No execution steps attached.']),
    '',
    '## Reproduction',
    '',
    'Import the accompanying .reprocase.json file, select your authorized API origins, connect your own test accounts, review the declared access boundary, and run the exact case revision. Do not reuse historical identity or resource values.',
    '',
    '## Redactions',
    '',
    ...pack.redactions.map(item => `- ${mdText(item)}`),
    '',
  ].join('\n');
}

export function renderHTML(input: ReproPackage): string {
  const pack = packageSchema.parse(input);
  const evidence = asRecord(pack.evidence);
  const steps = Array.isArray(evidence.steps) ? evidence.steps : [];
  const checks = Array.isArray(evidence.checks) ? evidence.checks : [];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${html(pack.case.title)} — ReproCase</title><style>body{font:15px/1.65 system-ui,sans-serif;background:#f5f7fa;color:#172432;max-width:1000px;margin:auto;padding:36px}header,section{background:white;border:1px solid #dce3eb;border-radius:12px;padding:24px;margin-bottom:16px}h1{font-size:30px;line-height:1.2;margin:12px 0}h2{font-size:19px}h3{font-size:15px}small,.muted{color:#526477}.brand{font-weight:800;letter-spacing:.12em;color:#15756d}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f5f8;border-radius:8px;padding:16px;font-size:12px}.notice{border-left:4px solid #cc9a2a;background:#fff8e6;padding:14px}.verdict{font-size:22px;font-weight:700}li{margin:8px 0}@media print{body{padding:0;background:white}header,section{break-inside:avoid;border:0}pre{font-size:10px}}</style></head><body><header><div class="brand">REPROCASE / EVIDENCE REPORT</div><h1>${html(pack.case.title)}</h1><p>${html(pack.case.description)}</p><p class="muted">${html(pack.case.id)} · revision ${pack.case.revision} · exported ${html(pack.exportedAt)}</p><p class="verdict">${html(humanVerdict(evidence.verdict))}</p><p>${html(evidence.reason ?? 'No live run is attached.')}</p><div class="notice">Historical observation. This report is not a new live verification. The recipient must connect their own accounts and execute the package. A non-reproduced result does not by itself prove the application is fixed.</div></header><section><h2>Declared policy and assumptions</h2><p>${html(pack.case.policy.statement)}</p><p>Researcher acknowledged: ${pack.case.policy.acknowledged ? 'yes' : 'no'}. This expectation is declared by the researcher; it is not an independent certification of intended access.</p><p>Setup provenance: ${html(evidence.setup ?? 'Not observed')}</p></section><section><h2>Observed checks</h2><ul>${checks.map(item => { const check = asRecord(item); return `<li><strong>${check.passed ? 'PASS' : 'FAIL'}</strong> ${html(check.label)}${check.detail ? ` — ${html(check.detail)}` : ''}</li>`; }).join('') || '<li>No checks attached.</li>'}</ul></section><section><h2>Account and resource relationships</h2><ul>${pack.case.actors.map(actor => `<li>${html(actor.label)} (${html(actor.id)})${actor.expectedRole ? ` — expected role ${html(actor.expectedRole)}` : ''}</li>`).join('')}${pack.case.resources.map(resource => `<li>${html(resource.label)} — created by ${html(resource.createdBy)}, owned by ${html(resource.ownerActor)}; fresh response bindings establish identity and ownership.</li>`).join('')}</ul></section><section><h2>Recorded steps</h2>${steps.map(item => { const step = asRecord(item); return `<h3>${html(step.label)} — ${html(step.status)}</h3><p class="muted">Actor ${html(step.actor)} · ${html(step.phase)}</p><pre>${html(JSON.stringify(step, null, 2))}</pre>`; }).join('') || '<p>No execution steps attached.</p>'}</section><section><h2>Reproduction</h2><p>Import the accompanying .reprocase.json file, select your authorized API origins, connect your own test accounts, review the declared boundary, and run the exact case revision.</p><h2>Redactions</h2><ul>${pack.redactions.map(item => `<li>${html(item)}</li>`).join('')}</ul></section><footer class="muted">ReproCase · portable case specification v1 · no external resources in this report</footer></body></html>`;
}

export function renderBountyReport(input: ReproPackage): string {
  const pack = packageSchema.parse(input);
  const evidence = asRecord(pack.evidence);
  const steps = Array.isArray(evidence.steps) ? evidence.steps : [];
  const checks = Array.isArray(evidence.checks) ? evidence.checks : [];
  const identities = asRecord(evidence.identities);
  const hasWrite = Boolean(pack.case.witness.writeProof);
  const hasRace = pack.case.steps.some(s => Boolean(s.concurrency));
  const cwe = hasRace ? 'CWE-362 (Concurrent Execution using Shared Resource / Race Condition) & CWE-284' : hasWrite ? 'CWE-639 (Authorization Bypass Through User-Controlled Key — Write/Modification)' : 'CWE-639 / CWE-284 (Improper Access Control — Cross-Account Information Disclosure)';

  return [
    `# [Bug Bounty Report] ${mdText(pack.case.title)}`,
    '',
    '## Summary',
    mdText(pack.case.description || pack.case.policy.statement),
    '',
    `- **Vulnerability Class:** ${cwe}`,
    `- **Case ID & Revision:** \`${mdText(pack.case.id)}\` (r${pack.case.revision})`,
    `- **Recorded Verdict:** **${humanVerdict(evidence.verdict)}** (${mdText(evidence.reason ?? 'No live run attached')})`,
    `- **Fresh Resource Provenance:** \`${mdText(evidence.setup ?? 'Not observed')}\``,
    '',
    '## Expected Access Policy',
    mdText(pack.case.policy.statement),
    '',
    '## Actors & Observed Identities',
    '| Actor ID | Label | Expected Role | Observed ID | Observed Tenant |',
    '| :--- | :--- | :--- | :--- | :--- |',
    ...pack.case.actors.map(actor => {
      const idObj = asRecord(identities[actor.id]);
      return `| \`${mdText(actor.id)}\` | ${mdText(actor.label)} | ${mdText(actor.expectedRole ?? '—')} | \`${mdText(idObj.id ?? '—')}\` | \`${mdText(idObj.tenant ?? '—')}\` |`;
    }),
    '',
    '## Controlled Resources',
    ...pack.case.resources.map(r => `- **${mdText(r.label)}** (\`${mdText(r.id)}\`): Created by \`${mdText(r.createdBy)}\`, owned by \`${mdText(r.ownerActor)}\` (ID binding: \`${mdText(r.idRef)}\`, Owner binding: \`${mdText(r.ownerRef)}\`)`),
    '',
    '## Step-by-Step Reproduction & Sanitized HTTP Evidence',
    ...(steps.length ? steps.flatMap((item, idx) => {
      const step = asRecord(item);
      const req = asRecord(step.request);
      const res = asRecord(step.response);
      return [
        `### Step ${idx + 1}: ${mdText(step.label)} (\`${mdText(step.phase)}\` · Actor: \`${mdText(step.actor)}\`)`,
        `- **Status:** ${mdText(step.status)}${res.status !== undefined ? ` (HTTP ${res.status})` : ''}`,
        ...(step.concurrency ? [`- **Concurrency:** ${JSON.stringify(step.concurrency)}`] : []),
        '',
        '**Request:**',
        code(req),
        '',
        '**Response:**',
        code(res),
        '',
      ];
    }) : pack.case.steps.map((s, idx) => `${idx + 1}. **${mdText(s.label)}** (\`${s.phase}\` as \`${s.request.actor}\`): \`${s.request.method} ${mdText(s.request.path)}\``)),
    '',
    '## Verification & Witness Checks',
    ...(checks.length ? checks.map(item => {
      const c = asRecord(item);
      return `- [${c.passed ? 'x' : ' '}] **${c.passed ? 'PASS' : 'FAIL'}**: ${mdText(c.label)}${c.detail ? ` (${mdText(c.detail)})` : ''}`;
    }) : ['- Connect your own test accounts and run the attached `.reprocase.json` package to verify live.']),
    '',
    '## Impact',
    hasWrite
      ? 'An unauthorized actor can modify resources belonging to another user or tenant, violating data integrity and tenant isolation.'
      : 'An unauthorized actor can read private resource data created by another user or tenant, resulting in cross-account/cross-tenant data disclosure.',
    '',
    '## Remediation Recommendation',
    'Enforce server-side object-level and tenant-level authorization checks on every resource endpoint by verifying that the authenticated session identity owns or is explicitly granted access to the target resource ID before returning or mutating data.',
    '',
  ].join('\n');
}

function hurlValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (!Array.isArray(value) && Object.keys(value).length === 1 && typeof (value as Record<string, unknown>).$ref === 'string') {
    const ref = String((value as Record<string, unknown>).$ref);
    if (ref === 'run.marker') return '{{run_marker}}';
    if (ref.startsWith('captures.')) return `{{${ref.slice('captures.'.length)}}}`;
    return `{{${ref.replace(/\./g, '_')}}}`;
  }
  if (Array.isArray(value)) return value.map(hurlValue);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, hurlValue(v)]));
}

export function renderHurl(input: CaseSpec, targets: Record<string, string> = {}): string {
  const spec = caseSchema.parse(input);
  const lines: string[] = [
    `# HTTP REQUEST DRAFT ONLY: this file does not verify CaseSpec identity, ownership or witnesses.`,
    `# Use the .reprocase.json runner or Playwright proof adapter for security verdicts.`,
    `# ReproCase Hurl Export: ${spec.title.replace(/[\r\n]+/g, ' ')}`,
    `# Case ID: ${spec.id} (revision ${spec.revision})`,
    `# Supply variables: --variable origin_api=https://api.example.com --variable run_marker=rc_test_marker`,
    '',
  ];
  for (const step of spec.steps) {
    const base = targets[step.request.origin] ?? `{{origin_${step.request.origin}}}`;
    const path = step.request.path.replace(/\{([^}]+)\}/g, (_m, k) => {
      const bound = step.request.pathParams[k];
      return String(hurlValue(bound) ?? `{{${k}}}`);
    });
    lines.push(`# Step: ${step.label} (${step.phase} as ${step.request.actor})`);
    lines.push(`${step.request.method} ${base.replace(/\/$/, '')}${path}`);
    lines.push(`Authorization: Bearer {{auth_${step.request.actor}}}`);
    for (const [hName, hVal] of Object.entries(step.request.headers)) {
      lines.push(`${hName}: ${String(hurlValue(hVal))}`);
    }
    if (step.request.body !== undefined) {
      lines.push(JSON.stringify(hurlValue(step.request.body), null, 2));
    }
    lines.push('HTTP *');
    if (step.captures.length) {
      lines.push('[Captures]');
      for (const cap of step.captures) {
        const jsonPath = '$' + cap.pointer.split('/').filter(Boolean).map(p => `.${p.replace(/~1/g, '/').replace(/~0/g, '~')}`).join('');
        lines.push(`${cap.name}: jsonpath "${jsonPath}"`);
      }
    }
    if (step.phase === 'probe' && spec.witness.success.length) {
      lines.push('# Witness assertions are NOT exported; a successful Hurl exit is NOT reproduction evidence.');
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Run inside a ReproCase source checkout: the proof uses the SAME runner and session transport. */
export function renderPlaywright(input: CaseSpec, targets: Record<string, string> = {}): string {
  const spec=caseSchema.parse(input);
  return [
    "import { test, expect } from '@playwright/test';",
    "import { caseSchema, executeCase } from '@reprocase/core';",
    "import { BrowserManager } from '@reprocase/browser';",
    '// Verified proof adapter: run inside a ReproCase source checkout after npm ci.',
    '// Set REPROCASE_APPROVE_REVISION to the reviewed revision below; this can create/delete test data.',
    '// Supply REPROCASE_TARGETS JSON when origins are not embedded, and REPROCASE_TOKEN_<ACTOR> or REPROCASE_COOKIE_<ACTOR>.',
    '// Expected verdict defaults to reproduced. Use REPROCASE_EXPECT_VERDICT=not_reproduced to test a fixed application.',
    'const spec = caseSchema.parse('+JSON.stringify(spec)+');',
    'test('+JSON.stringify(spec.title)+', async ({}, testInfo) => {',
    '  test.setTimeout(120000);',
    '  if (process.env.REPROCASE_APPROVE_REVISION !== String(spec.revision)) throw new Error("Review the case and set REPROCASE_APPROVE_REVISION="+spec.revision);',
    '  const targets = process.env.REPROCASE_TARGETS ? JSON.parse(process.env.REPROCASE_TARGETS) : '+JSON.stringify(targets)+';',
    '  const expected = process.env.REPROCASE_EXPECT_VERDICT ?? "reproduced";',
    '  if (!["reproduced", "not_reproduced"].includes(expected)) throw new Error("Expected verdict must be reproduced or not_reproduced");',
    '  const sessions = new BrowserManager();',
    '  try {',
    '    for (const actor of spec.actors) {',
    '      const suffix = actor.id.toUpperCase();',
    '      const token = process.env["REPROCASE_TOKEN_"+suffix], cookie = process.env["REPROCASE_COOKIE_"+suffix];',
    '      if (!targets[actor.identity.origin]) throw new Error("Missing approved target for "+actor.identity.origin);',
    '      if (!token && !cookie) throw new Error("Connect the test account for "+actor.id+" using its TOKEN or COOKIE environment variable");',
    '      await sessions.connectDirect(actor.id, {origin:targets[actor.identity.origin], ...(token?{token}:{}), ...(cookie?{cookie}:{})});',
    '    }',
    '    const result = await executeCase({...spec,policy:{...spec.policy,acknowledged:true}}, {targets,approvedRevision:spec.revision}, {request:(actor,req,signal)=>sessions.request(actor,req,signal),knownSecrets:()=>sessions.knownSecrets()});',
    '    await testInfo.attach("reprocase-result", {body:JSON.stringify(result,null,2),contentType:"application/json"});',
    '    expect(result.state, result.reason).toBe("completed");',
    '    expect(result.verdict, result.code+": "+result.reason).toBe(expected);',
    '  } finally { await sessions.close(); }',
    '});','',
  ].join('\n');
}
