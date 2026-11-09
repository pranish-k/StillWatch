import { renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffSnapshots } from '../src/index';
import { git, isolateGit, makeRepo, snapshot, tempDir, write } from './helpers';

isolateGit();

function byPath<T extends { relPath: string }>(files: T[]): Record<string, T> {
  return Object.fromEntries(files.map((file) => [file.relPath, file]));
}

describe('diffSnapshots files', () => {
  it('reports nothing for an unchanged repository', async () => {
    const root = makeRepo({ 'a.txt': 'a\n', 'dirty.txt': 'x\n' });
    write(root, 'dirty.txt', 'already dirty\n');
    const start = await snapshot(root);
    const diff = await diffSnapshots(start, await snapshot(root));
    expect(diff).toEqual({
      files: [],
      surface: [],
      headMoved: [],
      commits: [],
      truncated: false,
      errors: [],
    });
  });

  it('reports uncommitted modified, added, deleted, and renamed files', async () => {
    const root = makeRepo({ 'a.txt': 'a\n', 'b.txt': 'b\n', 'c.txt': 'same content\n' });
    write(root, 'pre.txt', 'untracked before\n');
    const start = await snapshot(root);
    write(root, 'a.txt', 'a changed\n');
    unlinkSync(join(root, 'b.txt'));
    renameSync(join(root, 'c.txt'), join(root, 'moved.txt'));
    write(root, 'new.txt', 'new\n');
    write(root, 'pre.txt', 'untracked after\n');
    const diff = await diffSnapshots(start, await snapshot(root));
    expect(diff.errors).toEqual([]);
    const files = byPath(diff.files);
    expect(Object.keys(files)).toEqual(['a.txt', 'b.txt', 'moved.txt', 'new.txt', 'pre.txt']);
    expect(files['a.txt']).toMatchObject({
      change: 'modified',
      path: join(root, 'a.txt'),
      repoRoot: root,
      committed: false,
      additions: null,
    });
    expect(files['b.txt']!.change).toBe('deleted');
    expect(files['moved.txt']).toMatchObject({ change: 'renamed', oldPath: 'c.txt' });
    expect(files['new.txt']!.change).toBe('added');
    expect(files['pre.txt']!.change).toBe('modified');
  });

  it('includes commits made between snapshots with line counts', async () => {
    const root = makeRepo({ 'a.txt': 'one\ntwo\n', 'old.txt': 'keep me around\nfor rename\n' });
    const startHead = git(root, 'rev-parse', 'HEAD');
    const start = await snapshot(root);
    write(root, 'a.txt', 'one\nTWO\nthree\n');
    write(root, 'bin.dat', 'x\0y');
    git(root, 'mv', 'old.txt', 'renamed.txt');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'second commit');
    write(root, 'later.txt', 'uncommitted\n');
    git(root, 'add', 'later.txt');
    git(root, 'commit', '-q', '-m', 'third');
    write(root, 'later.txt', 'edited after commit\n');
    const endHead = git(root, 'rev-parse', 'HEAD');
    const diff = await diffSnapshots(start, await snapshot(root));
    expect(diff.errors).toEqual([]);
    expect(diff.headMoved).toEqual([{ repoRoot: root, from: startHead, to: endHead }]);
    expect(diff.commits.map((commit) => commit.subject)).toEqual(['third', 'second commit']);
    expect(diff.commits[0]).toMatchObject({ sha: endHead, author: 'Test User' });
    expect(diff.commits[0]!.at).toBeGreaterThan(1_600_000_000_000);
    const files = byPath(diff.files);
    expect(files['a.txt']).toMatchObject({
      change: 'modified',
      committed: true,
      additions: 2,
      deletions: 1,
      binary: false,
    });
    expect(files['bin.dat']).toMatchObject({ change: 'added', committed: true, binary: true });
    expect(files['renamed.txt']).toMatchObject({
      change: 'renamed',
      oldPath: 'old.txt',
      committed: true,
    });
    // End content comes from the overlay, so line counts are unknown.
    expect(files['later.txt']).toMatchObject({ change: 'added', committed: true, additions: null });
    expect(files['old.txt']).toBeUndefined();
  });

  it('handles a first commit on an unborn branch', async () => {
    const root = makeRepo({});
    write(root, 'kept.txt', 'k\n');
    const start = await snapshot(root);
    write(root, 'added.txt', 'a\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'first');
    const diff = await diffSnapshots(start, await snapshot(root));
    expect(diff.errors).toEqual([]);
    expect(diff.headMoved[0]!.from).toBeNull();
    expect(diff.commits.map((commit) => commit.subject)).toEqual(['first']);
    expect(diff.files.map((file) => [file.relPath, file.change, file.committed])).toEqual([
      ['added.txt', 'added', true],
    ]);
  });

  it('caps the number of files', async () => {
    const root = makeRepo();
    const start = await snapshot(root);
    for (let i = 0; i < 4; i += 1) write(root, `n${i}.txt`, `${i}\n`);
    const diff = await diffSnapshots(start, await snapshot(root), { maxFiles: 2 });
    expect(diff.files).toHaveLength(2);
    expect(diff.truncated).toBe(true);
  });

  it('records errors instead of throwing when git is missing or the repository is gone', async () => {
    const root = makeRepo();
    const start = await snapshot(root);
    write(root, 'x.txt', 'x\n');
    const end = await snapshot(root);
    const missingGit = await diffSnapshots(start, end, { gitBinary: join(tempDir(), 'nope') });
    expect(missingGit.files).toEqual([]);
    expect(missingGit.errors.join(' ')).toMatch(/git not available/);

    const broken = await snapshot(root, { gitBinary: join(tempDir(), 'nope') });
    const diff = await diffSnapshots(broken, end);
    expect(diff.errors.join(' ')).toMatch(
      /not compared, snapshot failed \(start: git not available/,
    );
    expect(diff.files).toEqual([]);
  });
});
