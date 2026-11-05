import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionListQuery, SessionListResponse } from '@stillwatch/schema';
import { createLoginToken, decodeAuthSecret, issueApiToken } from './auth';
import { CONTENT_SECURITY_POLICY } from './headers';
import { startHttpServer } from './index';
import { DEFAULT_LIMITS, type ServerLimits } from './limits';
import { startServer } from './server';
import {
  fakeDeps,
  fakeDetail,
  fakeEvent,
  fakeSession,
  fakeStore,
  json,
  send,
  type RawRequest,
  type RawResponse,
} from './test-support';
import type { HttpServerHandle, ServerDeps } from './types';

vi.mock('@stillwatch/reports', () => ({
  buildSessionReport: vi.fn((detail: { session: { id: string } }) => ({
    v: 1,
    sessionId: detail.session.id,
  })),
  renderMarkdownReport: vi.fn(() => '# Session report\n'),
  describeEvent: vi.fn(() => 'Ran git status'),
}));

const reports = await import('@stillwatch/reports');

type Harness = {
  port: number;
  deps: ReturnType<typeof fakeDeps>;
  token: string;
  call(options: RawRequest): Promise<RawResponse>;
  api(method: string, path: string, extra?: Partial<RawRequest>): Promise<RawResponse>;
};

const handles: HttpServerHandle[] = [];

afterEach(async () => {
  await Promise.all(handles.splice(0).map((h) => h.close()));
  vi.clearAllMocks();
});

async function start(
  overrides: Partial<ServerDeps> = {},
  limits?: Partial<ServerLimits>,
): Promise<Harness> {
  const deps = fakeDeps(overrides);
  const handle = limits
    ? await startServer(deps, { ...DEFAULT_LIMITS, ...limits })
    : await startHttpServer(deps);
  handles.push(handle);
  const key = decodeAuthSecret(deps.config.authSecret);
  const { token } = issueApiToken(key, deps.clock.now);
  const call = (options: RawRequest) => send(handle.port, options);
  return {
    port: handle.port,
    deps,
    token,
    call,
    api: (method, path, extra = {}) =>
      call({
        method,
        path,
        ...extra,
        headers: { Authorization: `Bearer ${token}`, ...extra.headers },
      }),
  };
}

function loginFor(h: Harness, now = h.deps.clock.now): string {
  return createLoginToken(decodeAuthSecret(h.deps.config.authSecret), now);
}

function exchange(h: Harness, body: string | Buffer, headers: Record<string, string> = {}) {
  return h.call({
    method: 'POST',
    path: '/api/auth/exchange',
    headers: { 'Content-Type': 'application/json', ...headers },
    body,
  });
}

function expectSecurityHeaders(res: RawResponse): void {
  expect(res.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['referrer-policy']).toBe('no-referrer');
  expect(res.headers['x-frame-options']).toBe('DENY');
  expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
  expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
  expect(res.headers['permissions-policy']).toContain('camera=()');
  expect(res.headers['permissions-policy']).toContain('microphone=()');
  expect(res.headers['permissions-policy']).toContain('geolocation=()');
}

function expectApiError(res: RawResponse, status: number, code: string): void {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
  expect(res.headers['cache-control']).toBe('no-store');
  expectSecurityHeaders(res);
  const body = json(res) as { error: { code: string; message: string } };
  expect(body.error.code).toBe(code);
  expect(typeof body.error.message).toBe('string');
}

