import { z } from 'zod';
import { caseSchema, jsonSchema, type CaseSpec, type HttpRequestSpec, type Json, type StepSpec } from './schema.ts';
import { validateCase } from './validate.ts';

const pointer = z.string().startsWith('/').max(512).refine(value => value.split('/').slice(1).every(part => !/~(?:[^01]|$)/.test(part) && !['__proto__', 'constructor', 'prototype'].includes(part.replace(/~1/g, '/').replace(/~0/g, '~'))), 'Use a safe JSON Pointer');
const path = z.string().startsWith('/').max(2000).refine(value => !/^\/\/|[\\?#\r\n]/.test(value), 'Use a relative API path, without a query string');
const body = jsonSchema.refine(value => value !== null && typeof value === 'object' && !Array.isArray(value), 'Provide a JSON object');
export const authoringSchema = z.strictObject({
  title: z.string().trim().min(1).max(200), policy: z.string().trim().min(1).max(4000),
  kind: z.enum(['read', 'write']).default('read'), boundary: z.enum(['cross_user', 'cross_tenant']).default('cross_tenant'),
  identityPath: path.default('/me'), idPointer: pointer.default('/id'), tenantPointer: pointer.optional(), rolePointer: pointer.optional(), expectedRole: z.string().trim().max(100).optional(),
  createPath: path, createBody: body, idResponsePointer: pointer.default('/id'), ownerResponsePointer: pointer.default('/ownerId'), tenantResponsePointer: pointer.optional(),
  ownershipSource: z.enum(['creation', 'owner_read']).default('creation'), readPath: path,
  markerRequestPointer: pointer.default('/marker'), markerResponsePointer: pointer.default('/marker'),
  csrf: z.strictObject({ path, pointer, header: z.string().regex(/^[A-Za-z0-9-]+$/).refine(value => !/^(authorization|cookie|host|origin|connection|content-length|transfer-encoding|proxy-.*)$/i.test(value), 'Use a CSRF header, not an authentication or transport header') }).optional(),
  cleanup: z.boolean().default(true), cleanupPath: path.optional(),
  deniedStatuses: z.array(z.number().int().min(400).max(499)).min(1).max(20).default([403, 404]),
  writePath: path.optional(), writeMethod: z.enum(['PATCH', 'PUT', 'POST']).default('PATCH'), writeBody: body.optional(), writeMutationPointer: pointer.default('/title'), writeResponsePointer: pointer.default('/title'),
}).superRefine((value, ctx) => {
  if (value.boundary === 'cross_tenant' && !value.tenantPointer) ctx.addIssue({ code: 'custom', path: ['tenantPointer'], message: 'Cross-tenant cases need a live account tenant field' });
  if (value.tenantResponsePointer && !value.tenantPointer) ctx.addIssue({ code: 'custom', path: ['tenantResponsePointer'], message: 'Configure the account tenant field before checking the resource tenant' });
  if (value.expectedRole && !value.rolePointer) ctx.addIssue({ code: 'custom', path: ['rolePointer'], message: 'An expected role requires a live role response field' });
  for (const field of ['identityPath', 'createPath'] as const) if (/[{}]/.test(value[field])) ctx.addIssue({ code: 'custom', path: [field], message: 'This path must not contain resource bindings' });
  if (value.csrf && /[{}]/.test(value.csrf.path)) ctx.addIssue({ code: 'custom', path: ['csrf', 'path'], message: 'CSRF retrieval must not depend on a resource' });
  const fields: ('readPath' | 'cleanupPath' | 'writePath')[] = ['readPath', ...(value.cleanup ? ['cleanupPath' as const] : []), ...(value.kind === 'write' ? ['writePath' as const] : [])];
  for (const field of fields) {
    const current = value[field] ?? value.readPath;
    if (!current.includes('{resource}') || [...current.matchAll(/\{([^}]+)\}/g)].some(match => match[1] !== 'resource')) ctx.addIssue({ code: 'custom', path: [field], message: 'Use exactly the {resource} binding in the resource path' });
  }
});
export type AuthoringInput = z.input<typeof authoringSchema>;
export type AuthoringSettings = z.infer<typeof authoringSchema>;
const ref = ($ref: string): Json => ({ $ref });
function referenceForPointer(step: string, input: string): Json {
  const parts = input.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error('Witness response fields must use simple JSON keys; advanced fields can be authored in the specification editor');
  return ref(`steps.${step}.body.${parts.join('.')}`);
}
function inject(input: Json, pointer: string): Json {
  const output = structuredClone(input) as Record<string, any>;
  const parts = pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let node: any = output;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (Array.isArray(node) && (!/^\d+$/.test(key) || Number(key) >= node.length)) throw new Error('Marker array indexes must already exist');
    if (node[key] === undefined) node[key] = {};
    if (node[key] === null || typeof node[key] !== 'object') throw new Error('Marker pointer crosses a non-object field');
    node = node[key];
  }
  const last = parts.at(-1)!;
  if (Array.isArray(node) && (!/^\d+$/.test(last) || Number(last) >= node.length)) throw new Error('Marker array indexes must already exist');
  node[last] = ref('run.marker');
  return output;
}
export function buildCase(input: AuthoringInput, caseId = `case-${globalThis.crypto.randomUUID()}`): { case: CaseSpec; issues: ReturnType<typeof validateCase> } {
  const s = authoringSchema.parse(input);
  const request = (actor: string, method: HttpRequestSpec['method'], requestPath: string, extra: Partial<HttpRequestSpec> = {}): HttpRequestSpec => ({ actor, origin: 'api', method, path: requestPath, pathParams: requestPath.includes('{resource}') ? { resource: ref('captures.resourceId') } : {}, query: {}, headers: {}, ...extra });
  const ownerHeaders = s.csrf ? { [s.csrf.header]: ref('captures.ownerCsrf') } : {};
  const researcherHeaders = s.csrf ? { [s.csrf.header]: ref('captures.researcherCsrf') } : {};
  const steps: StepSpec[] = [];
  if (s.csrf) for (const actor of s.kind === 'write' ? ['owner', 'researcher'] : ['owner']) steps.push({ id: `${actor}-csrf`, label: `Get ${actor}'s current CSRF token`, phase: 'prepare', effect: 'read', request: request(actor, 'GET', s.csrf.path), captures: [{ name: `${actor}Csrf`, from: 'body', pointer: s.csrf.pointer }], checks: [] });
  const ownerCaptures: StepSpec['captures'] = [{ name: 'resourceOwner', from: 'body', pointer: s.ownerResponsePointer }, ...(s.tenantResponsePointer ? [{ name: 'resourceTenant', from: 'body' as const, pointer: s.tenantResponsePointer }] : [])];
  steps.push({ id: 'create-resource', label: 'Create a fresh controlled resource', phase: 'prepare', effect: 'write', request: request('owner', 'POST', s.createPath, { headers: ownerHeaders, body: s.kind === 'read' ? inject(s.createBody, s.markerRequestPointer) : s.createBody }), captures: [{ name: 'resourceId', from: 'body', pointer: s.idResponsePointer }, ...(s.ownershipSource === 'creation' ? ownerCaptures : [])], checks: [] });
  steps.push({ id: 'owner-read', label: 'Observe the resource as its owner', phase: 'prepare', effect: 'read', request: request('owner', 'GET', s.readPath), captures: s.ownershipSource === 'owner_read' ? ownerCaptures : [], checks: [{ id: 'owner-baseline', label: s.kind === 'read' ? 'Owner reads this run’s fresh marker' : 'Owner baseline exposes the controlled field', op: s.kind === 'read' ? 'eq' : 'exists', left: referenceForPointer('owner-read', s.kind === 'read' ? s.markerResponsePointer : s.writeResponsePointer), ...(s.kind === 'read' ? { right: ref('run.marker') } : {}) }] });
  steps.push({ id: 'probe', label: s.kind === 'read' ? 'Read the resource as the other account' : 'Attempt a controlled change as the other account', phase: 'probe', effect: s.kind === 'read' ? 'read' : 'write', request: s.kind === 'read' ? request('researcher', 'GET', s.readPath) : request('researcher', s.writeMethod, s.writePath ?? s.readPath, { headers: researcherHeaders, body: inject(s.writeBody ?? { title: 'Controlled change' }, s.writeMutationPointer) }), captures: [], checks: [] });
  if (s.kind === 'write') steps.push({ id: 'owner-after', label: 'Independently observe the owner’s state after the attempt', phase: 'verify', effect: 'read', request: request('owner', 'GET', s.readPath), captures: [], checks: [] });
  if (s.cleanup) steps.push({ id: 'cleanup', label: 'Remove only the resource created in this run', phase: 'cleanup', effect: 'write', request: request('owner', 'DELETE', s.cleanupPath ?? s.readPath, { headers: ownerHeaders }), captures: [], checks: [] });
  const spec = caseSchema.parse({
    schemaVersion: 1, id: caseId, revision: 1, title: s.title, description: 'Created with the guided authoring workflow. Review the declared access policy, endpoint mappings and observed relationships before running.', policy: { statement: s.policy, acknowledged: false },
    origins: [{ id: 'api', label: 'Application API' }],
    actors: [{ id: 'owner', label: 'Resource owner', color: '#43d9bc' }, { id: 'researcher', label: 'Researcher', color: '#a99bff' }].map(actor => ({ ...actor, ...(s.expectedRole ? { expectedRole: s.expectedRole } : {}), identity: { origin: 'api', path: s.identityPath, idPointer: s.idPointer, ...(s.tenantPointer ? { tenantPointer: s.tenantPointer } : {}), ...(s.rolePointer ? { rolePointer: s.rolePointer } : {}) } })),
    preconditions: [{ id: 'different-accounts', label: 'The two live identities are different', op: 'neq', left: ref('actors.owner.id'), right: ref('actors.researcher.id') }, ...(s.boundary === 'cross_tenant' ? [{ id: 'different-tenants', label: 'The live accounts belong to different tenants', op: 'neq', left: ref('actors.owner.tenant'), right: ref('actors.researcher.tenant') }] : [])],
    resources: [{ id: 'resource', label: 'Controlled resource', ownerActor: 'owner', createdBy: 'create-resource', idRef: 'captures.resourceId', ownerRef: 'captures.resourceOwner', ...(s.tenantResponsePointer ? { tenantRef: 'captures.resourceTenant' } : {}) }], steps,
    witness: { success: [{ id: 'fresh-evidence', label: s.kind === 'read' ? 'Other account receives this run’s fresh marker' : 'Owner independently observes the other account’s controlled change', op: 'eq', left: referenceForPointer(s.kind === 'read' ? 'probe' : 'owner-after', s.kind === 'read' ? s.markerResponsePointer : s.writeResponsePointer), right: ref('run.marker') }], rejection: [{ id: 'explicit-denial', label: 'The API explicitly denies the unauthorized attempt', op: 'in', left: ref('steps.probe.status'), right: s.deniedStatuses }], ...(s.kind === 'write' ? { writeProof: { resource: 'resource', probe: 'probe', before: 'owner-read', after: 'owner-after', fieldPointer: s.writeResponsePointer, mutationPointer: s.writeMutationPointer } } : {}) },
  });
  return { case: spec, issues: validateCase(spec) };
}
