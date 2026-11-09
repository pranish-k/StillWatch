/**
 * Test builders: sessions, events, and snapshots. Unless a test passes facts,
 * each event's facts come from the real extractor, as the collector stores them.
 */
import { extractFacts } from '@stillwatch/facts';
import {
  emptyFacts,
  type AnalysisInput,
  type EventFacts,
  type EventKind,
  type FileAccess,
  type PathClass,
  type RawFileChange,
  type SessionSnapshot,
  type SnapshotDiff,
  type StoredEvent,
  type SurfaceChange,
  type ToolCall,
  type ToolCategory,
} from '@stillwatch/schema';

export const HOME = '/home/u';
export const REPO = '/home/u/proj';
export const SID = 'session-1';
export const T0 = 1_700_000_000_000;

export function access(
  path: string,
  op: FileAccess['op'],
  via: FileAccess['via'] = 'tool',
): FileAccess {
  return { path, op, via, detail: 'test', unresolved: false };
}

export function facts(partial: Partial<EventFacts> = {}): EventFacts {
  return { ...emptyFacts(1), ...partial };
}

type ToolSpec = {
  input?: ToolCall['input'];
  filePath?: string | null;
  command?: string | null;
  url?: string | null;
  response?: ToolCall['response'];
  sandboxDisabled?: boolean;
  changedFiles?: string[];
  /** Facts of the call (input side). */
  facts?: Partial<EventFacts>;
  /** Extra facts only on the result (response side). */
  resultFacts?: Partial<EventFacts>;
  outcome?: 'ok' | 'fail' | 'denied' | 'open' | 'result_only';
};

/** Builds a session's events with a deterministic clock (one second per event). */
export class SessionBuilder {
  readonly events: StoredEvent[] = [];
  private seq = 0;
  private use = 0;
  ts = T0;
  permissionMode: string | null = 'default';

  readonly sessionId: string;

  constructor(sessionId: string = SID) {
    this.sessionId = sessionId;
  }

  advance(ms: number): this {
    this.ts += ms;
    return this;
  }

  push(
    kind: EventKind,
    data: unknown,
    opts: { tool?: ToolCall | null; facts?: Partial<EventFacts> | undefined } = {},
  ): StoredEvent {
    this.seq += 1;
    this.ts += 1000;
    const event = {
      id: `ev-${String(this.seq).padStart(5, '0')}`,
      sourceId: `src-${this.seq}`,
      agent: 'claude-code',
      sessionId: this.sessionId,
      agentId: null,
      agentType: null,
      promptId: null,
      sourceEvent: kind,
      ts: this.ts,
      cwd: REPO,
      permissionMode: this.permissionMode,
      transcriptPath: null,
      tool: opts.tool ?? null,
      kind,
      data,
      seq: this.seq,
      orderTs: this.ts,
      facts: emptyFacts(1),
      redactions: [],
      hash: `h${this.seq}`,
    } as StoredEvent;
    event.facts =
      opts.facts === undefined
        ? extractFacts(event, {
            home: HOME,
            stillwatchHome: `${HOME}/.stillwatch`,
          })
        : facts(opts.facts);
    this.events.push(event);
    return event;
  }

  prompt(
    text: string,
    origin: 'user' | 'task_notification' | 'cross_session' = 'user',
  ): StoredEvent {
    return this.push('prompt.submit', { prompt: text, origin, sessionTitle: null });
  }

  stop(
    data: Partial<{
      lastMessage: string | null;
      backgroundTasks: unknown[];
      sessionCrons: unknown[];
    }> = {},
  ): StoredEvent {
    return this.push('turn.stop', {
      lastMessage: null,
      backgroundTasks: [],
      sessionCrons: [],
      stopHookActive: null,
      ...data,
    });
  }

  /** A tool call: tool.pre plus its result. Returns [pre, result]. */
  tool(name: string, category: ToolCategory, spec: ToolSpec = {}): StoredEvent[] {
    this.use += 1;
    const base: ToolCall = {
      name,
      useId: `tu-${this.use}`,
      category,
      input: spec.input ?? {},
      response: null,
      error: null,
      isInterrupt: null,
      durationMs: null,
      mcpServer: null,
      filePath: spec.filePath ?? null,
      url: spec.url ?? null,
      command: spec.command ?? null,
      sandboxDisabled: spec.sandboxDisabled ?? false,
      runInBackground: false,
      changedFiles: [],
    };
    const outcome = spec.outcome ?? 'ok';
    const out: StoredEvent[] = [];
    if (outcome !== 'result_only')
      out.push(this.push('tool.pre', {}, { tool: base, facts: spec.facts }));
    const merged =
      spec.facts === undefined && spec.resultFacts === undefined
        ? undefined
        : mergeFacts(spec.facts ?? {}, spec.resultFacts ?? {});
    if (outcome === 'ok' || outcome === 'result_only') {
      out.push(
        this.push(
          'tool.post',
          {},
          {
            tool: {
              ...base,
              response: spec.response ?? null,
              changedFiles: spec.changedFiles ?? [],
            },
            facts: merged,
          },
        ),
      );
    } else if (outcome === 'fail') {
      out.push(
        this.push('tool.failure', {}, { tool: { ...base, error: 'failed' }, facts: merged }),
      );
    } else if (outcome === 'denied') {
      out.push(this.push('permission.denied', { reason: 'denied' }, { tool: base }));
    }
    return out;
  }

