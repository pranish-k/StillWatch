/** Test helpers: isolated git configuration and temporary repositories. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';
import { takeSnapshot, type SnapshotOptions } from '../src/index';

const created: string[] = [];

/** A fresh real (symlink-resolved) temporary directory, removed after the file's tests. */
export function tempDir(prefix = 'sw-git-'): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

/** Points git at an empty global config and no system config, and HOME at a temp dir. */
export function isolateGit(): void {
  beforeAll(() => {
    const home = tempDir('sw-home-');
    const globalConfig = join(home, 'gitconfig');
    writeFileSync(globalConfig, '');
    process.env.HOME = home;
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
  });
  afterAll(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
}

/** Runs git with a fixed identity and returns trimmed stdout. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', ...args],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}

export function write(root: string, rel: string, content: string): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/** A repository on branch main with the given files committed (none: unborn). */
export function makeRepo(files: Record<string, string> = { 'README.md': 'hello\n' }): string {
  const root = tempDir();
  git(root, 'init', '-q', '-b', 'main');
  for (const [rel, content] of Object.entries(files)) write(root, rel, content);
  if (Object.keys(files).length > 0) {
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'initial');
  }
  return root;
}

export function snapshot(
  cwd: string,
  options: Partial<SnapshotOptions> = {},
): ReturnType<typeof takeSnapshot> {
  return takeSnapshot({
    sessionId: 'session-1',
    kind: 'start',
    cwd,
    surface: [],
    repoSurface: [],
    ...options,
  });
}
