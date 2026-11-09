import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffSnapshots } from '../src/index';
import { git, isolateGit, makeRepo, snapshot, write } from './helpers';

isolateGit();

/** Writes an executable script that creates `marker` (and passes stdin through for filters). */
function markerScript(path: string, marker: string): void {
  writeFileSync(path, `#!/bin/sh\ntouch '${marker}'\ncat\n`);
  chmodSync(path, 0o755);
}

/** Plain git status as a user would run it, without Stillwatch's protections. */
function plainStatus(root: string): void {
  execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    stdio: 'ignore',
  });
}

describe('git safety', () => {
  it('never runs core.fsmonitor or filter drivers during snapshot and diff', async () => {
    const root = makeRepo({
      'tree.txt': 'filtered by .gitattributes\n',
      'info.txt': 'filtered by info/attributes\n',
      '.gitattributes': 'tree.txt filter=evil\n',
    });
    const outside = join(root, '..', `${root.split('/').pop() ?? 'x'}-markers`);
    execFileSync('mkdir', ['-p', outside]);
    const fsmonitorMarker = join(outside, 'fsmonitor-ran');
    const filterMarker = join(outside, 'filter-ran');
    markerScript(join(outside, 'fsmonitor.sh'), fsmonitorMarker);
    markerScript(join(outside, 'filter.sh'), filterMarker);
    write(root, '.git/info/attributes', 'info.txt filter=evil\n');

    // Same size, new mtime: git must re-read the content, which runs the clean filter.
    const touch = (): void => {
      const later = new Date(Date.now() + 60_000);
      for (const file of ['tree.txt', 'info.txt']) utimesSync(join(root, file), later, later);
    };
    git(root, 'config', 'filter.evil.clean', join(outside, 'filter.sh'));
    touch();
    plainStatus(root);
    expect(existsSync(filterMarker)).toBe(true);
    rmSync(filterMarker);

    git(root, 'config', 'core.fsmonitor', join(outside, 'fsmonitor.sh'));
    plainStatus(root);
    expect(existsSync(fsmonitorMarker)).toBe(true);
    rmSync(fsmonitorMarker);
    // GIT_OPTIONAL_LOCKS=0 kept the index stale, so this plain status ran the
    // clean filter again. Clear it so only Stillwatch's calls are measured.
    rmSync(filterMarker, { force: true });

    // Only the in-repo attributes file matches this one.
    git(root, 'config', '--unset', 'core.fsmonitor');
    write(root, '.gitattributes', 'tree.txt filter=evil\n');
    git(root, 'config', 'core.fsmonitor', join(outside, 'fsmonitor.sh'));
    touch();

    const start = await snapshot(root);
    write(root, 'untracked.txt', 'new\n');
    write(root, 'info.txt', 'filtered by info/attributes, changed\n');
    git(root, 'config', 'filter.evil.process', join(outside, 'filter.sh'));
    touch();
    const end = await snapshot(root);
    const diff = await diffSnapshots(start, end);

    expect(start.repos[0]!.error).toBeNull();
    expect(diff.errors).toEqual([]);
    expect(diff.files.map((file) => file.relPath)).toEqual(['info.txt', 'untracked.txt']);
    expect(existsSync(fsmonitorMarker)).toBe(false);
    expect(existsSync(filterMarker)).toBe(false);
  });

  it('skips a repository whose filter driver name cannot be neutralized', async () => {
    const root = makeRepo();
    git(root, 'config', 'filter.a=b.clean', 'true');
    const repo = (await snapshot(root)).repos[0]!;
    expect(repo.error).toMatch(/filter driver/);
    expect(repo.overlay).toEqual({});
  });
});
