import { randomUUID } from 'node:crypto';
import { bindResource, buildQuickProof, caseSchema, CSRF_PATHS, editableFields, equal, findCsrfPointer, findOwnerPointer, inferCreate, jsonPointer, parseRequest, privateFields, requestSchema, resolveRequest, rolePreconditions, scalarFields, sessionCase, setPointer, validateCase, type CaseSpec, type HttpRequestSpec, type HttpResponse, type IdentityGuess, type Json, type QuickProofKind } from '@reprocase/core';
import type { QuickProofDeps } from './quickproof.ts';

type Input = { create?: string; vulnerable: string; read?: string; field?: string; title?: string; csrf?: { path: string; pointer: string; header: string } };
type Session = { id: string; origin: string; kind: QuickProofKind; identity?: IdentityGuess };
export async function observeExpanded(deps: QuickProofDeps, session: Session, input: Input) {
  const identity = session.identity!;
  const notes: string[] = [];
  const network = deps.network();
  const key = (actor: string) => `${session.id}:${actor}`;
  const send = async (actor: string, req: HttpRequestSpec, captures: Record<string, unknown> = {}, cleanup = false) => {
    const request = resolveRequest(req, { api: session.origin }, { captures });
    await (cleanup ? network.authorizeCleanup(request.url) : network.authorize(request.url));
    return deps.browsers.request(key(actor), request, network.signal);
  };
  const needs = (message: string, fields: { pointer: string; label: string }[] = [], read = false) => ({ status: 'needs_input' as const, message, fields, read, notes });
  const save = (spec: CaseSpec, notes: string[] = [], preview = { owner: 200, other: 0, otherSawObject: false }) => {
    if (input.title) spec.title = input.title;
    const saved = deps.saveCase(caseSchema.parse(spec)); deps.saveTargets(saved.id, { api: session.origin });
    return { status: 'ready' as const, case: saved, issues: validateCase(saved), notes, learned: { identity, objectPath: spec.sessionProof?.request.path ?? spec.steps.find(s => s.id === 'owner-read')?.request.path ?? '', idField: 'Observed per run', ownerField: 'Observed per run', markerField: spec.witness.writeProof?.mutationPointer ?? spec.sessionProof?.fieldPointer ?? '', csrf: input.csrf ?? null, boundary: session.kind }, preview };
  };
  const parsed = parseRequest(input.vulnerable);
  if (session.kind === 'cors_read' || (session.kind === 'role' && !input.create)) {
    if (parsed.method !== 'GET') return needs('This flow needs a GET request. For role writes, also provide a test-object creation request.');
    if (session.kind === 'role' && (!identity.rolePointer || !identity.roles || identity.roles[0] === identity.roles[1])) return needs('Pick the role field from the account identities before building a role proof.');
    const req = requestSchema.parse({ actor: 'owner', origin: 'api', ...parsed });
    const request = resolveRequest(req, { api: session.origin }, {});
    const baseline = session.kind === 'cors_read' ? await deps.browsers.browserFetch(key('owner'), request, 'same', url => network.authorize(url), network.signal) : await send('owner', req);
    if (baseline.status !== 200) return needs('The authorized account could not read this endpoint. Check the request and browser sign-in.');
    await network.authorize(request.url);
    const anonymous = await deps.browsers.anonymous(request, network.signal);
    if (![200, 401, 403, 404].includes(anonymous.status)) return needs('The anonymous control did not complete. Try again after checking the endpoint.');
    const fields = privateFields(baseline.body, anonymous.body);
    const chosen = input.field ? fields.find(f => f.pointer === input.field) : fields[0];
    if (!chosen) return needs('No account-only field was established. Select a private field from a different endpoint.');
    return save(sessionCase(session.id, session.kind === 'cors_read' ? 'cors_read' : 'function_read', req, identity, chosen.pointer), ['A new live baseline and anonymous control are checked on every run.']);
  }
  if (!input.create) return needs('Paste the request that creates a disposable object.');
  const create = parseRequest(input.create), bound = bindResource(parsed);
  if (create.method !== 'POST' || !create.body) return needs('Creation must be a POST with a JSON or form body.');
  if (!bound || !parsed.body || !['PATCH', 'PUT', 'POST'].includes(parsed.method)) return needs('Paste a PATCH, PUT or POST with a resource ID in its path, query or body.');
  const fields = editableFields(parsed.body);
  const preferred = fields.filter(f => /^(?:text|title|name|description|note|content|label)$/i.test(f.key));
  const selected = input.field ? fields.find(f => f.pointer === input.field) : preferred.length === 1 ? preferred[0] : fields.length === 1 ? fields[0] : undefined;
  if (!selected) return needs('Which field should change? Choose one field; no JSON Pointer needs to be typed.', fields.map(f => ({ pointer: f.pointer, label: f.pointer.slice(1).replaceAll('/', ' › ') })));
  if (session.kind === 'role' && (!identity.rolePointer || !identity.roles || identity.roles[0] === identity.roles[1])) return needs('Two different live roles must be selected before a role write.');
  const owner = deps.browsers.verifiedIdentity(key('owner'));
  if (!owner) return needs('Verify account A first.');
  let csrf = input.csrf;
  const csrfHeaders = async (actor: string, cleanup = false): Promise<Record<string, string>> => {
    if (!csrf) return {};
    const r = await send(actor, requestSchema.parse({ actor, origin: 'api', method: 'GET', path: csrf.path }), {}, cleanup);
    const token = jsonPointer(r.body, csrf.pointer);
    if (typeof token !== 'string' || !token) throw new Error('The CSRF token could not be established');
    return { [csrf.header]: token };
  };
  const createRequest = requestSchema.parse({ actor: 'owner', origin: 'api', ...create });
  const doCreate = async () => send('owner', { ...createRequest, headers: await csrfHeaders('owner') });
  network.reserveRequests(2);
  let created = await doCreate();
  if (!csrf && [403, 419].includes(created.status) && /csrf|xsrf/i.test(JSON.stringify(created.body))) {
    outer: for (const path of CSRF_PATHS) {
      const r = await send('owner', requestSchema.parse({ actor: 'owner', origin: 'api', method: 'GET', path }));
      const pointer = r.status === 200 ? findCsrfPointer(r.body) : undefined;
      if (!pointer) continue;
      for (const header of ['x-csrf-token', 'x-xsrf-token']) {
        csrf = { path, pointer, header }; created = await doCreate();
        if (created.status >= 200 && created.status < 300) break outer;
        if (![403, 419].includes(created.status)) throw new Error('Creation outcome is uncertain; it was not retried. Review objects created by A.');
        csrf = undefined;
      }
    }
  }
  if (created.status < 200 || created.status >= 300) throw new Error(`Creation failed: HTTP ${created.status}`);
  let guess: ReturnType<typeof inferCreate>;
  try { guess = inferCreate({ requestBody: create.body, responseBody: created.body, owner, sampleId: bound.sampleId }); }
  catch (e) { throw new Error(`${(e as Error).message} An object may have been created by A; its ID is unknown, so review it manually.`); }
  const captures = { resourceId: jsonPointer(created.body, guess.idResponsePointer) };
  const fallback = requestSchema.parse({ actor: 'owner', origin: 'api', method: 'GET', path: `${create.path.replace(/\/$/, '')}/{resource}`, pathParams: { resource: { $ref: 'captures.resourceId' } } });
  let read = fallback;
  let pendingError: unknown;
  try {
    const candidates = input.read ? [bindResource(parseRequest(input.read), 'owner')?.request] : [fallback, { ...bound.request, actor: 'owner', method: 'GET' as const, body: undefined, headers: {}, contentType: undefined }];
    let before: HttpResponse | undefined;
    for (const candidate of candidates.filter((x): x is HttpRequestSpec => !!x)) {
      if (candidate.method !== 'GET') continue;
      const r = await send('owner', candidate, captures);
      if (r.status === 200 && findOwnerPointer(r.body, owner.id)) { read = candidate; before = r; break; }
    }
    if (!before) return needs('Paste the GET request the owner uses to read this object.', [], true);
    if (!guess.ownerResponsePointer) { guess.ownerResponsePointer = findOwnerPointer(before.body, owner.id); guess.ownerSource = 'owner_read'; }
    const marker = typeof selected.value === 'string' && /^(text|title|name|description|note|notes|content|label|memo|comment|summary|message|body|subject)$/i.test(selected.key);
    const expected: Json = marker ? `rc_${randomUUID()}` : selected.value;
    const mutation = { ...bound.request, actor: 'owner', headers: await csrfHeaders('owner'), body: setPointer(bound.request.body, selected.pointer, expected) };
    // Exactly one authorized calibration write. Its effect is observed, even for an error response.
    try { await send('owner', mutation, captures); } catch (e) { if (/scope|budget|restriction|cancel/i.test((e as Error).message)) throw e; }
    const after = await send('owner', read, captures);
    const matches = scalarFields(after.body).filter(f => equal(f.value, expected) && !equal(jsonPointer(before!.body, f.pointer), expected)).map(f => f.pointer);
    // scalarFields intentionally skips booleans; follow the request field name for typed state.
    if (!matches.length) for (const f of editableFields(after.body)) if (equal(f.value, expected) && !equal(jsonPointer(before.body, f.pointer), expected)) matches.push(f.pointer);
    if (after.status !== 200 || matches.length !== 1) return needs('The authorized write did not establish one unambiguous state change. Choose a different field or check the read request.', fields.map(f => ({ pointer: f.pointer, label: f.key })), true);
    const built = buildQuickProof({ identity, createPath: create.path, createBody: create.body, createContentType: create.contentType, create: guess, readPath: fallback.path, ...(csrf ? { csrf } : {}) }, session.id).case;
    const spec = caseSchema.parse({ ...built, schemaVersion: 2, kind: 'authorization', boundary: session.kind === 'role' ? 'role' : 'object' });
    spec.title = `Write authorization: ${parsed.path}`;
    spec.policy.statement = session.kind === 'role' ? 'Account A may perform this operation; lower-privileged account B must not change the controlled state.' : 'Only the owner may change this object. Account B must be denied.';
    if (session.kind === 'role') rolePreconditions(spec, identity);
    const createStep = spec.steps.find(s => s.id === 'create-resource')!;
    createStep.request = { ...createRequest, headers: createStep.request.headers };
    const readStep = spec.steps.find(s => s.id === 'owner-read')!;
    readStep.request = read; readStep.checks = [];
    const probe = spec.steps.find(s => s.id === 'probe')!;
    probe.effect = 'write'; probe.request = { ...bound.request, body: setPointer(bound.request.body, selected.pointer, marker ? { $ref: 'run.marker' } : expected), headers: csrf ? { [csrf.header]: { $ref: 'captures.researcherCsrf' } } : {} };
    const expectedRef = marker ? { $ref: 'run.marker' } : expected;
    const controlCreate = structuredClone(createStep); controlCreate.id = 'control-create'; controlCreate.label = 'Create a separate authorized control object';
    controlCreate.captures = controlCreate.captures.map(c => ({ ...c, name: `control_${c.name}` }));
    const remap = <T>(obj: T): T => JSON.parse(JSON.stringify(obj).replaceAll('captures.resource', 'captures.control_resource'));
    const controlRead = remap(structuredClone(readStep)); controlRead.id = 'control-before'; controlRead.captures = controlRead.captures.map(c => ({ ...c, name: `control_${c.name}` }));
    const controlWrite = remap(structuredClone(probe)); controlWrite.id = 'control-write'; controlWrite.label = 'Authorized account performs the same change'; controlWrite.phase = 'prepare'; controlWrite.request.actor = 'owner'; controlWrite.request.headers = createStep.request.headers;
    const controlAfter = remap(structuredClone(readStep)); controlAfter.id = 'control-after'; controlAfter.label = 'Observe the authorized control change'; controlAfter.captures = [];
    const controlResource = { ...spec.resources[0], id: 'control', createdBy: 'control-create', idRef: 'captures.control_resourceId', ownerRef: 'captures.control_resourceOwner', ...(spec.resources[0].tenantRef ? { tenantRef: 'captures.control_resourceTenant' } : {}) };
    spec.resources.unshift(controlResource);
    const afterStep = { ...structuredClone(readStep), id: 'owner-after', label: 'Owner independently observes the result', phase: 'verify' as const, captures: [] };
    const cleanup = spec.steps.find(s => s.phase === 'cleanup')!; cleanup.request = { ...read, method: 'DELETE', headers: createStep.request.headers };
    // Query/body IDs are read through a canonical collection resource URL for deletion.
    cleanup.request = { ...fallback, method: 'DELETE', headers: createStep.request.headers };
    const controlCleanup = remap(structuredClone(cleanup)); controlCleanup.id = 'control-cleanup';
    const csrfSteps = spec.steps.filter(s => s.id === 'owner-csrf');
    if (csrf) csrfSteps.push({ ...structuredClone(csrfSteps[0]), id: 'researcher-csrf', label: 'Get the other account CSRF token', request: { ...csrfSteps[0].request, actor: 'researcher' }, captures: [{ name: 'researcherCsrf', from: 'body', pointer: csrf.pointer }] });
    spec.steps = [...csrfSteps, controlCreate, controlRead, controlWrite, controlAfter, createStep, readStep, probe, afterStep, cleanup, controlCleanup];
    const refFor = (step: string) => ({ $ref: `steps.${step}.body.${matches[0].slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~')).join('.')}` });
    spec.witness = { success: [{ id: 'controlled-change', label: 'Owner observes the exact controlled transition', op: 'eq', left: refFor('owner-after'), right: expectedRef }], rejection: [{ id: 'explicit-denial', label: 'The unauthorized mutation was denied', op: 'in', left: { $ref: 'steps.probe.status' }, right: [401, 403, 404] }], writeProof: { resource: 'resource', probe: 'probe', before: 'owner-read', after: 'owner-after', fieldPointer: matches[0], mutationPointer: selected.pointer, ...(marker ? {} : { expected: expected as string | number | boolean }), control: { step: 'control-after', before: 'control-before', mutation: 'control-write', resource: 'control', fieldPointer: matches[0] } } };
    const errors = validateCase(spec).filter(i => i.level === 'error' && i.path !== 'policy.acknowledged');
    if (errors.length) throw new Error(errors.map(e => `${e.path}: ${e.message}`).join('; '));
    return save(spec, notes);
  } catch (e) { pendingError = e; throw e; } finally {
    try {
      const del = await send('owner', { ...fallback, method: 'DELETE', headers: await csrfHeaders('owner', true) }, captures, true);
      if (del.status < 200 || del.status >= 300) throw new Error('Deletion not confirmed');
    } catch {
      const message = `Remove the observation object manually: ${session.origin}${fallback.path.replace('{resource}', encodeURIComponent(String(captures.resourceId)))}`;
      notes.push(message); if (pendingError instanceof Error) pendingError.message += ` ${message}`;
    }
  }
}
