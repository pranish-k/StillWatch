/**
 * @stillwatch/adapter-claude
 *
 * Everything Claude Code specific lives here (ADR-006):
 * - which hook events Stillwatch installs and how (`CLAUDE_HOOK_EVENTS`),
 * - converting raw hook payloads from the spool into `NormalizedEvent`,
 * - reading Claude Code transcripts (ADR-004: transcripts are a backup source).
 *
 * Public API contract. Signatures are fixed; implementations replace the stubs.
 */
import type { NormalizedEvent, PromptOrigin, ToolCategory } from '@stillwatch/schema';

// ---------------------------------------------------------------------------
// Hook installation spec
// ---------------------------------------------------------------------------

/** Oldest Claude Code version supported: exec-form hooks (`args`) arrived in 2.1.139. */
export const MIN_CLAUDE_CODE_VERSION = '2.1.139';

export type HookEventSpec = {
  /** Claude Code hook event name. */
  event: string;
  /**
   * `sync`: Claude Code waits for the hook (about 10 ms). Used where ordering
   * matters or where async hooks are killed at `claude -p` teardown.
   * `async`: runs in the background with zero latency for the agent.
   */
  mode: 'sync' | 'async';
  /** Seconds. `null` leaves Claude Code's default. Never set on SessionEnd: a value raises the shared 1.5 s budget for every SessionEnd hook. */
  timeoutSec: number | null;
  /** When true the hook also starts the collector if it is not running. */
  ensureCollector: boolean;
  description: string;
};

/** The hook events Stillwatch installs, in install order. */
export const CLAUDE_HOOK_EVENTS: readonly HookEventSpec[] = [
  {
    event: 'SessionStart',
    mode: 'sync',
    timeoutSec: 10,
    ensureCollector: true,
    description: 'Session boundaries and how the session started',
  },
  {
    event: 'UserPromptSubmit',
    mode: 'sync',
    timeoutSec: 10,
    ensureCollector: true,
    description: "The user's request, used for scope checks",
  },
  {
    event: 'UserPromptExpansion',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Slash commands and skills the user invoked',
  },
  {
    event: 'PreToolUse',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Tool calls and their inputs',
  },
  {
    event: 'PostToolUse',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Tool results',
  },
  {
    event: 'PostToolUseFailure',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Failed tool calls',
  },
  {
    event: 'PostToolBatch',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Batch boundaries; resolves calls that never got a result, such as denied ones',
  },
  {
    event: 'PermissionRequest',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Permission prompts',
  },
  {
    event: 'PermissionDenied',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Auto mode denials',
  },
  {
    event: 'Notification',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Waiting for input and other notifications',
  },
  {
    event: 'SubagentStart',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Which subagent did the work',
  },
  {
    event: 'SubagentStop',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Subagent results and transcripts',
  },
  {
    event: 'TaskCreated',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Planned work, for unfinished-work tracking',
  },
  {
    event: 'TaskCompleted',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Completed work',
  },
  {
    event: 'Stop',
    mode: 'sync',
    timeoutSec: 10,
    ensureCollector: false,
    description: 'Turn end, final message, background tasks, session crons',
  },
  {
    event: 'StopFailure',
    mode: 'sync',
    timeoutSec: 10,
    ensureCollector: false,
    description: 'Turns that ended on an API error',
  },
  {
    event: 'InstructionsLoaded',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Instruction and memory files loaded into a session',
  },
  {
    event: 'ConfigChange',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Changes to agent configuration during a session',
  },
  {
    event: 'CwdChanged',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Working directory changes, for path resolution',
  },
  {
    event: 'DirectoryAdded',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Extra working directories added with /add-dir',
  },
  {
    event: 'FileChanged',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: "Changes to files the user's own configuration watches",
  },
  {
    event: 'PreCompact',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Context compaction',
  },
  {
    event: 'PostCompact',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Context compaction results',
  },
  {
    event: 'PostModelSwitch',
    mode: 'async',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Model changes during a session',
  },
  {
    event: 'SessionEnd',
    mode: 'sync',
    timeoutSec: null,
    ensureCollector: false,
    description: 'Session end and reason',
  },
];

