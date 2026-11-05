/**
 * Snapshots record repository state and the persistence surface at session
 * start and end (ADR-021). They store hashes only, never file contents.
 * `@stillwatch/git-tracker` takes and compares them.
 */
import type { PathClass } from './facts';
import type { FileChangeKind } from './session';

/** A path outside repositories to watch, from the catalog in `@stillwatch/facts`. */
export type SurfaceSpec = {
  /** Absolute path, or a stable name for `command` entries (e.g. "crontab"). */
  path: string;
  kind: 'file' | 'dir' | 'command';
  class: PathClass;
  label: string;
  /** For `command` entries only: a fixed argument vector, run without a shell, e.g. ["crontab", "-l"]. */
  argv: string[] | null;
};

/** A path inside each repository to watch, resolved by git-tracker. */
export type RepoSurfaceSpec = {
  /** Path relative to `base`. Use "." for the base itself. */
  rel: string;
  /**
   * `worktree`: the repository's working tree root.
   * `git_common_dir`: the shared .git directory (hooks and config live here, also for worktrees).
   * `hooks_path`: the effective hooks directory (core.hooksPath when set, else .git/hooks).
   */
  base: 'worktree' | 'git_common_dir' | 'hooks_path';
  kind: 'file' | 'dir';
  class: PathClass;
  label: string;
};

export type SurfaceEntry = {
  path: string;
  kind: 'file' | 'dir' | 'command';
  class: PathClass;
  label: string;
  exists: boolean;
  /** sha256 hex of the content (files, command output), or of the sorted child listing (dirs). */
  hash: string | null;
  size: number | null;
  mode: number | null;
  /** For directories: child name to content hash (files) or "dir". Non-recursive and capped. */
  children: Record<string, string> | null;
  error: string | null;
};

export type RepoSnapshot = {
  /** Working tree root (`git rev-parse --show-toplevel`). */
  root: string;
  gitCommonDir: string | null;
  head: string | null;
  branch: string | null;
  /** Effective hooks directory. */
  hooksPath: string | null;
  /**
   * Working tree differences from HEAD, including untracked files that are not
   * ignored: relative path to blob hash, or `null` for a deleted path.
   */
  overlay: Record<string, string | null>;
  overlayTruncated: boolean;
  error: string | null;
};

export type SessionSnapshot = {
  v: number;
  kind: 'start' | 'end' | 'current';
  sessionId: string;
  takenAt: number;
  cwd: string;
  repos: RepoSnapshot[];
  surface: SurfaceEntry[];
  durationMs: number;
  /** True when it was taken after the moment it describes (for example the collector was not running). */
  late: boolean;
};

export type RawFileChange = {
  repoRoot: string;
  /** Absolute path. */
  path: string;
  relPath: string;
  change: FileChangeKind;
  oldPath: string | null;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
  /** True when the change is part of a commit made between the two snapshots. */
  committed: boolean;
};

export type SurfaceChange = {
  path: string;
  class: PathClass;
  label: string;
  kind: 'file' | 'dir' | 'command';
  change: 'created' | 'modified' | 'deleted';
  /** For directories: which children were created, modified, or deleted. */
  childChanges: { name: string; change: 'created' | 'modified' | 'deleted' }[] | null;
  hashAfter: string | null;
};

export type CommitInfo = { sha: string; subject: string; author: string; at: number };

export type SnapshotDiff = {
  files: RawFileChange[];
  surface: SurfaceChange[];
  headMoved: { repoRoot: string; from: string | null; to: string | null }[];
  commits: CommitInfo[];
  truncated: boolean;
  errors: string[];
};
