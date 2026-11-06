/**
 * In-memory fakes of the packages the collector core depends on, for unit tests.
 */
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  emptyFacts,
  isRecord,
  type AnalysisResult,
  type CaptureGap,
  type HookInstallStatus,
  type NormalizedEvent,
  type SessionRecord,
  type SessionSnapshot,
  type SessionStatus,
  type StoredEvent,
} from '@stillwatch/schema';
import type { AdaptResult, SpoolRecord } from '@stillwatch/adapter-claude';
import type { SnapshotOptions } from '@stillwatch/git-tracker';
import type { StatusInput } from '@stillwatch/rules';
import type { InsertEventInput, InsertResult, Store } from '@stillwatch/storage';
import type { PipelineDeps } from '../src/deps';
import { buildPipeline, type PipelineInternal } from '../src/pipeline-core';
import type { PipelineOptions } from '../src/pipeline';
import type { LogFields, Logger } from '../src/types';

export class FakeStore implements Store {
  readonly path: string;
  closed = false;
  events: StoredEvent[] = [];
  sessions = new Map<string, SessionRecord>();
  snapshots = new Map<string, SessionSnapshot>();
  gaps: CaptureGap[] = [];
  analyzed = new Map<string, number>();
  analyses: { sessionId: string; through: number; status: SessionStatus; summary: string }[] = [];
  insertCalls: number[] = [];
  statusCalls: { id: string; status: SessionStatus; endReason: string | null }[] = [];
  retentionCutoffs: number[] = [];
  failInsert: ((items: InsertEventInput[]) => boolean) | null = null;
  private seq = 0;

  constructor(path: string) {
    this.path = path;
  }

  close(): void {
    this.closed = true;
  }

  insertEvents(items: InsertEventInput[]): InsertResult {
    this.insertCalls.push(items.length);
    if (this.failInsert?.(items) === true) throw new Error('fake insert failure');
    let inserted = 0;
    let duplicates = 0;
    const ids = new Set<string>();
    for (const item of items) {
      const e = item.event;
      if (this.events.some((x) => x.sourceId === e.sourceId)) {
        duplicates++;
        continue;
      }
      inserted++;
      ids.add(e.sessionId);
      this.seq++;
      this.events.push({
        ...e,
        seq: this.seq,
        orderTs: e.ts,
        facts: item.facts,
        redactions: item.redactions,
        hash: 'h',
      });
      const s = this.sessions.get(e.sessionId) ?? newSession(e, item.projectRoot);
      s.lastEventAt = Math.max(s.lastEventAt, e.ts);
      s.startedAt = Math.min(s.startedAt, e.ts);
      s.cwd ??= e.cwd;
      s.eventCount++;
      if (e.kind === 'session.end') {
        s.status = 'finished';
        s.endedAt = e.ts;
      } else if (s.status !== 'active') {
        s.status = 'active';
        s.endedAt = null;
      }
      this.sessions.set(e.sessionId, s);
    }
    return { inserted, duplicates, sessionIds: [...ids] };
  }

  saveSnapshot(snapshot: SessionSnapshot): void {
    this.snapshots.set(`${snapshot.sessionId}:${snapshot.kind}`, snapshot);
  }
  getSnapshot(sessionId: string, kind: 'start' | 'end'): SessionSnapshot | null {
    return this.snapshots.get(`${sessionId}:${kind}`) ?? null;
  }
  addGap(gap: CaptureGap): void {
    this.gaps.push(gap);
  }
  getGaps(sessionId: string | null, options?: { excludeSource?: CaptureGap['source'] }) {
    return this.gaps.filter(
      (g) => g.sessionId === sessionId && g.source !== options?.excludeSource,
    );
  }
  saveAnalysis(
    sessionId: string,
    _result: AnalysisResult,
    meta: { summary: string; analyzedThroughSeq: number; status: SessionStatus },
  ): void {
    this.analyzed.set(sessionId, meta.analyzedThroughSeq);
    this.analyses.push({
      sessionId,
      through: meta.analyzedThroughSeq,
      status: meta.status,
      summary: meta.summary,
    });
  }
  setSessionStatus(id: string, status: SessionStatus, endReason: string | null): void {
    this.statusCalls.push({ id, status, endReason });
    const s = this.sessions.get(id);
    if (s) s.status = status;
  }
  markForAnalysis(sessionId: string): void {
    this.analyzed.set(sessionId, -1);
  }
  pendingAnalysis(): { sessionId: string; maxSeq: number }[] {
    const out: { sessionId: string; maxSeq: number }[] = [];
    for (const id of this.sessions.keys()) {
      const maxSeq = Math.max(0, ...this.getSessionEvents(id).map((e) => e.seq));
      if ((this.analyzed.get(id) ?? 0) < maxSeq) out.push({ sessionId: id, maxSeq });
    }
    return out;
  }
  getPriorContext() {
    return { knownDomains: [], noteWriters: {}, overlapping: [] };
  }
  getSession(id: string): SessionRecord | null {
    return this.sessions.get(id) ?? null;
  }
  getSessionEvents(sessionId: string): StoredEvent[] {
    return this.events.filter((e) => e.sessionId === sessionId);
  }
  sessionsWithStatus(status: SessionStatus): SessionRecord[] {
    return [...this.sessions.values()].filter((s) => s.status === status);
  }
  lastEventAt(): number | null {
    return this.events.length === 0 ? null : Math.max(...this.events.map((e) => e.ts));
  }
  deleteSession(id: string): boolean {
    return this.sessions.delete(id);
  }
  deleteSessionsBefore(cutoff: number): number {
    this.retentionCutoffs.push(cutoff);
    let n = 0;
    for (const [id, s] of this.sessions) {
      if (s.lastEventAt < cutoff) {
        this.sessions.delete(id);
        n++;
      }
    }
    return n;
  }
  counts() {
    return { sessions: this.sessions.size, events: this.events.length, sizeBytes: 4096 };
  }
  listSessions(): never {
    throw new Error('not used');
  }
  getSessionDetail(): never {
    throw new Error('not used');
  }
  listEvents(): never {
    throw new Error('not used');
  }
  getEvent(): never {
    throw new Error('not used');
  }
  findingIdsByEvent(): never {
    throw new Error('not used');
  }
  deleteAll(): void {
    this.sessions.clear();
  }
  verifyChain(): never {
    throw new Error('not used');
  }
}

