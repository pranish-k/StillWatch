import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
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
    // The baseline does only the work the hook cannot avoid, the same way the
    // hook does it on this shell: create a file in tmp, copy stdin into it, and
    // move it into new. Shells without $RANDOM (dash, the /bin/sh on Debian and
    // Ubuntu) need mktemp for the name.
    const hasRandom = execFileSync('/bin/sh', ['-c', 'printf %s "${RANDOM:-}"']).length > 0;
    const tmp = join(root, 'base-tmp');
    const dest = join(root, 'base-new');
    await mkdir(tmp);
    await mkdir(dest);
    const create = hasRandom ? `t="${tmp}/b.$$"; : >"$t"` : `t=$(mktemp "${tmp}/b.XXXXXXXXXX")`;
    baseline = join(root, 'baseline.sh');
    await writeFile(baseline, `${create}\ncat >"$t"\nmv -f "$t" "${dest}/"\n`, { mode: 0o700 });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  // Starting /bin/sh costs 5-8 ms on a laptop and two or three times that on
  // a busy CI runner, and load slows the hook's own work by the same factor, so
  // an absolute budget measures the machine. Against a script doing the same
  // unavoidable work, the hook measures 1.01-1.05 on bash and dash, idle or
  // loaded. Each extra subprocess adds about 0.22, so two of them, or starting
  // Node, fail the limit. The 20th percentile ignores scheduler hiccups.
  it('costs little more than the file work it must do', async () => {
    const bases: number[] = [];
    const hooks: number[] = [];
    for (let i = 0; i < 50; i++) {
      bases.push(await timeScript(baseline, '{"a":1}'));
      hooks.push(await timeScript(script, '{"a":1}'));
    }
    expect(p20(hooks) / p20(bases)).toBeLessThan(1.3);
    expect(await readdir(join(home, 'spool', 'new'))).toHaveLength(50);
  });
});
