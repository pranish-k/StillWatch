import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureDataDirs } from '../src/config';
import { renderHookScript } from '../src/hook-script';

/** Wall time of one hook run as an agent sees it: spawn, write stdin, wait for exit. */
function timeHook(script: string, input: string): Promise<number> {
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

describe('hook script performance', () => {
  let root: string;
  let home: string;
  let script: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'sw-hook-perf-'));
    home = join(root, 'sw');
    await ensureDataDirs(home);
    script = join(home, 'bin', 'hook.sh');
    await writeFile(
      script,
      renderHookScript({ stillwatchHome: home, nodePath: '/nonexistent/node', cliPath: '/x' }),
      {
        mode: 0o700,
      },
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('runs in under 15 ms median', async () => {
    const times: number[] = [];
    for (let i = 0; i < 50; i++) times.push(await timeHook(script, '{"a":1}'));
    times.sort((a, b) => a - b);
    expect(times[25]).toBeLessThan(15);
    expect(await readdir(join(home, 'spool', 'new'))).toHaveLength(50);
  });
});
