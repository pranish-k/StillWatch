/**
 * Facts are the objective things one event did: files it touched, commands
 * it ran, domains it named, and suspicious signals in its content.
 * `@stillwatch/facts` computes them at import time, on the redacted but
 * untruncated event, and the collector stores them next to the event.
 * Rules (`@stillwatch/rules`) decide what the facts mean.
 */

/** Path classes from the persistence and sensitivity catalog. */
export const PATH_CLASSES = [
  /** Credentials, keys, env files, cloud and package-registry auth. */
  'secret',
  /** .git/hooks, core.hooksPath, husky, lefthook, pre-commit config. */
  'git_hook',
  /** .git/config, ~/.gitconfig, .gitattributes (filters can run code). */
  'git_config',
  /** CI pipeline definitions: GitHub Actions, GitLab CI, CircleCI, Jenkins, and similar. */
  'ci',
  /** Delayed execution through tooling: package.json scripts, Makefile, .vscode/tasks.json, devcontainer, .envrc. */
  'task_runner',
  /** cron, launchd, systemd timers and units, autostart entries. */
  'scheduled_task',
  /** Shell profiles, ssh rc/config/authorized_keys, interpreter startup files. */
  'startup_file',
  /** Agent configuration: Claude Code settings, hooks, MCP servers, agents, commands, skills; other agents' configs. */
  'agent_config',
  /** Files agents load as instructions or memory: CLAUDE.md, AGENTS.md, rules, auto memory, notes. */
  'memory_note',
  /** Dependency manifests and lockfiles. */
  'package_manifest',
  /** Stillwatch's own data, hooks, and configuration. Touching it is monitor tampering. */
  'stillwatch',
] as const;
export type PathClass = (typeof PATH_CLASSES)[number];

export type PathScope = 'repo' | 'home' | 'system' | 'temp' | 'other';

export type PathClassification = {
  classes: PathClass[];
  /** Human label for the most specific catalog match, e.g. "GitHub Actions workflow". */
  label: string | null;
  scope: PathScope;
};

export type FileOp = 'read' | 'write' | 'delete' | 'chmod' | 'exec' | 'list';

export type FileAccess = {
  /** Absolute path normalized with `canonicalPath`. */
  path: string;
  op: FileOp;
  /** `tool`: structured tool input. `shell`: parsed from command text. `agent-report`: Claude Code's bashEditDiff. */
  via: 'tool' | 'shell' | 'agent-report';
  /** How the fact was derived, e.g. "Read tool", "redirect >>", "tee", "cp destination", "sed -i". */
  detail: string;
  /** True when the path still contains variables or globs that could not be expanded. */
  unresolved: boolean;
};

export type CommandFact = {
  /** Program basename after unwrapping sudo, env, nohup, time, xargs, and similar wrappers. */
  program: string;
  /** Arguments after the program (redacted text, capped). */
  args: string[];
  /** Source text of this simple command (redacted, at most 500 characters). */
  text: string;
  sudo: boolean;
  /** True for the shell end of a network fetch piped into a shell, as in `curl ... | sh`. */
  pipedToShell: boolean;
  background: boolean;
  /** 0 at top level, higher inside `$(...)`, backticks, `sh -c`, and `bash -c`. */
  depth: number;
};

export const SIGNAL_KINDS = [
  /** Instruction-like text aimed at an agent inside untrusted content. */
  'prompt_injection',
  /** Invisible characters (zero-width, Unicode tags) or hidden comments carrying instructions. */
  'hidden_text',
  /** Skipping checks: --no-verify, sandbox disabled, TLS verification off, hooks disabled. */
  'safety_bypass',
  /** Network content executed by a shell: curl | sh, eval "$(curl ...)". */
  'pipe_to_shell',
  /** sudo, chmod 777, setuid, chown to root. */
  'privilege',
  /** crontab, launchctl load or bootstrap, systemctl enable, at. */
  'scheduled_task',
  /** Commands that create persistence without a file write we can see: git config core.hooksPath, aliases, filters. */
  'persistence_command',
  /** Commands that print credentials: security find-generic-password, gh auth token, printenv. */
  'credential_command',
  /** A redaction marker inside a command, URL, or network tool input. */
  'secret_in_command',
  /** A command or tool that talks to the network. */
  'network',
  /** Package manager commands that add, remove, or install packages. */
  'package_change',
  /** Touching Stillwatch's own files or processes, or editing hook settings. */
  'monitor_tampering',
  /** Broad deletes, git reset --hard, git clean -fdx, force pushes. */
  'destructive',
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export type FactSource = 'tool.input' | 'tool.response' | 'prompt' | 'message' | 'data';

export type Signal = {
  kind: SignalKind;
  /** What matched, short and redacted, e.g. "--no-verify" or "ignore previous instructions". */
  detail: string;
  source: FactSource;
  confidence: 'low' | 'medium' | 'high';
};

export type PackageChange = {
  /** npm, pnpm, yarn, bun, pip, uv, poetry, cargo, go, gem, brew, apt, and so on. */
  manager: string;
  action: 'add' | 'remove' | 'install' | 'update' | 'global';
  /** Package names or specs from the command line. Empty for a bare install. */
  names: string[];
};

export type SecretRef = {
  /** Redaction detector id, e.g. "aws-access-key-id". */
  detector: string;
  /** 8 hex characters; equal fingerprints mean the same secret value. */
  fingerprint: string;
  where: FactSource;
};

export type EventFacts = {
  v: number;
  files: FileAccess[];
  commands: CommandFact[];
  urls: string[];
  /** Lowercase hostnames without ports, deduplicated. IP addresses are kept as written. */
  domains: string[];
  packages: PackageChange[];
  signals: Signal[];
  secrets: SecretRef[];
};

export function emptyFacts(v: number): EventFacts {
  return {
    v,
    files: [],
    commands: [],
    urls: [],
    domains: [],
    packages: [],
    signals: [],
    secrets: [],
  };
}
