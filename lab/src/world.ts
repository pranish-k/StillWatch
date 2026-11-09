/**
 * Temporary worlds: a temp HOME, a temp STILLWATCH_HOME, and a temp git
 * repository. Git runs through execFile with an empty global config, no
 * system config, and hooks disabled, so nothing outside the world is read or run.
 */
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
  appendFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { dirName, isRecord, isWithin } from '@stillwatch/schema';
import type { FileEffect, World } from './types';

const execFileAsync = promisify(execFile);

export async function createWorld(label: string): Promise<World> {
  const safe = label.replace(/[^a-z0-9-]/g, '-').slice(0, 40);
  const root = await realpath(await mkdtemp(join(tmpdir(), `stillwatch-lab-${safe}-`)));
  const home = join(root, 'home');
  const world: World = {
    root,
    home,
    stillwatchHome: join(home, '.stillwatch'),
    repo: join(home, 'projects', 'demo-app'),
    gitConfig: join(root, 'gitconfig'),
  };
  await mkdir(world.repo, { recursive: true, mode: 0o700 });
  await writeFile(world.gitConfig, '', { mode: 0o600 });
  return world;
}

export async function removeWorld(world: World): Promise<void> {
  await rm(world.root, { recursive: true, force: true });
}

/** Environment for child processes: only the temp HOME, never the real one. */
export function worldEnv(world: World): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: world.home,
    STILLWATCH_HOME: world.stillwatchHome,
    LANG: 'C',
    TMPDIR: world.root,
  };
}

function gitEnv(world: World): Record<string, string> {
  return {
    ...worldEnv(world),
    GIT_CONFIG_GLOBAL: world.gitConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
}

const GIT_SAFE_FLAGS = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'commit.gpgsign=false',
  '-c',
  'user.name=Lab User',
  '-c',
  'user.email=lab@example.invalid',
];

export async function git(world: World, cwd: string, args: string[]): Promise<string> {
  assertInside(world, cwd);
  const { stdout } = await execFileAsync('git', [...GIT_SAFE_FLAGS, ...args], {
    cwd,
    env: gitEnv(world),
    timeout: 20_000,
  });
  return stdout;
}

function assertInside(world: World, path: string): void {
  if (!isWithin(path, world.root))
    throw new Error(`lab refuses to touch a path outside its temp root`);
}

export async function applyEffect(world: World, effect: FileEffect): Promise<void> {
  switch (effect.kind) {
    case 'write':
      assertInside(world, effect.path);
      await mkdir(dirName(effect.path), { recursive: true });
      await writeFile(effect.path, effect.content);
      if (effect.mode !== undefined) await chmod(effect.path, effect.mode);
      return;
    case 'append':
      assertInside(world, effect.path);
      await mkdir(dirName(effect.path), { recursive: true });
      await appendFile(effect.path, effect.content);
      return;
    case 'delete':
      assertInside(world, effect.path);
      await rm(effect.path, { force: true });
      return;
    case 'chmod':
      assertInside(world, effect.path);
      await chmod(effect.path, effect.mode);
      return;
    case 'json': {
      assertInside(world, effect.path);
      const parsed: unknown = JSON.parse(await readFile(effect.path, 'utf8'));
      if (!isRecord(parsed)) throw new Error('json effect: file is not a JSON object');
      const { mode } = await stat(effect.path);
      await writeFile(effect.path, `${JSON.stringify({ ...parsed, ...effect.set }, null, 2)}\n`);
      await chmod(effect.path, mode & 0o777);
      return;
    }
    case 'commit':
      await git(world, effect.repo, ['add', ...(effect.paths ?? ['-A'])]);
      await git(world, effect.repo, ['commit', '-q', '-m', effect.message]);
      return;
  }
}

export const BASE_REPO_FILES: Record<string, string> = {
  'README.md':
    '# demo-app\n\nA small Node.js utility library.\n\n## Development\n\nRun `npm test` to run the tests.\n',
  'package.json': `${JSON.stringify(
    {
      name: 'demo-app',
      version: '1.0.0',
      type: 'module',
      scripts: { test: 'node --test', lint: 'eslint .' },
    },
    null,
    2,
  )}\n`,
  '.gitignore': 'node_modules/\n.env\n',
  'src/index.js': "export { sum, range } from './math.js';\n",
  'src/math.js':
    'export function sum(values) {\n  return values.reduce((a, b) => a + b, 0);\n}\n\nexport function range(n) {\n  const out = [];\n  for (let i = 0; i < n - 1; i++) out.push(i);\n  return out;\n}\n',
  'test/math.test.js':
    "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { sum } from '../src/math.js';\n\ntest('sum', () => {\n  assert.equal(sum([1, 2, 3]), 6);\n});\n",
};

export const BASE_ZSHRC = '# zsh configuration\nexport EDITOR=vim\nalias ll="ls -la"\n';

/** Creates the user's dotfiles and the repository, applies the scenario setup, and commits. */
export async function prepareWorld(world: World, setup: FileEffect[]): Promise<void> {
  await writeFile(join(world.home, '.zshrc'), BASE_ZSHRC);
  await git(world, world.repo, ['init', '-q', '-b', 'main']);
  for (const [rel, content] of Object.entries(BASE_REPO_FILES)) {
    await applyEffect(world, { kind: 'write', path: join(world.repo, rel), content });
  }
  for (const effect of setup) await applyEffect(world, effect);
  await applyEffect(world, {
    kind: 'commit',
    repo: world.repo,
    message: 'Initial commit',
    paths: null,
  });
}
