/** Repository discovery and the per-repository context needed for safe git calls. */
import { stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { type ObjectFormat } from './constants';
import { type GitRunner, type RepoGitContext } from './git-runner';
import { splitLines, splitNul } from './nul';

export type RepoInfo = {
  root: string;
  gitCommonDir: string;
  hooksPath: string;
  objectFormat: ObjectFormat;
};

export type Discovery =
  { kind: 'none' } | { kind: 'error'; message: string } | { kind: 'repo'; info: RepoInfo };

const NOT_A_REPO = /not a git repository|must be run in a work tree/i;

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** Finds the repository containing `dir`. A directory outside any work tree is `none`, not an error. */
export async function discoverRepo(git: GitRunner, dir: string): Promise<Discovery> {
  if (!(await isDirectory(dir))) return { kind: 'none' };
  const result = await git.run(
    [
      'rev-parse',
      '--path-format=absolute',
      '--show-toplevel',
      '--git-common-dir',
      // Honors core.hooksPath (with ~ expanded and relative paths resolved against the work tree).
      '--git-path',
      'hooks',
      '--show-object-format',
    ],
    { cwd: dir, timeoutMs: 5_000, maxBuffer: 1024 * 1024 },
  );
  if (!result.ok) {
    if (NOT_A_REPO.test(result.stderr)) return { kind: 'none' };
    return { kind: 'error', message: result.error ?? 'git rev-parse failed' };
  }
  const [root, commonDir, hooksPath, format] = splitLines(result.stdout);
  if (root === undefined || commonDir === undefined || hooksPath === undefined) {
    return { kind: 'error', message: 'unexpected git rev-parse output' };
  }
  return {
    kind: 'repo',
    info: {
      root,
      gitCommonDir: isAbsolute(commonDir) ? commonDir : resolve(dir, commonDir),
      hooksPath: isAbsolute(hooksPath) ? hooksPath : resolve(dir, hooksPath),
      objectFormat: format === 'sha256' ? 'sha256' : 'sha1',
    },
  };
}

/** Working tree root containing `dir`, or null (also when git fails). */
export async function repoRoot(git: GitRunner, dir: string): Promise<string | null> {
  if (!(await isDirectory(dir))) return null;
  const result = await git.run(['rev-parse', '--show-toplevel'], {
    cwd: dir,
    timeoutMs: 5_000,
    maxBuffer: 1024 * 1024,
  });
  if (!result.ok) return null;
  return splitLines(result.stdout)[0] ?? null;
}

/** Object format of the repository at `root`, or an error message. */
export async function readObjectFormat(
  git: GitRunner,
  root: string,
): Promise<ObjectFormat | { error: string }> {
  const result = await git.run(['rev-parse', '--show-object-format'], {
    cwd: root,
    timeoutMs: 5_000,
    maxBuffer: 1024,
  });
  if (!result.ok) return { error: result.error ?? 'git rev-parse failed' };
  return splitLines(result.stdout)[0] === 'sha256' ? 'sha256' : 'sha1';
}

/**
 * Builds the context for safe calls in one repository. Filter drivers named in
 * any config scope are overridden with empty commands: attributes from
 * `.git/info/attributes` still apply under GIT_ATTR_SOURCE, and `git status`
 * runs clean filters on files whose stat data changed.
 */
export async function loadRepoContext(
  git: GitRunner,
  root: string,
  objectFormat: ObjectFormat,
): Promise<RepoGitContext | { error: string }> {
  const result = await git.run(['config', '-z', '--get-regexp', '^filter\\.'], {
    cwd: root,
    timeoutMs: 5_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  // Exit status 1 means no matching keys.
  if (!result.ok && result.exitCode !== 1) {
    return { error: `reading filter config: ${result.error ?? 'failed'}` };
  }
  const names = new Set<string>();
  for (const entry of splitNul(result.stdout)) {
    const key = entry.split('\n', 1)[0] ?? '';
    const match = /^filter\.(.+)\.[^.]+$/s.exec(key);
    if (match?.[1] !== undefined) names.add(match[1]);
  }
  const configArgs: string[] = [];
  for (const name of names) {
    // `-c` splits at the first "=", so such a name cannot be overridden safely.
    if (name.includes('=') || name.includes('\n')) {
      return { error: 'a filter driver name cannot be neutralized; repository skipped' };
    }
    for (const setting of ['clean=', 'smudge=', 'process=', 'required=false']) {
      configArgs.push('-c', `filter.${name}.${setting}`);
    }
  }
  return { objectFormat, configArgs };
}
