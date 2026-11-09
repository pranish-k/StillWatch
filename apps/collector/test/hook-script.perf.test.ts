import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureDataDirs } from '../src/config';
import { renderHookScript } from '../src/hook-script';

/** Wall time of one script run as an agent sees it: spawn, write stdin, wait for exit. */
function timeScript(script: string, input: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn('/bin/sh', [script, 'claude-code', 'PreToolUse'], {
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.on('error', reject);
    child.on('close', () => resolve(performance.now() - started));
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

function p20(times: number[]): number {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 5)] ?? Number.POSITIVE_INFINITY;
}

describe('hook script performance', () => {
  let root: string;
  let home: string;
  let script: string;
  let baseline: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sw-hook-perf-'));
    home = join(root, 'sw');
    await ensureDataDirs(home);
    script = join(home, 'bin', 'hook.sh');
    await writeFile(
      script,
      renderHookScript({ stillwatchHome: home, nodePath: '/nonexistent/node', cliPath: '/x' }),
      { mode: 0o700 },
    );
    // The same process launches the hook needs on this shell: cat, mv, and
    // mktemp when the shell has no $RANDOM (dash, the /bin/sh on Debian and
    // Ubuntu). true stands in for mv and mktemp.
    const hasRandom = execFileSync('/bin/sh', ['-c', 'printf %s "${RANDOM:-}"']).length > 0;
    const launches = hasRandom ? 'cat >/dev/null; true' : 'cat >/dev/null; true; true';
    baseline = join(root, 'baseline.sh');
    await writeFile(baseline, `${launches.replaceAll('true', '/usr/bin/true')}\n`, { mode: 0o700 });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // Starting /bin/sh costs 5-8 ms on a laptop and two or three times that on
  // a busy CI runner, and load slows the hook's own work by the same factor, so
  // an absolute budget measures the machine. A baseline script that starts the
  // same processes the hook needs runs at about 1.08 of the hook's time from
  // idle and 1.26 heavily loaded, on bash and on dash. Each extra subprocess
  // in the hook adds about 0.25, and starting Node in the foreground far more.
  // The 20th percentile ignores runs that a scheduler hiccup slowed.
  it('costs no more than the processes it starts', async () => {
    const bases: number[] = [];
    const hooks: number[] = [];
    for (let i = 0; i < 50; i++) {
      bases.push(await timeScript(baseline, '{"a":1}'));
      hooks.push(await timeScript(script, '{"a":1}'));
    }
    expect(p20(hooks) / p20(bases)).toBeLessThan(1.5);
    expect(await readdir(join(home, 'spool', 'new'))).toHaveLength(50);
  });
});
