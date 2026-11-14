import { randomUUID } from 'node:crypto';
import { runConfigSchema, type CaseSpec, type HttpResponse, type RunConfig, type RunEvent, type RunResult, type SessionTransport } from './schema.ts';
import { check, equal, jsonPointer, resolveRequest } from './values.ts';
import { validateCase } from './validate.ts';
import { createRedactor } from './redact.ts';

export async function executeSessionCase(spec: CaseSpec, config: RunConfig, transport: SessionTransport, options: { signal?: AbortSignal; onEvent?: (event: RunEvent) => void; runId?: string } = {}): Promise<RunResult> {
  const run: RunResult = { schemaVersion: 2, id: options.runId ?? randomUUID(), caseId: spec.id, caseRevision: spec.revision, state: 'running', verdict: 'inconclusive', code: 'running', reason: 'Verifying live session controls', startedAt: new Date().toISOString(), steps: [], checks: [], identities: {}, requests: 0, cleanupErrors: [], setup: 'verified_session' };
  const redactor = createRedactor(transport.knownSecrets());
  const emit = (type: RunEvent['type']) => { redactor.add(...transport.knownSecrets()); options.onEvent?.({ type, run: redactor.json(structuredClone(run)) }); };
  const values: Record<string, any> = { actors: {} };
  const observed = async (id: string, actor: string, request: ReturnType<typeof resolveRequest>, send: () => Promise<HttpResponse>) => {
    options.signal?.throwIfAborted();
    if (++run.requests > (config.maxRequests ?? 100)) throw new Error('Request budget exhausted');
    const row: RunResult['steps'][number] = { id, label: id.replaceAll('-', ' '), actor, phase: id.startsWith('identity') ? 'identity' : 'probe', status: 'running', startedAt: new Date().toISOString(), request: { url: request.url, method: request.method }, checks: [] };
    run.steps.push(row);
    try { const res = await send(); options.signal?.throwIfAborted(); run.requests += Math.max(0, Number(res.headers['x-reprocase-request-count'] ?? 1) - 1); row.response = res; row.status = 'passed'; return res; }
    catch (e) { row.status = 'failed'; row.error = (e as Error).message; throw e; }
    finally { row.finishedAt = new Date().toISOString(); emit('step'); }
  };
  const identities = async (recheck: boolean) => {
    for (const actor of spec.actors) {
      const request = resolveRequest({ actor: actor.id, origin: actor.identity.origin, method: 'GET', path: actor.identity.path, pathParams: {}, query: {}, headers: {} }, config.targets, {});
      const response = await observed(`identity-${actor.id}-${run.requests}`, actor.id, request, () => transport.request(actor.id, request, options.signal));
      if (response.status !== 200) throw new Error('The live account session was not accepted');
      const identity = { id: jsonPointer(response.body, actor.identity.idPointer), ...(actor.identity.rolePointer ? { role: jsonPointer(response.body, actor.identity.rolePointer) } : {}), ...(actor.identity.tenantPointer ? { tenant: jsonPointer(response.body, actor.identity.tenantPointer) } : {}) };
      if (Object.values(identity).some(v => !['string', 'number'].includes(typeof v) || v === '') || (actor.expectedRole !== undefined && identity.role !== actor.expectedRole)) throw new Error('Identity or expected role was not observed');
      if (recheck && !equal(run.identities[actor.id], identity)) throw new Error('Identity, role or organization changed during the run');
      values.actors[actor.id] = identity; run.identities[actor.id] = identity;
    }
    if (spec.kind === 'function_read') {
      const [a, b] = Object.values(run.identities);
      if (!a || !b || equal(a.id, b.id) || equal(a.role, b.role) || (a.tenant !== undefined && !equal(a.tenant, b.tenant))) throw new Error('Role proofs need different accounts and roles in the same organization');
    }
  };
  emit('started');
  try {
    runConfigSchema.parse(config);
    const errors = validateCase(spec).filter(i => i.level === 'error');
    if (errors.length) throw new Error(errors.map(i => i.message).join('; '));
    if (config.approvedRevision !== spec.revision) throw new Error('Approve the current revision');
    await identities(false);
    if (spec.preconditions.some(c => !check(c, values).passed)) throw new Error('Live account prerequisites failed');
    const proof = spec.sessionProof!, request = resolveRequest(proof.request, config.targets, {});
    const normal = async () => observed(`authorized-${run.requests}`, 'owner', request, () => spec.kind === 'cors_read'
      ? transport.browserFetch ? transport.browserFetch('owner', request, 'same', options.signal) : Promise.reject(new Error('A signed-in browser session is required'))
      : transport.request('owner', request, options.signal));
    const baseline = await normal();
    if (baseline.status !== 200) throw new Error('Authenticated baseline failed; sign in with a cookie browser session');
    const privateValue = jsonPointer(baseline.body, proof.fieldPointer);
    if (!['string', 'number'].includes(typeof privateValue) || String(privateValue).length < 4) throw new Error('A nonempty private response field was not observed');
    if (!transport.anonymous) throw new Error('Anonymous control is unavailable');
    const anonymous = await observed('anonymous-control', 'anonymous', request, () => transport.anonymous!(request, options.signal));
    if (![200, 401, 403, 404].includes(anonymous.status) || equal(jsonPointer(anonymous.body, proof.fieldPointer), privateValue)) throw new Error('This field was public or the anonymous control was inconclusive');
    let reproduced = false, denied = true;
    for (const origin of spec.kind === 'cors_read' ? ['foreign', 'null'] as const : ['foreign'] as const) {
      const response = await observed(spec.kind === 'cors_read' ? `browser-${origin}` : 'lower-role-read', spec.kind === 'cors_read' ? 'owner' : 'researcher', request, () => spec.kind === 'cors_read'
        ? transport.browserFetch!('owner', request, origin, options.signal)
        : transport.request('researcher', request, options.signal));
      // An error status can still disclose the protected body. Browser readability is the evidence.
      const leaked = response.status >= 200 && response.status < 600 && equal(jsonPointer(response.body, proof.fieldPointer), privateValue);
      reproduced ||= leaked;
      denied &&= [401, 403, 404].includes(response.status) || response.headers['x-reprocase-browser-block'] === 'cors';
      run.checks.push({ id: `private-${origin}`, label: spec.kind === 'cors_read' ? `JavaScript at ${origin === 'null' ? 'null' : 'https://reprocase-probe.invalid'} can read the private field` : 'Lower-privileged account receives the live private field', passed: leaked });
    }
    const after = await normal();
    if (after.status !== 200 || !equal(jsonPointer(after.body, proof.fieldPointer), privateValue)) throw new Error('Authenticated baseline changed during the run');
    await identities(true);
    run.verdict = reproduced ? 'reproduced' : denied ? 'not_reproduced' : 'inconclusive';
    run.code = reproduced ? 'private_field_read' : denied ? 'browser_or_role_denial' : 'ambiguous_response';
    run.reason = reproduced ? 'Live account-only data was read across the declared boundary' : denied ? 'Access was denied for the tested role/origins in this browser context' : 'Neither private access nor an explicit denial was established';
  } catch (error) { run.code = options.signal?.aborted ? 'cancelled' : 'prerequisite_failed'; run.reason = (error as Error).message; }
  finally { run.state = options.signal?.aborted ? 'cancelled' : 'completed'; run.finishedAt = new Date().toISOString(); emit('finished'); }
  redactor.add(...transport.knownSecrets()); return redactor.json(run);
}
