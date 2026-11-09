/** Runs and parses `git status --porcelain=v2 -z`. */
import { type GitRunner, type RepoGitContext } from './git-runner';
import { splitNul } from './nul';

export type StatusResult = {
  /** HEAD commit, or null on an unborn branch. */
  head: string | null;
  /** Current branch, or null when HEAD is detached. */
  branch: string | null;
  /** Paths that differ from HEAD (changed, renamed and their sources, unmerged, untracked), in order. */
  paths: string[];
  /** The output was cut off, so `paths` may be incomplete. */
  truncated: boolean;
  error: string | null;
};

/** Text after the `count`-th space; porcelain v2 paths may contain spaces. */
function afterSpaces(field: string, count: number): string | null {
  let index = -1;
  for (let i = 0; i < count; i += 1) {
    index = field.indexOf(' ', index + 1);
    if (index === -1) return null;
  }
  return field.slice(index + 1);
}

/** Parses porcelain v2 `-z` output produced with `--branch`. */
export function parseStatus(fields: string[]): Omit<StatusResult, 'truncated' | 'error'> {
  let head: string | null = null;
  let branch: string | null = null;
  const seen = new Set<string>();
  const paths: string[] = [];
  const add = (path: string | null | undefined): void => {
    if (path === null || path === undefined || path === '') return;
    // Untracked directories (embedded repositories) end with a slash.
    const clean = path.endsWith('/') ? path.slice(0, -1) : path;
    if (seen.has(clean)) return;
    seen.add(clean);
    paths.push(clean);
  };

  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i] ?? '';
    const tag = field.slice(0, 2);
    if (tag === '# ') {
      const oid = /^# branch\.oid (.+)$/.exec(field);
      if (oid?.[1] !== undefined) head = oid[1] === '(initial)' ? null : oid[1];
      const name = /^# branch\.head (.+)$/.exec(field);
      if (name?.[1] !== undefined) branch = name[1] === '(detached)' ? null : name[1];
    } else if (tag === '1 ') {
      add(afterSpaces(field, 8));
    } else if (tag === '2 ') {
      add(afterSpaces(field, 9));
      // The rename source follows as its own field.
      i += 1;
      add(fields[i]);
    } else if (tag === 'u ') {
      add(afterSpaces(field, 10));
    } else if (tag === '? ') {
      add(field.slice(2));
    }
    // '! ' (ignored) never appears without --ignored and is skipped regardless.
  }
  return { head, branch, paths };
}

/** Lists working tree differences from HEAD. Ignored files are excluded; submodules are not entered. */
export async function readStatus(
  git: GitRunner,
  root: string,
  repo: RepoGitContext,
): Promise<StatusResult> {
  const result = await git.run(
    [
      'status',
      '--porcelain=v2',
      '-z',
      '--branch',
      '--no-ahead-behind',
      '--untracked-files=all',
      '--ignore-submodules=dirty',
      '--no-renames',
    ],
    { cwd: root, repo },
  );
  if (!result.ok && !result.truncated) {
    return { head: null, branch: null, paths: [], truncated: false, error: result.error };
  }
  const parsed = parseStatus(splitNul(result.stdout, !result.truncated));
  return { ...parsed, truncated: result.truncated, error: null };
}
