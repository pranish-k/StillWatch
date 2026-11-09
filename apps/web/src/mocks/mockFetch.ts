/**
 * An in-browser stand-in for the collector API, used in `vite` dev mode with
 * VITE_STILLWATCH_MOCK=1 and in tests. Never part of the production bundle.
 */
import {
  RISK_LEVELS,
  SESSION_STATUSES,
  riskRank,
  type ApiErrorBody,
  type EventView,
  type RiskLevel,
  type SessionListResponse,
  type SessionStatus,
} from '@stillwatch/schema';
import type { FetchLike } from '../api/client';
import type { MockSession } from './assemble';
import { reportMarkdown } from './markdown';
import { buildSessions, buildStatus } from './sessions';

export type MockScenario = 'default' | 'empty' | 'offline';

export type MockOptions = {
  latencyMs?: number;
  scenario?: MockScenario;
  now?: number;
  /** Tokens the mock accepts. Default: any non-empty token. */
  validToken?: (token: string) => boolean;
};

export type MockServer = {
  fetch: FetchLike;
  sessions: MockSession[];
  requests: { method: string; url: string; auth: string | null }[];
};

export const MOCK_TOKEN = 'mock-token';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fail(status: number, code: string, message: string): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return json(body, status);
}

function list<T extends string>(value: string | null, allowed: readonly T[]): T[] | null {
  if (value === null || value === '') return null;
  return value.split(',').filter((v): v is T => (allowed as readonly string[]).includes(v));
}

function delay(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
}

export function createMockServer(options: MockOptions = {}): MockServer {
  const now = options.now ?? Date.now();
  const scenario = options.scenario ?? 'default';
  const sessions = scenario === 'empty' ? [] : buildSessions(now);
  const status = buildStatus(now, sessions);
  const requests: MockServer['requests'] = [];
  const validToken = options.validToken ?? ((t: string) => t.length > 0);
  let eventIndex: Map<string, EventView> | null = null;

  function findSession(id: string): MockSession | undefined {
    return sessions.find((s) => s.summary.id === id);
  }

  function listSessions(params: URLSearchParams): SessionListResponse {
    const risk = list<RiskLevel>(params.get('risk'), RISK_LEVELS);
    const statuses = list<SessionStatus>(params.get('status'), SESSION_STATUSES);
    const q = (params.get('q') ?? '').toLowerCase();
    const sort = params.get('sort') === 'recent' ? 'recent' : 'review';
    const limit = Math.min(200, Math.max(1, Number(params.get('limit') ?? 50) || 50));
    const offset = Number(params.get('cursor') ?? 0) || 0;
    const matches = sessions
      .map((s) => s.summary)
      .filter((s) => risk === null || risk.includes(s.risk))
      .filter((s) => statuses === null || statuses.includes(s.status))
      .filter(
        (s) =>
          q === '' ||
          [s.title, s.summary, s.projectName].some((v) => v?.toLowerCase().includes(q) === true),
      )
      .sort((a, b) =>
        sort === 'review'
          ? riskRank(b.risk) - riskRank(a.risk) || b.lastEventAt - a.lastEventAt
          : b.lastEventAt - a.lastEventAt,
      );
    const page = matches.slice(offset, offset + limit);
    const next = offset + limit;
    return {
      sessions: page,
      nextCursor: next < matches.length ? String(next) : null,
      total: matches.length,
    };
  }

  function route(method: string, url: URL): Response {
    const path = url.pathname;
    if (method === 'GET' && path === '/api/status') return json(status);
    if (method === 'GET' && path === '/api/sessions') return json(listSessions(url.searchParams));

    const eventMatch = /^\/api\/events\/([^/]+)$/.exec(path);
    if (method === 'GET' && eventMatch?.[1] !== undefined) {
      eventIndex ??= new Map(sessions.flatMap((s) => s.events.map((e) => [e.id, e] as const)));
      const event = eventIndex.get(decodeURIComponent(eventMatch[1]));
      return event ? json(event) : fail(404, 'not_found', 'Event not found');
    }

    const m = /^\/api\/sessions\/([^/]+)(\/events|\/report\.md|\/reanalyze)?$/.exec(path);
    const id = m?.[1] === undefined ? null : decodeURIComponent(m[1]);
    const session = id === null ? undefined : findSession(id);
    if (!m || !session) return fail(404, 'not_found', 'Session not found');
    const sub = m[2];
    if (sub === undefined && method === 'GET') return json(session.detail);
    if (sub === undefined && method === 'DELETE') {
      sessions.splice(sessions.indexOf(session), 1);
      return json({ ok: true });
    }
    if (sub === '/events' && method === 'GET') {
      const limit = Math.min(500, Number(url.searchParams.get('limit') ?? 200) || 200);
      const offset = Number(url.searchParams.get('cursor') ?? 0) || 0;
      const next = offset + limit;
      return json({
        events: session.events.slice(offset, next),
        nextCursor: next < session.events.length ? String(next) : null,
      });
    }
    if (sub === '/report.md' && method === 'GET') {
      return new Response(reportMarkdown(session.detail.report), {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="stillwatch-${session.summary.id.slice(0, 8)}.md"`,
        },
      });
    }
    if (sub === '/reanalyze' && method === 'POST') return json({ ok: true });
    return fail(405, 'method_not_allowed', 'Method not allowed');
  }

  const fetch: FetchLike = async (input, init) => {
    const method = (init.method ?? 'GET').toUpperCase();
    const url = new URL(input, 'http://127.0.0.1:7391');
    const headers = new Headers(init.headers);
    const auth = headers.get('Authorization');
    requests.push({ method, url: url.pathname + url.search, auth });
    await delay(options.latencyMs ?? 0, init.signal);
    if (scenario === 'offline') throw new TypeError('Failed to fetch');
    if (url.pathname === '/api/auth/exchange' && method === 'POST') {
      return json({ token: MOCK_TOKEN, expiresAt: Date.now() + 30 * 24 * 3600_000 });
    }
    const token = auth?.startsWith('Bearer ') === true ? auth.slice(7) : '';
    if (!validToken(token)) return fail(401, 'unauthorized', 'Sign in again.');
    return route(method, url);
  };

  return { fetch, sessions, requests };
}