/** Events Stillwatch must never install, because a hook there changes Claude Code's behavior. */
export const NEVER_INSTALL_EVENTS: readonly { event: string; reason: string }[] = [
  { event: 'WorktreeCreate', reason: 'A hook replaces git worktree creation.' },
  { event: 'WorktreeRemove', reason: 'A hook takes over worktree removal.' },
  { event: 'PreModelSwitch', reason: 'A hook that times out blocks the model switch.' },
  { event: 'Elicitation', reason: 'A hook can answer or decline MCP input requests.' },
  { event: 'ElicitationResult', reason: 'A hook can change MCP input responses.' },
  { event: 'MessageDisplay', reason: 'Fires while text streams; too frequent and display-only.' },
  { event: 'TeammateIdle', reason: 'Exit codes keep teammates working; low value for Phase 1.' },
  { event: 'Setup', reason: 'Only runs for --init and --maintenance, not for sessions.' },
];

/** Extracts "2.1.318" from `claude --version` output such as "2.1.318 (Claude Code)". */
export function parseClaudeVersion(_output: string): string | null {
  throw new Error('not implemented: parseClaudeVersion');
}

/** Numeric dotted-version comparison: negative, zero, or positive. Pre-release suffixes sort before the release. */
export function compareVersions(_a: string, _b: string): number {
  throw new Error('not implemented: compareVersions');
}

// ---------------------------------------------------------------------------
// Payload normalization
// ---------------------------------------------------------------------------

/** One spool file, as read by the collector. */
export type SpoolRecord = {
  /** Spool file name; unique. Becomes `NormalizedEvent.sourceId`. */
  sourceId: string;
  /** Event name from the file name. Untrusted; used only when the payload lacks `hook_event_name`. */
  eventHint: string | null;
  /** File modification time, epoch milliseconds (fractional). Becomes `NormalizedEvent.ts`. */
  receivedAt: number;
  /** Raw payload text exactly as the hook received it on stdin. */
  body: string;
};

export type AdaptResult =
  { ok: true; event: NormalizedEvent } | { ok: false; reason: string; sessionId: string | null };

export type AdaptOptions = {
  /** Id generator, default `newId` from @stillwatch/schema. */
  newId?: (ts: number) => string;
};

/**
 * Converts one Claude Code hook payload into a `NormalizedEvent`.
 * Never throws: malformed input gives `{ ok: false }` with a reason, plus the
 * session id when one could be salvaged (so the gap can be attributed).
 * Unknown event names map to kind `unknown` and keep the payload in `data.raw`.
 * Does not redact or truncate; the collector does that next.
 */
export function adaptClaudeRecord(_record: SpoolRecord, _options?: AdaptOptions): AdaptResult {
  throw new Error('not implemented: adaptClaudeRecord');
}

/** Maps a Claude Code tool name to a category. `mcp__*` tools are `mcp`. */
export function classifyClaudeTool(_name: string): ToolCategory {
  throw new Error('not implemented: classifyClaudeTool');
}

/**
 * Where a UserPromptSubmit prompt came from. Claude Code also fires the event
 * for background subagent reports (`<task-notification>`), cross-session
 * messages, and scheduled tasks. Only `user` prompts count as user requests.
 */
export function promptOrigin(_prompt: string): PromptOrigin {
  throw new Error('not implemented: promptOrigin');
}

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

export type TranscriptSummary = {
  path: string;
  exists: boolean;
  /** tool_use ids found in assistant messages, in order. */
  toolUseIds: string[];
  /** Text of the last assistant message, if any. */
  lastAssistantText: string | null;
  model: string | null;
  lines: number;
  parseErrors: number;
  /** True when the file was larger than `maxBytes` and only its tail was read. */
  truncated: boolean;
  mtimeMs: number | null;
};

/**
 * Reads a Claude Code transcript (JSONL) defensively and summarizes it.
 * The format is internal to Claude Code and changes without notice: unknown
 * lines are skipped and counted, never fatal. Never throws for a missing file.
 */
export function readTranscriptSummary(
  _path: string,
  _options?: { maxBytes?: number },
): Promise<TranscriptSummary> {
  return Promise.reject(new Error('not implemented: readTranscriptSummary'));
}
