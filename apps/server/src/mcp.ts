import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { VERSION } from '@reprocase/core';

/** A thin local API client: MCP never has a second execution engine or session store. */
export async function startMcp(workspace: string) {
  let runtime: { origin: string; token: string };
  try { runtime = JSON.parse(readFileSync(join(workspace, 'runtime.json'), 'utf8')); }
  catch { throw new Error('Start ReproCase serve or demo with this workspace before connecting MCP.'); }
  const url = new URL(runtime.origin);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash || !/^[a-f0-9]{64}$/.test(runtime.token)) throw new Error('The workspace runtime endpoint is not a valid local ReproCase service');
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${url.origin}${path}`, { method, redirect: 'error', headers: { authorization: `Bearer ${runtime.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    if (!response.ok) throw new Error((result as any).error ?? 'Local service request failed');
    return result;
  };
  await call('/api/state');
  const server = new McpServer({ name: 'reprocase', version: VERSION });
  const output = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
  const register = (name: string, description: string, shape: z.ZodRawShape, fn: (args: any) => Promise<unknown>) => {
    server.registerTool(name, { description, inputSchema: shape }, async (args: any) => {
      try { return output(await fn(args)); }
      catch (error) { return { ...output({ error: error instanceof Error ? error.message : 'Tool failed' }), isError: true }; }
    });
  };
  const actor = { caseId: z.string(), actorId: z.string() };
  const prefix = (a: any) => `/api/cases/${encodeURIComponent(a.caseId)}/actors/${encodeURIComponent(a.actorId)}`;
  register('case_list', 'List cases, live account bindings, and run summaries from the same local UI.', {}, async () => {
    const state = await call('/api/state') as any;
    // Controlled-lab login credentials are for the human UI, never an agent tool result.
    return { ...state, demo: state.demo ? { origin: state.demo.origin, mode: state.demo.mode } : null };
  });
  register('case_get', 'Read a versioned declarative reproduction case.', { caseId: z.string() }, a => call(`/api/cases/${encodeURIComponent(a.caseId)}`));
  register('case_build', 'Create an unapproved read-disclosure or controlled-write case from endpoint mappings. No target traffic is sent; review policy and connect accounts before running.', { settingsJson: z.string(), targetOrigin: z.string().optional() }, a => call('/api/cases/build', 'POST', { settings: JSON.parse(a.settingsJson), ...(a.targetOrigin ? { targetOrigin: a.targetOrigin } : {}) }));
  register('run_plan', 'Inspect dependencies, account binding gaps, target origins, reads and writes without sending any target requests. Live identities still need checking at execution time.', { caseId: z.string(), approvedRevision: z.number().int().positive(), targets: z.record(z.string(), z.string()), maxRequests: z.number().int().positive().max(10000).optional() }, a => { const { caseId, ...config } = a; return call(`/api/cases/${encodeURIComponent(caseId)}/preflight`, 'POST', config); });
  register('run_compare', 'Compare recorded HTTP outcomes, checks and JSON response fields from two finished runs of the same case. This sends no target traffic and does not establish that all variants are fixed.', { before: z.string(), after: z.string() }, a => call(`/api/runs/compare?before=${encodeURIComponent(a.before)}&after=${encodeURIComponent(a.after)}`));
  register('case_import', 'Import HAR, raw HTTP, Burp XML, Postman Collection or a ReproCase package as a draft. Import never sends target requests.', { kind: z.enum(['har', 'http', 'package', 'burp', 'postman']), data: z.string() }, a => call('/api/import', 'POST', a));
  register('idor_candidates', 'Rank IDOR leads from Arjun (-oJ) or ffuf (-of json) output. Offline: sends no target traffic. Pass a returned candidate raw request to case_import with kind http to create a draft.', { kind: z.enum(['arjun', 'ffuf']), data: z.string() }, a => call('/api/candidates', 'POST', a));
  register('case_update', 'Save edited case JSON with optimistic revision checking. This does not run it.', { caseId: z.string(), caseJson: z.string(), expectedRevision: z.number().int().positive() }, a => call(`/api/cases/${encodeURIComponent(a.caseId)}`, 'PUT', { case: JSON.parse(a.caseJson), expectedRevision: a.expectedRevision }));
  register('case_validate', 'Check relationships, fresh resource bindings, witness rules, and request scope without sending traffic.', { caseId: z.string() }, a => call(`/api/cases/${encodeURIComponent(a.caseId)}/validate`));
  register('actor_open_browser', 'Open a separately isolated Chromium session for a user-controlled test account.', { ...actor, origin: z.string() }, a => call(`${prefix(a)}/browser`, 'POST', { origin: a.origin }));
  register('actor_verify', 'Verify the selected account through its live identity probe.', { ...actor }, a => call(`${prefix(a)}/verify`, 'POST', {}));
  register('browser_snapshot', 'Read a redacted login view and transient form element references; credential values are omitted.', { ...actor }, a => call(`${prefix(a)}/snapshot`));
  register('browser_action', 'Operate the selected login session. No arbitrary scripts. Use secret references for credentials; hand off MFA/CAPTCHA to the user.', { ...actor, type: z.enum(['navigate', 'click', 'fill', 'fillSecret', 'press', 'handoff']), ref: z.string().optional(), url: z.string().optional(), value: z.string().optional(), secretRef: z.string().optional() }, a => { const { caseId, actorId, ...action } = a; return call(`${prefix(a)}/action`, 'POST', action); });
  register('actor_bind_environment_credentials', 'Bind locally configured REPROCASE_SECRET_* environment variables to opaque login references. Never returns the credential values.', { ...actor, usernameEnv: z.string().optional(), passwordEnv: z.string().optional() }, async a => {
    const get = (name: string | undefined) => {
      if (!name) return undefined;
      if (!/^REPROCASE_SECRET_[A-Z0-9_]+$/.test(name) || !process.env[name]) throw new Error('Use an explicitly configured REPROCASE_SECRET_* variable');
      return process.env[name];
    };
    return call(`${prefix(a)}/credentials`, 'POST', { username: get(a.usernameEnv), password: get(a.passwordEnv) });
  });
  register('traffic_record', 'Start or stop selected-session recording. Login is not recorded unless explicitly enabled.', { ...actor, enabled: z.boolean() }, a => call(`${prefix(a)}/recording`, 'POST', { enabled: a.enabled }));
  register('traffic_get', 'Get redacted HAR data recorded in this account session.', { ...actor }, a => call(`${prefix(a)}/traffic`));
  register('traffic_draft', 'Create an unapproved multi-actor draft case from live recorded traffic across connected actors.', { caseId: z.string() }, a => call(`/api/cases/${encodeURIComponent(a.caseId)}/traffic/draft`, 'POST', {}));
  register('run_start', 'Run an explicitly approved current case revision against user-supplied origins and connected test accounts. Mutating requests are never automatically retried.', { caseId: z.string(), approvedRevision: z.number().int().positive(), targets: z.record(z.string(), z.string()), maxRequests: z.number().int().positive().max(10000).optional(), intervalMs: z.number().min(0).max(60000).optional() }, a => { const { caseId, ...config } = a; return call(`/api/cases/${encodeURIComponent(caseId)}/run`, 'POST', config); });
  register('run_matrix', 'Run a multi-actor role access matrix evaluation against an explicitly approved case revision.', { caseId: z.string(), approvedRevision: z.number().int().positive(), targets: z.record(z.string(), z.string()), maxRequests: z.number().int().positive().max(10000).optional(), intervalMs: z.number().min(0).max(60000).optional() }, a => { const { caseId, ...config } = a; return call(`/api/cases/${encodeURIComponent(caseId)}/matrix`, 'POST', config); });
  register('run_get', 'Read observed steps and reproduced / not_reproduced / inconclusive result.', { runId: z.string() }, a => call(`/api/runs/${encodeURIComponent(a.runId)}`));
  register('run_cancel', 'Cancel future requests. In-flight writes may remain uncertain and are not repeated.', { runId: z.string() }, a => call(`/api/runs/${encodeURIComponent(a.runId)}/cancel`, 'POST', {}));
  register('case_export', 'Get a sanitized package using the exact case revision for the selected historical run. Exported evidence is not a new live verification.', { caseId: z.string(), runId: z.string().optional() }, a => call(`/api/cases/${encodeURIComponent(a.caseId)}/export${a.runId ? `?runId=${encodeURIComponent(a.runId)}` : ''}`));
  register('recon_probe', 'Probe a target origin for security headers, CORS policy, OpenAPI/Swagger, GraphQL, robots.txt, and ranked IDOR/BOLA/BFLA/Race vulnerability candidates.', { origin: z.string() }, a => call('/api/recon/probe', 'POST', { origin: a.origin }));
  register('recon_extract', 'Extract and rank API endpoints and vulnerability candidates from JS bundles, HTML, OpenAPI JSON, HAR, or raw HTTP traffic.', { sourceText: z.string(), sourceLabel: z.string().optional() }, a => call('/api/recon/extract', 'POST', a));
  await server.connect(new StdioServerTransport());
  console.error('ReproCase MCP connected to the local workspace service.');
  return server;
}
