/**
 * Serves the built dashboard from `webRoot`, or a short "dashboard not built"
 * page when there is none.
 *
 * Only regular files whose real path stays inside the real `webRoot` are
 * served; dotfiles are never served. Requests for missing paths that accept
 * HTML get `index.html` (single-page app routing), except under /assets/.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { open, realpath } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { methodNotAllowed, notFound } from './errors';
import { NO_STORE } from './headers';
import type { Method, Target } from './request';
import { sendBody } from './respond';
import type { Logger } from '../types';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

const IMMUTABLE = 'public, max-age=31536000, immutable';
const REVALIDATE = 'no-cache';
/** Dashboard files are small; anything larger is not served. */
const MAX_FILE_BYTES = 32 * 1024 * 1024;

const NOT_BUILT_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stillwatch</title>
</head>
<body>
<h1>Stillwatch dashboard not built</h1>
<p>The collector is running, but the dashboard files were not found.</p>
<p>Build the dashboard with <code>pnpm build</code>, then restart the collector with <code>stillwatch stop</code> and <code>stillwatch open</code>.</p>
</body>
</html>
`;

export type StaticRequest = { method: Method; target: Target; req: IncomingMessage };

export type StaticSite = {
  serve(request: StaticRequest, res: ServerResponse): Promise<void>;
};

function acceptsHtml(req: IncomingMessage): boolean {
  return (req.headers.accept ?? '').toLowerCase().includes('text/html');
}

function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

type FileHit = { body: Buffer; etag: string; lastModified: string; path: string };

/** Reads a regular file under `root` by real path, or returns null. */
async function readInside(root: string, segments: readonly string[]): Promise<FileHit | null> {
  let real: string;
  try {
    real = await realpath(join(root, ...segments));
  } catch {
    return null;
  }
  if (!isInside(root, real) || real === root) return null;
  const handle = await open(real, 'r').catch(() => null);
  if (!handle) return null;
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > MAX_FILE_BYTES) return null;
    const body = await handle.readFile();
    return {
      body,
      etag: `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`,
      lastModified: stats.mtime.toUTCString(),
      path: real,
    };
  } finally {
    await handle.close();
  }
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  return header.split(',').some((tag) => tag.trim() === etag || tag.trim() === '*');
}

function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: FileHit,
  cacheControl: string,
): void {
  const contentType = CONTENT_TYPES[extname(file.path).toLowerCase()] ?? 'application/octet-stream';
  const headers = { ETag: file.etag, 'Last-Modified': file.lastModified };
  if (etagMatches(req.headers['if-none-match'], file.etag)) {
    res.statusCode = 304;
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
    res.setHeader('Cache-Control', cacheControl);
    res.end();
    return;
  }
  sendBody(res, 200, contentType, file.body, { ...headers, 'Cache-Control': cacheControl });
}

function checkMethod(method: Method): void {
  if (method !== 'GET' && method !== 'HEAD') throw methodNotAllowed(['GET', 'HEAD']);
}

function notBuiltSite(): StaticSite {
  return {
    serve({ method, target, req }, res) {
      checkMethod(method);
      if (target.segments.length > 0 && !acceptsHtml(req)) throw notFound();
      sendBody(res, 200, CONTENT_TYPES['.html'] ?? 'text/html', NOT_BUILT_PAGE, {
        'Cache-Control': NO_STORE,
      });
      return Promise.resolve();
    },
  };
}

function builtSite(root: string): StaticSite {
  return {
    async serve({ method, target, req }, res) {
      checkMethod(method);
      const { segments } = target;
      if (segments.some((segment) => segment.startsWith('.'))) throw notFound();
      const isAsset = segments[0] === 'assets';
      const file =
        segments.length === 0 || target.trailingSlash ? null : await readInside(root, segments);
      if (file) {
        const isIndex = segments.length === 1 && segments[0] === 'index.html';
        sendFile(req, res, file, isAsset && !isIndex ? IMMUTABLE : REVALIDATE);
        return;
      }
      if (isAsset || (segments.length > 0 && !acceptsHtml(req))) throw notFound();
      const index = await readInside(root, ['index.html']);
      if (!index) throw notFound();
      sendFile(req, res, index, REVALIDATE);
    },
  };
}

/**
 * Creates the static site. When `webRoot` is null or cannot be resolved, the
 * site serves the "dashboard not built" page.
 */
export async function createStaticSite(
  webRoot: string | null,
  logger: Logger,
): Promise<StaticSite> {
  if (webRoot === null) return notBuiltSite();
  try {
    return builtSite(await realpath(webRoot));
  } catch {
    logger.warn('dashboard directory not found; serving the not-built page');
    return notBuiltSite();
  }
}
