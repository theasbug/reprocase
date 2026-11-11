import { caseSchema, type CaseSpec, type HttpRequestSpec } from './schema.ts';
const ref = ($ref: string) => ({ $ref });
const req = (actor: string, method: HttpRequestSpec['method'], path: string, extra: Partial<HttpRequestSpec> = {}) => ({ actor, origin: 'api', method, path, pathParams: {}, query: {}, headers: {}, ...extra });
export function createExampleCase(id = 'cross-tenant-document'): CaseSpec {
  return caseSchema.parse({
    schemaVersion: 1, id, revision: 1, title: 'Cross-tenant private document access',
    description: 'Recreate a private document under its owner, then check whether a verified member of a different tenant can read its fresh marker. All identities and resource IDs are rebound at run time.',
    policy: { statement: 'A private document is readable only by its owner. A member of another tenant must receive 403 or 404.', acknowledged: true },
    actors: [
      { id: 'owner', label: 'Resource owner', color: '#43d9bc', expectedRole: 'member', identity: { origin: 'api', path: '/me', idPointer: '/id', tenantPointer: '/tenant', rolePointer: '/role' } },
      { id: 'researcher', label: 'Researcher', color: '#a99bff', expectedRole: 'member', identity: { origin: 'api', path: '/me', idPointer: '/id', tenantPointer: '/tenant', rolePointer: '/role' } },
    ],
    origins: [{ id: 'api', label: 'Application API' }],
    preconditions: [
      { id: 'distinct-accounts', label: 'The two accounts are different', op: 'neq', left: ref('actors.owner.id'), right: ref('actors.researcher.id') },
      { id: 'distinct-tenants', label: 'The accounts belong to different tenants', op: 'neq', left: ref('actors.owner.tenant'), right: ref('actors.researcher.tenant') },
    ],
    resources: [{ id: 'document', label: 'Private document', ownerActor: 'owner', createdBy: 'create-document', idRef: 'captures.documentId', ownerRef: 'captures.documentOwner', tenantRef: 'captures.documentTenant' }],
    steps: [
      { id: 'csrf', label: 'Get the owner’s current CSRF token', phase: 'prepare', effect: 'read', request: req('owner', 'GET', '/csrf'), captures: [{ name: 'ownerCsrf', from: 'body', pointer: '/csrf' }], checks: [] },
      { id: 'create-document', label: 'Create a fresh private document', phase: 'prepare', effect: 'write', request: req('owner', 'POST', '/documents', { headers: { 'x-csrf-token': ref('captures.ownerCsrf') }, body: { title: 'ReproCase controlled test document', marker: ref('run.marker') } }), captures: [{ name: 'documentId', from: 'body', pointer: '/id' }, { name: 'documentOwner', from: 'body', pointer: '/ownerId' }, { name: 'documentTenant', from: 'body', pointer: '/tenant' }], checks: [{ id: 'private-document', label: 'The new document is private', op: 'eq', left: ref('steps.create-document.body.visibility'), right: 'private' }] },
      { id: 'owner-read', label: 'Confirm the owner can read the marker', phase: 'prepare', effect: 'read', request: req('owner', 'GET', '/documents/{document}', { pathParams: { document: ref('captures.documentId') } }), captures: [], checks: [{ id: 'owner-marker', label: 'Owner reads this run’s marker', op: 'eq', left: ref('steps.owner-read.body.marker'), right: ref('run.marker') }] },
      { id: 'cross-tenant-read', label: 'Read the same document as the other tenant', phase: 'probe', effect: 'read', request: req('researcher', 'GET', '/documents/{document}', { pathParams: { document: ref('captures.documentId') } }), captures: [], checks: [] },
      { id: 'remove-document', label: 'Remove the document created by this run', phase: 'cleanup', effect: 'write', request: req('owner', 'DELETE', '/documents/{document}', { pathParams: { document: ref('captures.documentId') }, headers: { 'x-csrf-token': ref('captures.ownerCsrf') } }), captures: [], checks: [] },
    ],
    witness: {
      success: [{ id: 'fresh-marker-leaked', label: 'Other tenant reads this run’s exact marker', op: 'eq', left: ref('steps.cross-tenant-read.body.marker'), right: ref('run.marker') }, { id: 'owner-preserved', label: 'Returned resource still belongs to the owner', op: 'eq', left: ref('steps.cross-tenant-read.body.ownerId'), right: ref('actors.owner.id') }],
      rejection: [{ id: 'access-denied', label: 'The API explicitly denies access', op: 'in', left: ref('steps.cross-tenant-read.status'), right: [403, 404] }],
    },
  });
}

/** A write witness needs a real owner-observed before/after transition, not a reflected response. */
export function createWriteExampleCase(id = 'cross-tenant-document-write'): CaseSpec {
  const spec = createExampleCase(id);
  spec.title = 'Cross-tenant private document modification';
  spec.description = 'Create a private document, observe its original title as owner, mutate it using another tenant, then independently read its title again as owner.';
  spec.policy.statement = 'Only the owner can modify a private document. A member of another tenant must receive 403 or 404, and the original title must remain unchanged.';
  const probeIndex = spec.steps.findIndex(s => s.phase === 'probe');
  spec.steps.splice(probeIndex, 0, { id: 'researcher-csrf', label: 'Get the researcher’s current CSRF token', phase: 'prepare', effect: 'read', request: req('researcher', 'GET', '/csrf'), captures: [{ name: 'researcherCsrf', from: 'body', pointer: '/csrf' }], checks: [] });
  const probe = spec.steps.find(s => s.id === 'cross-tenant-read')!;
  probe.id = 'cross-tenant-write'; probe.label = 'Attempt to change the title as the other tenant'; probe.effect = 'write';
  probe.request = req('researcher', 'PATCH', '/documents/{document}', { pathParams: { document: ref('captures.documentId') }, headers: { 'x-csrf-token': ref('captures.researcherCsrf') }, body: { title: ref('run.marker') } });
  spec.steps.splice(spec.steps.indexOf(probe) + 1, 0, { id: 'owner-read-after', label: 'Independently observe the title as the owner', phase: 'verify', effect: 'read', request: req('owner', 'GET', '/documents/{document}', { pathParams: { document: ref('captures.documentId') } }), captures: [], checks: [] });
  spec.witness = {
    success: [{ id: 'write-observed', label: 'Owner observes the other actor’s new marker in the title', op: 'eq', left: ref('steps.owner-read-after.body.title'), right: ref('run.marker') }],
    rejection: [{ id: 'write-denied', label: 'The API explicitly denies modification', op: 'in', left: ref('steps.cross-tenant-write.status'), right: [403, 404] }],
    writeProof: { resource: 'document', probe: 'cross-tenant-write', before: 'owner-read', after: 'owner-read-after', fieldPointer: '/title', mutationPointer: '/title' },
  };
  return caseSchema.parse(spec);
}
