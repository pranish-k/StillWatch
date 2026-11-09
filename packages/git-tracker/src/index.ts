/**
 * @stillwatch/git-tracker
 *
 * Takes and compares snapshots of repository state and of the persistence
 * surface (ADR-021). Snapshots hold hashes only: never copy file contents.
 *
 * Git safety (git runs inside repositories an agent may have tampered with):
 * - Run git only with `execFile` and an argument array, never a shell.
 * - Neutralize config that runs programs. Pass `-c core.fsmonitor=false
 *   -c core.untrackedCache=false -c log.showSignature=false -c diff.external=`
 *   and `--no-pager`; use `--no-ext-diff --no-textconv` on diffs and
 *   `--no-filters` on hash-object. When git is 2.40 or newer, set
 *   GIT_ATTR_SOURCE to the empty tree (4b825dc642cb6eb9a060e54bf8d69288fbee4904)
 *   so in-tree .gitattributes cannot attach filters.
 * - Environment: GIT_OPTIONAL_LOCKS=0 (never take index.lock while the agent
 *   works), GIT_TERMINAL_PROMPT=0, LC_ALL=C.
 * - Every call has a timeout and a maxBuffer. Errors are recorded on the
 *   snapshot (`error` fields), never thrown for an ordinary repository problem.
 *
 * Public API contract. Signatures are fixed; implementations replace the stubs.
 */
import { resolve } from 'node:path';
import {
  SNAPSHOT_VERSION,
  type RepoSnapshot,
  type RepoSurfaceSpec,
  type SessionSnapshot,
  type SnapshotDiff,
  type SurfaceSpec,
} from '@stillwatch/schema';
import { DEFAULTS } from './constants';
import { Deadline } from './deadline';
import { diffRepo } from './diff-files';
import { diffSurface } from './diff-surface';
import { detectGitVersion, GitRunner } from './git-runner';
import { discoverRepo, repoRoot, type RepoInfo } from './repo-context';
import { snapshotRepo } from './repo-snapshot';
import { resolveRepoSurface, snapshotSurface } from './surface';

const DEFAULT_GIT = 'git';

/** Finds the repositories for the session directories, one per root. */
async function snapshotRepos(
  git: GitRunner,
  dirs: string[],
  maxOverlay: number,
): Promise<RepoSnapshot[]> {
  const found = await Promise.all(dirs.map((dir) => discoverRepo(git, dir)));
  const infos = new Map<string, RepoInfo>();
  const failed: RepoSnapshot[] = [];
  found.forEach((discovery, index) => {
    const dir = dirs[index] ?? '';
    if (discovery.kind === 'repo') {
      if (!infos.has(discovery.info.root)) infos.set(discovery.info.root, discovery.info);
    } else if (discovery.kind === 'error') {
      // The repository could not be read; the directory stands in for its root.
      failed.push({
        root: dir,
        gitCommonDir: null,
        head: null,
        branch: null,
        hooksPath: null,
        overlay: {},
        overlayTruncated: false,
        error: discovery.message,
      });
    }
  });
  const repos = await Promise.all(
    [...infos.values()].map((info) => snapshotRepo(git, info, maxOverlay)),
  );
  const roots = new Set(repos.map((repo) => repo.root));
  const seenFailed = new Set<string>();
  for (const repo of failed) {
    if (roots.has(repo.root) || seenFailed.has(repo.root)) continue;
    seenFailed.add(repo.root);
    repos.push(repo);
  }
  return repos;
}

export type SnapshotOptions = {
  sessionId: string;
  kind: SessionSnapshot['kind'];
  /** Session working directory. Its repository (if any) is snapshotted. */
  cwd: string;
  /** Extra directories (from /add-dir) whose repositories are snapshotted too. */
  extraDirs?: string[];
  /** Home and system level entries, from `persistenceSurface()` in @stillwatch/facts. */
  surface: SurfaceSpec[];
  /** Per-repository entries, from `repoSurfaceSpecs()` in @stillwatch/facts. */
  repoSurface: RepoSurfaceSpec[];
  /** Marks the snapshot as taken later than the moment it describes. */
  late?: boolean;
  now?: () => number;
  /** Budget for all git work in this snapshot. Default 15000 ms. */
  timeoutMs?: number;
  /** Max overlay entries per repository. Default 20000; beyond that `overlayTruncated` is set. */
  maxOverlay?: number;
  /** Files larger than this are hashed by size and mtime instead of content. Default 5 MiB. */
  maxHashBytes?: number;
  /** Max children recorded per surface directory. Default 500. */
  maxDirChildren?: number;
  gitBinary?: string;
};

