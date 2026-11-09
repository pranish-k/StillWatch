/**
 * HTTP errors raised by guards and handlers and turned into `ApiErrorBody`
 * responses by the server. Messages are fixed strings: they never contain
 * request data, tokens, or session content.
 */
import type { ApiErrorBody } from '@stillwatch/schema';

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'request_timeout'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'misdirected_request'
  | 'rate_limited'
  | 'internal';

export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  /** Extra response headers, e.g. `Allow` or `Retry-After`. */
  readonly headers: Readonly<Record<string, string>>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    headers: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export function badRequest(message: string): HttpError {
  return new HttpError(400, 'bad_request', message);
}

export function notFound(message = 'Not found'): HttpError {
  return new HttpError(404, 'not_found', message);
}

export function methodNotAllowed(allow: readonly string[]): HttpError {
  return new HttpError(405, 'method_not_allowed', 'Method not allowed', {
    Allow: allow.join(', '),
  });
}

export function unauthorized(message = 'Authentication required'): HttpError {
  return new HttpError(401, 'unauthorized', message, { 'WWW-Authenticate': 'Bearer' });
}

export function internalError(): HttpError {
  return new HttpError(500, 'internal', 'Internal error');
}

export function errorBody(error: HttpError): ApiErrorBody {
  return { error: { code: error.code, message: error.message } };
}
