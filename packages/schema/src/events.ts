/**
 * The shared, agent-independent event format (ADR-006).
 *
 * Agent adapters convert raw agent data (for Claude Code: hook payloads) into
 * `NormalizedEvent`. Rules, storage, reports, and the dashboard only ever see
 * this format. The original hook event name is kept in `sourceEvent`.
 */
import type { JsonObject, JsonValue } from './json';

export const AGENT_KINDS = ['claude-code'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const EVENT_KINDS = [
  'session.start',
  'session.end',
  'prompt.submit',
  'prompt.expand',
  'tool.pre',
  'tool.post',
  'tool.failure',
  'tool.batch',
  'permission.request',
  'permission.denied',
  'subagent.start',
  'subagent.stop',
  'task.created',
  'task.completed',
  'turn.stop',
  'turn.failure',
  'instructions.loaded',
  'config.change',
  'cwd.change',
  'directory.add',
  'file.change',
  'compact.pre',
  'compact.post',
  'model.switch',
  'notification',
  'unknown',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const TOOL_CATEGORIES = [
  'shell',
  'file.read',
  'file.write',
  'file.edit',
  'file.search',
  'notebook',
  'web.fetch',
  'web.search',
  'agent',
  'mcp',
  'task',
  'plan',
  'question',
  'other',
] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export type McpServerInfo = { name: string; source: string | null };

/**
 * One tool call as seen by a tool event. Present on `tool.pre`, `tool.post`,
 * `tool.failure`, `permission.request`, and `permission.denied`.
 *
 * `input` and `response` are the agent's data after redaction and truncation.
 * The fields after `mcpServer` are structured hints the adapter copies from
 * structured tool inputs. They never come from parsing shell text; that is
 * the job of `@stillwatch/facts`.
 */
export type ToolCall = {
  /** Tool name as the agent reports it, e.g. "Bash", "Write", "mcp__github__create_issue". */
  name: string;
  /** Agent tool-use id. `null` on `permission.request`, which carries none. */
  useId: string | null;
  category: ToolCategory;
  input: JsonObject;
  /** Tool result. Only on `tool.post`. */
  response: JsonValue | null;
  /** Failure text. Only on `tool.failure`. */
  error: string | null;
  /** Only on `tool.failure`: true when the failure was an abort. */
  isInterrupt: boolean | null;
  durationMs: number | null;
  mcpServer: McpServerInfo | null;
  /** Absolute file path for Read, Write, Edit, and NotebookEdit. */
  filePath: string | null;
  /** URL for WebFetch. */
  url: string | null;
  /** Shell command text for Bash and PowerShell. */
  command: string | null;
  /** True when a Bash call asked to run outside the sandbox. */
  sandboxDisabled: boolean;
  /** True when a Bash call ran in the background. */
  runInBackground: boolean;
  /** Absolute paths from `tool_response.bashEditDiff.changedFiles` on `tool.post` for Bash. */
  changedFiles: string[];
};

/** Where a submitted prompt came from. Only `user` counts as a user request for scope checks. */
export type PromptOrigin = 'user' | 'task_notification' | 'cross_session' | 'scheduled' | 'system';

export type EmptyData = Readonly<Record<string, never>>;

export type SessionStartData = {
  /** "startup", "resume", "clear", "compact", or "fork". */
  source: string | null;
  model: string | null;
  sessionTitle: string | null;
};
export type SessionEndData = { reason: string | null };
export type PromptSubmitData = {
  prompt: string;
  origin: PromptOrigin;
  sessionTitle: string | null;
};
export type PromptExpandData = {
  expansionType: string | null;
  commandName: string | null;
  commandArgs: string | null;
  commandSource: string | null;
  prompt: string | null;
};
export type ToolBatchItem = {
  toolUseId: string | null;
  toolName: string;
  /** First characters of the serialized tool result, for display only. */
  resultPreview: string | null;
};
export type ToolBatchData = { calls: ToolBatchItem[] };
export type PermissionRequestData = { suggestions: JsonValue | null };
export type PermissionDeniedData = { reason: string | null };
export type SubagentStartData = { subagentId: string; subagentType: string | null };
export type SubagentStopData = {
  subagentId: string;
  subagentType: string | null;
  transcriptPath: string | null;
  lastMessage: string | null;
};
export type TaskData = {
  taskId: string;
  subject: string | null;
  description: string | null;
  teammateName: string | null;
};
export type BackgroundTask = {
  id: string;
  type: string | null;
  status: string | null;
  description: string | null;
  command: string | null;
};
export type SessionCron = {
  id: string;
  schedule: string | null;
  recurring: boolean | null;
  prompt: string | null;
};
export type TurnStopData = {
  lastMessage: string | null;
  backgroundTasks: BackgroundTask[];
  sessionCrons: SessionCron[];
  stopHookActive: boolean | null;
};
export type TurnFailureData = {
  error: string | null;
  errorDetails: string | null;
  lastMessage: string | null;
};
export type InstructionsLoadedData = {
  filePath: string;
  memoryType: string | null;
  loadReason: string | null;
  globs: string[];
  triggerFilePath: string | null;
  parentFilePath: string | null;
};
export type ConfigChangeData = { source: string | null; filePath: string | null };
export type CwdChangeData = { oldCwd: string | null; newCwd: string | null };
export type DirectoryAddData = { directory: string; source: string | null };
export type FileChangeData = { filePath: string; change: string | null };
export type CompactPreData = { trigger: string | null; customInstructions: string | null };
export type CompactPostData = { trigger: string | null; summary: string | null };
export type ModelSwitchData = {
  fromModel: string | null;
  toModel: string | null;
  source: string | null;
};
export type NotificationData = {
  notificationType: string | null;
  title: string | null;
  message: string | null;
};
/** For events the adapter does not recognize: the payload minus the common fields. */
export type UnknownData = { raw: JsonObject };

export type EventBase = {
  /** Stillwatch event id (sortable, see `newId`). */
  id: string;
  /** Spool record id this event came from. Dedupe key: one record gives one event. */
  sourceId: string;
  agent: AgentKind;
  /** The agent's session id. */
  sessionId: string;
  /** Subagent or teammate id the event fired in. `null` means the main agent. */
  agentId: string | null;
  agentType: string | null;
  /** Groups events by user prompt (Claude Code `prompt_id`). */
  promptId: string | null;
  /** Original agent event name, e.g. "PreToolUse". */
  sourceEvent: string;
  /** When the event was observed, epoch milliseconds (may be fractional). */
  ts: number;
  cwd: string | null;
  permissionMode: string | null;
  transcriptPath: string | null;
  /** Present only for tool and permission events. */
  tool: ToolCall | null;
};

export type EventPayload =
  | { kind: 'session.start'; data: SessionStartData }
  | { kind: 'session.end'; data: SessionEndData }
  | { kind: 'prompt.submit'; data: PromptSubmitData }
  | { kind: 'prompt.expand'; data: PromptExpandData }
  | { kind: 'tool.pre'; data: EmptyData }
  | { kind: 'tool.post'; data: EmptyData }
  | { kind: 'tool.failure'; data: EmptyData }
  | { kind: 'tool.batch'; data: ToolBatchData }
  | { kind: 'permission.request'; data: PermissionRequestData }
  | { kind: 'permission.denied'; data: PermissionDeniedData }
  | { kind: 'subagent.start'; data: SubagentStartData }
  | { kind: 'subagent.stop'; data: SubagentStopData }
  | { kind: 'task.created'; data: TaskData }
  | { kind: 'task.completed'; data: TaskData }
  | { kind: 'turn.stop'; data: TurnStopData }
  | { kind: 'turn.failure'; data: TurnFailureData }
  | { kind: 'instructions.loaded'; data: InstructionsLoadedData }
  | { kind: 'config.change'; data: ConfigChangeData }
  | { kind: 'cwd.change'; data: CwdChangeData }
  | { kind: 'directory.add'; data: DirectoryAddData }
  | { kind: 'file.change'; data: FileChangeData }
  | { kind: 'compact.pre'; data: CompactPreData }
  | { kind: 'compact.post'; data: CompactPostData }
  | { kind: 'model.switch'; data: ModelSwitchData }
  | { kind: 'notification'; data: NotificationData }
  | { kind: 'unknown'; data: UnknownData };

/** One normalized agent event. JSON-compatible. */
export type NormalizedEvent = EventBase & EventPayload;

/** Narrowing helper: `isKind(e, 'turn.stop')` types `e.data` as `TurnStopData`. */
export function isKind<K extends EventKind>(
  event: NormalizedEvent,
  kind: K,
): event is Extract<NormalizedEvent, { kind: K }> {
  return event.kind === kind;
}

/** Kinds that carry a `tool` field. */
export const TOOL_EVENT_KINDS: readonly EventKind[] = [
  'tool.pre',
  'tool.post',
  'tool.failure',
  'permission.request',
  'permission.denied',
];
