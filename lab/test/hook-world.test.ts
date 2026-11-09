import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stillwatchPaths } from '@stillwatch/schema';
import { deliverHookPayload, installHookScript, runHookScript } from '../src/hook';
import type { HookPayload, World } from '../src/types';
import { applyEffect, createWorld, git, prepareWorld, removeWorld, worldEnv } from '../src/world';
import { makeSpoolDirs, minimalHookScript } from './helpers';

let world: World;

beforeEach(async () => {
  world = await createWorld('unit');
});

afterEach(async () => {
  await removeWorld(world);
});

const payload: HookPayload = {
  session_id: 's1',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: "echo 'quoted' $HOME `x`" },
};

describe('hook payload writer', () => {
  it('sends the payload through the hook script into spool/new', async () => {
    await makeSpoolDirs(world.stillwatchHome);
    const script = await installHookScript(
      world.stillwatchHome,
      minimalHookScript(world.stillwatchHome),
    );
    expect((await stat(script)).mode & 0o777).toBe(0o700);
    const name = await deliverHookPayload({
      scriptPath: script,
      stillwatchHome: world.stillwatchHome,
      env: worldEnv(world),
      event: 'PreToolUse',
      payload,
    });
    expect(name).toMatch(/^claude-code\.PreToolUse\.[A-Za-z0-9]{10}$/);
    const spoolNew = stillwatchPaths(world.stillwatchHome).spoolNew;
    expect(JSON.parse(await readFile(join(spoolNew, name), 'utf8'))).toEqual(payload);
    expect(await readdir(stillwatchPaths(world.stillwatchHome).spoolTmp)).toEqual([]);
  });

  it('fails when the hook writes to stdout, exits non-zero, or spools nothing', async () => {
    await makeSpoolDirs(world.stillwatchHome);
    const deliver = async (source: string): Promise<string> => {
      const script = await installHookScript(world.stillwatchHome, source);
      return deliverHookPayload({
        scriptPath: script,
        stillwatchHome: world.stillwatchHome,
        env: worldEnv(world),
        event: 'Stop',
        payload: { ...payload, hook_event_name: 'Stop' },
      });
    };
    await expect(deliver('echo hi\n')).rejects.toThrow(/stdout/);
    await expect(deliver('exit 2\n')).rejects.toThrow(/exited with 2/);
    await expect(deliver('cat >/dev/null\nexit 0\n')).rejects.toThrow(/exactly one Stop/);
  });

  it('passes agent and event as arguments, never through a shell', async () => {
    const script = join(world.root, 'args.sh');
    await writeFile(script, 'printf "%s|%s" "$1" "$2" >&2\n');
    const run = await runHookScript(script, 'claude-code', 'Stop; rm -rf x', '', worldEnv(world));
    expect(run.stderr).toBe('claude-code|Stop; rm -rf x');
    expect(run.code).toBe(0);
  });
});

describe('world and file effects', () => {
  it('uses a temp HOME and never the real one', () => {
    expect(worldEnv(world).HOME).toBe(world.home);
    expect(world.stillwatchHome).toBe(join(world.home, '.stillwatch'));
    expect(world.repo.startsWith(world.root)).toBe(true);
  });

  it('applies write, append, chmod, json, and delete', async () => {
    const file = join(world.home, 'a', 'b.txt');
    await applyEffect(world, { kind: 'write', path: file, content: 'one\n', mode: 0o600 });
    await applyEffect(world, { kind: 'append', path: file, content: 'two\n' });
    expect(await readFile(file, 'utf8')).toBe('one\ntwo\n');
    await applyEffect(world, { kind: 'chmod', path: file, mode: 0o755 });
    expect((await stat(file)).mode & 0o777).toBe(0o755);

    const json = join(world.home, 'c.json');
    await writeFile(json, '{"a":1,"b":2}', { mode: 0o600 });
    await applyEffect(world, { kind: 'json', path: json, set: { b: 3 } });
    expect(JSON.parse(await readFile(json, 'utf8'))).toEqual({ a: 1, b: 3 });
    expect((await stat(json)).mode & 0o777).toBe(0o600);

    await applyEffect(world, { kind: 'delete', path: file });
    await expect(stat(file)).rejects.toThrow();
  });

  it('refuses paths outside the temp root', async () => {
    await expect(
      applyEffect(world, { kind: 'write', path: '/tmp/../etc/stillwatch-lab', content: 'x' }),
    ).rejects.toThrow(/outside/);
    await expect(
      applyEffect(world, { kind: 'append', path: `${world.root}/../escape`, content: 'x' }),
    ).rejects.toThrow(/outside/);
  });

  it('prepares a committed repo with ignored files left untracked, and commits changes', async () => {
    await prepareWorld(world, [
      { kind: 'write', path: join(world.repo, '.env'), content: 'X=1\n' },
      { kind: 'write', path: join(world.repo, 'docs.md'), content: 'docs\n' },
    ]);
    expect(await git(world, world.repo, ['status', '--porcelain'])).toBe('');
    expect(await git(world, world.repo, ['ls-files'])).toContain('docs.md');
    expect(await git(world, world.repo, ['ls-files'])).not.toContain('.env');

    await writeFile(join(world.repo, 'new.js'), 'x\n');
    await applyEffect(world, { kind: 'commit', repo: world.repo, message: 'Add', paths: null });
    expect(await git(world, world.repo, ['log', '--format=%s'])).toBe('Add\nInitial commit\n');
  });

  it('never runs planted git hooks when committing', async () => {
    await prepareWorld(world, []);
    const marker = join(world.root, 'hook-ran');
    await applyEffect(world, {
      kind: 'write',
      path: join(world.repo, '.git/hooks/pre-commit'),
      content: `#!/bin/sh\ntouch '${marker}'\n`,
      mode: 0o755,
    });
    await writeFile(join(world.repo, 'x.js'), 'x\n');
    await applyEffect(world, { kind: 'commit', repo: world.repo, message: 'X', paths: null });
    await expect(stat(marker)).rejects.toThrow();
  });
});