function newSession(e: NormalizedEvent, projectRoot: string | null): SessionRecord {
  return {
    id: e.sessionId,
    agent: 'claude-code',
    projectId: null,
    projectRoot,
    projectName: null,
    cwd: null,
    transcriptPath: e.transcriptPath,
    title: null,
    startedAt: e.ts,
    endedAt: null,
    lastEventAt: e.ts,
    status: 'active',
    endReason: null,
    risk: 'low',
    riskReasons: [],
    model: null,
    permissionMode: null,
    summary: null,
    eventCount: 0,
    findingCount: 0,
    fileChangeCount: 0,
    subagentCount: 0,
    analyzedAt: null,
    analysisVersion: null,
    chainHead: null,
  };
}

/** Fake adapter: JSON with session_id, hook_event_name, cwd, and optional directory. */
export function fakeAdapt(record: SpoolRecord): AdaptResult {
  let raw: unknown;
  try {
    raw = JSON.parse(record.body);
  } catch {
    return { ok: false, reason: 'invalid JSON', sessionId: null };
  }
  if (!isRecord(raw)) return { ok: false, reason: 'not an object', sessionId: null };
  const sessionId = typeof raw.session_id === 'string' ? raw.session_id : null;
  const name = typeof raw.hook_event_name === 'string' ? raw.hook_event_name : null;
  if (sessionId === null || name === null) return { ok: false, reason: 'missing fields', sessionId };
  const base = {
    id: `id-${record.sourceId}`,
    sourceId: record.sourceId,
    agent: 'claude-code' as const,
    sessionId,
    agentId: null,
    agentType: null,
    promptId: null,
    sourceEvent: name,
    ts: record.receivedAt,
    cwd: typeof raw.cwd === 'string' ? raw.cwd : null,
    permissionMode: null,
    transcriptPath: null,
    tool: null,
  };
  let event: NormalizedEvent;
  if (name === 'SessionStart') {
    event = { ...base, kind: 'session.start', data: { source: null, model: null, sessionTitle: null } };
  } else if (name === 'SessionEnd') {
    event = { ...base, kind: 'session.end', data: { reason: 'exit' } };
  } else if (name === 'DirectoryAdded') {
    const directory = typeof raw.directory === 'string' ? raw.directory : '';
    event = { ...base, kind: 'directory.add', data: { directory, source: null } };
  } else {
    event = { ...base, kind: 'unknown', data: { raw: {} } };
  }
  return { ok: true, event };
}

export function emptyResult(): AnalysisResult {
  return {
    findings: [],
    fileChanges: [],
    artifacts: [],
    links: [],
    domains: [],
    gaps: [],
    unfinished: [],
    sensitiveAccess: [],
    stats: {
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
    },
    risk: 'low',
    riskReasons: [],
    lastAssistantMessage: null,
  };
}

export type Recorder = {
  snapshots: SnapshotOptions[];
  analyzed: string[];
  diffs: number;
  failAnalysis: Set<string>;
  status: (input: StatusInput) => { status: SessionStatus; endReason: string | null };
  store: FakeStore | null;
};

