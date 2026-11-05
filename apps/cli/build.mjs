// Bundles the CLI, collector, lab, and all internal packages into one file
// with zero runtime dependencies, and copies the built dashboard next to it.
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));

await rm(`${here}dist`, { recursive: true, force: true });
await build({
  entryPoints: [`${here}src/bin.ts`],
  outfile: `${here}dist/stillwatch.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22.13',
  banner: { js: '#!/usr/bin/env node' },
  define: { __STILLWATCH_VERSION__: JSON.stringify(pkg.version) },
  legalComments: 'none',
  logLevel: 'warning',
});

const webDist = fileURLToPath(new URL('../web/dist/', import.meta.url));
try {
  await stat(`${webDist}index.html`);
  await mkdir(`${here}dist/web`, { recursive: true });
  await cp(webDist, `${here}dist/web`, { recursive: true });
} catch {
  process.stderr.write('build: apps/web/dist not found; the dashboard will not be bundled\n');
}