describe('auth exchange', () => {
  it('exchanges a login link for a token that unlocks the API', async () => {
    const h = await start();
    const res = await exchange(h, JSON.stringify({ login: loginFor(h) }));
    expect(res.status).toBe(200);
    expectSecurityHeaders(res);
    expect(res.headers['cache-control']).toBe('no-store');
    const { token, expiresAt } = json(res) as { token: string; expiresAt: number };
    expect(expiresAt).toBe(h.deps.clock.now + 30 * 24 * 60 * 60 * 1000);
    const status = await h.call({
      path: '/api/status',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status.status).toBe(200);
    expect(json(status)).toEqual({ version: '0.0.0-test' });
  });

  it('rejects bad signature, expired, replayed, and malformed logins with 401', async () => {
    const h = await start();
    const valid = loginFor(h);
    const badSig = loginFor(h).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    const foreign = createLoginToken(randomBytes(32), h.deps.clock.now);
    const expired = loginFor(h, h.deps.clock.now - 121_000);
    expect((await exchange(h, JSON.stringify({ login: valid }))).status).toBe(200);
    for (const login of [badSig, foreign, expired, valid, 'garbage', '1.2.3']) {
      const res = await exchange(h, JSON.stringify({ login }));
      expectApiError(res, 401, 'unauthorized');
    }
  });

  it('rejects malformed bodies', async () => {
    const h = await start();
    expectApiError(await exchange(h, '{'), 400, 'bad_request');
    expectApiError(await exchange(h, '[]'), 400, 'bad_request');
    expectApiError(await exchange(h, '{"login":1}'), 400, 'bad_request');
    expectApiError(await exchange(h, '{"login":"a","x":1}'), 400, 'bad_request');
    expectApiError(await exchange(h, Buffer.from([0x7b, 0xff, 0x7d])), 400, 'bad_request');
    expectApiError(
      await h.call({ method: 'POST', path: '/api/auth/exchange' }),
      400,
      'bad_request',
    );
    expectApiError(
      await exchange(h, '{"login":"a"}', { 'Content-Type': 'text/plain' }),
      415,
      'unsupported_media_type',
    );
  });

  it('rate limits exchanges to 20 per minute', async () => {
    const h = await start();
    for (let i = 0; i < 20; i++) {
      expect((await exchange(h, '{"login":"x"}')).status).toBe(401);
    }
    const limited = await exchange(h, JSON.stringify({ login: loginFor(h) }));
    expectApiError(limited, 429, 'rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    h.deps.clock.now += 60_000;
    expect((await exchange(h, JSON.stringify({ login: loginFor(h) }))).status).toBe(200);
  });
});

describe('bearer tokens', () => {
  it('requires a valid, unexpired bearer token on every other API route', async () => {
    const h = await start();
    const missing = await h.call({ path: '/api/status' });
    expectApiError(missing, 401, 'unauthorized');
    expect(missing.headers['www-authenticate']).toBe('Bearer');
    const wrong = issueApiToken(randomBytes(32), h.deps.clock.now).token;
    for (const header of [`Bearer ${wrong}`, `Basic ${h.token}`, h.token, 'Bearer ']) {
      const res = await h.call({ path: '/api/sessions', headers: { Authorization: header } });
      expectApiError(res, 401, 'unauthorized');
    }
    // Unknown API paths do not reveal anything without a token.
    expectApiError(await h.call({ path: '/api/nope' }), 401, 'unauthorized');
    h.deps.clock.now += 30 * 24 * 60 * 60 * 1000;
    expectApiError(await h.api('GET', '/api/status'), 401, 'unauthorized');
  });
});

describe('request guards', () => {
  it('rejects Host headers other than 127.0.0.1:<port> and localhost:<port>', async () => {
    const h = await start();
    for (const host of [
      'evil.example',
      `evil.example:${h.port}`,
      `127.0.0.1:${h.port + 1}`,
      '127.0.0.1',
      `LOCALHOST:${h.port}`,
      `[::1]:${h.port}`,
      `127.0.0.1:${h.port}.evil.example`,
    ]) {
      expectApiError(await h.api('GET', '/api/status', { host }), 421, 'misdirected_request');
    }
    expectApiError(await h.call({ path: '/', host: 'rebind.example' }), 421, 'misdirected_request');
    expect((await h.api('GET', '/api/status', { host: `localhost:${h.port}` })).status).toBe(200);
  });

  it('checks Origin on POST and DELETE', async () => {
    const getSession = vi.fn(() => fakeSession('s1'));
    const h = await start({ store: fakeStore({ getSession, deleteSession: () => true }) });
    for (const origin of ['http://evil.example', 'null', `https://127.0.0.1:${h.port}`]) {
      const res = await h.api('POST', '/api/sessions/s1/reanalyze', {
        headers: { Origin: origin },
      });
      expectApiError(res, 403, 'forbidden');
      expectApiError(
        await h.api('DELETE', '/api/sessions/s1', { headers: { Origin: origin } }),
        403,
        'forbidden',
      );
    }
    expect(getSession).not.toHaveBeenCalled();
    const ok = await h.api('POST', '/api/sessions/s1/reanalyze', {
      headers: { Origin: `http://localhost:${h.port}` },
    });
    expect(ok.status).toBe(200);
    // GET requests are protected by the bearer token, not by Origin.
    const get = await h.api('GET', '/api/status', { headers: { Origin: 'http://evil.example' } });
    expect(get.status).toBe(200);
  });

  it('allows only GET, HEAD, POST, and DELETE, and the right one per route', async () => {
    const h = await start();
    for (const method of ['PUT', 'PATCH', 'OPTIONS']) {
      const res = await h.api(method, '/api/status');
      expectApiError(res, 405, 'method_not_allowed');
      expect(res.headers.allow).toBe('GET, HEAD, POST, DELETE');
    }
    const wrong = await h.api('GET', '/api/sessions/s1/reanalyze');
    expectApiError(wrong, 405, 'method_not_allowed');
    expect(wrong.headers.allow).toBe('POST');
    const post = await h.api('POST', '/api/sessions/s1');
    expect(post.headers.allow).toBe('GET, HEAD, DELETE');
    expectApiError(await h.call({ method: 'POST', path: '/' }), 405, 'method_not_allowed');
  });

  it('limits body size and rejects bodies on other methods', async () => {
    const h = await start({ store: fakeStore({ getSession: () => fakeSession('s1') }) });
    const big = JSON.stringify({ login: 'x'.repeat(17 * 1024) });
    const headers = { 'Content-Type': 'application/json' };
    expectApiError(
      await h.call({ method: 'POST', path: '/api/auth/exchange', headers, body: big }),
      413,
      'payload_too_large',
    );
    expectApiError(
      await h.call({
        method: 'POST',
        path: '/api/auth/exchange',
        headers,
        body: big,
        chunked: true,
      }),
      413,
      'payload_too_large',
    );
    expectApiError(await h.api('GET', '/api/status', { body: '{}', headers }), 400, 'bad_request');
    expectApiError(await h.call({ path: '/', body: 'x' }), 400, 'bad_request');
    const reanalyzeEmpty = await h.api('POST', '/api/sessions/s1/reanalyze');
    expect(reanalyzeEmpty.status).toBe(200);
  });

  it('times out slow request bodies', async () => {
    const h = await start({}, { bodyTimeoutMs: 100 });
    const res = await h.call({
      method: 'POST',
      path: '/api/auth/exchange',
      headers: { 'Content-Type': 'application/json', 'Content-Length': '50' },
      hold: true,
    });
    expectApiError(res, 408, 'request_timeout');
  });

  it('rejects malformed request targets', async () => {
    const h = await start();
    for (const path of ['/api//status', '/api/%zz', '/api/%2fstatus', '/api/a%00']) {
      expectApiError(await h.api('GET', path), 400, 'bad_request');
    }
  });

  it('answers malformed HTTP with a bare 400 that keeps the security headers', async () => {
    const h = await start();
    const { connect } = await import('node:net');
    const raw = await new Promise<string>((resolve, reject) => {
      const socket = connect(h.port, '127.0.0.1', () => {
        socket.write('GARBAGE\r\n\r\n');
      });
      let data = '';
      socket.on('data', (chunk) => (data += chunk.toString('utf8')));
      socket.on('end', () => {
        resolve(data);
      });
      socket.on('error', reject);
    });
    expect(raw).toMatch(/^HTTP\/1\.1 400 /);
    expect(raw).toContain('X-Content-Type-Options: nosniff');
  });
});

describe('API routes', () => {
  it('GET /api/sessions parses the query strictly', async () => {
    const response: SessionListResponse = { sessions: [], nextCursor: null, total: 0 };
    const listSessions = vi.fn((_query: SessionListQuery) => response);
    const h = await start({ store: fakeStore({ listSessions }) });
    const res = await h.api('GET', '/api/sessions');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expectSecurityHeaders(res);
    expect(json(res)).toEqual(response);
    expect(listSessions).toHaveBeenLastCalledWith({
      risk: null,
      status: null,
      q: null,
      projectId: null,
      sort: 'review',
      limit: 50,
      cursor: null,
    });
    await h.api(
      'GET',
      '/api/sessions?risk=high,medium,high&status=active&q=%20fix%20&projectId=p1&sort=recent&limit=200&cursor=abc',
    );
    expect(listSessions).toHaveBeenLastCalledWith({
      risk: ['high', 'medium'],
      status: ['active'],
      q: 'fix',
      projectId: 'p1',
      sort: 'recent',
      limit: 200,
      cursor: 'abc',
    });
    for (const query of [
      'risk=bogus',
      'risk=',
      'risk=high,',
      'status=done',
      'sort=oldest',
      'limit=0',
      'limit=201',
      'limit=1.5',
      'limit=-1',
      'other=1',
      'limit=5&limit=6',
      `q=${'x'.repeat(201)}`,
      'projectId=../x',
      'cursor=a%20b',
    ]) {
      expectApiError(await h.api('GET', `/api/sessions?${query}`), 400, 'bad_request');
    }
    expect(listSessions).toHaveBeenCalledTimes(2);
  });

  it('GET /api/sessions/:id returns the detail with its report', async () => {
    const getSessionDetail = vi.fn((id: string) => (id === 's1' ? fakeDetail('s1') : null));
    const h = await start({ store: fakeStore({ getSessionDetail }) });
    const res = await h.api('GET', '/api/sessions/s1');
    expect(res.status).toBe(200);
    const body = json(res) as { session: { id: string }; report: { sessionId: string } };
    expect(body.session.id).toBe('s1');
    expect(body.report).toEqual({ v: 1, sessionId: 's1' });
    expect(reports.buildSessionReport).toHaveBeenCalledWith(expect.anything(), {
      now: h.deps.clock.now,
      home: '/home/tester',
    });
    expectApiError(await h.api('GET', '/api/sessions/missing'), 404, 'not_found');
    for (const id of ['.hidden', 'a'.repeat(129), 'a%20b', '%2e%2e']) {
      const res2 = await h.api('GET', `/api/sessions/${id}`);
      expect(res2.status).toBe(400);
    }
  });

  it('HEAD on a GET route returns headers without a body', async () => {
    const h = await start();
    const res = await h.api('HEAD', '/api/status');
    expect(res.status).toBe(200);
    expect(res.body).toBe('');
    expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
  });

  it('GET /api/sessions/:id/events returns event views with summaries and finding ids', async () => {
    const listEvents = vi.fn(() => ({
      events: [fakeEvent('e1', 's1'), fakeEvent('e2', 's1')],
      nextCursor: 'next',
    }));
    const store = fakeStore({
      getSession: (id) => (id === 's1' ? fakeSession('s1') : null),
      listEvents,
      findingIdsByEvent: () => ({ e1: ['f1'] }),
    });
    const h = await start({ store });
    const res = await h.api('GET', '/api/sessions/s1/events?limit=500&cursor=c1');
    expect(res.status).toBe(200);
    const body = json(res) as {
      events: { id: string; summary: string; findingIds: string[] }[];
      nextCursor: string | null;
    };
    expect(body.nextCursor).toBe('next');
    expect(body.events.map((e) => [e.id, e.summary, e.findingIds])).toEqual([
      ['e1', 'Ran git status', ['f1']],
      ['e2', 'Ran git status', []],
    ]);
    expect(listEvents).toHaveBeenLastCalledWith('s1', { cursor: 'c1', limit: 500 });
    expect(reports.describeEvent).toHaveBeenCalledWith(expect.anything(), {
      base: '/work/repo',
      home: '/home/tester',
    });
    await h.api('GET', '/api/sessions/s1/events');
    expect(listEvents).toHaveBeenLastCalledWith('s1', { cursor: null, limit: 200 });
    expectApiError(await h.api('GET', '/api/sessions/s1/events?limit=501'), 400, 'bad_request');
    expectApiError(await h.api('GET', '/api/sessions/s1/events?risk=high'), 400, 'bad_request');
    expectApiError(await h.api('GET', '/api/sessions/s2/events'), 404, 'not_found');
  });

  it('GET /api/events/:id returns one event view', async () => {
    const session = { ...fakeSession('s1'), projectRoot: null };
    const store = fakeStore({
      getEvent: (id) => (id === 'e1' ? fakeEvent('e1', 's1') : null),
      getSession: () => session,
      findingIdsByEvent: () => ({ e1: ['f1', 'f2'] }),
    });
    const h = await start({ store });
    const res = await h.api('GET', '/api/events/e1');
    expect(res.status).toBe(200);
    expect(json(res)).toMatchObject({
      id: 'e1',
      summary: 'Ran git status',
      findingIds: ['f1', 'f2'],
    });
    expect(reports.describeEvent).toHaveBeenCalledWith(expect.anything(), {
      base: '/work/repo/sub',
      home: '/home/tester',
    });
    expectApiError(await h.api('GET', '/api/events/e9'), 404, 'not_found');
  });

  it('GET /api/sessions/:id/report.md sends a Markdown attachment', async () => {
    const id = 'abc.DEF_1-2';
    const store = fakeStore({ getSessionDetail: (s) => (s === id ? fakeDetail(id) : null) });
    const h = await start({ store });
    const res = await h.api('GET', `/api/sessions/${id}/report.md`);
    expect(res.status).toBe(200);
    expect(res.body).toBe('# Session report\n');
    expect(res.headers['content-type']).toBe('text/markdown; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="stillwatch-session-abc_DEF_1-2.md"',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expectSecurityHeaders(res);
    expectApiError(await h.api('GET', '/api/sessions/zzz/report.md'), 404, 'not_found');
  });

  it('POST /api/sessions/:id/reanalyze asks for analysis', async () => {
    const requestAnalysis = vi.fn();
    const store = fakeStore({ getSession: (id) => (id === 's1' ? fakeSession('s1') : null) });
    const h = await start({ store, requestAnalysis });
    const res = await h.api('POST', '/api/sessions/s1/reanalyze', {
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
    expect(json(res)).toEqual({ ok: true });
    expect(requestAnalysis).toHaveBeenCalledWith('s1');
    expectApiError(await h.api('POST', '/api/sessions/s2/reanalyze'), 404, 'not_found');
    expect(requestAnalysis).toHaveBeenCalledTimes(1);
  });

  it('DELETE /api/sessions/:id deletes and notifies', async () => {
    const onSessionDeleted = vi.fn();
    const store = fakeStore({ deleteSession: (id) => id === 's1' });
    const h = await start({ store, onSessionDeleted });
    const res = await h.api('DELETE', '/api/sessions/s1');
    expect(res.status).toBe(200);
    expect(json(res)).toEqual({ ok: true });
    expect(onSessionDeleted).toHaveBeenCalledWith('s1');
    expectApiError(await h.api('DELETE', '/api/sessions/s2'), 404, 'not_found');
    expect(onSessionDeleted).toHaveBeenCalledTimes(1);
  });

  it('turns handler exceptions into a 500 without details', async () => {
    const error = vi.fn();
    const secretish = 'detail-' + 'that-must-not-leak';
    const h = await start({
      getStatus: () => Promise.reject(new Error(secretish)),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error },
    });
    const res = await h.api('GET', '/api/status');
    expectApiError(res, 500, 'internal');
    expect(res.body).not.toContain(secretish);
    expect(JSON.stringify(error.mock.calls)).not.toContain(secretish);
  });

  it('returns 404 for unknown API paths', async () => {
    const h = await start();
    expectApiError(await h.api('GET', '/api/nope'), 404, 'not_found');
    expectApiError(await h.api('GET', '/api'), 404, 'not_found');
  });
});

describe('lifecycle', () => {
  it('binds 127.0.0.1 only and closes cleanly', async () => {
    const h = await start();
    const handle = handles[0]!;
    expect(handle.server.address()).toMatchObject({ address: '127.0.0.1', port: h.port });
    await handle.close();
    handles.length = 0;
    await expect(h.api('GET', '/api/status')).rejects.toThrow();
  });

  it('rejects when the port is taken', async () => {
    const h = await start();
    await expect(startHttpServer(fakeDeps({ port: h.port }))).rejects.toThrow();
  });
});
