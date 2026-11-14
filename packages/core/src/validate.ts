import { caseSchema, type CaseSpec, type ValidationIssue } from './schema.ts';
import { consumedRequestRefs, jsonPointer, refs } from './values.ts';

export function validateCase(input: unknown): ValidationIssue[] {
  const parsed = caseSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message, level: 'error' }));
  const spec = parsed.data;
  const issues: ValidationIssue[] = [];
  const error = (path: string, message: string) => issues.push({ path, message, level: 'error' });
  const warning = (path: string, message: string) => issues.push({ path, message, level: 'warning' });
  const actors = new Set(spec.actors.map(x => x.id)), origins = new Set(spec.origins.map(x => x.id));
  if (actors.size !== spec.actors.length) error('actors', 'Actor identifiers must be unique');
  if (origins.size !== spec.origins.length) error('origins', 'Origin identifiers must be unique');
  if (!spec.policy.acknowledged) error('policy.acknowledged', 'Review and acknowledge the expected access policy');
  if (actors.size < 2) error('actors', 'Authorization reproduction requires at least two distinct actors');
  const available = new Set(['run.id', 'run.marker']);
  for (const actor of spec.actors) {
    if (!origins.has(actor.identity.origin)) error(`actors.${actor.id}.identity`, 'Unknown identity origin');
    if (/^\/\/|[\\?#\r\n{}]/.test(actor.identity.path)) error(`actors.${actor.id}.identity.path`, 'Identity path must be a relative path without bindings');
    for (const pointer of [actor.identity.idPointer, actor.identity.tenantPointer, actor.identity.rolePointer].filter(x => x !== undefined)) {
      if (pointer !== '' && !pointer!.startsWith('/')) error(`actors.${actor.id}.identity`, 'Use JSON Pointer syntax for identity fields');
    }
    available.add(`actors.${actor.id}.id`);
    if (actor.identity.tenantPointer !== undefined) available.add(`actors.${actor.id}.tenant`);
    if (actor.identity.rolePointer !== undefined) available.add(`actors.${actor.id}.role`);
  }
  const inspectRefs = (value: unknown, path: string) => {
    for (const ref of refs(value)) {
      const parentStep = /^steps\.([^.]+)\.(body|headers|concurrency|text)(\.|$)/.exec(ref);
      if (!available.has(ref) && !(parentStep && available.has(`steps.${parentStep[1]}.status`))) error(path, `Reference is missing or used before its producer: ${ref}`);
    }
  };
  for (const condition of spec.preconditions) inspectRefs(condition, `preconditions.${condition.id}`);
  const seenSteps = new Set<string>(), captures = new Set<string>();
  let sawProbe = false, sawCleanup = false;
  for (const [index, step] of spec.steps.entries()) {
    const path = `steps.${index}`;
    if (seenSteps.has(step.id)) error(path, 'Step identifiers must be unique');
    if (!actors.has(step.request.actor)) error(path, 'Unknown actor');
    if (!origins.has(step.request.origin)) error(path, 'Unknown origin');
    if (/^\/\/|[\\?#\r\n]/.test(step.request.path)) error(`${path}.request.path`, 'Use a relative path, with query parameters in query');
    for (const key of Object.keys(step.request.headers)) if (/^(authorization|cookie|host|origin|connection|content-length|transfer-encoding|proxy-.*)$/i.test(key)) error(path, 'Credentials and transport headers cannot be embedded in a case');
    if (sawCleanup && step.phase !== 'cleanup') error(path, 'Cleanup steps must be last');
    if (step.phase === 'cleanup') sawCleanup = true;
    if (step.phase === 'probe') sawProbe = true;
    if (sawProbe && step.phase === 'prepare') error(path, 'Preparation must finish before probing');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(step.request.method) && step.effect !== 'write' && !(step.request.method === 'POST' && step.request.contentType === 'graphql')) error(path, 'Mutating methods must be declared as writes');
    for (const match of step.request.path.matchAll(/\{([^}]+)\}/g)) if (!Object.hasOwn(step.request.pathParams, match[1])) error(path, `Missing path binding for ${match[1]}`);
    const usedParams = new Set([...step.request.path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]));
    for (const name of Object.keys(step.request.pathParams)) if (!usedParams.has(name)) error(path, `Unused path binding cannot establish resource access: ${name}`);
    inspectRefs(step.request, path);
    seenSteps.add(step.id);
    available.add(`steps.${step.id}.status`);
    for (const capture of step.captures) {
      if (captures.has(capture.name)) error(path, 'Capture names must be unique');
      if (capture.pointer && !capture.pointer.startsWith('/')) error(path, 'Capture pointer must use JSON Pointer');
      captures.add(capture.name); available.add(`captures.${capture.name}`);
    }
    for (const condition of step.checks) inspectRefs(condition, path);
  }
  if (!sawProbe) error('steps', 'Select at least one probe step');
  const resourceIds = new Set<string>();
  for (const resource of spec.resources) {
    if (resourceIds.has(resource.id)) error('resources', 'Resource identifiers must be unique');
    resourceIds.add(resource.id);
    const creator = spec.steps.find(s => s.id === resource.createdBy);
    if (!creator || creator.phase !== 'prepare' || creator.effect !== 'write' || creator.request.actor !== resource.ownerActor) error(`resources.${resource.id}`, 'Resource must be created in a preparation write by its owner');
    if (!actors.has(resource.ownerActor)) error(`resources.${resource.id}`, 'Unknown resource owner');
    if (creator && !creator.captures.some(c => `captures.${c.name}` === resource.idRef)) error(`resources.${resource.id}.idRef`, 'Fresh resource ID must be captured from its creation response');
    for (const proof of [resource.ownerRef, resource.tenantRef].filter(Boolean)) {
      const producer = spec.steps.find(s => s.captures.some(c => c.from === 'body' && `captures.${c.name}` === proof));
      const beforeProbe = producer && spec.steps.indexOf(producer) < spec.steps.findIndex(s => s.phase === 'probe');
      if (!producer || !beforeProbe || (producer.id !== resource.createdBy && !(producer.phase === 'prepare' && producer.request.actor === resource.ownerActor && consumedRequestRefs(producer.request).includes(resource.idRef)))) error(`resources.${resource.id}`, 'Ownership and tenant proof must be captured from the created resource response, before probing');
    }
    for (const ref of [resource.idRef, resource.ownerRef, resource.tenantRef].filter(Boolean)) inspectRefs({ $ref: ref }, `resources.${resource.id}`);
  }
  if (!spec.resources.length) error('resources', 'Define a freshly created resource and its observed ownership');
  for (const step of spec.steps.filter(s => s.phase === 'cleanup')) {
    const resource = spec.resources.find(r => r.ownerActor === step.request.actor && consumedRequestRefs(step.request).includes(r.idRef));
    if (!resource) error(`steps.${step.id}`, 'Cleanup must reference a resource created in this run, using its owner');
  }
  for (const condition of [...spec.preconditions, ...spec.steps.flatMap(s => s.checks), ...spec.witness.success, ...spec.witness.rejection]) {
    if (condition.op !== 'exists' && condition.right === undefined) error(`conditions.${condition.id}`, 'This condition needs a right-hand value');
    if (condition.op === 'in' && !Array.isArray(condition.right)) error(`conditions.${condition.id}`, 'The in operator needs an array');
  }
  for (const condition of [...spec.witness.success, ...spec.witness.rejection]) inspectRefs(condition, `witness.${condition.id}`);
  const attackedResources = spec.resources.filter(r => spec.steps.some(s => s.phase === 'probe' && s.request.actor !== r.ownerActor && consumedRequestRefs(s.request).includes(r.idRef)));
  // Reading a marker as its legitimate owner never proves that another account accessed it.
  const probeIds = new Set(spec.steps.filter(s => s.phase === 'probe' && ((s.effect === 'read' && (['GET', 'HEAD'].includes(s.request.method) || (s.request.method === 'POST' && s.request.contentType === 'graphql'))) || s.concurrency !== undefined) && attackedResources.some(r => s.request.actor !== r.ownerActor && consumedRequestRefs(s.request).includes(r.idRef))).map(s => s.id));
  const proof = spec.witness.writeProof;
  if (proof) {
    const resource = spec.resources.find(r => r.id === proof.resource);
    const before = spec.steps.find(s => s.id === proof.before), probe = spec.steps.find(s => s.id === proof.probe), after = spec.steps.find(s => s.id === proof.after);
    const at = (step: typeof before) => step ? spec.steps.indexOf(step) : -1;
    const ownerRead = (step: typeof before) => step && resource && step.effect === 'read' && (step.request.method === 'GET' || (step.request.method === 'POST' && step.request.contentType === 'graphql')) && step.request.actor === resource.ownerActor && consumedRequestRefs(step.request).includes(resource.idRef);
    let marker: unknown;
    try { marker = jsonPointer(probe?.request.body, proof.mutationPointer); } catch { /* Report as a contract error below. */ }
    const freshMutation = marker && typeof marker === 'object' && Object.keys(marker).length === 1 && (marker as any).$ref === 'run.marker';
    const exclusiveWrite = spec.steps.slice(at(before) + 1, at(after)).filter(s => s.effect === 'write').every(s => s.id === probe?.id);
    if (!resource || !before || !probe || !after || before.phase !== 'prepare' || after.phase !== 'verify' || !ownerRead(before) || !ownerRead(after) || probe.phase !== 'probe' || probe.effect !== 'write' || !['POST', 'PUT', 'PATCH'].includes(probe.request.method) || probe.request.actor === resource.ownerActor || !consumedRequestRefs(probe.request).includes(resource.idRef) || !(at(before) < at(probe) && at(probe) < at(after)) || !freshMutation || !exclusiveWrite) error('witness.writeProof', 'Write proof requires an owner baseline, one different-actor mutation with a fresh marker, then an owner read of the same created resource');
    else probeIds.add(after.id);
  }
  const observedWitness = spec.witness.success.some(condition => {
    const used = refs(condition);
    const bodyWitness = condition.op !== 'exists' && used.some(r => /^steps\.([^.]+)\.(?:body(?:\.|$)|text$)/.test(r) && probeIds.has(r.split('.')[1])) && used.some(r => r === 'run.marker' || r.startsWith('captures.') || r.startsWith('actors.'));
    const concurrencyWitness = condition.op !== 'exists' && used.some(r => /^steps\.([^.]+)\.concurrency\.succeeded$/.test(r) && probeIds.has(r.split('.')[1]));
    return bodyWitness || concurrencyWitness;
  });
  if (!observedWitness) error('witness.success', 'A success witness must compare a body observation from a freshly created resource accessed by a different actor to this run’s marker, identity or capture; status or unrelated identity responses are insufficient');
  if (!spec.preconditions.some(c => c.op === 'neq' && refs(c).filter(r => /^actors\.[^.]+\.id$/.test(r)).length >= 2)) error('preconditions', 'Explicitly require the two actor identities to be different');
  if (spec.steps.some(s => Object.values(s.request.pathParams).some(v => typeof v === 'string' || typeof v === 'number'))) warning('steps', 'A literal path ID may depend on the original environment. Bind dynamic resource IDs explicitly.');
  return issues;
}
export function requireValidCase(input: unknown): CaseSpec {
  const spec = caseSchema.parse(input);
  const errors = validateCase(spec).filter(i => i.level === 'error');
  if (errors.length) throw new Error(errors.map(i => `${i.path}: ${i.message}`).join('\n'));
  return spec;
}
