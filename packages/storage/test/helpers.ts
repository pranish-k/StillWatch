import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyFacts,
  type AnalysisResult,
  type EventBase,
  type Finding,
  type NormalizedEvent,
  type SessionStats,
  type ToolCall,
} from '@stillwatch/schema';
import { afterEach } from 'vitest';
import {
  installSqliteWarningFilter,
  openStore,
  type AnalysisMeta,
  type InsertEventInput,
  type Store,
  type StoreOptions,
} from '../src/index';

installSqliteWarningFilter();

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

/** A temporary directory removed after the test. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'stillwatch-storage-'));
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

/** Opens a store in a fresh temporary directory, closed after the test. */
export function openTemp(options: Partial<StoreOptions> = {}): Store {
  const path = options.path ?? join(tempDir(), 'stillwatch.db');
  const store = openStore({ ...options, path });
  cleanups.unshift(() => {
    store.close();
  });
  return store;
}

let counter = 0;

type Kind = NormalizedEvent['kind'];
type DataOf<K extends Kind> = Extract<NormalizedEvent, { kind: K }>['data'];

/** Builds a normalized event with unique ids. */
export function ev<K extends Kind>(
  kind: K,
  data: DataOf<K>,
  overrides: Partial<EventBase> = {},
): NormalizedEvent {
  counter++;
  return {
    id: `ev-${String(counter).padStart(8, '0')}`,
    sourceId: `src-${String(counter)}`,
    agent: 'claude-code',
    sessionId: 's1',
    agentId: null,
    agentType: null,
    promptId: null,
    sourceEvent: 'Test',
    ts: 1_000_000 + counter,
    cwd: null,
    permissionMode: null,
    transcriptPath: null,
    tool: null,
    ...overrides,
    kind,
    data,
  } as NormalizedEvent;
}

/** A tool call with defaults. */
export function tool(name: string, useId: string | null, extra: Partial<ToolCall> = {}): ToolCall {
  return {
    name,
    useId,
    category: 'shell',
    input: { command: 'ls' },
    response: null,
    error: null,
    isInterrupt: null,
    durationMs: null,
    mcpServer: null,
    filePath: null,
    url: null,
    command: 'ls',
    sandboxDisabled: false,
    runInBackground: false,
    changedFiles: [],
    ...extra,
  };
}

/** Wraps an event for insertEvents. */
export function item(event: NormalizedEvent, projectRoot: string | null = null): InsertEventInput {
  return { event, facts: emptyFacts(1), redactions: [], projectRoot };
}

export function stats(): SessionStats {
  return {
    toolCalls: 0,
    byCategory: {},
    filesRead: 0,
    filesWritten: 0,
    commands: 0,
    failures: 0,
    prompts: 0,
    turns: 0,
    subagents: 0,
    permissionRequests: 0,
    denials: 0,
    durationMs: null,
  };
}

export function finding(
  sessionId: string,
  id: string,
  severity: Finding['severity'],
  eventIds: string[] = [],
): Finding {
  return {
    id,
    sessionId,
    ruleId: 'memory.note_written',
    severity,
    title: `Finding ${id}`,
    reason: 'test',
    subject: id,
    evidence: { eventIds, paths: [], artifactIds: [], note: null },
    requested: null,
    ts: 1,
  };
}

export function emptyResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    findings: [],
    fileChanges: [],
    artifacts: [],
    links: [],
    domains: [],
    gaps: [],
    unfinished: [],
    sensitiveAccess: [],
    stats: stats(),
    risk: 'low',
    riskReasons: [],
    lastAssistantMessage: null,
    ...overrides,
  };
}

export function meta(
  analyzedThroughSeq: number,
  overrides: Partial<AnalysisMeta> = {},
): AnalysisMeta {
  return {
    summary: 'summary',
    analyzedThroughSeq,
    analysisVersion: 1,
    status: 'active',
    endReason: null,
    ...overrides,
  };
}
