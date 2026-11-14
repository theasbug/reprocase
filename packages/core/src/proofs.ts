import { caseSchema, requestSchema, type CaseSpec, type HttpRequestSpec, type Json } from './schema.ts';
import { equal, jsonPointer } from './values.ts';
import { scalarFields, templatePath, type IdentityGuess, type ParsedRequest } from './quickproof.ts';

export type QuickProofKind = 'authorization' | 'role' | 'cors_read';
export const runRef = { $ref: 'run.marker' };
export const resourceRef = { $ref: 'captures.resourceId' };
const blocked = /password|secret|token|cookie|credential|authorization|csrf|xsrf|owner|tenant|role|permission|(?:^|[_-])id(?:$|[_-])/i;
const escape = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
export function setPointer(body: unknown, pointer: string, value: unknown): any {
  const out = structuredClone(body), parts = pointer.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  if (!pointer.startsWith('/') || parts.some(p => ['__proto__', 'constructor', 'prototype'].includes(p))) throw new Error('Unsafe field pointer');
  let node: any = out;
  for (const key of parts.slice(0, -1)) { if (!node || typeof node !== 'object' || !Object.hasOwn(node, key)) throw new Error('Field not found'); node = node[key]; }
  if (!node || typeof node !== 'object') throw new Error('Field not found');
  node[parts.at(-1)!] = value; return out;
}
export function editableFields(body: unknown, prefix = '', depth = 0): { pointer: string; value: string | number | boolean; key: string }[] {
  if (!body || typeof body !== 'object' || depth > 5) return [];
  return Object.entries(body).slice(0, 100).flatMap(([key, value]) => {
    if (blocked.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) return [];
    const pointer = `${prefix}/${escape(key)}`;
    if (['string', 'number', 'boolean'].includes(typeof value)) return [{ pointer, key, value: value as string | number | boolean }];
    return editableFields(value, pointer, depth + 1);
  }).slice(0, 200);
}
/** The sample ID is replaced only at observed identifier locations; no original object is mutated. */
export function bindResource(parsed: ParsedRequest, actor = 'researcher'): { request: HttpRequestSpec; sampleId: string } | undefined {
  const template = templatePath(parsed.path);
  const request = requestSchema.parse({ actor, origin: 'api', method: parsed.method, path: parsed.path, query: parsed.query ?? {}, contentType: parsed.contentType, body: parsed.body });
  let sampleId = template?.sampleId;
  if (!sampleId) {
    const candidates: string[] = [];
    const collect = (value: unknown, depth = 0) => { if (!value || typeof value !== 'object' || depth > 5) return; for (const [key, v] of Object.entries(value)) { if (/^(?:id|uuid|uid|guid|(?:[a-z]+[_-])?(?:id|uuid|uid))$/i.test(key) && ['string', 'number'].includes(typeof v)) candidates.push(String(v)); else collect(v, depth + 1); } };
    collect(parsed.query); collect(parsed.body);
    if (new Set(candidates).size > 1) return undefined;
  }
  if (template) { request.path = template.readPath; request.pathParams = { resource: resourceRef }; }
  const idKey = /^(?:id|uuid|uid|guid|(?:[a-z]+[_-])?(?:id|uuid|uid))$/i;
  for (const [key, value] of Object.entries(request.query)) if (idKey.test(key) && ['string', 'number'].includes(typeof value) && (!sampleId || String(value) === sampleId)) { sampleId ??= String(value); request.query[key] = resourceRef; }
  const walk = (body: any, path = '', depth = 0) => {
    if (!body || typeof body !== 'object' || depth > 5) return;
    for (const [key, value] of Object.entries(body)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe body field');
      const pointer = `${path}/${escape(key)}`;
      if (idKey.test(key) && ['string', 'number'].includes(typeof value) && (!sampleId || String(value) === sampleId)) { sampleId ??= String(value); request.body = setPointer(request.body, pointer, resourceRef); }
      else if (value && typeof value === 'object') walk(value, pointer, depth + 1);
    }
  };
  walk(parsed.body);
  return sampleId ? { request, sampleId } : undefined;
}
export function rolePreconditions(spec: CaseSpec, identity: IdentityGuess & { rolePointer?: string; roles?: [string, string] }) {
  if (!identity.rolePointer || !identity.roles || identity.roles[0] === identity.roles[1]) throw new Error('Two different live roles are required. Pick the role field.');
  if (identity.tenantPointer && !identity.sameTenant) throw new Error('Role tests require accounts in the same organization.');
  for (const [i, actor] of spec.actors.entries()) { actor.expectedRole = identity.roles[i]; actor.identity.rolePointer = identity.rolePointer; }
  spec.preconditions = spec.preconditions.filter(c => c.id !== 'different-tenants');
  spec.preconditions.push({ id: 'different-roles', label: 'The observed roles are different', op: 'neq', left: { $ref: 'actors.owner.role' }, right: { $ref: 'actors.researcher.role' } });
  if (identity.tenantPointer) spec.preconditions.push({ id: 'same-tenant', label: 'The live accounts belong to the same organization', op: 'eq', left: { $ref: 'actors.owner.tenant' }, right: { $ref: 'actors.researcher.tenant' } });
}
/** Pick a live private scalar, excluding unstable metadata and credential fields. */
export function privateFields(authenticated: unknown, anonymous: unknown) {
  return scalarFields(authenticated, 5, 400, true).filter(f => !/time|timestamp|request.?id|trace|nonce|csrf|password|token|secret|cookie|credential/i.test(f.pointer) && String(f.value).length >= 4 && !equal(f.value, jsonPointer(anonymous, f.pointer)));
}
export function sessionCase(id: string, kind: 'function_read' | 'cors_read', request: HttpRequestSpec, identity: IdentityGuess & { rolePointer?: string; roles?: [string, string] }, fieldPointer: string): CaseSpec {
  const actors = (kind === 'cors_read' ? ['owner'] : ['owner', 'researcher']).map((actor, i) => ({ id: actor, label: i ? 'Lower-privileged account' : 'Authorized account', color: i ? '#a99bff' : '#43d9bc', identity: { origin: 'api', path: identity.path, idPointer: identity.idPointer, ...(identity.tenantPointer ? { tenantPointer: identity.tenantPointer } : {}) } }));
  const spec = caseSchema.parse({ schemaVersion: 2, kind, boundary: kind === 'function_read' ? 'role' : 'object', id, revision: 1, title: `${kind === 'cors_read' ? 'CORS private read' : 'Role-restricted read'}: ${request.path}`, policy: { statement: kind === 'cors_read' ? 'An untrusted origin must not read this account-only response.' : 'Account A may perform this operation; account B must be denied.', acknowledged: false }, actors, origins: [{ id: 'api', label: 'Application API' }], resources: [], preconditions: kind === 'function_read' ? [{ id: 'different-accounts', label: 'The accounts are different', op: 'neq', left: { $ref: 'actors.owner.id' }, right: { $ref: 'actors.researcher.id' } }] : [], steps: [{ id: 'private-read', label: 'Verify private response access', phase: 'probe', effect: 'read', request, captures: [], checks: [] }], witness: { success: [], rejection: [] }, sessionProof: { request, fieldPointer } });
  if (kind === 'function_read') rolePreconditions(spec, identity);
  return spec;
}
