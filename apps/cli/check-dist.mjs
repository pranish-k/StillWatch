// Runs before `pnpm pack` and `pnpm publish`: refuses to package a build
// that is missing the CLI bundle, the dashboard, or the license notices.
import { stat } from 'node:fs/promises';

const required = ['dist/stillwatch.mjs', 'dist/web/index.html', 'dist/THIRD_PARTY_NOTICES.md'];
const missing = [];
for (const path of required) {
  try {
    await stat(new URL(path, import.meta.url));
  } catch {
    missing.push(path);
  }
}
if (missing.length > 0) {
  process.stderr.write(`Missing ${missing.join(', ')}. Run 'pnpm build' at the repo root first.\n`);
  process.exit(1);
}