export function fakeDeps(rec: Recorder): PipelineDeps {
  return {
    adapt: fakeAdapt,
    createRedactor: () => ({
      redactString: (text) => ({ value: text, redactions: [] }),
      redactJson: (value) => ({ value, redactions: [] }),
    }),
    extractFacts: () => emptyFacts(1),
    truncateJson: (value) => ({ value, truncated: [] }),
    openStore: (options) => {
      rec.store = new FakeStore(options.path);
      return rec.store;
    },
    takeSnapshot: (options) => {
      rec.snapshots.push(options);
      return Promise.resolve({
        v: 1,
        kind: options.kind,
        sessionId: options.sessionId,
        takenAt: options.now ? options.now() : Date.now(),
        cwd: options.cwd,
        repos: [],
        surface: options.surface.map((s) => ({
          path: s.path,
          kind: s.kind,
          class: s.class,
          label: s.label,
          exists: true,
          hash: null,
          size: null,
          mode: null,
          children: null,
          error: null,
        })),
        durationMs: 1,
        late: options.late ?? false,
      });
    },
    diffSnapshots: () => {
      rec.diffs++;
      return Promise.resolve({
        files: [],
        surface: [],
        headMoved: [],
        commits: [],
        truncated: false,
        errors: [],
      });
    },
    findRepoRoot: (dir) => Promise.resolve(dir.endsWith('/repo') ? dir : null),
    persistenceSurface: (ctx) => [
      { path: `${ctx.home}/.zshrc`, kind: 'file', class: 'startup_file', label: 'zshrc', argv: null },
    ],
    repoSurfaceSpecs: () => [
      { rel: 'hooks', base: 'git_common_dir', kind: 'dir', class: 'git_hook', label: 'hooks' },
    ],
    analyzeSession: (input) => {
      if (rec.failAnalysis.has(input.session.id)) throw new Error('rule crashed');
      rec.analyzed.push(input.session.id);
      return emptyResult();
    },
    deriveSessionStatus: (input) => ({ ...rec.status(input), midTurn: false }),
    summarizeSession: () => 'summary',
    readTranscriptSummary: () => Promise.reject(new Error('no transcript')),
    checkHookInstall: () => Promise.resolve(hookStatus()),
    startHttpServer: () => Promise.reject(new Error('not used')),
  };
}

export function hookStatus(): HookInstallStatus {
  return {
    installed: true,
    scope: 'user',
    settingsPath: '/x/settings.json',
    events: ['SessionStart'],
    missing: [],
    hookScriptOk: true,
    claudeVersion: '2.1.318',
    compatible: true,
  };
}

export type LogLine = { level: string; message: string; fields: LogFields | undefined };

export function memoryLogger(lines: LogLine[] = []): Logger & { lines: LogLine[] } {
  const add = (level: string) => (message: string, fields?: LogFields) => {
    lines.push({ level, message, fields });
  };
  return { lines, debug: add('debug'), info: add('info'), warn: add('warn'), error: add('error') };
}

export type Harness = {
  root: string;
  home: string;
  userHome: string;
  rec: Recorder;
  clock: { now: number };
  pipeline: PipelineInternal;
  store: FakeStore;
  logger: ReturnType<typeof memoryLogger>;
  spool(name: string, body: string, mtimeMs?: number): Promise<string>;
  event(
    sessionId: string,
    hook: string,
    mtimeMs: number,
    extra?: Record<string, string>,
  ): Promise<string>;
  cleanup(): Promise<void>;
};

let counter = 0;

export async function harness(
  options: Partial<PipelineOptions> = {},
  depsOverride: Partial<PipelineDeps> = {},
): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'sw-pipeline-'));
  const home = join(root, 'sw');
  const userHome = join(root, 'user');
  const clock = { now: 1_800_000_000_000 };
  const rec: Recorder = {
    snapshots: [],
    analyzed: [],
    diffs: 0,
    failAnalysis: new Set(),
    status: (input) => ({
      status: input.events.some((e) => e.kind === 'session.end') ? 'finished' : 'active',
      endReason: null,
    }),
    store: null,
  };
  const logger = memoryLogger();
  const pipeline = await buildPipeline(
    {
      stillwatchHome: home,
      userHome,
      now: () => clock.now,
      logger,
      timing: { analysisDebounceMs: 60_000 },
      ...options,
    },
    { ...fakeDeps(rec), ...depsOverride },
  );
  if (!rec.store) throw new Error('store not opened');
  const store = rec.store;
  const spool = async (name: string, body: string, mtimeMs = clock.now): Promise<string> => {
    const path = join(home, 'spool', 'new', name);
    await writeFile(path, body, { mode: 0o600 });
    await utimes(path, mtimeMs / 1000, mtimeMs / 1000);
    return path;
  };
  return {
    root,
    home,
    userHome,
    rec,
    clock,
    pipeline,
    store,
    logger,
    spool,
    event: (sessionId, hook, mtimeMs, extra = {}) =>
      spool(
        `claude-code.${hook}.n${String(++counter).padStart(8, '0')}`,
        JSON.stringify({ session_id: sessionId, hook_event_name: hook, cwd: '/w/repo', ...extra }),
        mtimeMs,
      ),
    cleanup: async () => {
      await pipeline.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
