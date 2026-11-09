/** Defaults and fixed values shared by the git-tracker modules. */

/** The empty tree object id per object format. Git knows it without it being stored. */
export const EMPTY_TREE = {
  sha1: '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
  sha256: '6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321',
} as const;

export type ObjectFormat = keyof typeof EMPTY_TREE;

/**
 * Overlay value for a submodule or an embedded repository. Their contents are
 * not tracked, only their path (the value is never a valid object id).
 */
export const SUBMODULE_MARKER = 'submodule';

export const DEFAULTS = {
  timeoutMs: 15_000,
  maxOverlay: 20_000,
  maxHashBytes: 5 * 1024 * 1024,
  maxDirChildren: 500,
  maxFiles: 20_000,
  maxCommits: 200,
  maxSubjectChars: 200,
  /** Upper bound for a single git call, further limited by the remaining budget. */
  gitCallTimeoutMs: 15_000,
  gitMaxBuffer: 64 * 1024 * 1024,
  commandTimeoutMs: 5_000,
  commandMaxBuffer: 16 * 1024 * 1024,
  /** Directory entries read before sorting and capping a surface directory. */
  maxDirScan: 100_000,
} as const;
