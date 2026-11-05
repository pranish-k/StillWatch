/**
 * @stillwatch/facts
 *
 * Turns one normalized event into objective facts (files, commands, URLs,
 * domains, packages, signals, secret references) and holds the catalog of
 * sensitive and persistent locations. No judgment lives here: rules decide
 * what facts mean.
 *
 * Requirements:
 * - Pure and deterministic. No filesystem, network, clock, or process access.
 * - Shell text is untrusted. The parser must be linear time, never execute
 *   anything, and degrade gracefully (unknown syntax gives fewer facts, not errors).
 *   Commands longer than LIMITS.maxCommandParseLength are not parsed.
 * - Paths in facts are absolute and `canonicalPath`-normalized, resolved
 *   against the event's cwd (tracking `cd` within one command line), with `~`,
 *   `$HOME`, and `${HOME}` expanded. Other variables leave `unresolved: true`.
 * - Facts run on the redacted, untruncated event, so injection text deep in a
 *   long tool response is still seen.
 *
 * Public API contract. Signatures are fixed; implementations replace the stubs.
 */
import type {
  EventFacts,
  NormalizedEvent,
  PathClassification,
  RepoSurfaceSpec,
  Signal,
  SurfaceSpec,
} from '@stillwatch/schema';

export type FactsContext = {
  /** The user's home directory. */
  home: string;
  /** Stillwatch's data directory, so touching it can be flagged as monitor tampering. */
  stillwatchHome: string;
};

/** Extracts facts from one event. Sets `v` to FACTS_VERSION. */
export function extractFacts(_event: NormalizedEvent, _context: FactsContext): EventFacts {
  throw new Error('not implemented: extractFacts');
}

export type ClassifyContext = FactsContext & {
  /** Known repository roots, for repo-relative catalog entries. */
  repoRoots: string[];
};

/**
 * Classifies a path against the catalog. Catalog entries are anchored to the
 * home directory (e.g. ~/.zshrc), to absolute system paths (e.g. /etc/cron.d),
 * or match anywhere by name or suffix (e.g. .github/workflows/*.yml, CLAUDE.md).
 * Paths with no match return `{ classes: [], label: null, scope }`.
 */
export function classifyPath(_path: string, _context: ClassifyContext): PathClassification {
  throw new Error('not implemented: classifyPath');
}

export type SurfaceContext = FactsContext & {
  /** Include entries outside the home directory (crontab command, /etc, /Library). The lab sets false. */
  includeSystem: boolean;
  platform: 'darwin' | 'linux';
};

/** Home and system level persistence surface to snapshot at session start and end. */
export function persistenceSurface(_context: SurfaceContext): SurfaceSpec[] {
  throw new Error('not implemented: persistenceSurface');
}

/** Per-repository persistence surface (.git/hooks, .git/config, ignored agent files). */
export function repoSurfaceSpecs(): RepoSurfaceSpec[] {
  throw new Error('not implemented: repoSurfaceSpecs');
}

/** Finds instruction-like text aimed at an agent, and hidden text, in untrusted content. */
export function detectInjection(_text: string, _source: Signal['source']): Signal[] {
  throw new Error('not implemented: detectInjection');
}

export type ShellRedirect = { op: string; target: string };

export type ShellCommand = {
  argv: string[];
  /** Leading VAR=value assignments. */
  assignments: string[];
  redirects: ShellRedirect[];
  /** 0 at top level; higher inside $(...), backticks, and sh -c / bash -c strings. */
  depth: number;
  background: boolean;
  /** Index (in `commands`) of the command piping into this one, or null. */
  pipedFrom: number | null;
  /** Effective working directory for this command after earlier `cd`s on the same line, when known. */
  cwd: string | null;
};

export type ShellParse = { commands: ShellCommand[]; truncated: boolean };

/** Tokenizes and splits a shell command line. Exported for tests and tools. */
export function parseShell(_command: string, _cwd: string | null, _home: string): ShellParse {
  throw new Error('not implemented: parseShell');
}

/** Finds http, https, ftp, ssh, and git URLs and scp-style host:path references in text. */
export function extractUrls(_text: string): string[] {
  throw new Error('not implemented: extractUrls');
}

/** Lowercase hostname of a URL (no port, no credentials), or null. */
export function hostnameOf(_url: string): string | null {
  throw new Error('not implemented: hostnameOf');
}
