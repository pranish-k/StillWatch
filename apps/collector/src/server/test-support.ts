/**
 * Test helpers for the server tests: a raw HTTP client that controls Host,
 * path, and body exactly, an in-memory fake `Store`, and fake deps.
 * Imported only by `*.test.ts` files.
 */
import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type {
  SessionDetail,
  SessionRecord,
  StatusResponse,
  StillwatchConfig,
  StoredEvent,
} from '@stillwatch/schema';
import type { Store } from '@stillwatch/storage';
import type { Logger } from '../types';
import type { ServerDeps } from './types';

export type RawResponse = { status: number; headers: IncomingHttpHeaders; body: string };

export type RawRequest = {
  method?: string;
  path: string;
  /** Host header; defaults to `127.0.0.1:<port>`. */
  host?: string;
  headers?: Record<string, string>;
  /** Written as is; Content-Length is set unless `chunked` is true. */
  body?: string | Buffer;
  chunked?: boolean;
  /** Leaves the request open after the headers (for timeout tests). */
  hold?: boolean;
};

/** Sends one request on a fresh connection and collects the whole response. */
export function send(port: number, options: RawRequest): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      Host: options.host ?? `127.0.0.1:${port}`,
      ...options.headers,
    };
    const body =
      typeof options.body === 'string' ? Buffer.from(options.body, 'utf8') : options.body;
    if (body !== undefined && options.chunked !== true) {
      headers['Content-Length'] = String(body.length);
    }
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: options.method ?? 'GET',
        path: options.path,
        headers,
        agent: false,
        setHost: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (options.chunked === true) req.setHeader('Transfer-Encoding', 'chunked');
    if (body !== undefined) req.write(body);
    if (options.hold !== true) req.end();
    else req.flushHeaders();
  });
}

/** Parses a JSON response body. */
export function json(response: RawResponse): unknown {
  return JSON.parse(response.body) as unknown;
}

/** A fresh base64url secret built at runtime (never a literal). */
export function fakeConfig(): StillwatchConfig {
  return {
    v: 1,
    port: 7391,
    retentionDays: 30,
    authSecret: randomBytes(32).toString('base64url'),
    fingerprintKey: randomBytes(32).toString('base64url'),
    createdAt: 0,
    install: null,
  };
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function unexpected(name: string): () => never {
  return () => {
    throw new Error(`unexpected store call: ${name}`);
  };
}

/** A `Store` whose methods throw unless overridden. */
export function fakeStore(overrides: Partial<Store> = {}): Store {
  const base: Store = {
    path: ':memory:',
    close: () => undefined,
    insertEvents: unexpected('insertEvents'),
    saveSnapshot: unexpected('saveSnapshot'),
    getSnapshot: unexpected('getSnapshot'),
    addGap: unexpected('addGap'),
    getGaps: unexpected('getGaps'),
    saveAnalysis: unexpected('saveAnalysis'),
    setSessionStatus: unexpected('setSessionStatus'),
    markForAnalysis: unexpected('markForAnalysis'),
    pendingAnalysis: unexpected('pendingAnalysis'),
    getPriorContext: unexpected('getPriorContext'),
    getSession: unexpected('getSession'),
    listSessions: unexpected('listSessions'),
    getSessionDetail: unexpected('getSessionDetail'),
    getSessionEvents: unexpected('getSessionEvents'),
    listEvents: unexpected('listEvents'),
    getEvent: unexpected('getEvent'),
    findingIdsByEvent: unexpected('findingIdsByEvent'),
    sessionsWithStatus: unexpected('sessionsWithStatus'),
    lastEventAt: unexpected('lastEventAt'),
    deleteSession: unexpected('deleteSession'),
    deleteSessionsBefore: unexpected('deleteSessionsBefore'),
    deleteAll: unexpected('deleteAll'),
    verifyChain: unexpected('verifyChain'),
    counts: unexpected('counts'),
  };
  return { ...base, ...overrides };
}

/** Minimal session record for tests. */
export function fakeSession(id: string): SessionRecord {
  return {
    id,
    agent: 'claude-code',
    projectId: 'p1',
    projectRoot: '/work/repo',
    projectName: 'repo',
    cwd: '/work/repo/sub',
    transcriptPath: null,
    title: 'Fix tests',
    startedAt: 1_000,
    endedAt: null,
    lastEventAt: 2_000,
    status: 'active',
    endReason: null,
    risk: 'low',
    riskReasons: [],
    model: null,
    permissionMode: null,
    summary: null,
    eventCount: 1,
    findingCount: 0,
    fileChangeCount: 0,
    subagentCount: 0,
    analyzedAt: null,
    analysisVersion: null,
    chainHead: null,
  };
}

/** Minimal session detail for tests. */
export function fakeDetail(id: string): SessionDetail {
  return {
    session: fakeSession(id),
    agents: [],
    findings: [],
    fileChanges: [],
    artifacts: [],
    links: [],
    gaps: [],
    domains: [],
    unfinished: [],
    sensitiveAccess: [],
    stats: null,
    lastAssistantMessage: null,
  };
}

/** Minimal stored event for tests; only the fields the server reads matter. */
export function fakeEvent(id: string, sessionId: string): StoredEvent {
  const event = {
    id,
    sourceId: `src-${id}`,
    agent: 'claude-code',
    sessionId,
    agentId: null,
    agentType: null,
    promptId: null,
    sourceEvent: 'PreToolUse',
    ts: 1_500,
    cwd: '/work/repo',
    permissionMode: null,
    transcriptPath: null,
    tool: null,
    kind: 'tool.pre',
    data: {},
    seq: 1,
    orderTs: 1_500,
    facts: {},
    redactions: [],
    hash: 'h',
  };
  return event as unknown as StoredEvent;
}

export function fakeStatus(): StatusResponse {
  return { version: '0.0.0-test' } as unknown as StatusResponse;
}

/** Deps with a controllable clock; override any field. */
export function fakeDeps(
  overrides: Partial<ServerDeps> = {},
): ServerDeps & { clock: { now: number } } {
  const clock = { now: 1_700_000_000_000 };
  return {
    store: fakeStore(),
    config: fakeConfig(),
    version: '0.0.0-test',
    webRoot: null,
    port: 0,
    logger: silentLogger,
    now: () => clock.now,
    userHome: '/home/tester',
    getStatus: () => Promise.resolve(fakeStatus()),
    requestAnalysis: () => undefined,
    onSessionDeleted: () => undefined,
    ...overrides,
    clock,
  };
}
