import { createHash } from 'node:crypto';
import { rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRepoRoot, gitVersion } from '../src/index';
import { git, isolateGit, makeRepo, snapshot, tempDir, write } from './helpers';

isolateGit();

describe('takeSnapshot repositories', () => {
  it('records a clean repository', async () => {
    const root = makeRepo();
    const snap = await snapshot(root, { now: () => 1234, late: true });
    expect(snap).toMatchObject({ v: 1, kind: 'start', takenAt: 1234, late: true, cwd: root });
    expect(snap.repos).toEqual([
      {
        root,
        gitCommonDir: join(root, '.git'),
        head: git(root, 'rev-parse', 'HEAD'),
        branch: 'main',
        hooksPath: join(root, '.git', 'hooks'),
        overlay: {},
        overlayTruncated: false,
        error: null,
      },
    ]);
  });

  it('records modified, added, deleted, untracked, and symlinked paths but not ignored ones', async () => {
    const root = makeRepo({ 'a.txt': 'a\n', 'b.txt': 'b\n', '.gitignore': 'ignored.log\n' });
    write(root, 'a.txt', 'changed\n');
    unlinkSync(join(root, 'b.txt'));
    write(root, 'staged.txt', 'staged\n');
    git(root, 'add', 'staged.txt');
    write(root, 'new dir/untracked file.txt', 'u\n');
    write(root, 'ignored.log', 'nope\n');
    symlinkSync('a.txt', join(root, 'link'));
    const snap = await snapshot(join(root, 'new dir'));
    const repo = snap.repos[0]!;
    expect(repo.root).toBe(root);
    expect(Object.keys(repo.overlay)).toEqual([
      'a.txt',
      'b.txt',
      'link',
      'new dir/untracked file.txt',
      'staged.txt',
    ]);
    expect(repo.overlay['a.txt']).toBe(git(root, 'hash-object', 'a.txt'));
    expect(repo.overlay['b.txt']).toBeNull();
    // A symlink's blob is its target text, as git stores it.
    expect(repo.overlay.link).toBe(createHash('sha1').update('blob 5\0a.txt').digest('hex'));
    expect(repo.error).toBeNull();
  });

  it('handles a detached HEAD and an unborn branch', async () => {
    const root = makeRepo();
    git(root, 'checkout', '-q', '--detach');
    const detached = (await snapshot(root)).repos[0]!;
    expect(detached.branch).toBeNull();
    expect(detached.head).toBe(git(root, 'rev-parse', 'HEAD'));

    const unborn = makeRepo({});
    write(unborn, 'first.txt', 'x\n');
    const snap = (await snapshot(unborn)).repos[0]!;
    expect(snap.head).toBeNull();
    expect(snap.branch).toBe('main');
    expect(Object.keys(snap.overlay)).toEqual(['first.txt']);
  });

  it('returns no repository for a plain directory and no error', async () => {
    const dir = tempDir();
    const snap = await snapshot(dir);
    expect(snap.repos).toEqual([]);
    expect(await findRepoRoot(dir)).toBeNull();
  });

  it('deduplicates extra directories by repository root', async () => {
    const root = makeRepo({ 'sub/x.txt': 'x\n' });
    const other = makeRepo();
    const snap = await snapshot(root, { extraDirs: [join(root, 'sub'), other, tempDir()] });
    expect(snap.repos.map((repo) => repo.root)).toEqual([root, other]);
    expect(await findRepoRoot(join(root, 'sub'))).toBe(root);
  });

  it('resolves a linked worktree to the shared common dir and hooks', async () => {
    const root = makeRepo();
    const worktree = join(tempDir(), 'wt');
    git(root, 'worktree', 'add', '-q', worktree);
    const repo = (await snapshot(worktree)).repos[0]!;
    expect(repo.root).toBe(worktree);
    expect(repo.gitCommonDir).toBe(join(root, '.git'));
    expect(repo.hooksPath).toBe(join(root, '.git', 'hooks'));
  });

  it('resolves core.hooksPath against the work tree', async () => {
    const root = makeRepo();
    git(root, 'config', 'core.hooksPath', '.githooks');
    const repo = (await snapshot(join(root))).repos[0]!;
    expect(repo.hooksPath).toBe(join(root, '.githooks'));
  });

  it('caps the overlay', async () => {
    const root = makeRepo();
    for (let i = 0; i < 5; i += 1) write(root, `u${i}.txt`, `${i}\n`);
    const repo = (await snapshot(root, { maxOverlay: 3 })).repos[0]!;
    expect(Object.keys(repo.overlay)).toHaveLength(3);
    expect(repo.overlayTruncated).toBe(true);
  });

  it('records submodules and embedded repositories by path only', async () => {
    const root = makeRepo();
    const nested = join(root, 'nested');
    git(root, 'init', '-q', 'nested');
    write(nested, 'inner.txt', 'i\n');
    const repo = (await snapshot(root)).repos[0]!;
    expect(repo.overlay).toEqual({ nested: 'submodule' });
    rmSync(nested, { recursive: true });
  });

  it('reports a missing git binary as errors without throwing', async () => {
    const root = makeRepo();
    const gitBinary = join(tempDir(), 'no-such-git');
    const snap = await snapshot(root, { gitBinary });
    expect(snap.repos).toHaveLength(1);
    expect(snap.repos[0]!.error).toMatch(/git not available/);
    expect(await findRepoRoot(root, { gitBinary })).toBeNull();
    expect(await gitVersion(gitBinary)).toBeNull();
    expect(await gitVersion()).toMatch(/^\d+\.\d+/);
  });

  it('snapshots a 5,000-file repository with 50 dirty files in under a second', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 5000; i += 1) files[`d${i % 50}/f${i}.txt`] = `line ${i}\n`;
    const root = makeRepo(files);
    for (let i = 0; i < 50; i += 1) write(root, `d${i}/f${i}.txt`, `dirty ${i}\n`);
    await snapshot(root); // warm the git version cache and file system caches
    const snap = await snapshot(root);
    expect(Object.keys(snap.repos[0]!.overlay)).toHaveLength(50);
    console.info(`[git-tracker] 5,000-file snapshot: ${snap.durationMs} ms`);
    expect(snap.durationMs).toBeLessThan(1000);
  });
});