/** Takes a snapshot. Never throws for repository or file problems; they are recorded as errors. */
export async function takeSnapshot(options: SnapshotOptions): Promise<SessionSnapshot> {
  const now = options.now ?? Date.now;
  const takenAt = now();
  const startedAt = performance.now();
  const git = new GitRunner(
    options.gitBinary ?? DEFAULT_GIT,
    new Deadline(options.timeoutMs ?? DEFAULTS.timeoutMs),
  );
  const limits = {
    maxHashBytes: options.maxHashBytes ?? DEFAULTS.maxHashBytes,
    maxDirChildren: options.maxDirChildren ?? DEFAULTS.maxDirChildren,
  };
  const dirs = [options.cwd, ...(options.extraDirs ?? [])].map((dir) => resolve(dir));
  const [repos, homeSurface] = await Promise.all([
    snapshotRepos(git, dirs, options.maxOverlay ?? DEFAULTS.maxOverlay),
    snapshotSurface(options.surface, [], limits),
  ]);
  const repoSurface = await snapshotSurface(
    [],
    resolveRepoSurface(options.repoSurface, repos),
    limits,
  );
  const homePaths = new Set(homeSurface.map((entry) => entry.path));
  return {
    v: SNAPSHOT_VERSION,
    kind: options.kind,
    sessionId: options.sessionId,
    takenAt,
    cwd: options.cwd,
    repos,
    surface: [...homeSurface, ...repoSurface.filter((entry) => !homePaths.has(entry.path))],
    durationMs: Math.round(performance.now() - startedAt),
    late: options.late ?? false,
  };
}

export type DiffOptions = { timeoutMs?: number; gitBinary?: string; maxFiles?: number };

/**
 * Compares two snapshots of the same session.
 * - Files: for each repository present in both, compare content at start
 *   (overlay, else HEAD) with content at end (overlay, else HEAD). Includes
 *   commits made in between (`committed: true`) and untracked files.
 *   Line counts come from `git diff --numstat` where both sides are available, else null.
 * - Surface: compare entries by path (hash, existence, directory children).
 */
export async function diffSnapshots(
  start: SessionSnapshot,
  end: SessionSnapshot,
  options?: DiffOptions,
): Promise<SnapshotDiff> {
  const git = new GitRunner(
    options?.gitBinary ?? DEFAULT_GIT,
    new Deadline(options?.timeoutMs ?? DEFAULTS.timeoutMs),
  );
  const maxFiles = options?.maxFiles ?? DEFAULTS.maxFiles;
  const diff: SnapshotDiff = {
    files: [],
    surface: [],
    headMoved: [],
    commits: [],
    truncated: false,
    errors: [],
  };
  const startRepos = new Map(start.repos.map((repo) => [repo.root, repo]));
  const pairs = end.repos.flatMap((repo) => {
    const before = startRepos.get(repo.root);
    return before === undefined ? [] : [{ before, after: repo }];
  });
  const results = await Promise.all(
    pairs.map(async ({ before, after }) => {
      try {
        return await diffRepo(git, before, after, {
          maxCommits: DEFAULTS.maxCommits,
          maxSubjectChars: DEFAULTS.maxSubjectChars,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { files: [], commits: [], truncated: false, errors: [`${after.root}: ${message}`] };
      }
    }),
  );
  pairs.forEach(({ before, after }, index) => {
    if (before.head !== after.head) {
      diff.headMoved.push({ repoRoot: after.root, from: before.head, to: after.head });
    }
    const result = results[index];
    if (result === undefined) return;
    diff.files.push(...result.files);
    diff.commits.push(...result.commits);
    diff.errors.push(...result.errors);
    if (result.truncated) diff.truncated = true;
  });
  if (diff.files.length > maxFiles) {
    diff.files = diff.files.slice(0, Math.max(0, maxFiles));
    diff.truncated = true;
  }
  const surface = diffSurface(start.surface, end.surface);
  diff.surface = surface.changes;
  diff.errors.push(...surface.errors);
  return diff;
}

/** Repository working tree root containing `dir`, or null. */
export async function findRepoRoot(
  dir: string,
  options?: { gitBinary?: string },
): Promise<string | null> {
  const git = new GitRunner(options?.gitBinary ?? DEFAULT_GIT, new Deadline(DEFAULTS.timeoutMs));
  return repoRoot(git, resolve(dir));
}

/** Installed git version, e.g. "2.50.1", or null when git is unavailable. */
export function gitVersion(gitBinary?: string): Promise<string | null> {
  return detectGitVersion(gitBinary ?? DEFAULT_GIT);
}