  write(path: string, content: string, created = false): StoredEvent[] {
    return this.tool('Write', 'file.write', {
      input: { file_path: path, content },
      filePath: path,
      response: { type: created ? 'create' : 'update' },
    });
  }

  /** Reads a file; `content` becomes the tool response the agent sees. */
  read(path: string, content = 'file content'): StoredEvent[] {
    return this.tool('Read', 'file.read', {
      input: { file_path: path },
      filePath: path,
      response: { file: { filePath: path, content } },
    });
  }

  bash(command: string, extra: Omit<ToolSpec, 'input' | 'command'> = {}): StoredEvent[] {
    return this.tool('Bash', 'shell', { input: { command }, command, ...extra });
  }
}

function mergeFacts(a: Partial<EventFacts>, b: Partial<EventFacts>): Partial<EventFacts> {
  const out: Partial<EventFacts> = { ...a };
  for (const key of [
    'files',
    'commands',
    'urls',
    'domains',
    'packages',
    'signals',
    'secrets',
  ] as const) {
    const merged = [...(a[key] ?? []), ...(b[key] ?? [])];
    (out as Record<string, unknown>)[key] = merged;
  }
  return out;
}

export function snapshot(
  kind: SessionSnapshot['kind'],
  takenAt: number,
  overlay: Record<string, string | null> = {},
): SessionSnapshot {
  return {
    v: 1,
    kind,
    sessionId: SID,
    takenAt,
    cwd: REPO,
    repos: [
      {
        root: REPO,
        gitCommonDir: `${REPO}/.git`,
        head: 'abc',
        branch: 'main',
        hooksPath: `${REPO}/.git/hooks`,
        overlay,
        overlayTruncated: false,
        error: null,
      },
    ],
    surface: [],
    durationMs: 5,
    late: false,
  };
}

export function fileChange(
  rel: string,
  change: RawFileChange['change'] = 'modified',
): RawFileChange {
  return {
    repoRoot: REPO,
    path: `${REPO}/${rel}`,
    relPath: rel,
    change,
    oldPath: null,
    additions: 1,
    deletions: 0,
    binary: false,
    committed: false,
  };
}

export function surfaceChange(
  path: string,
  cls: PathClass,
  partial: Partial<SurfaceChange> = {},
): SurfaceChange {
  return {
    path,
    class: cls,
    label: 'Surface',
    kind: 'file',
    change: 'modified',
    childChanges: null,
    hashAfter: 'hh',
    ...partial,
  };
}

export function diff(partial: Partial<SnapshotDiff> = {}): SnapshotDiff {
  return {
    files: [],
    surface: [],
    headMoved: [],
    commits: [],
    truncated: false,
    errors: [],
    ...partial,
  };
}

/** An analysis input with start and end snapshots and an empty diff unless overridden. */
export function makeInput(b: SessionBuilder, over: Partial<AnalysisInput> = {}): AnalysisInput {
  const end = b.ts + 1000;
  return {
    session: {
      id: b.sessionId,
      agent: 'claude-code',
      projectId: 'p1',
      projectRoot: REPO,
      projectName: 'proj',
      cwd: REPO,
      transcriptPath: null,
      title: null,
      startedAt: T0,
      endedAt: null,
      lastEventAt: b.ts,
      status: 'active',
      endReason: null,
      risk: 'low',
      riskReasons: [],
      model: null,
      permissionMode: null,
      summary: null,
      eventCount: b.events.length,
      findingCount: 0,
      fileChangeCount: 0,
      subagentCount: 0,
      analyzedAt: null,
      analysisVersion: null,
      chainHead: null,
    },
    events: b.events,
    start: snapshot('start', T0),
    end: snapshot('end', end),
    diff: diff(),
    gaps: [],
    prior: { knownDomains: [], noteWriters: {}, overlapping: [] },
    home: HOME,
    status: 'active',
    now: end,
    ...over,
  };
}
