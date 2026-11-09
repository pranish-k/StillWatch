import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from './headers';
import { startHttpServer } from './index';
import { fakeDeps, send, type RawRequest, type RawResponse } from './test-support';
import type { HttpServerHandle } from './types';

let dir = '';
let webRoot = '';
const handles: HttpServerHandle[] = [];

const INDEX = '<!doctype html><title>Stillwatch</title><script src="/assets/app.js"></script>';
const SECRET = 'outside-' + 'the-web-root';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'stillwatch-static-'));
  webRoot = join(dir, 'web');
  await mkdir(join(webRoot, 'assets'), { recursive: true });
  await writeFile(join(webRoot, 'index.html'), INDEX);
  await writeFile(join(webRoot, 'assets', 'app.js'), 'console.log(1);');
  await writeFile(join(webRoot, 'assets', 'app.css'), 'body{}');
  await writeFile(join(webRoot, 'assets', 'font.woff2'), Buffer.from([1, 2, 3]));
  await writeFile(join(webRoot, 'favicon.svg'), '<svg/>');
  await writeFile(join(webRoot, '.env'), SECRET);
  await mkdir(join(webRoot, '.git'));
  await writeFile(join(webRoot, '.git', 'config'), SECRET);
  await writeFile(join(dir, 'secret.txt'), SECRET);
  await symlink(join(dir, 'secret.txt'), join(webRoot, 'escape.txt'));
  await symlink(dir, join(webRoot, 'assets', 'up'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

afterEach(async () => {
  await Promise.all(handles.splice(0).map((h) => h.close()));
});

async function serve(root: string | null) {
  const handle = await startHttpServer(fakeDeps({ webRoot: root }));
  handles.push(handle);
  return (options: RawRequest) => send(handle.port, options);
}

const HTML = { Accept: 'text/html,application/xhtml+xml' };

function expectSecurityHeaders(res: RawResponse): void {
  expect(res.headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY);
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['x-frame-options']).toBe('DENY');
  expect(res.headers['referrer-policy']).toBe('no-referrer');
}

describe('static files', () => {
  it('serves index.html at / (also with a login link) without long caching', async () => {
    const get = await serve(webRoot);
    for (const path of ['/', '/?login=1.abc.def', '/index.html']) {
      const res = await get({ path, headers: HTML });
      expect(res.status).toBe(200);
      expect(res.body).toBe(INDEX);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers.etag).toMatch(/^W\/"/);
      expect(res.headers['last-modified']).toBeDefined();
      expectSecurityHeaders(res);
    }
  });

  it('serves assets with content types and immutable caching', async () => {
    const get = await serve(webRoot);
    const cases: [string, string][] = [
      ['/assets/app.js', 'text/javascript; charset=utf-8'],
      ['/assets/app.css', 'text/css; charset=utf-8'],
      ['/assets/font.woff2', 'font/woff2'],
    ];
    for (const [path, type] of cases) {
      const res = await get({ path });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe(type);
      expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
      expectSecurityHeaders(res);
    }
    const icon = await get({ path: '/favicon.svg' });
    expect(icon.headers['content-type']).toBe('image/svg+xml');
    expect(icon.headers['cache-control']).toBe('no-cache');
  });

  it('answers If-None-Match with 304 and supports HEAD', async () => {
    const get = await serve(webRoot);
    const first = await get({ path: '/assets/app.js' });
    const etag = String(first.headers.etag);
    const cached = await get({ path: '/assets/app.js', headers: { 'If-None-Match': etag } });
    expect(cached.status).toBe(304);
    expect(cached.body).toBe('');
    expectSecurityHeaders(cached);
    const head = await get({ method: 'HEAD', path: '/assets/app.js' });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    expect(head.headers['content-length']).toBe(String('console.log(1);'.length));
  });

  it('falls back to index.html for app routes that accept HTML', async () => {
    const get = await serve(webRoot);
    const res = await get({ path: '/sessions/abc?tab=events', headers: HTML });
    expect(res.status).toBe(200);
    expect(res.body).toBe(INDEX);
    expect(res.headers['cache-control']).toBe('no-cache');
    const notHtml = await get({ path: '/sessions/abc', headers: { Accept: 'application/json' } });
    expect(notHtml.status).toBe(404);
    expectSecurityHeaders(notHtml);
    expect((await get({ path: '/assets/missing.js', headers: HTML })).status).toBe(404);
  });

  it('never serves files outside the web root, dotfiles, or traversal attempts', async () => {
    const get = await serve(webRoot);
    const attempts = [
      '/../secret.txt',
      '/assets/../../secret.txt',
      '/%2e%2e/secret.txt',
      '/assets/%2E%2E/%2e%2e/secret.txt',
      '/%2e%2e%2fsecret.txt',
      '/..%2fsecret.txt',
      '/..%5csecret.txt',
      '/..\\secret.txt',
      '/index.html%00.js',
      '/.env',
      '/%2eenv',
      '/.git/config',
      '/escape.txt',
      '/assets/up/secret.txt',
      '//etc/passwd',
    ];
    for (const path of attempts) {
      const res = await get({ path });
      expect(res.body, path).not.toContain(SECRET);
      expect([400, 404], path).toContain(res.status);
      expectSecurityHeaders(res);
      // With an HTML Accept header, the most a miss can give is the SPA index page.
      const html = await get({ path, headers: HTML });
      expect(html.body, path).not.toContain(SECRET);
      if (html.status === 200) expect(html.body, path).toBe(INDEX);
      else expect([400, 404], path).toContain(html.status);
    }
  });

  it('allows only GET and HEAD for static paths', async () => {
    const get = await serve(webRoot);
    const res = await get({ method: 'DELETE', path: '/index.html' });
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET, HEAD');
  });
});

describe('dashboard not built', () => {
  it('serves a static page without scripts when webRoot is null or missing', async () => {
    for (const root of [null, join(dir, 'does-not-exist')]) {
      const get = await serve(root);
      const res = await get({ path: '/', headers: HTML });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(res.body).toContain('dashboard not built');
      expect(res.body).not.toContain('<script');
      expect(res.body).not.toContain('style');
      expectSecurityHeaders(res);
      expect((await get({ path: '/sessions/x', headers: HTML })).status).toBe(200);
      expect((await get({ path: '/assets/app.js' })).status).toBe(404);
      expect((await get({ method: 'HEAD', path: '/' })).body).toBe('');
      await handles.pop()?.close();
    }
  });
});
