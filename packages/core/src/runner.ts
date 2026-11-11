import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { runConfigSchema, type CaseSpec, type RunConfig, type RunResult, type SessionTransport, type RunEvent, type StepSpec, type StepResult, type Identity, type Json } from './schema.ts';
import { check, consumedRequestRefs, equal, jsonPointer, lookup, resolveRequest, targetOrigin } from './values.ts';
import { validateCase } from './validate.ts';
import { createRedactor } from './redact.ts';

export function newRunResult(spec: CaseSpec, id: string = randomUUID()): RunResult {
  return { schemaVersion: 1, id, caseId: spec.id, caseRevision: spec.revision, state: 'running', verdict: 'inconclusive', reason: 'Checking preparation and identity', code: 'running', startedAt: new Date().toISOString(), steps: [], checks: [], identities: {}, requests: 0, cleanupErrors: [], setup: 'created_this_run' };
}
class RunFailure extends Error { constructor(public code: string, message: string) { super(message); } }
export async function executeCase(spec: CaseSpec, config: RunConfig, transport: SessionTransport, options: { signal?: AbortSignal; onEvent?: (event: RunEvent) => void; runId?: string } = {}): Promise<RunResult> {
  const run = newRunResult(spec, options.runId);
  const marker = `rc_${randomUUID()}`;
  const values: Record<string, any> = { run: { id: run.id, marker }, actors: {}, captures: {}, steps: {} };
  const redact = createRedactor(transport.knownSecrets());
  redact.alias(marker, 'run.marker');
  const emit = (type: RunEvent['type']) => { redact.add(...transport.knownSecrets()); options.onEvent?.({ type, run: redact.json(structuredClone(run)) }); };
  const created = new Set<string>();
  const checkCancellation = () => { if (options.signal?.aborted) throw new RunFailure('cancelled', 'Run cancelled; in-flight writes may have an unknown outcome'); };
  const send = async (actor: string, request: ReturnType<typeof resolveRequest>) => {
    checkCancellation();
    if (run.requests >= (config.maxRequests ?? 100)) throw new RunFailure('request_budget', 'The configured request budget was exhausted');
    if (run.requests && (config.intervalMs ?? 250) > 0) await pause(config.intervalMs ?? 250, undefined, { signal: options.signal });
    checkCancellation();
    run.requests++;
    const response = await transport.request(actor, request, options.signal);
    checkCancellation();
    return response;
  };
  const identity = async (actor: CaseSpec['actors'][number], recheck: boolean) => {
    const row: StepResult = { id: `${recheck ? 'recheck' : 'identity'}-${actor.id}-${run.requests}`, label: `${recheck ? 'Recheck' : 'Verify'} ${actor.label}`, phase: 'identity', actor: actor.id, status: 'running', startedAt: new Date().toISOString(), checks: [] };
    run.steps.push(row); emit('step');
    try {
      const request = resolveRequest({ actor: actor.id, origin: actor.identity.origin, method: 'GET', path: actor.identity.path, pathParams: {}, query: {}, headers: {} }, config.targets, values);
      row.request = { method: request.method, url: request.url };
      const response = await send(actor.id, request);
      row.response = response;
      if (response.status < 200 || response.status >= 300) throw new RunFailure('authentication_failed', `Identity could not be verified for ${actor.label}`);
      const id = jsonPointer(response.body, actor.identity.idPointer);
      const tenant = actor.identity.tenantPointer === undefined ? undefined : jsonPointer(response.body, actor.identity.tenantPointer);
      const role = actor.identity.rolePointer === undefined ? undefined : jsonPointer(response.body, actor.identity.rolePointer);
      const scalar = (value: unknown) => (typeof value === 'string' && value.length > 0) || (typeof value === 'number' && Number.isFinite(value));
      if (!scalar(id) || (actor.identity.tenantPointer !== undefined && !scalar(tenant)) || (actor.identity.rolePointer !== undefined && !scalar(role))) throw new RunFailure('identity_unavailable', 'Identity response is missing required scalar fields');
      const observed: Identity = { id, ...(tenant === undefined ? {} : { tenant }), ...(role === undefined ? {} : { role }) };
      if (recheck && !equal(observed, values.actors[actor.id])) throw new RunFailure('identity_changed', `The identity or permissions changed for ${actor.label}`);
      if (actor.expectedRole !== undefined && role !== actor.expectedRole) throw new RunFailure('role_mismatch', `The expected role was not observed for ${actor.label}`);
      values.actors[actor.id] = observed;
      run.identities[actor.id] = observed;
      redact.alias(id as Json, `actors.${actor.id}.id`);
      if (tenant !== undefined) redact.alias(tenant as Json, `actors.${actor.id}.tenant`);
      row.checks = [{ id: 'identity-observed', label: 'Identity observed from the live API', passed: true }];
      row.status = 'passed';
    } catch (error) { row.status = 'failed'; row.error = error instanceof Error ? error.message : 'Identity check failed'; throw error; }
    finally { row.finishedAt = new Date().toISOString(); emit('step'); }
  };
  const resourceChecks = () => {
    for (const resource of spec.resources) {
      const id = lookup(values, resource.idRef), owner = lookup(values, resource.ownerRef), tenant = resource.tenantRef ? lookup(values, resource.tenantRef) : undefined;
      const expected = values.actors[resource.ownerActor];
      const passed = created.has(resource.id) && id !== undefined && id !== null && owner !== undefined && equal(owner, expected?.id) && (!resource.tenantRef || (tenant !== undefined && equal(tenant, expected?.tenant)));
      const item = { id: `resource-${resource.id}`, label: `${resource.label}: freshly created with the observed owner${resource.tenantRef ? ' and tenant' : ''}`, passed };
      run.checks.push(item); emit('check');
      if (!passed) throw new RunFailure('resource_precondition_failed', `Freshness or ownership was not established for ${resource.label}`);
    }
  };
  const step = async (item: StepSpec) => {
    const row: StepResult = { id: item.id, label: item.label, actor: item.request.actor, phase: item.phase, status: 'running', startedAt: new Date().toISOString(), checks: [] };
    run.steps.push(row); emit('step');
    try {
      const request = resolveRequest(item.request, config.targets, values);
      row.request = { method: request.method, url: request.url, ...(request.contentType ? { contentType: request.contentType } : {}), ...(request.body === undefined ? {} : { body: request.body }) };
      let response: Awaited<ReturnType<typeof send>>;
      if (item.concurrency && item.concurrency.count >= 2) {
        const count = item.concurrency.count;
        let responses: Awaited<ReturnType<typeof send>>[];
        if (item.concurrency.mode === 'sequential') {
          responses = [];
          for (let i = 0; i < count; i++) responses.push(await send(item.request.actor, request));
        } else {
          checkCancellation();
          if (run.requests + count > (config.maxRequests ?? 100)) throw new RunFailure('request_budget', 'The configured request budget was exhausted');
          if (run.requests && (config.intervalMs ?? 250) > 0) await pause(config.intervalMs ?? 250, undefined, { signal: options.signal });
          checkCancellation();
          run.requests += count;
          responses = await Promise.all(Array.from({ length: count }, () => transport.request(item.request.actor, request, options.signal)));
          checkCancellation();
        }
        response = responses.find(r => r.status >= 200 && r.status < 300) ?? responses[0]!;
        const concurrency = { count: responses.length, succeeded: responses.filter(r => r.status >= 200 && r.status < 300).length, statuses: responses.map(r => r.status) };
        row.response = response; row.concurrency = concurrency;
        values.steps[item.id] = { ...response, concurrency };
      } else {
        response = await send(item.request.actor, request);
        row.response = response; values.steps[item.id] = response;
      }
      for (const capture of item.captures) {
        const source = capture.from === 'status' ? response.status : capture.from === 'headers' ? response.headers : response.body;
        const value = jsonPointer(source, capture.pointer);
        if (value === undefined) throw new RunFailure('capture_unavailable', `Required capture is missing: ${capture.name}`);
        values.captures[capture.name] = value;
        if ((typeof value === 'string' || typeof value === 'number') && value !== '') redact.alias(value, `captures.${capture.name}`);
      }
      if (response.status >= 200 && response.status < 300) for (const resource of spec.resources.filter(r => r.createdBy === item.id)) {
        if (lookup(values, resource.idRef) !== undefined) created.add(resource.id);
      }
      row.checks = item.checks.map(c => check(c, values));
      if (row.checks.some(c => !c.passed)) throw new RunFailure('step_precondition_failed', `A required observation failed in ${item.label}`);
      // Preparation cannot silently proceed after a failed create, even if its body looks plausible.
      if (item.phase === 'prepare' && (response.status < 200 || response.status >= 300)) throw new RunFailure('preparation_failed', `${item.label} did not complete successfully`);
      row.status = 'passed';
    } catch (error) { row.status = 'failed'; row.error = error instanceof Error ? error.message : 'Request failed'; throw error; }
    finally { row.finishedAt = new Date().toISOString(); emit('step'); }
  };
  emit('started');
  try {
    const runConfig = runConfigSchema.safeParse(config);
    if (!runConfig.success) throw new RunFailure('invalid_run_config', 'Run targets, revision, timing or request budget are invalid');
    const errors = validateCase(spec).filter(i => i.level === 'error');
    if (errors.length) throw new RunFailure('invalid_case', errors.map(i => `${i.path}: ${i.message}`).join('; '));
    if (config.approvedRevision !== spec.revision) throw new RunFailure('stale_revision', 'The approved case revision is no longer current');
    for (const origin of spec.origins) { if (!config.targets[origin.id]) throw new RunFailure('missing_target', `Bind target origin ${origin.label}`); targetOrigin(config.targets[origin.id]); }
    for (const actor of spec.actors) await identity(actor, false);
    run.checks.push(...spec.preconditions.map(c => check(c, values))); emit('check');
    if (run.checks.some(c => !c.passed)) throw new RunFailure('precondition_failed', 'The observed accounts do not satisfy the scenario’s prerequisites');
    let preparationChecked = false;
    for (const item of spec.steps.filter(s => s.phase !== 'cleanup')) {
      if (item.phase === 'probe' || (preparationChecked && item.phase === 'verify')) {
        for (const actor of spec.actors) await identity(actor, true);
        if (!preparationChecked) { resourceChecks(); preparationChecked = true; }
      }
      await step(item);
      if (spec.witness.writeProof?.before === item.id) {
        const beforeValue = jsonPointer(values.steps[item.id]?.body, spec.witness.writeProof.fieldPointer);
        if (beforeValue === undefined || equal(beforeValue, marker)) throw new RunFailure('write_precondition_failed', 'The owner baseline must expose a field that does not already contain this run’s write marker');
      }
    }
    const success = spec.witness.success.map(c => check(c, values));
    const rejection = spec.witness.rejection.map(c => check(c, values));
    if (spec.witness.writeProof) {
      const proof = spec.witness.writeProof;
      const before = jsonPointer(values.steps[proof.before]?.body, proof.fieldPointer), after = jsonPointer(values.steps[proof.after]?.body, proof.fieldPointer);
      const probe = values.steps[proof.probe];
      success.push({ id: 'write-transition', label: 'A different actor changed the owner-observed field to this run’s fresh marker', passed: before !== undefined && !equal(before, marker) && equal(after, marker) && probe?.status >= 200 && probe?.status < 300 });
    }
    run.checks.push(...success.map(c => ({ ...c, id: `witness-${c.id}` })));
    if (success.every(c => c.passed)) { run.verdict = 'reproduced'; run.code = 'witness_observed'; run.reason = 'The declared access boundary was crossed with this run’s fresh resource and verified accounts'; }
    else if (rejection.every(c => c.passed)) { run.verdict = 'not_reproduced'; run.code = 'rejection_observed'; run.reason = 'Prerequisites were verified and the declared rejection behavior was observed'; }
    else { run.verdict = 'inconclusive'; run.code = 'ambiguous_response'; run.reason = 'Neither the required violation witness nor the declared rejection behavior was observed'; }
  } catch (error) {
    run.verdict = 'inconclusive';
    run.code = options.signal?.aborted ? 'cancelled' : error instanceof RunFailure ? error.code : 'request_failed';
    run.reason = options.signal?.aborted ? 'Run cancelled; an in-flight write may have an unknown outcome' : error instanceof Error ? error.message : 'The run could not be completed';
  } finally {
    if (!options.signal?.aborted) for (const item of spec.steps.filter(s => s.phase === 'cleanup')) {
      const resource = spec.resources.find(r => created.has(r.id) && r.ownerActor === item.request.actor && consumedRequestRefs(item.request).includes(r.idRef));
      if (!resource) continue;
      try { await step(item); const response = values.steps[item.id]; if (response?.status < 200 || response?.status >= 300) run.cleanupErrors.push(`${item.label}: server did not confirm cleanup`); }
      catch (error) { run.cleanupErrors.push(`${item.label}: ${error instanceof Error ? error.message : 'Cleanup failed'}`); }
    }
    if (options.signal?.aborted && created.size) run.cleanupErrors.push('Cleanup was not sent after cancellation. Review resources created before cancellation.');
    run.state = options.signal?.aborted ? 'cancelled' : 'completed';
    run.finishedAt = new Date().toISOString(); emit('finished');
  }
  return redact.json(run);
}
