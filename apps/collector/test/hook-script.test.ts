import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSpoolName } from '@stillwatch/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureDataDirs } from '../src/config';
import { renderHookScript } from '../src/hook-script';

type RunResult = { code: number | null; stdout: string; stderr: string; ms: number };

function runHook(script: string, args: string[], input: Buffer | string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn('/bin/sh', [script, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, stdout, stderr, ms: performance.now() - started });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

describe('renderHookScript', () => {
  let root: string;
  let home: string;
  let script: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sw hook '"));
    home = join(root, "data dir 'q'");
    await ensureDataDirs(home);
    script = join(home, 'bin', 'hook.sh');
    await writeFile(
      script,
      renderHookScript({ stillwatchHome: home, nodePath: '/nonexistent/node', cliPath: '/x' }),
      { mode: 0o700 },
    );
  });

  afterEach(async () => {
    await chmod(join(home, 'spool', 'tmp'), 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  });

  async function spooled(): Promise<string[]> {
    return readdir(join(home, 'spool', 'new'));
  }

  it('moves the exact payload into spool/new with a valid name and mode 0600', async () => {
    const payload = Buffer.from('{"session_id":"s1","x":"é\\n"}\n\u0000tail', 'utf8');
    const result = await runHook(script, ['claude-code', 'PreToolUse'], payload);
    expect(result).toMatchObject({ code: 0, stdout: '', stderr: '' });
    const names = await spooled();
    expect(names).toHaveLength(1);
    const name = names[0]!;
    expect(parseSpoolName(name)).toMatchObject({ agent: 'claude-code', eventHint: 'PreToolUse' });
    const file = join(home, 'spool', 'new', name);
    expect((await readFile(file)).equals(payload)).toBe(true);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readdir(join(home, 'spool', 'tmp'))).toEqual([]);
  });

  it('recreates missing spool directories', async () => {
    await rm(join(home, 'spool'), { recursive: true });
    const result = await runHook(script, ['claude-code', 'Stop'], '{}');
    expect(result.code).toBe(0);
    expect(await spooled()).toHaveLength(1);
    expect((await stat(join(home, 'spool', 'new'))).mode & 0o777).toBe(0o700);
  });

  it('exits 0 silently when the spool is not writable', async () => {
    if (process.getuid?.() === 0) return;
    await chmod(join(home, 'spool', 'tmp'), 0o500);
    const result = await runHook(script, ['claude-code', 'Stop'], '{}');
    expect(result).toMatchObject({ code: 0, stdout: '', stderr: '' });
    expect(await spooled()).toEqual([]);
  });

  it('falls back for invalid agent and event arguments', async () => {
    await runHook(script, ['Bad;Agent', 'Pre-Tool/../x'], '{}');
    await runHook(script, [], '{}');
    await runHook(script, ['a'.repeat(40), '9Event'], '{}');
    const names = await spooled();
    expect(names).toHaveLength(3);
    for (const name of names) {
      expect(parseSpoolName(name)).toMatchObject({ agent: 'unknown', eventHint: 'Unknown' });
    }
  });

  it('starts the collector when --ensure-collector finds no live pid', async () => {
    const marker = join(root, 'marker');
    const fakeCli = join(root, "cli 'x'.mjs");
    await writeFile(
      fakeCli,
      `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ args: process.argv.slice(2), home: process.env.STILLWATCH_HOME }));\n`,
    );
    await writeFile(
      script,
      renderHookScript({ stillwatchHome: home, nodePath: process.execPath, cliPath: fakeCli }),
    );
    await writeFile(join(home, 'run', 'collector.pid'), '999999999\n');
    const result = await runHook(
      script,
      ['claude-code', 'SessionStart', '--ensure-collector'],
      '{}',
    );
    expect(result).toMatchObject({ code: 0, stdout: '' });
    const deadline = Date.now() + 5000;
    let text: string | null = null;
    while (Date.now() < deadline && text === null) {
      text = await readFile(marker, 'utf8').catch(() => null);
      if (text === null) await new Promise((r) => setTimeout(r, 25));
    }
    expect(JSON.parse(text ?? 'null')).toEqual({ args: ['start', '--quiet'], home });
  });

  it('does not start the collector when the pid file names a live process', async () => {
    const marker = join(root, 'marker2');
    const fakeCli = join(root, 'cli2.mjs');
    await writeFile(
      fakeCli,
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'x');\n`,
    );
    await writeFile(
      script,
      renderHookScript({ stillwatchHome: home, nodePath: process.execPath, cliPath: fakeCli }),
    );
    await writeFile(join(home, 'run', 'collector.pid'), `${process.pid}\n7391\n`);
    await runHook(script, ['claude-code', 'SessionStart', '--ensure-collector'], '{}');
    await new Promise((r) => setTimeout(r, 300));
    await expect(stat(marker)).rejects.toThrow();
  });

  it('handles a 5 MB payload', async () => {
    const payload = Buffer.alloc(5 * 1024 * 1024, 0x61);
    const result = await runHook(script, ['claude-code', 'PostToolUse'], payload);
    expect(result.code).toBe(0);
    const names = await spooled();
    expect((await stat(join(home, 'spool', 'new', names[0]!))).size).toBe(payload.length);
  });

  it.skipIf(!existsSync('/bin/dash'))(
    'falls back to mktemp in a shell without $RANDOM',
    async () => {
      await mkdir(join(home, 'spool', 'new'), { recursive: true });
      const r = spawnSync('/bin/dash', [script, 'claude-code', 'Stop'], { input: '{"b":2}' });
      expect(r.status).toBe(0);
      const names = await spooled();
      expect(names).toHaveLength(1);
      expect(names[0]).toMatch(/^claude-code\.Stop\.[A-Za-z0-9]{10}$/);
    },
  );
});
