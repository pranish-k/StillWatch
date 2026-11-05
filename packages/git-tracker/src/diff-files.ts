/** File-level comparison of one repository between two snapshots. */
import { join } from 'node:path';
import {
  type CommitInfo,
  type FileChangeKind,
  type RawFileChange,
  type RepoSnapshot,
} from '@stillwatch/schema';
import { EMPTY_TREE, SUBMODULE_MARKER } from './constants';
import { type GitRunner } from './git-runner';
import {
  committedChanges,
  isObjectId,
  lineCounts,
  listCommits,
  lookupObjects,
  type CommittedChange,
  type ObjectInfo,
} from './history';
import { loadRepoContext, readObjectFormat } from './repo-context';

export type RepoDiffLimits = { maxCommits: number; maxSubjectChars: number };

export type RepoDiff = {
  files: RawFileChange[];
  commits: CommitInfo[];
  truncated: boolean;
  errors: string[];
};

/** Content of a path on one side: where it came from and what it is. */
type Side = {
  source: 'overlay' | 'head';
  type: 'blob' | 'submodule' | 'missing';
  id: string | null;
};

const COMMITTED_KIND: Partial<Record<string, FileChangeKind>> = {
  A: 'added',
  D: 'deleted',
  M: 'modified',
  T: 'type_changed',
};

function fromOverlay(value: string | null): Side {
  if (value === null) return { source: 'overlay', type: 'missing', id: null };
  if (value === SUBMODULE_MARKER) return { source: 'overlay', type: 'submodule', id: null };
  return { source: 'overlay', type: 'blob', id: value };
}

function fromHead(info: ObjectInfo | undefined): Side {
  // A tree means the path is a directory there; its files are compared on their own.
  if (info?.type === 'blob') return { source: 'head', type: 'blob', id: info.id };
  return { source: 'head', type: 'missing', id: null };
}

function classify(
  start: Side,
  end: Side,
  committed: CommittedChange | undefined,
): FileChangeKind | null {
  if (start.type === 'missing' && end.type === 'missing') {
    // Both unresolvable (for example a submodule bump): trust the commit diff.
    return committed === undefined ? null : (COMMITTED_KIND[committed.status] ?? 'modified');
  }
  if (start.type === 'missing') return 'added';
  if (end.type === 'missing') return 'deleted';
  if (start.type !== end.type) return 'type_changed';
  if (start.type === 'submodule') return null;
  if (committed?.status === 'T' && start.source === 'head' && end.source === 'head') {
    return 'type_changed';
  }
  return start.id === end.id ? null : 'modified';
}

type Pending = {
  relPath: string;
  change: FileChangeKind;
  start: Side;
  end: Side;
  oldPath: string | null;
};

/** Merges deleted and added paths into renames: commit renames first, then identical content. */
function pairRenames(pending: Pending[], committedRenames: Map<string, string>): Pending[] {
  const byPath = new Map(pending.map((item) => [item.relPath, item]));
  const removed = new Set<string>();
  for (const [newPath, oldPath] of committedRenames) {
    const added = byPath.get(newPath);
    const deleted = byPath.get(oldPath);
    if (added?.change !== 'added' || deleted?.change !== 'deleted') continue;
    added.change = 'renamed';
    added.oldPath = oldPath;
    added.start = deleted.start;
    removed.add(oldPath);
  }
  const deletedById = new Map<string, Pending[]>();
  for (const item of pending) {
    if (item.change !== 'deleted' || removed.has(item.relPath) || item.start.type !== 'blob')
      continue;
    const id = item.start.id ?? '';
    deletedById.set(id, [...(deletedById.get(id) ?? []), item]);
  }
  for (const item of pending) {
    if (item.change !== 'added' || item.end.type !== 'blob') continue;
    const match = deletedById.get(item.end.id ?? '')?.shift();
    if (match === undefined) continue;
    item.change = 'renamed';
    item.oldPath = match.relPath;
    item.start = match.start;
    removed.add(match.relPath);
  }
  return pending.filter((item) => !removed.has(item.relPath));
}

