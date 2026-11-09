/**
 * The single place where git is started. Every call goes through `GitRunner.run`,
 * which applies the safety flags and environment described in `index.ts`.
 */
import { execFile, type ExecFileException } from 'node:child_process';
import { DEFAULTS, EMPTY_TREE, type ObjectFormat } from './constants';
import { type Deadline } from './deadline';

/** Config overrides that stop git from running programs named in repository config. */
const SAFETY_CONFIG = [
  'core.fsmonitor=false',
  'core.untrackedCache=false',
  'log.showSignature=false',
  'diff.external=',
  // No transport may run: blocks lazy fetches in partial clones on older git.
  'protocol.allow=never',
];

const GLOBAL_ARGS: readonly string[] = [
  ...SAFETY_CONFIG.flatMap((setting) => ['-c', setting]),
  '--no-pager',
];

/** Inherited GIT_* variables that select configuration files and are kept. */
const KEPT_GIT_ENV = new Set([
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
]);

/** What a repository needs for safe calls: its object format and filter overrides. */
export type RepoGitContext = {
  objectFormat: ObjectFormat;
  /** Extra `-c` arguments that neutralize configured filter drivers. */
  configArgs: string[];
};

export type GitResult = {
  ok: boolean;
  exitCode: number | null;
  stdout: Buffer;
  stderr: string;
  /** Output hit maxBuffer; `stdout` holds the part read before git was stopped. */
  truncated: boolean;
  /** Short description of the failure, or null when `ok`. */
  error: string | null;
};

export type GitCallOptions = {
  cwd: string;
  input?: string;
  maxBuffer?: number;
  /** Per-call cap; the remaining budget always applies too. */
  timeoutMs?: number;
  /** Repository context. Without it GIT_ATTR_SOURCE is not set (repository discovery only). */
  repo?: RepoGitContext;
};

type RawResult = {
  error: ExecFileException | null;
  stdout: Buffer;
  stderr: Buffer;
};

const versionCache = new Map<string, Promise<string | null>>();

/** Environment for git: inherited minus GIT_* overrides, plus the safety variables. */
function gitEnv(attrSource: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key.startsWith('GIT_') && !KEPT_GIT_ENV.has(key)) continue;
    env[key] = value;
  }
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_NO_LAZY_FETCH = '1';
  env.LC_ALL = 'C';
  if (attrSource !== null) env.GIT_ATTR_SOURCE = attrSource;
  return env;
}

function execRaw(
  binary: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  maxBuffer: number,
  input: string | undefined,
): Promise<RawResult> {
  return new Promise((resolve) => {
    const child = execFile(
      binary,
      args,
      {
        cwd,
        env,
        timeout: timeoutMs,
        maxBuffer,
        encoding: 'buffer',
        killSignal: 'SIGKILL',
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve({ error, stdout, stderr });
      },
    );
    // git may exit before reading all input; a broken pipe is reported through the exit status.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(input ?? '');
  });
}

function describeFailure(error: ExecFileException, stderr: string, timedOut: boolean): string {
  if (timedOut) return 'git timed out';
  if (error.code === 'ENOENT') return 'git not found';
  const detail = stderr.trim().split('\n').slice(0, 3).join(' ').slice(0, 300);
  if (detail !== '') return detail;
  return typeof error.code === 'number' ? `git exited with status ${error.code}` : error.message;
}

/** Parses "git version 2.50.1 (Apple Git-155)" into "2.50.1". */
export function parseGitVersion(text: string): string | null {
  const match = /git version (\d+\.\d+(?:\.\d+)?)/.exec(text);
  return match?.[1] ?? null;
}

/** True when `version` is at least major.minor. */
export function versionAtLeast(version: string, major: number, minor: number): boolean {
  const [maj = 0, min = 0] = version.split('.').map((part) => Number.parseInt(part, 10));
  return maj > major || (maj === major && min >= minor);
}

/** Detects the git version once per binary; null when git cannot be run. */
export function detectGitVersion(binary: string): Promise<string | null> {
  let cached = versionCache.get(binary);
  if (cached === undefined) {
    cached = execRaw(binary, ['--version'], process.cwd(), gitEnv(null), 5_000, 64 * 1024, '').then(
      ({ error, stdout }) => (error === null ? parseGitVersion(stdout.toString('utf8')) : null),
    );
    versionCache.set(binary, cached);
    // A failure may be transient (for example git being installed); do not cache it.
    void cached.then((version) => {
      if (version === null) versionCache.delete(binary);
    });
  }
  return cached;
}

/** Runs git with the safety flags, a timeout from the shared budget, and bounded output. */
export class GitRunner {
  readonly binary: string;
  private readonly deadline: Deadline;

  constructor(binary: string, deadline: Deadline) {
    this.binary = binary;
    this.deadline = deadline;
  }

  async run(args: readonly string[], options: GitCallOptions): Promise<GitResult> {
    const version = await detectGitVersion(this.binary);
    if (version === null) return failure(`git not available (${this.binary})`);
    const remaining = this.deadline.remaining();
    if (remaining <= 0) return failure('git time budget exhausted');
    const timeoutMs = Math.min(remaining, options.timeoutMs ?? DEFAULTS.gitCallTimeoutMs);

    const repo = options.repo;
    const attrSource =
      repo !== undefined && versionAtLeast(version, 2, 40) ? EMPTY_TREE[repo.objectFormat] : null;
    const fullArgs = [...GLOBAL_ARGS, ...(repo?.configArgs ?? []), ...args];
    const startedAt = performance.now();
    const raw = await execRaw(
      this.binary,
      fullArgs,
      options.cwd,
      gitEnv(attrSource),
      timeoutMs,
      options.maxBuffer ?? DEFAULTS.gitMaxBuffer,
      options.input,
    );
    const stderr = raw.stderr.toString('utf8');
    if (raw.error === null) {
      return { ok: true, exitCode: 0, stdout: raw.stdout, stderr, truncated: false, error: null };
    }
    const truncated = raw.error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
    const timedOut =
      !truncated && raw.error.killed === true && performance.now() - startedAt >= timeoutMs - 5;
    return {
      ok: false,
      exitCode: typeof raw.error.code === 'number' ? raw.error.code : null,
      stdout: raw.stdout,
      stderr,
      truncated,
      error: truncated ? 'git output too large' : describeFailure(raw.error, stderr, timedOut),
    };
  }
}

function failure(error: string): GitResult {
  return {
    ok: false,
    exitCode: null,
    stdout: Buffer.alloc(0),
    stderr: '',
    truncated: false,
    error,
  };
}
