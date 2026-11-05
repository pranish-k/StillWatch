/** Commit-level git queries for diffs: changed paths, line counts, commit list, object lookup. */
import { type CommitInfo } from '@stillwatch/schema';
import { type GitRunner, type RepoGitContext } from './git-runner';
import { splitLines, splitNul } from './nul';

const DIFF_FLAGS = ['--no-ext-diff', '--no-textconv', '--no-color', '-z', '-M'];

export type CommittedChange = { status: string; path: string; oldPath: string | null };

export type LineCounts = { additions: number | null; deletions: number | null; binary: boolean };

export type ObjectInfo = { type: 'blob' | 'tree' | 'missing' | 'other'; id: string | null };

type Call = { git: GitRunner; root: string; repo: RepoGitContext };

/** Object ids from snapshots are checked before they are passed to git. */
export function isObjectId(value: string | null): value is string {
  return value !== null && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
}

/** Paths changed between two commits or trees (`git diff --name-status -z -M`). */
export async function committedChanges(
  { git, root, repo }: Call,
  from: string,
  to: string,
): Promise<{ changes: CommittedChange[]; error: string | null }> {
  const result = await git.run(['diff', '--name-status', ...DIFF_FLAGS, from, to, '--'], {
    cwd: root,
    repo,
  });
  if (!result.ok) return { changes: [], error: `git diff: ${result.error ?? 'failed'}` };
  const fields = splitNul(result.stdout);
  const changes: CommittedChange[] = [];
  for (let i = 0; i < fields.length; i += 1) {
    const status = (fields[i] ?? '').charAt(0);
    if (status === 'R' || status === 'C') {
      const oldPath = fields[i + 1] ?? '';
      const path = fields[i + 2] ?? '';
      i += 2;
      changes.push({ status, path, oldPath: status === 'R' ? oldPath : null });
    } else {
      changes.push({ status, path: fields[i + 1] ?? '', oldPath: null });
      i += 1;
    }
  }
  return { changes, error: null };
}

/** Line counts per new path (`git diff --numstat -z -M`). Binary files have `-` counts. */
export async function lineCounts(
  { git, root, repo }: Call,
  from: string,
  to: string,
): Promise<{ counts: Map<string, LineCounts>; error: string | null }> {
  const counts = new Map<string, LineCounts>();
  const result = await git.run(['diff', '--numstat', ...DIFF_FLAGS, from, to, '--'], {
    cwd: root,
    repo,
  });
  if (!result.ok) return { counts, error: `git diff --numstat: ${result.error ?? 'failed'}` };
  const fields = splitNul(result.stdout);
  for (let i = 0; i < fields.length; i += 1) {
    const [added = '', deleted = '', path = ''] = (fields[i] ?? '').split('\t');
    let target = path;
    if (path === '') {
      // Rename: the old and new paths follow as separate fields.
      target = fields[i + 2] ?? '';
      i += 2;
    }
    const binary = added === '-' && deleted === '-';
    counts.set(target, {
      additions: binary ? null : Number.parseInt(added, 10),
      deletions: binary ? null : Number.parseInt(deleted, 10),
      binary,
    });
  }
  return { counts, error: null };
}

/** Commits reachable from `to` but not `from`, newest first, capped. */
export async function listCommits(
  { git, root, repo }: Call,
  from: string | null,
  to: string,
  max: number,
  maxSubjectChars: number,
): Promise<{ commits: CommitInfo[]; truncated: boolean; error: string | null }> {
  const range = from === null ? to : `${from}..${to}`;
  const result = await git.run(
    [
      'log',
      '-z',
      '--no-color',
      `--max-count=${max + 1}`,
      '--format=%H%x00%s%x00%an%x00%at',
      range,
      '--',
    ],
    { cwd: root, repo },
  );
  if (!result.ok)
    return { commits: [], truncated: false, error: `git log: ${result.error ?? 'failed'}` };
  const fields = splitNul(result.stdout);
  const commits: CommitInfo[] = [];
  for (let i = 0; i + 3 < fields.length; i += 4) {
    commits.push({
      sha: fields[i] ?? '',
      subject: (fields[i + 1] ?? '').slice(0, maxSubjectChars),
      author: fields[i + 2] ?? '',
      at: Number.parseInt(fields[i + 3] ?? '0', 10) * 1000,
    });
  }
  return { commits: commits.slice(0, max), truncated: commits.length > max, error: null };
}

function parseObjectLine(line: string): ObjectInfo {
  const match = /^([0-9a-f]{40}|[0-9a-f]{64}) (\w+)$/.exec(line);
  if (match?.[1] === undefined || match[2] === undefined) return { type: 'missing', id: null };
  const type = match[2];
  return { type: type === 'blob' || type === 'tree' ? type : 'other', id: match[1] };
}

/** Looks up one `<rev>:<path>` whose path cannot be written on a line, using ls-tree. */
async function lookupOne(
  { git, root, repo }: Call,
  rev: string,
  path: string,
): Promise<ObjectInfo> {
  const result = await git.run(['ls-tree', '-z', '--full-tree', rev, '--', `:(literal)${path}`], {
    cwd: root,
    repo,
  });
  for (const field of result.ok ? splitNul(result.stdout) : []) {
    const tab = field.indexOf('\t');
    if (tab === -1 || field.slice(tab + 1) !== path) continue;
    const [, type = '', id = ''] = field.slice(0, tab).split(' ');
    return { type: type === 'blob' || type === 'tree' ? type : 'other', id };
  }
  return { type: 'missing', id: null };
}

/**
 * Resolves `<rev>:<path>` queries with one `git cat-file --batch-check` call.
 * Keys of the result are `${rev}:${path}`. Gitlinks resolve as missing.
 */
export async function lookupObjects(
  call: Call,
  queries: { rev: string; path: string }[],
): Promise<{ objects: Map<string, ObjectInfo>; error: string | null }> {
  const objects = new Map<string, ObjectInfo>();
  const lineSafe = queries.filter((query) => !query.path.includes('\n'));
  const other = queries.filter((query) => query.path.includes('\n'));
  let error: string | null = null;
  if (lineSafe.length > 0) {
    const input = lineSafe.map((query) => `${query.rev}:${query.path}\n`).join('');
    const result = await call.git.run(['cat-file', '--batch-check=%(objectname) %(objecttype)'], {
      cwd: call.root,
      repo: call.repo,
      input,
    });
    const lines = result.ok ? splitLines(result.stdout) : [];
    if (lines.length === lineSafe.length) {
      lineSafe.forEach((query, index) => {
        objects.set(`${query.rev}:${query.path}`, parseObjectLine(lines[index] ?? ''));
      });
    } else {
      error = `git cat-file: ${result.error ?? 'unexpected output'}`;
    }
  }
  for (const query of other) {
    objects.set(`${query.rev}:${query.path}`, await lookupOne(call, query.rev, query.path));
  }
  return { objects, error };
}
