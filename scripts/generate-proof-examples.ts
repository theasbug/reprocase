import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from '../apps/server/src/server.ts';
import { startProofApi } from '../tests/fixtures/proof-api.ts';
import { exportPackage, requestSchema, sessionCase, type CaseSpec } from '../packages/core/src/index.ts';

const write = (name: string, spec: CaseSpec) => { mkdirSync('templates', { recursive: true }); writeFileSync(`templates/${name}.reprocase.json`, JSON.stringify(exportPackage({ ...spec, id: name, policy: { ...spec.policy, acknowledged: false } }), null, 2) + '\n'); };
const identity = { path: '/me', idPointer: '/id', tenantPointer: '/tenant', sameTenant: true, rolePointer: '/role', roles: ['admin', 'member'] as [string, string] };
const req = requestSchema.parse({ actor: 'owner', origin: 'api', method: 'GET', path: '/admin/report' });
write('quick-role-read-v2', sessionCase('quick-role-read-v2', 'function_read', req, identity, '/confidential'));
write('quick-cors-read-v2', sessionCase('quick-cors-read-v2', 'cors_read', { ...req, path: '/private' }, identity, '/privateNote'));
const lab = await startProofApi(); const server = await createServer({ memory: true, port: 0 });
try {
  const qp = server.service.quickproof, { id } = qp.start(lab.origin);
  await qp.connect(id, { actor: 'owner', token: 'alice' }); await qp.connect(id, { actor: 'researcher', token: 'bob' }); await qp.detectIdentity(id);
  const observed = await qp.observe(id, { create: 'POST /documents\n\n{"text":"before"}', vulnerable: 'PATCH /documents/42\n\n{"text":"after"}' });
  if (observed.status !== 'ready') throw new Error('Example learning failed');
  write('quick-write-v2', observed.case);
} finally { await server.close(); await lab.close(); }
