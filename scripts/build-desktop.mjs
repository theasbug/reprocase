import { build } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
mkdirSync(new URL('../desktop/dist', import.meta.url), { recursive: true });
await build({ entryPoints: ['desktop/src/main.ts'], outfile: 'desktop/dist/main.mjs', platform: 'node', format: 'esm', target: 'node24', bundle: true, sourcemap: true, external: ['electron', 'vite', ...Object.keys(pkg.dependencies)], banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
console.log('Built ReproCase desktop main process');
