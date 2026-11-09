/**
 * Request guards that run before routing: method, Host (DNS rebinding),
 * Origin on state-changing requests, body presence, and strict parsing of the
 * request target into decoded path segments.
 */
import type { IncomingMessage } from 'node:http';
import { MAX_TARGET_LENGTH } from './limits';
import { badRequest, HttpError, methodNotAllowed } from './errors';

export const ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'DELETE'] as const;
export type Method = (typeof ALLOWED_METHODS)[number];

function isMethod(value: string): value is Method {
  return (ALLOWED_METHODS as readonly string[]).includes(value);
}

/** Returns the request method, or throws 405 for anything else. */
export function parseMethod(method: string | undefined): Method {
  if (method !== undefined && isMethod(method)) return method;
  throw methodNotAllowed(ALLOWED_METHODS);
}

function localAuthorities(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

/** Rejects requests whose Host is not exactly 127.0.0.1:<port> or localhost:<port> (421). */
export function checkHost(host: string | undefined, port: number): void {
  if (host === undefined || !localAuthorities(port).includes(host)) {
    throw new HttpError(421, 'misdirected_request', 'Unexpected Host header');
  }
}

/** Rejects POST and DELETE requests that carry a foreign Origin (403). */
export function checkOrigin(method: Method, origin: string | undefined, port: number): void {
  if (method !== 'POST' && method !== 'DELETE') return;
  if (origin === undefined) return;
  const allowed = localAuthorities(port).map((authority) => `http://${authority}`);
  if (!allowed.includes(origin)) throw new HttpError(403, 'forbidden', 'Origin not allowed');
}

/** True when the request announces a body (non-zero length or a transfer encoding). */
export function declaresBody(req: IncomingMessage): boolean {
  if (req.headers['transfer-encoding'] !== undefined) return true;
  const length = req.headers['content-length'];
  return length !== undefined && length !== '0';
}

export type Target = {
  /** Decoded path segments, without empty segments. `/` gives `[]`. */
  segments: string[];
  /** True when the raw path ended with `/`. */
  trailingSlash: boolean;
  query: URLSearchParams;
  isApi: boolean;
};

const VISIBLE_ASCII = /^[\x21-\x7e]+$/;
const ENCODED_SEPARATOR_OR_NUL = /%(?:2f|5c|00)/i;

/**
 * Parses an origin-form request target. Rejects (400) absolute forms,
 * control characters, backslashes, encoded slashes or NUL, empty or dot
 * segments (also when percent-encoded), and invalid percent-encoding.
 */
export function parseTarget(rawUrl: string | undefined): Target {
  if (rawUrl === undefined || rawUrl.length > MAX_TARGET_LENGTH) throw badRequest('Bad path');
  if (!rawUrl.startsWith('/') || !VISIBLE_ASCII.test(rawUrl)) throw badRequest('Bad path');
  const queryStart = rawUrl.indexOf('?');
  const rawPath = queryStart === -1 ? rawUrl : rawUrl.slice(0, queryStart);
  const rawQuery = queryStart === -1 ? '' : rawUrl.slice(queryStart + 1);
  if (rawPath.includes('\\') || ENCODED_SEPARATOR_OR_NUL.test(rawPath)) {
    throw badRequest('Bad path');
  }
  const trailingSlash = rawPath.length > 1 && rawPath.endsWith('/');
  const parts = rawPath === '/' ? [] : rawPath.slice(1, trailingSlash ? -1 : undefined).split('/');
  const segments = parts.map((part) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      throw badRequest('Bad path');
    }
    if (decoded === '' || decoded === '.' || decoded === '..' || decoded.includes('\0')) {
      throw badRequest('Bad path');
    }
    return decoded;
  });
  return {
    segments,
    trailingSlash,
    query: new URLSearchParams(rawQuery),
    isApi: segments[0] === 'api',
  };
}
