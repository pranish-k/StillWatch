/**
 * Session-level records: the session itself, its agents, what changed, what
 * remains, links to other sessions, and gaps in what Stillwatch captured.
 */
import type { AgentKind } from './events';
import type { PathClass } from './facts';
import type { Finding, RiskLevel } from './findings';

export const SESSION_STATUSES = ['active', 'finished', 'interrupted'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export type SessionRecord = {
  /** The agent's session id. */
  id: string;
  agent: AgentKind;
  projectId: string | null;
  /** Repository root (or cwd when not in a repository). */
  projectRoot: string | null;
  projectName: string | null;
  cwd: string | null;
  transcriptPath: string | null;
  /** Custom session title, or the first user prompt's first line (redacted, capped). */
  title: string | null;
  startedAt: number;
  endedAt: number | null;
  lastEventAt: number;
  status: SessionStatus;
  /** SessionEnd reason, or "no_session_end" when Stillwatch closed a stale session. */
  endReason: string | null;
  risk: RiskLevel;
  /** Short reasons for the risk level, highest first, e.g. "A CI workflow changed". */
  riskReasons: string[];
  model: string | null;
  permissionMode: string | null;
  /** Deterministic plain-English summary from `@stillwatch/reports`. */
  summary: string | null;
  eventCount: number;
  findingCount: number;
  fileChangeCount: number;
  subagentCount: number;
  analyzedAt: number | null;
  analysisVersion: number | null;
  /** Hash of the newest event in this session's hash chain. */
  chainHead: string | null;
};

export type AgentRecord = {
  sessionId: string;
  /** "main" for the main agent, otherwise the subagent or teammate id. */
  agentId: string;
  agentType: string | null;
  startedAt: number | null;
  stoppedAt: number | null;
  transcriptPath: string | null;
  /** Final message (redacted, capped). */
  lastMessage: string | null;
  eventCount: number;
};

export const MAIN_AGENT_ID = 'main';

export const FILE_CHANGE_KINDS = [
  'added',
  'modified',
  'deleted',
  'renamed',
  'type_changed',
] as const;
export type FileChangeKind = (typeof FILE_CHANGE_KINDS)[number];

/**
 * How Stillwatch knows who changed a file:
 * `tool` a file tool call wrote it; `shell` a parsed shell command or Claude Code's
 * bashEditDiff names it; `other_session` an overlapping session's tool call wrote it;
 * `unattributed` it changed but no recorded action explains it.
 */
export type Attribution = 'tool' | 'shell' | 'other_session' | 'unattributed';

export type FileChange = {
  sessionId: string;
  /** Absolute path. */
  path: string;
  repoRoot: string | null;
  relPath: string | null;
  change: FileChangeKind;
  oldPath: string | null;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
  classes: PathClass[];
  attribution: Attribution;
  eventIds: string[];
  /** True when the change is part of a commit made during the session. */
  committed: boolean;
};

export const ARTIFACT_KINDS = [
  'git_hook',
  'git_config',
  'ci',
  'task_runner',
  'scheduled_task',
  'startup_file',
  'agent_config',
  'memory_note',
  'package_manifest',
  'background_process',
  'session_cron',
  'stillwatch',
  'other',
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** Something that remains after the session and could run or be read later ("What remains"). */
export type Artifact = {
  /** Deterministic from session, kind, and path. */
  id: string;
  sessionId: string;
  kind: ArtifactKind;
  /** File path, or a description for non-file artifacts (e.g. "crontab", a background command). */
  path: string;
  change: 'created' | 'modified' | 'deleted' | 'running' | 'scheduled';
  hashAfter: string | null;
  /** How Stillwatch knows: snapshot comparison, a tool call, parsed shell text, or a hook field. */
  source: 'snapshot' | 'tool' | 'shell' | 'hook';
  eventIds: string[];
  /** Extra context, e.g. "contains instructions for the next session". */
  detail: string | null;
};

export type SessionLink = {
  /** The session that wrote the file. */
  sourceSessionId: string;
  /** The session that later loaded or read it. */
  targetSessionId: string;
  path: string;
  kind: 'note_loaded' | 'note_read' | 'config_inherited';
  /** The loading event in the target session. */
  eventId: string | null;
  at: number;
};

export type SessionLinkView = SessionLink & {
  /** `incoming`: this session loaded something another wrote. `outgoing`: another session loaded what this one wrote. */
  direction: 'incoming' | 'outgoing';
  otherSessionTitle: string | null;
};

export type GapSource = 'hooks' | 'spool' | 'snapshot' | 'transcript' | 'collector' | 'analysis';

/** Something Stillwatch may have missed. Gaps are shown in reports, never hidden. */
export type CaptureGap = {
  id: string;
  /** `null` for gaps that are not tied to one session. */
  sessionId: string | null;
  source: GapSource;
  /** `critical` gaps can make a session's risk `unknown`. */
  severity: 'info' | 'warning' | 'critical';
  startedAt: number | null;
  endedAt: number | null;
  reason: string;
  createdAt: number;
};

export type DomainRecord = {
  sessionId: string;
  domain: string;
  firstEventId: string;
  count: number;
  /** Not seen in any earlier session. */
  isNew: boolean;
  /** Tools or programs that named it, e.g. "WebFetch", "curl". */
  via: string[];
};

export type UnfinishedItem = {
  kind: 'task' | 'turn' | 'tool_call' | 'background_task' | 'session_cron';
  label: string;
  eventId: string | null;
};

export type SensitiveAccess = {
  path: string;
  op: 'read' | 'write' | 'delete';
  eventId: string;
  ts: number;
  classes: PathClass[];
};

export type SessionStats = {
  toolCalls: number;
  /** Tool calls per `ToolCategory`. */
  byCategory: Record<string, number>;
  filesRead: number;
  filesWritten: number;
  commands: number;
  failures: number;
  prompts: number;
  turns: number;
  subagents: number;
  permissionRequests: number;
  denials: number;
  durationMs: number | null;
};

/** Everything the dashboard and the report builder need about one session. */
export type SessionDetail = {
  session: SessionRecord;
  agents: AgentRecord[];
  findings: Finding[];
  fileChanges: FileChange[];
  artifacts: Artifact[];
  links: SessionLinkView[];
  gaps: CaptureGap[];
  domains: DomainRecord[];
  unfinished: UnfinishedItem[];
  sensitiveAccess: SensitiveAccess[];
  stats: SessionStats | null;
  /** The agent's own final message, shown as "the agent reported", never as evidence. */
  lastAssistantMessage: string | null;
};

export type GapSeverity = CaptureGap['severity'];
