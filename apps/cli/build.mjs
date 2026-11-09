// Bundles the CLI, collector, lab, and all internal packages into one file
// with zero runtime dependencies, and copies the built dashboard next to it.
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
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
  await writeNotices();
} catch {
  process.stderr.write('build: apps/web/dist not found; the dashboard will not be bundled\n');
}

/**
 * The dashboard bundle includes React, React DOM, and the scheduler they use,
 * with their license comments minified away. Their licenses ask for the
 * notice to ship with the code, so collect it in one file next to the bundle.
 * The CLI bundle itself contains only Stillwatch code and Node built-ins.
 */
async function writeNotices() {
  const fromWeb = createRequire(new URL('../web/package.json', import.meta.url));
  const reactDom = fromWeb.resolve('react-dom/package.json');
  const packages = [
    fromWeb.resolve('react/package.json'),
    reactDom,
    createRequire(reactDom).resolve('scheduler/package.json'),
  ];
  const sections = [];
  for (const manifest of packages) {
    const { name, version, license } = JSON.parse(await readFile(manifest, 'utf8'));
    const text = await readFile(`${dirname(manifest)}/LICENSE`, 'utf8');
    sections.push(`## ${name} ${version} (${license})\n\n${text.trim()}\n`);
  }
  const header =
    '# Third-party notices\n\nThe Stillwatch dashboard (`web/`) includes the following open source packages.\n';
  await writeFile(`${here}dist/THIRD_PARTY_NOTICES.md`, `${header}\n${sections.join('\n')}`);
}
