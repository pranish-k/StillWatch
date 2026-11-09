import type {
  EventFacts,
  JsonObject,
  JsonValue,
  NormalizedEvent,
  Signal,
  ToolCall,
  ToolCategory,
} from '@stillwatch/schema';
import { extractFacts, type FactsContext } from '../src/index';

export const HOME = '/home/dev';
export const CWD = '/home/dev/project';
export const SW_HOME = '/home/dev/.stillwatch';
export const ctx: FactsContext = { home: HOME, stillwatchHome: SW_HOME };

/** A redaction marker built at runtime, never a literal secret. */
export function marker(detector: string, fingerprint = 'ab12cd34'): string {
  return '[REDACTED:' + detector + ':' + fingerprint + ']';
}

const base = {
  id: 'e1',
  sourceId: 's1',
  agent: 'claude-code',
  sessionId: 'session-1',
  agentId: null,
  agentType: null,
  promptId: null,
  sourceEvent: 'PreToolUse',
  ts: 0,
  cwd: CWD,
  permissionMode: null,
  transcriptPath: null,
} as const;

type ToolOptions = {
  name?: string;
  category?: ToolCategory;
  input?: JsonObject;
  response?: JsonValue | null;
  error?: string | null;
  filePath?: string | null;
  url?: string | null;
  command?: string | null;
  sandboxDisabled?: boolean;
  changedFiles?: string[];
  kind?: 'tool.pre' | 'tool.post' | 'tool.failure';
  cwd?: string | null;
};

export function toolEvent(o: ToolOptions): NormalizedEvent {
  const tool: ToolCall = {
    name: o.name ?? 'Bash',
    useId: 'toolu_1',
    category: o.category ?? 'shell',
    input: o.input ?? {},
    response: o.response ?? null,
    error: o.error ?? null,
    isInterrupt: null,
    durationMs: null,
    mcpServer: null,
    filePath: o.filePath ?? null,
    url: o.url ?? null,
    command: o.command ?? null,
    sandboxDisabled: o.sandboxDisabled ?? false,
    runInBackground: false,
    changedFiles: o.changedFiles ?? [],
  };
  return {
    ...base,
    cwd: o.cwd === undefined ? CWD : o.cwd,
    tool,
    kind: o.kind ?? 'tool.pre',
    data: {},
  };
}

export function bash(command: string, extra: Partial<ToolOptions> = {}): NormalizedEvent {
  return toolEvent({ ...extra, command, input: { command, ...(extra.input ?? {}) } });
}

/** Facts of one shell command line. */
export function shellFacts(command: string): EventFacts {
  return extractFacts(bash(command), ctx);
}

export function kinds(facts: EventFacts, kind: Signal['kind']): Signal[] {
  return facts.signals.filter((s) => s.kind === kind);
}

export function details(facts: EventFacts, kind: Signal['kind']): string[] {
  return kinds(facts, kind).map((s) => s.detail);
}
