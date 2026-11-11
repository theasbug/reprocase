import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createExampleCase } from '../packages/core/src/example.ts';
import { exportPackage } from '../packages/core/src/export.ts';

const folder = new URL('../examples/', import.meta.url);
await mkdir(folder, { recursive: true });
const path = new URL('cross-tenant.reprocase.json', folder);
await writeFile(path, `${JSON.stringify(exportPackage(createExampleCase()), null, 2)}\n`, 'utf8');
console.log(`Wrote ${fileURLToPath(path)}`);
