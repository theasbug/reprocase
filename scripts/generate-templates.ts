// Regenerates the built-in templates in templates/ from the example packages.
// Run: npx tsx scripts/generate-templates.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { makeTemplate, packageSchema, templateSchema } from '../packages/core/src/index.ts';

const sources = [
  { file: 'examples/cross-tenant.reprocase.json', id: 'cross-tenant-object-read', name: 'Cross-tenant object read (REST)', appliesTo: 'REST APIs with per-tenant objects: create as A, read by ID as B', tags: ['idor', 'bola', 'read', 'multi-tenant'] },
  { file: 'examples/cross-tenant-write.reprocase.json', id: 'cross-tenant-object-write', name: 'Cross-tenant object write (REST)', appliesTo: 'REST APIs where B can change A’s object by ID; the owner confirms the change', tags: ['idor', 'bola', 'write', 'multi-tenant'] },
];
for (const source of sources) {
  const pack = packageSchema.parse(JSON.parse(readFileSync(source.file, 'utf8')));
  const made = makeTemplate(pack.case, { name: source.name, description: pack.case.description, appliesTo: source.appliesTo, tags: source.tags });
  const template = templateSchema.parse({ ...made, id: source.id, createdAt: '2026-11-15T00:00:00.000Z' });
  writeFileSync(`templates/${source.id}.json`, JSON.stringify(template, null, 2) + '\n');
  console.log('wrote', source.id);
}
