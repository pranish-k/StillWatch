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
import type {
  RepoSurfaceSpec,
  SessionSnapshot,
  SnapshotDiff,
  SurfaceSpec,
} from '@stillwatch/schema';

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
export function takeSnapshot(_options: SnapshotOptions): Promise<SessionSnapshot> {
  return Promise.reject(new Error('not implemented: takeSnapshot'));
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
export function diffSnapshots(
  _start: SessionSnapshot,
  _end: SessionSnapshot,
  _options?: DiffOptions,
): Promise<SnapshotDiff> {
  return Promise.reject(new Error('not implemented: diffSnapshots'));
}

/** Repository working tree root containing `dir`, or null. */
export function findRepoRoot(
  _dir: string,
  _options?: { gitBinary?: string },
): Promise<string | null> {
  return Promise.reject(new Error('not implemented: findRepoRoot'));
}

/** Installed git version, e.g. "2.50.1", or null when git is unavailable. */
export function gitVersion(_gitBinary?: string): Promise<string | null> {
  return Promise.reject(new Error('not implemented: gitVersion'));
}