/** Compares one repository present in both snapshots. Never throws; problems go to `errors`. */
export async function diffRepo(
  git: GitRunner,
  start: RepoSnapshot,
  end: RepoSnapshot,
  limits: RepoDiffLimits,
): Promise<RepoDiff> {
  const root = end.root;
  const out: RepoDiff = { files: [], commits: [], truncated: false, errors: [] };
  const fail = (message: string): RepoDiff => ({
    ...out,
    errors: [...out.errors, `${root}: ${message}`],
  });
  if (start.error !== null) out.errors.push(`${root}: start snapshot incomplete: ${start.error}`);
  if (end.error !== null) out.errors.push(`${root}: end snapshot incomplete: ${end.error}`);
  if (start.overlayTruncated || end.overlayTruncated) out.truncated = true;
  const startHead = start.head;
  const endHead = end.head;
  if (
    (startHead !== null && !isObjectId(startHead)) ||
    (endHead !== null && !isObjectId(endHead))
  ) {
    return fail('snapshot holds an invalid HEAD');
  }

  const format = await readObjectFormat(git, root);
  if (typeof format !== 'string') return fail(format.error);
  const repo = await loadRepoContext(git, root, format);
  if ('error' in repo) return fail(repo.error);
  const call = { git, root, repo };

  // Commit-level changes when HEAD moved.
  const committed = new Map<string, CommittedChange>();
  const committedRenames = new Map<string, string>();
  const committedPaths = new Set<string>();
  let counts = new Map<
    string,
    { additions: number | null; deletions: number | null; binary: boolean }
  >();
  if (startHead !== endHead && endHead !== null) {
    const fromTree = startHead ?? EMPTY_TREE[format];
    const [changes, history, numstat] = await Promise.all([
      committedChanges(call, fromTree, endHead),
      listCommits(call, startHead, endHead, limits.maxCommits, limits.maxSubjectChars),
      lineCounts(call, fromTree, endHead),
    ]);
    for (const error of [changes.error, history.error, numstat.error]) {
      if (error !== null) out.errors.push(`${root}: ${error}`);
    }
    for (const change of changes.changes) {
      committed.set(change.path, change);
      committedPaths.add(change.path);
      if (change.oldPath !== null) {
        committedPaths.add(change.oldPath);
        committedRenames.set(change.path, change.oldPath);
        if (!committed.has(change.oldPath))
          committed.set(change.oldPath, { status: 'D', path: change.oldPath, oldPath: null });
      }
    }
    out.commits = history.commits;
    if (history.truncated) out.truncated = true;
    counts = numstat.counts;
  } else if (startHead !== endHead && startHead !== null) {
    // HEAD became unborn (for example an orphan checkout): everything at start HEAD is gone.
    const changes = await committedChanges(call, startHead, EMPTY_TREE[format]);
    if (changes.error !== null) out.errors.push(`${root}: ${changes.error}`);
    for (const change of changes.changes) {
      committed.set(change.path, change);
      committedPaths.add(change.path);
    }
  }

  const candidates = [
    ...new Set([...Object.keys(start.overlay), ...Object.keys(end.overlay), ...committedPaths]),
  ].sort();

  // Resolve every side that is not in its overlay against that side's HEAD, in one batch.
  const queries = new Map<string, { rev: string; path: string }>();
  for (const path of candidates) {
    if (!(path in start.overlay) && startHead !== null) {
      queries.set(`${startHead}:${path}`, { rev: startHead, path });
    }
    if (!(path in end.overlay) && endHead !== null) {
      queries.set(`${endHead}:${path}`, { rev: endHead, path });
    }
  }
  const lookup = await lookupObjects(call, [...queries.values()]);
  if (lookup.error !== null) return fail(lookup.error);
  const sideOf = (snapshot: RepoSnapshot, head: string | null, path: string): Side => {
    if (path in snapshot.overlay) return fromOverlay(snapshot.overlay[path] ?? null);
    if (head === null) return { source: 'head', type: 'missing', id: null };
    return fromHead(lookup.objects.get(`${head}:${path}`));
  };

  const pending: Pending[] = [];
  for (const relPath of candidates) {
    const startSide = sideOf(start, startHead, relPath);
    const endSide = sideOf(end, endHead, relPath);
    const change = classify(startSide, endSide, committed.get(relPath));
    if (change !== null)
      pending.push({ relPath, change, start: startSide, end: endSide, oldPath: null });
  }

  for (const item of pairRenames(pending, committedRenames)) {
    const fromHeads = item.start.source === 'head' && item.end.source === 'head';
    const lines = fromHeads ? counts.get(item.relPath) : undefined;
    out.files.push({
      repoRoot: root,
      path: join(root, item.relPath),
      relPath: item.relPath,
      change: item.change,
      oldPath: item.oldPath,
      additions: lines?.additions ?? null,
      deletions: lines?.deletions ?? null,
      binary: lines?.binary ?? false,
      committed:
        committedPaths.has(item.relPath) ||
        (item.oldPath !== null && committedPaths.has(item.oldPath)),
    });
  }
  return out;
}
